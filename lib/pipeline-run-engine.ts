import {
  verifyAndRepairChapterAsync,
  verifyAndRollbackStylistPass,
  type ChapterVerificationOutput,
} from './chapter-verifier-server.ts';
import { finalizeAndVerifyChapter } from './chapter-verifier.ts';
import {
  buildCharacterVoicePromptBlock,
} from './canon-glossary-vault.ts';
import * as llmInferenceNamespace from './llm-inference-port.ts';
import {
  getAiClientPool,
  createPipelineLlmPort,
  buildScoutPrompts,
  buildTranslatePass1Prompts,
  buildSurgicalCriticPass2Prompts,
  buildBlindStylistPass3Prompts,
  buildSelfRepairPrompts,
  deterministicLocalTranslate,
  type LlmInferencePort,
} from './llm-inference-port.ts';
import {
  annotateSceneDialogueAndZeroPronouns,
  classifyScenePacingMode,
  selectContrastiveFewShotTriplets,
  capStylisticDirectivesPerParagraph,
  type ScenePacingMode,
  type StylisticSpanDirective,
  type LiTransProQaRubricScores,
} from './scene-analysis.ts';
import {
  analyzeChapterPreFlightWithDecision1,
  auditChapterDraftWithDecision1,
  refereeStylistRewritesWithDecision1,
  type ChapterDecisionAuditResult,
  type ChapterPreFlightDecisionResult,
} from './gemini-decision-engine.ts';
import { detectCrossChapterSlopCooldown } from './delta-diting.ts';
import {
  runAdditionBySubtractionScout,
  filterScoutedTermsWithAgentS,
  filterGlossaryForChapter,
  applySurgicalPatches,
  extractResilientJsonFromLlm,
  splitChapterParagraphs,
  joinParagraphsPreservingSystemBoxes,
  GENRE_PRESET_LABELS,
  PROSE_TONE_LABELS,
  DEFAULT_LLM_PROVIDER_CONFIG,
  type SurgicalPatchItem,
} from './qa-linter.ts';
import {
  parseRubyAndGikunMarkup,
  normalizeKoreanOneLineParagraphs,
} from './ruby-korean-parser.ts';
import type {
  ArcCanonPacket,
  CanonicalGlossary,
  CrossChapterSlopIssue,
  CsiCulturalNote,
  GenrePreset,
  GlossaryTermMeta,
  GrammaticalGender,
  LintIssue,
  LintRuleId,
  LlmProviderConfig,
  ProseTone,
  ScoutedTerm,
  SocialRegisterEdge,
  StreamedChapterDraft,
} from './pipeline-types.ts';
import type { ChapterRecord, NovelProject } from './seed-data.ts';
import {
  compileArcPreLinkerDeterministic,
  runPipelineBatchOnNovelCore,
  autoMergeSplitChaptersInNovel,
  prepareGlossaryStopGateTerms,
  InMemoryPipelineTransportAdapter,
  FetchPipelineTransportAdapter,
  sampleChaptersStratifiedMonteCarlo,
  evaluateLorebookStateMachine,
  type PipelineTransportScoutRequest,
  type PipelineTransportScoutResponse,
  type PipelineTransportTranslateRequest,
  type PipelineTransportTranslateResponse,
  type PipelineTransportVerifyRequest,
  type PipelineTransportAdapter,
  type PipelineBatchProgressEvent,
  type PipelineBatchOptions,
  type ServerPipelineBatchHooks,
} from './pipeline-batch-runner.ts';

export {
  autoMergeSplitChaptersInNovel,
  prepareGlossaryStopGateTerms,
  InMemoryPipelineTransportAdapter,
  FetchPipelineTransportAdapter,
  sampleChaptersStratifiedMonteCarlo,
  evaluateLorebookStateMachine,
  type PipelineTransportScoutRequest,
  type PipelineTransportScoutResponse,
  type PipelineTransportTranslateRequest,
  type PipelineTransportTranslateResponse,
  type PipelineTransportVerifyRequest,
  type PipelineTransportAdapter,
  type PipelineBatchProgressEvent,
  type PipelineBatchOptions,
  type ServerPipelineBatchHooks,
};

export interface ServerPipelineExecutionOptions {
  enableNeuralAudit?: boolean;
  llmPortFactory?: (
    config: LlmProviderConfig | undefined,
    glossary: CanonicalGlossary,
    proseTone: ProseTone
  ) => LlmInferencePort;
}

type ParsePass1Fn = (rawText: string, expectedParagraphCount: number) => StreamedChapterDraft;
type BuildContinuationFn = (params: {
  chapterNumber: number;
  titleEng: string;
  engText: string;
  alreadyTranslatedParagraphs: string[];
  startParagraphIndex: number;
  filteredGlossary?: CanonicalGlossary;
  outputFormat?: 'json' | 'stream_delimited';
  styleGuideMd?: string;
  arcCanonBlock?: string;
}) => { systemPrompt: string; userPrompt: string };
type BuildUnifiedDeltaPatcherFn = (params: {
  chapterNumber?: number;
  titleEng?: string;
  engParagraphs: string[];
  rusParagraphs: string[];
  flawedIndices: number[];
  lintIssues?: LintIssue[];
  slopIssues?: CrossChapterSlopIssue[];
  filteredGlossary?: CanonicalGlossary;
  characterVoicesBlock?: string;
  toneTitle?: string;
}) => { systemPrompt: string; userPrompt: string };
type CompileArcPreLinkerFn = (params: {
  chapters: Array<{ number: number; titleEng?: string; engText: string }>;
  glossary: CanonicalGlossary;
  glossaryMeta?: Record<string, GlossaryTermMeta>;
  socialEdges?: SocialRegisterEdge[];
  llmPort?: LlmInferencePort;
  genreTitle?: string;
  genrePromptHint?: string;
  arcId?: string;
}) => Promise<{
  arcPacket: ArcCanonPacket;
  inferredGenders?: Record<string, GrammaticalGender>;
  suggestedTerms?: ScoutedTerm[];
}>;

function parsePass1TranslationOutputSafe(
  rawText: string,
  expectedParagraphCount: number
): StreamedChapterDraft {
  const ext = (llmInferenceNamespace as Record<string, unknown>)
    .parsePass1TranslationOutput as ParsePass1Fn | undefined;
  if (typeof ext === 'function') {
    return ext(rawText, expectedParagraphCount);
  }

  const cleanedRaw = (rawText || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const hasStreamMarkers = /@@P\d{2,4}\b/.test(cleanedRaw);

  if (hasStreamMarkers) {
    const paragraphs: string[] = [];
    let currentIdx = -1;
    let buffer: string[] = [];
    let titleRus = '';
    let summary = '';
    let summaryEng = '';
    const csiNotes: string[] = [];

    const flush = () => {
      if (currentIdx >= 0 && buffer.length > 0) {
        paragraphs[currentIdx] = buffer.join('\n').trim();
      }
      buffer = [];
    };

    for (const line of cleanedRaw.split(/\r?\n/)) {
      const pMatch = line.match(/^@@P(\d{2,4})\s*(.*)$/);
      if (pMatch) {
        flush();
        currentIdx = Number(pMatch[1]);
        if (pMatch[2].trim()) buffer.push(pMatch[2].trim());
        continue;
      }
      if (line.startsWith('@@TITLE ')) {
        flush();
        currentIdx = -1;
        titleRus = line.slice(8).trim();
        continue;
      }
      if (line.startsWith('@@SUMMARY_RU ')) {
        flush();
        currentIdx = -1;
        summary = line.slice(13).trim();
        continue;
      }
      if (line.startsWith('@@SUMMARY_EN ')) {
        flush();
        currentIdx = -1;
        summaryEng = line.slice(13).trim();
        continue;
      }
      if (line.startsWith('@@CSI ')) {
        flush();
        currentIdx = -1;
        const csiLine = line.slice(6).trim();
        if (csiLine) csiNotes.push(csiLine);
        continue;
      }
      if (currentIdx >= 0) {
        buffer.push(line);
      }
    }
    flush();

    const denseParagraphs = paragraphs.map((p) => (p ?? '').trim());
    let lastCompletedIndex = -1;
    for (let i = 0; i < denseParagraphs.length; i++) {
      if (denseParagraphs[i]) lastCompletedIndex = i;
    }
    const populatedCount = denseParagraphs.filter(Boolean).length;
    return {
      titleRus,
      paragraphs: denseParagraphs,
      rusText: denseParagraphs.filter(Boolean).join('\n\n'),
      summary,
      summaryEng,
      csiNotes,
      truncated: expectedParagraphCount > 0 && populatedCount < expectedParagraphCount,
      lastCompletedIndex,
    };
  }

  const parsed = extractResilientJsonFromLlm<{
    titleRus?: string;
    rusText?: string;
    summary?: string;
    summaryEng?: string;
    csiNotes?: unknown[];
  }>(cleanedRaw, {});

  const rusText =
    typeof parsed.rusText === 'string' && parsed.rusText.trim()
      ? parsed.rusText.trim()
      : !cleanedRaw.startsWith('{') && /[а-яА-ЯёЁ]{10,}/.test(cleanedRaw)
        ? cleanedRaw
        : '';
  const paragraphs = rusText ? splitChapterParagraphs(rusText) : [];
  return {
    titleRus: typeof parsed.titleRus === 'string' ? parsed.titleRus.trim() : '',
    paragraphs,
    rusText,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    summaryEng: typeof parsed.summaryEng === 'string' ? parsed.summaryEng.trim() : '',
    csiNotes: Array.isArray(parsed.csiNotes)
      ? parsed.csiNotes.map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))
      : [],
    truncated:
      expectedParagraphCount > 0 &&
      paragraphs.length > 0 &&
      paragraphs.length + 1 < expectedParagraphCount,
    lastCompletedIndex: paragraphs.length - 1,
  };
}

function buildContinuationPromptSafe(params: {
  chapterNumber: number;
  titleEng: string;
  engText: string;
  engParagraphs: string[];
  completedParagraphs: string[];
  lastCompletedIndex: number;
  filteredGlossary?: CanonicalGlossary;
  styleGuideMd?: string;
  arcCanonBlock?: string;
}): { systemPrompt: string; userPrompt: string } {
  const startParagraphIndex = params.lastCompletedIndex + 1;
  const ext = (llmInferenceNamespace as Record<string, unknown>)
    .buildPass1ContinuationPrompt as BuildContinuationFn | undefined;
  if (typeof ext === 'function') {
    return ext({
      chapterNumber: params.chapterNumber,
      titleEng: params.titleEng,
      engText: params.engText,
      alreadyTranslatedParagraphs: params.completedParagraphs.filter(Boolean),
      startParagraphIndex,
      filteredGlossary: params.filteredGlossary,
      outputFormat: 'stream_delimited',
      styleGuideMd: params.styleGuideMd,
      arcCanonBlock: params.arcCanonBlock,
    });
  }

  const remaining = params.engParagraphs
    .map((text, index) => ({ index, text }))
    .filter((item) => item.index >= startParagraphIndex);
  const tail = params.completedParagraphs
    .map((text, index) => ({ index, text }))
    .filter((item) => Boolean(item.text))
    .slice(-2);

  return {
    systemPrompt:
      'Continue the Russian literary translation strictly from the next @@P index without repeating previous paragraphs. Output @@PNNN lines followed by @@TITLE, @@SUMMARY_RU, @@SUMMARY_EN.',
    userPrompt:
      `PREVIOUS TRANSLATED TAIL:\n${tail
        .map((t) => `@@P${String(t.index).padStart(3, '0')} ${t.text}`)
        .join('\n')}\n\nREMAINING SOURCE PARAGRAPHS:\n${remaining
        .map((r) => `@@P${String(r.index).padStart(3, '0')} ${r.text}`)
        .join('\n')}`,
  };
}

/**
 * Canonical 4-Pass Server & Headless Pipeline Execution Adapter.
 * Shared by `/api/pipeline` and `scripts/headless-runner.ts` so chapter-scoped glossary slicing,
 * Pass 1 resilience fallback, Pass 2 LiTransProQA, Pass 3 Source Firewall, and 3-Stage Self-Repair
 * behave identically across Web Studio and CLI.
 */
export class ServerPipelineExecutionAdapter implements PipelineTransportAdapter {
  protected readonly defaultLlmConfig: LlmProviderConfig;
  protected readonly explicitEnableNeuralAudit?: boolean;
  protected readonly enableNeuralAudit: boolean;
  protected readonly hasCustomLlmPortFactory: boolean;
  protected readonly llmPortFactory: NonNullable<ServerPipelineExecutionOptions['llmPortFactory']>;

  constructor(
    llmConfig: LlmProviderConfig = DEFAULT_LLM_PROVIDER_CONFIG,
    options?: ServerPipelineExecutionOptions
  ) {
    this.defaultLlmConfig = llmConfig;
    this.explicitEnableNeuralAudit = options?.enableNeuralAudit;
    this.enableNeuralAudit =
      options?.enableNeuralAudit ?? ((llmConfig?.provider as string) !== 'deterministic');
    this.hasCustomLlmPortFactory = Boolean(options?.llmPortFactory);
    this.llmPortFactory =
      options?.llmPortFactory ??
      ((cfg, gls, tone) => createPipelineLlmPort(cfg, gls, tone));
  }

  protected shouldRunNeuralAudit(config?: LlmProviderConfig): boolean {
    return (
      this.explicitEnableNeuralAudit ??
      (((config || this.defaultLlmConfig)?.provider as string) !== 'deterministic')
    );
  }

  protected shouldUseDecisionEngine(config?: LlmProviderConfig): boolean {
    const active = config || this.defaultLlmConfig;
    if (!active || (active.provider as string) === 'deterministic') return false;
    if (active.useDecisionEngine === false) return false;
    if (this.hasCustomLlmPortFactory && active.useDecisionEngine !== true) return false;
    return active.useDecisionEngine ?? getAiClientPool().length > 0;
  }

  protected resolveModelForStage(
    config: LlmProviderConfig | undefined,
    stage: 'primary' | 'scout' | 'critic' | 'stylist' | 'repair'
  ): string {
    const provider = config?.provider;
    const isAgyOnly = (m: string) => /^(?:gemini-4-argon|claude-)/i.test(m);
    const isUsableModel = (rawValue: string | undefined): rawValue is string => {
      const trimmed = (rawValue || '').trim();
      if (!trimmed) return false;
      if (trimmed.includes(':') && provider !== 'colab_ollama') return false;
      if (provider === 'gemini_api' && isAgyOnly(trimmed)) return false;
      return true;
    };

    if (stage === 'scout') {
      if (isUsableModel(config?.scoutModelId)) return config!.scoutModelId!.trim();
      return provider === 'antigravity_cli' ? 'gemini-3.8-flash-low' : 'gemini-3.1-flash-lite';
    }
    if (stage === 'critic') {
      if (isUsableModel(config?.criticModelId)) return config!.criticModelId!.trim();
      return provider === 'antigravity_cli' ? 'gemini-4-argon-medium' : 'gemini-3.8-flash';
    }
    if (stage === 'stylist') {
      if (isUsableModel(config?.stylistModelId)) return config!.stylistModelId!.trim();
      if (provider === 'antigravity_cli') return 'claude-sonnet-5-5-high';
      return this.resolveModelForStage(config, 'critic');
    }
    if (stage === 'repair') {
      if (provider === 'antigravity_cli') {
        return this.resolveModelForStage(config, 'primary');
      }
      return this.resolveModelForStage(config, 'critic');
    }
    if (isUsableModel(config?.modelId)) return config!.modelId!.trim();
    return provider === 'gemini_api' ? 'gemini-4-hydrogen' : 'gemini-3.8-flash';
  }

  async scout(req: PipelineTransportScoutRequest): Promise<PipelineTransportScoutResponse> {
    const config = req.llmConfig || this.defaultLlmConfig;
    const genrePreset = (req.genrePreset || 'xianxia') as GenrePreset;
    const genreInfo = GENRE_PRESET_LABELS[genrePreset] || GENRE_PRESET_LABELS.xianxia;
    const degradedWarnings: string[] = [];
    const localAbs = runAdditionBySubtractionScout(
      req.engText,
      req.chapterNumber,
      req.glossary,
      req.scoutedTerms || []
    );

    let preFlightScout: ChapterPreFlightDecisionResult | null = null;
    if (this.shouldUseDecisionEngine(config) && localAbs.discoveredTerms.length > 0) {
      try {
        preFlightScout = await analyzeChapterPreFlightWithDecision1({
          chapterNumber: req.chapterNumber,
          titleEng: req.titleEng,
          engText: req.engText,
          genreTitle: genreInfo.title,
          candidateTerms: localAbs.discoveredTerms.slice(0, 45).map((t) => ({
            eng: t.eng,
            context_snippet: t.context_snippet,
          })),
        });
      } catch (err: unknown) {
        preFlightScout = null;
        degradedWarnings.push(
          `Scout PreFlight Decision-1 degraded: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const scoutPrompts = buildScoutPrompts({
      chapterNumber: req.chapterNumber,
      titleEng: req.titleEng || `Chapter ${req.chapterNumber}`,
      engText: req.engText,
      glossary: req.glossary,
      scoutedTerms: req.scoutedTerms || [],
      genrePromptHint: genreInfo.promptHint,
      genreTitle: genreInfo.title,
    });

    let discoveredList = localAbs.discoveredTerms;
    let engineUsed = 'transagents-addition-by-subtraction-v3';

    if (preFlightScout) {
      const prunedByDecision = localAbs.discoveredTerms
        .map((dt) => {
          const dec = preFlightScout?.termDecisions[dt.eng];
          if (!dec) return dt;
          return {
            ...dt,
            category: dec.category || dt.category,
            gender: dec.gender !== 'UNKNOWN' ? dec.gender : dt.gender,
            confidence: Number(((dt.confidence + dec.keepConfidence) / 2).toFixed(2)),
            _decisionKeep: dec.keep,
          };
        })
        .filter((dt) => !('_decisionKeep' in dt) || (dt as { _decisionKeep?: boolean })._decisionKeep !== false);
      if (prunedByDecision.length > 0) {
        discoveredList = prunedByDecision;
      }
    }

    try {
      const llmPort = this.llmPortFactory(config, req.glossary, 'classic');
      const response = await llmPort.complete({
        task: 'scout',
        systemInstruction: scoutPrompts.systemPrompt,
        userPrompt: scoutPrompts.userPrompt,
        expectJson: true,
        temperature: 0.2,
        numCtx: config?.numCtx || 16384,
        geminiModel: this.resolveModelForStage(config, 'scout'),
        geminiResponseSchema: scoutPrompts.geminiSchema,
      });

      engineUsed = preFlightScout
        ? `${response.engineUsed} + gemini-decision-1`
        : response.engineUsed;
      const parsed = extractResilientJsonFromLlm<unknown>(
        response.text,
        localAbs.discoveredTerms
      );
      const candidateList = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { terms?: unknown[] })?.terms)
          ? (parsed as { terms: unknown[] }).terms
          : localAbs.discoveredTerms;

      if (Array.isArray(candidateList) && candidateList.length > 0) {
        const filteredCandidates = filterScoutedTermsWithAgentS(
          candidateList as typeof localAbs.discoveredTerms,
          req.glossary,
          req.scoutedTerms || []
        );
        if (filteredCandidates.length > 0) {
          discoveredList = filteredCandidates.map((fc) => {
            const dec = preFlightScout?.termDecisions[fc.eng];
            if (!dec) return fc;
            return {
              ...fc,
              category: dec.category || fc.category,
              gender: fc.gender && fc.gender !== 'UNKNOWN' ? fc.gender : dec.gender,
            };
          });
        }
      }
    } catch (err: unknown) {
      degradedWarnings.push(
        `LLM Scout degraded to Addition-by-Subtraction: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return {
      engine: engineUsed,
      ...(degradedWarnings.length > 0 ? { degradedWarnings } : {}),
      discoveredTerms: discoveredList.map((dt) => ({
        eng: dt.eng,
        rus_suggested: dt.rus_suggested,
        category: dt.category,
        gender: dt.gender || 'UNKNOWN',
        context_snippet: dt.context_snippet,
        confidence: dt.confidence ?? 0.95,
      })),
      addedRecallCount: localAbs.addedRecallCount,
      subtractedNoiseCount: localAbs.subtractedNoiseCount,
      subtractedSamples: localAbs.subtractedSamples,
    };
  }

  async translateAndEdit(
    req: PipelineTransportTranslateRequest
  ): Promise<PipelineTransportTranslateResponse> {
    const config = req.llmConfig || this.defaultLlmConfig;
    const isDeterministicProvider = config?.provider === 'deterministic';
    const genrePreset = (req.genrePreset || 'xianxia') as GenrePreset;
    const proseTone = (req.proseTone || 'classic') as ProseTone;
    const genreInfo = GENRE_PRESET_LABELS[genrePreset] || GENRE_PRESET_LABELS.xianxia;
    const toneInfo = PROSE_TONE_LABELS[proseTone] || PROSE_TONE_LABELS.classic;
    const llmPort = this.llmPortFactory(config, req.glossary, proseTone);

    // Step 0.1: Japanese AST Ruby/Gikun/Bouten Pre-parser & Korean One-Line Paragraph Normalizer
    const rubyGikunRes = parseRubyAndGikunMarkup(req.engText);
    const afterRubyText = rubyGikunRes.foundCount > 0 ? rubyGikunRes.parsedText : req.engText;
    const effectiveEngText = normalizeKoreanOneLineParagraphs(afterRubyText).normalizedText;
    const effectiveEngParagraphs = splitChapterParagraphs(effectiveEngText);
    const wordCountEng = effectiveEngText.trim().split(/\s+/).filter(Boolean).length;

    // Chapter-scoped glossary slice (prevents full-novel glossary bloat in both Web API & CLI)
    const { filteredGlossary, matchedCount } = filterGlossaryForChapter(
      effectiveEngText,
      req.glossary
    );

    const useDecisionEngine = this.shouldUseDecisionEngine(config);
    const degradedWarnings: string[] = [];
    let preFlightDecision: ChapterPreFlightDecisionResult | null = null;
    if (useDecisionEngine && !isDeterministicProvider) {
      try {
        preFlightDecision = await analyzeChapterPreFlightWithDecision1({
          chapterNumber: req.chapterNumber,
          titleEng: req.titleEng,
          engText: effectiveEngText,
          genreTitle: genreInfo.title,
        });
      } catch (err: unknown) {
        preFlightDecision = null;
        degradedWarnings.push(
          `Pass 0 PreFlight Decision-1 degraded: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const pacingMode: ScenePacingMode =
      (req.pacingMode as ScenePacingMode | undefined) ||
      preFlightDecision?.pacingMode ||
      classifyScenePacingMode(effectiveEngText);
    const resolvedThinkingLevel: 'low' | 'medium' | 'high' | 'xhigh' | undefined =
      config?.thinkingLevel && config.thinkingLevel !== 'auto_xhigh'
        ? config.thinkingLevel
        : preFlightDecision?.recommendedThinkingLevel ||
          (config?.provider === 'gemini_api' ? 'high' : undefined);
    const primaryModel = this.resolveModelForStage(config, 'primary');
    const criticModel = this.resolveModelForStage(config, 'critic');
    const stylistModel = this.resolveModelForStage(config, 'stylist');
    const repairModel = this.resolveModelForStage(config, 'repair');
    const repairThinkingLevel: 'low' | 'medium' | 'high' | undefined =
      resolvedThinkingLevel === 'xhigh' ? 'high' : resolvedThinkingLevel;
    const contrastiveTriplets = selectContrastiveFewShotTriplets(pacingMode, 3);
    const characterVoicesBlock = buildCharacterVoicePromptBlock(
      filteredGlossary,
      req.glossaryMeta || {}
    );
    const effectiveSceneDialogueBlock =
      req.sceneDialogueBlock ??
      (() => {
        const analysis = annotateSceneDialogueAndZeroPronouns(
          effectiveEngText,
          filteredGlossary,
          req.glossaryMeta || {},
          []
        );
        return analysis.annotations.length > 0 ? analysis.promptSummaryBlock : undefined;
      })();

    const genderRulesList: string[] = [];
    Object.entries(filteredGlossary.characters || {}).forEach(([eng, rus]) => {
      const meta = req.glossaryMeta?.[eng];
      if (meta) {
        genderRulesList.push(
          `${eng} → ${rus} (Род: ${meta.gender || 'UNKNOWN'}${meta.declensionNote ? `, Склонение: ${meta.declensionNote}` : ''}${meta.voiceNote ? `, Речь и регистр: ${meta.voiceNote}` : ''})`
        );
      }
    });
    if (preFlightDecision && preFlightDecision.narratorGender !== 'UNKNOWN') {
      genderRulesList.push(
        `Рассказчик от 1-го лица («я») → Род по контексту главы: ${preFlightDecision.narratorGender}`
      );
    }

    const buildQuarantineResponse = (reason: string): PipelineTransportTranslateResponse => ({
      engine: 'quarantined-outage',
      quarantined: true,
      quarantineReason: reason,
      titleRus: req.titleEng || `Глава ${req.chapterNumber}`,
      rusText: `[КАРАНТИН: ${reason}]`,
      summary: '',
      summaryEng: '',
      csiNotes: [],
      verified: false,
      alreadyVerified: false,
      wordCountEng,
      wordCountRus: 0,
      scenePacingMode: pacingMode,
      pacingMode,
    });

    // Pass 1: Streaming Delimited Protocol + Fail-Closed Quarantine
    const promptParams = {
      chapterNumber: req.chapterNumber,
      titleEng: req.titleEng,
      engText: effectiveEngText,
      genreTitle: genreInfo.title,
      genrePromptHint: genreInfo.promptHint,
      toneTitle: toneInfo.title,
      toneInstruction: toneInfo.instruction,
      styleGuideMd: req.styleGuideMd || '',
      filteredGlossary,
      matchedCount,
      genderRulesList,
      heroLedger: req.heroLedger,
      previousChapterSummary: req.previousChapterSummary,
      previousChapterSummaryEng: req.previousChapterSummaryEng,
      deltaShortTermWindow: req.deltaShortTermWindow,
      deltaLongTermMemories: req.deltaLongTermMemories,
      socialEdgesBlock: req.socialEdgesBlock,
      lorebookBlock: req.lorebookBlock,
      forwardQuestionsBlock: req.forwardQuestionsBlock,
      sceneDialogueBlock: effectiveSceneDialogueBlock,
      useHashAnchors: req.useHashAnchors ?? true,
      characterVoicesBlock,
      pacingMode,
      contrastiveTriplets,
      arcCanonBlock: req.arcCanonBlock,
      outputFormat: (isDeterministicProvider ? 'json' : 'stream_delimited') as
        | 'json'
        | 'stream_delimited',
    };
    const translatePrompts = (
      buildTranslatePass1Prompts as (
        opts: Parameters<typeof buildTranslatePass1Prompts>[0] & Record<string, unknown>
      ) => ReturnType<typeof buildTranslatePass1Prompts>
    )(promptParams);

    let pass1Response: { text: string; engineUsed: string };
    try {
      pass1Response = await llmPort.complete({
        task: 'translate_pass1',
        systemInstruction: translatePrompts.systemPrompt,
        userPrompt: translatePrompts.userPrompt,
        expectJson: isDeterministicProvider,
        temperature: config?.temperature ?? 0.2,
        numCtx: config?.numCtx ?? 16384,
        geminiModel: primaryModel,
        ...(resolvedThinkingLevel ? { thinkingLevel: resolvedThinkingLevel } : {}),
      });
    } catch (err: unknown) {
      if (!isDeterministicProvider) {
        const reason =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : 'Сбой всех провайдеров LLM на Pass 1';
        return buildQuarantineResponse(reason);
      }
      const fallback = deterministicLocalTranslate(
        effectiveEngText,
        req.titleEng,
        req.chapterNumber,
        req.glossary,
        proseTone
      );
      pass1Response = {
        text: JSON.stringify({
          titleRus: fallback.titleRus,
          rusText: fallback.rusText,
          summary: `Итог главы ${req.chapterNumber}`,
          summaryEng: `Summary of Chapter ${req.chapterNumber}`,
          csiNotes: [],
        }),
        engineUsed: 'deterministic-fallback',
      };
    }

    const parsedJson = extractResilientJsonFromLlm<{
      titleRus?: string;
      rusText?: string;
      summary?: string;
      summaryEng?: string;
      csiNotes?: CsiCulturalNote[];
    }>(pass1Response.text, {});

    const draft = parsePass1TranslationOutputSafe(
      pass1Response.text,
      effectiveEngParagraphs.length
    );

    if (
      !isDeterministicProvider &&
      draft.truncated &&
      draft.lastCompletedIndex >= 0 &&
      draft.lastCompletedIndex + 1 < effectiveEngParagraphs.length
    ) {
      try {
        const contPrompts = buildContinuationPromptSafe({
          chapterNumber: req.chapterNumber,
          titleEng: req.titleEng,
          engText: effectiveEngText,
          engParagraphs: effectiveEngParagraphs,
          completedParagraphs: draft.paragraphs,
          lastCompletedIndex: draft.lastCompletedIndex,
          filteredGlossary,
          styleGuideMd: req.styleGuideMd,
          arcCanonBlock: req.arcCanonBlock,
        });
        const contRes = await llmPort.complete({
          task: 'translate_pass1',
          systemInstruction: contPrompts.systemPrompt,
          userPrompt: contPrompts.userPrompt,
          expectJson: false,
          temperature: config?.temperature ?? 0.2,
          numCtx: config?.numCtx ?? 16384,
          geminiModel: primaryModel,
          ...(resolvedThinkingLevel ? { thinkingLevel: resolvedThinkingLevel } : {}),
        });
        const contDraft = parsePass1TranslationOutputSafe(
          contRes.text,
          effectiveEngParagraphs.length
        );
        for (let idx = 0; idx < contDraft.paragraphs.length; idx++) {
          const piece = contDraft.paragraphs[idx];
          if (piece && !draft.paragraphs[idx]) {
            draft.paragraphs[idx] = piece;
          }
        }
        draft.rusText = draft.paragraphs.filter(Boolean).join('\n\n') || draft.rusText;
        draft.titleRus = draft.titleRus || contDraft.titleRus;
        draft.summary = draft.summary || contDraft.summary;
        draft.summaryEng = draft.summaryEng || contDraft.summaryEng;
        if (contDraft.csiNotes.length > 0 && draft.csiNotes.length === 0) {
          draft.csiNotes = contDraft.csiNotes;
        }
      } catch (err: unknown) {
        degradedWarnings.push(
          `Pass 1 stream continuation degraded: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    let candidateRusText =
      draft.rusText ||
      parsedJson.rusText ||
      (!pass1Response.text.trim().startsWith('{') &&
      /[а-яА-ЯёЁ]{10,}/.test(pass1Response.text)
        ? pass1Response.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
        : '');
    let candidateTitleRus = draft.titleRus || parsedJson.titleRus || '';
    const candidateSummaryRus = draft.summary || parsedJson.summary || '';
    const candidateSummaryEng = draft.summaryEng || parsedJson.summaryEng || '';
    const structuredCsiNotes: CsiCulturalNote[] = Array.isArray(parsedJson.csiNotes)
      ? parsedJson.csiNotes
      : draft.csiNotes
          .filter(Boolean)
          .map((line, idx) => ({
            id: `csi-stream-${req.chapterNumber}-${idx}`,
            sourcePhrase: '',
            category: 'idiom' as const,
            categoryLabel: 'CSI',
            adaptedRus: line,
            rationale: 'Stream Pass 1 note',
          }));

    if (!candidateRusText.trim() || !/[а-яА-ЯёЁ]{3,}/.test(candidateRusText)) {
      if (!isDeterministicProvider) {
        return buildQuarantineResponse(
          'Модель вернула пустой или нерусскоязычный перевод на Pass 1'
        );
      }
      const fallback = deterministicLocalTranslate(
        effectiveEngText,
        req.titleEng,
        req.chapterNumber,
        req.glossary,
        proseTone
      );
      candidateRusText = fallback.rusText;
      candidateTitleRus = candidateTitleRus || fallback.titleRus;
    }

    // Pass 1.5 -> Pass 2: Decision 1 10-Rubric Radar + Conditional Surgical Accuracy & Span Critic
    const patchesList: SurgicalPatchItem[] = [];
    let criticEngineLabel = '';
    let otqsScore: number | undefined;
    const rawDirectives: StylisticSpanDirective[] = [];
    let decisionAudit: ChapterDecisionAuditResult | null = null;

    if (req.twoPassCritic !== false && candidateRusText && useDecisionEngine && !isDeterministicProvider) {
      try {
        decisionAudit = await auditChapterDraftWithDecision1({
          chapterNumber: req.chapterNumber,
          engText: effectiveEngText,
          rusText: candidateRusText,
          engParagraphs: effectiveEngParagraphs,
          glossary: filteredGlossary,
          genderRulesList,
        });
        otqsScore = decisionAudit.otqsScore;
        rawDirectives.push(...decisionAudit.stylisticDirectives);
        if (decisionAudit.skipGenerativePass2) {
          criticEngineLabel = `gemini-decision-1 (10-rubric OTQS=${decisionAudit.otqsScore.toFixed(1)}, 0 accuracy defects)`;
        }
      } catch (err: unknown) {
        decisionAudit = null;
        degradedWarnings.push(
          `Pass 1.5 Decision-1 audit degraded: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (req.twoPassCritic !== false && candidateRusText && !decisionAudit?.skipGenerativePass2) {
      try {
        const criticPrompts = (
          buildSurgicalCriticPass2Prompts as (
            opts: Parameters<typeof buildSurgicalCriticPass2Prompts>[0] &
              Record<string, unknown>
          ) => ReturnType<typeof buildSurgicalCriticPass2Prompts>
        )({
          engText: effectiveEngText,
          draftRusText: candidateRusText,
          filteredGlossary,
          genderRulesList,
          characterVoicesBlock,
          socialEdgesBlock: req.socialEdgesBlock,
          sceneDialogueBlock: effectiveSceneDialogueBlock,
        });

        const decisionPinpointHeader =
          decisionAudit && decisionAudit.flawedAccuracyParagraphs.length > 0
            ? `[GEMINI DECISION 1 PRE-AUDIT PINPOINTS — FOCUS STRICTLY ON THESE FLAGGED PARAGRAPHS]\n${decisionAudit.flawedAccuracyParagraphs
                .map((fp) => `- #p${fp.paragraphIndex}: ${fp.reasons.join(', ')}`)
                .join('\n')}\n\n`
            : '';

        const criticResponse = await llmPort.complete({
          task: 'surgical_critic_pass2',
          systemInstruction: criticPrompts.systemPrompt,
          userPrompt: `${decisionPinpointHeader}${criticPrompts.userPrompt}`,
          expectJson: true,
          temperature: 0.35,
          numCtx: config?.numCtx ?? 16384,
          geminiModel: criticModel,
        });
        criticEngineLabel = decisionAudit
          ? `gemini-decision-1 -> ${criticResponse.engineUsed}`
          : criticResponse.engineUsed;

        const parsedCritic = extractResilientJsonFromLlm<{
          patches?: SurgicalPatchItem[];
          edits?: SurgicalPatchItem[];
          rubricScores?: LiTransProQaRubricScores;
          stylisticSpanDirectives?: StylisticSpanDirective[];
        }>(criticResponse.text, {});

        const extractedPatches = Array.isArray(parsedCritic.patches)
          ? parsedCritic.patches
          : Array.isArray(parsedCritic.edits)
            ? parsedCritic.edits
            : Array.isArray(parsedCritic)
              ? (parsedCritic as unknown as SurgicalPatchItem[])
              : [];

        patchesList.push(...extractedPatches);

        if (parsedCritic.rubricScores?.otqs !== undefined) {
          otqsScore =
            otqsScore !== undefined
              ? Number(((otqsScore + parsedCritic.rubricScores.otqs) / 2).toFixed(2))
              : parsedCritic.rubricScores.otqs;
        }

        if (Array.isArray(parsedCritic.stylisticSpanDirectives)) {
          rawDirectives.push(...parsedCritic.stylisticSpanDirectives);
        }
      } catch (err: unknown) {
        degradedWarnings.push(
          `Pass 2 Surgical Critic degraded: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Mechanical Gate: apply factual accuracy patches -> verified Russian text y'
    let verifiedRusIntermediate = candidateRusText;
    if (patchesList.length > 0) {
      const patchRes = applySurgicalPatches(candidateRusText, patchesList, req.glossary);
      if (patchRes.appliedCount > 0) {
        verifiedRusIntermediate = patchRes.patchedText;
      }
    }

    // Pass 3: Blind Literary Stylist (Source Firewall — x_s is strictly absent)
    const cappedDirectives = capStylisticDirectivesPerParagraph(rawDirectives, 3);
    let stylistEngineLabel = '';
    let stylistAcceptedCount = 0;
    let stylistRolledBackCount = 0;

    if (
      req.twoPassCritic !== false &&
      (cappedDirectives.length > 0 || (otqsScore !== undefined && otqsScore < 8.5))
    ) {
      const paragraphs = splitChapterParagraphs(verifiedRusIntermediate);
      const flawedForStylist = paragraphs
        .map((p, idx) => {
          const dirs = cappedDirectives.filter((d) => d.paragraphIndex === idx);
          return {
            index: idx,
            verifiedRusText: p,
            directives: dirs,
          };
        })
        .filter(
          (item) =>
            item.directives.length > 0 || (otqsScore !== undefined && otqsScore < 8.5)
        );

      if (flawedForStylist.length > 0) {
        try {
          const stylistPrompts = buildBlindStylistPass3Prompts({
            flawedParagraphs: flawedForStylist,
            genreTitle: genreInfo.title,
            toneTitle: toneInfo.title,
            toneInstruction: toneInfo.instruction,
            characterVoicesBlock,
            pacingMode,
            contrastiveTriplets,
          });

          const stylistResponse = await llmPort.complete({
            task: 'blind_stylist_pass3',
            systemInstruction: stylistPrompts.systemPrompt,
            userPrompt: stylistPrompts.userPrompt,
            expectJson: true,
            temperature: 0.35,
            numCtx: config?.numCtx ?? 16384,
            geminiModel: stylistModel,
          });
          stylistEngineLabel = stylistResponse.engineUsed;

          const parsedStylist = extractResilientJsonFromLlm<{
            styledParagraphs?: Array<{ index: number; styledRusText: string }>;
          }>(stylistResponse.text, {});

          let rawStyled = Array.isArray(parsedStylist.styledParagraphs)
            ? parsedStylist.styledParagraphs
            : [];

          let decisionRejectedCount = 0;
          if (rawStyled.length > 0 && useDecisionEngine && !isDeterministicProvider) {
            try {
              const refereeRes = await refereeStylistRewritesWithDecision1({
                engParagraphs: effectiveEngParagraphs,
                verifiedRusParagraphs: paragraphs,
                styledParagraphs: rawStyled,
              });
              rawStyled = refereeRes.acceptedParagraphs;
              decisionRejectedCount = refereeRes.rejectedIndices.length;
              stylistEngineLabel = `${stylistResponse.engineUsed} + decision-1-referee`;
            } catch (err: unknown) {
              degradedWarnings.push(
                `Pass 3 Decision-1 A/B referee degraded: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
          stylistRolledBackCount += decisionRejectedCount;

          if (rawStyled.length > 0) {
            const rollbackRes = verifyAndRollbackStylistPass({
              verifiedRusText: verifiedRusIntermediate,
              styledParagraphs: rawStyled,
              glossary: req.glossary,
            });
            verifiedRusIntermediate = rollbackRes.finalRusText;
            stylistAcceptedCount = rollbackRes.acceptedParagraphIndices.length;
            stylistRolledBackCount += rollbackRes.rolledBackParagraphs.length;
          }
        } catch (err: unknown) {
          degradedWarnings.push(
            `Pass 3 Blind Stylist degraded: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    // Step 4: Prose Quality Gate & 3-Stage Self-Repair
    const verifiedOutput = await verifyAndRepairChapterAsync(
      {
        chapterNumber: req.chapterNumber,
        titleEng: req.titleEng,
        titleRus: candidateTitleRus,
        engText: effectiveEngText,
        candidateRusText: verifiedRusIntermediate,
        glossary: req.glossary,
        glossaryMeta: req.glossaryMeta,
        enabledRuleIds: req.enabledRuleIds,
        surgicalPatches: [],
        aiCsiNotes: structuredCsiNotes,
        existingSummaryRus: candidateSummaryRus,
        existingSummaryEng: candidateSummaryEng,
      },
      {
        enableNeuralAudit: this.shouldRunNeuralAudit(config),
        llmParagraphRepairFn: async ({ promptBlock }) => {
          try {
            const repairPrompts = buildSelfRepairPrompts({
              engText: effectiveEngText,
              rusText: verifiedRusIntermediate,
              glossary: req.glossary,
              linterIssues: [],
              genreTitle: genreInfo.title,
              toneTitle: toneInfo.title,
              flawedPromptBlock: promptBlock,
            });
            const resp = await llmPort.complete({
              task: 'self_repair',
              systemInstruction: repairPrompts.systemPrompt,
              userPrompt: repairPrompts.userPrompt,
              expectJson: false,
              temperature: 0.2,
              numCtx: config?.numCtx ?? 16384,
              geminiModel: repairModel,
              ...(repairThinkingLevel ? { thinkingLevel: repairThinkingLevel } : {}),
            });
            return resp.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
          } catch (err: unknown) {
            degradedWarnings.push(
              `Stage 3 LLM Self-Repair degraded: ${err instanceof Error ? err.message : String(err)}`
            );
            return '';
          }
        },
      }
    );

    const engineLabel = `${preFlightDecision ? 'Decision-1 PreFlight -> ' : ''}${pass1Response.engineUsed}${
      req.twoPassCritic !== false
        ? ` → Pass 2: ${criticEngineLabel || criticModel}${
            stylistEngineLabel ? ` → Pass 3 Blind Stylist: ${stylistEngineLabel}` : ''
          }`
        : ''
    }`;

    return {
      engine: engineLabel,
      quarantined: false,
      ...(degradedWarnings.length > 0 ? { degradedWarnings } : {}),
      titleRus: verifiedOutput.titleRus || `Глава ${req.chapterNumber}`,
      rusText: verifiedOutput.rusText,
      summary: verifiedOutput.summary,
      summaryEng: verifiedOutput.summaryEng,
      csiNotes: verifiedOutput.csiNotes,
      ditingReport: verifiedOutput.ditingReport,
      proseGateReport: verifiedOutput.proseGateReport,
      neuralAudit: verifiedOutput.neuralAudit,
      scorecard: verifiedOutput.scorecard,
      slicedGlossaryCount: matchedCount,
      deltaShortTermCount: (req.deltaShortTermWindow || []).length,
      scenePacingMode: pacingMode,
      pacingMode,
      otqsScore,
      stylistAcceptedCount,
      stylistRolledBackCount,
      rubyGikunCount: rubyGikunRes.foundCount,
      appliedFixes: verifiedOutput.appliedFixes,
      lintReport: verifiedOutput.lintReport,
      alreadyVerified: true,
      verified: verifiedOutput.verified,
      wordCountEng: verifiedOutput.wordCountEng,
      wordCountRus: verifiedOutput.wordCountRus,
    };
  }

  async verifyAndRepair(
    req: PipelineTransportVerifyRequest
  ): Promise<ChapterVerificationOutput & { engine: string; scorecard?: unknown }> {
    const config = req.llmConfig || this.defaultLlmConfig;
    const genrePreset = (req.genrePreset || 'xianxia') as GenrePreset;
    const proseTone = (req.proseTone || 'classic') as ProseTone;
    const genreInfo = GENRE_PRESET_LABELS[genrePreset] || GENRE_PRESET_LABELS.xianxia;
    const toneInfo = PROSE_TONE_LABELS[proseTone] || PROSE_TONE_LABELS.classic;
    const llmPort = this.llmPortFactory(config, req.glossary, proseTone);

    let engineUsed = '3-stage-deterministic-dtw-qa-repair';

    const verifiedOutput = await verifyAndRepairChapterAsync(
      {
        chapterNumber: req.chapterNumber,
        titleEng: req.titleEng,
        titleRus: req.titleRus || '',
        engText: req.engText,
        candidateRusText: req.rusText,
        glossary: req.glossary,
        glossaryMeta: req.glossaryMeta,
        enabledRuleIds: req.enabledRuleIds,
        existingSummaryRus: req.existingSummaryRus,
        existingSummaryEng: req.existingSummaryEng,
        aiCsiNotes: req.aiCsiNotes,
      },
      {
        enableNeuralAudit: this.shouldRunNeuralAudit(config),
        llmParagraphRepairFn: async ({ promptBlock }) => {
          try {
            const repairPrompts = buildSelfRepairPrompts({
              engText: req.engText,
              rusText: req.rusText,
              glossary: req.glossary,
              linterIssues: [],
              genreTitle: genreInfo.title,
              toneTitle: toneInfo.title,
              flawedPromptBlock: promptBlock,
            });
            const repairThinkingLevel: 'low' | 'medium' | 'high' | undefined =
              config?.thinkingLevel && config.thinkingLevel !== 'auto_xhigh'
                ? config.thinkingLevel === 'xhigh'
                  ? 'high'
                  : config.thinkingLevel
                : undefined;
            const response = await llmPort.complete({
              task: 'self_repair',
              systemInstruction: repairPrompts.systemPrompt,
              userPrompt: repairPrompts.userPrompt,
              expectJson: false,
              temperature: 0.2,
              numCtx: config?.numCtx ?? 16384,
              geminiModel: this.resolveModelForStage(config, 'repair'),
              ...(repairThinkingLevel ? { thinkingLevel: repairThinkingLevel } : {}),
            });
            engineUsed = `${response.engineUsed} (Stage 3 Paragraph-Scoped Repair)`;
            return response.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
          } catch {
            return '';
          }
        },
      }
    );

    return {
      ...verifiedOutput,
      engine: `${engineUsed} + diting-agenteval`,
    };
  }
}


async function compileArcPreLinkerSafe(params: {
  targets: ChapterRecord[];
  glossary: CanonicalGlossary;
  glossaryMeta: Record<string, GlossaryTermMeta>;
  scoutedTerms: ScoutedTerm[];
  socialEdges?: SocialRegisterEdge[];
  llmConfig?: LlmProviderConfig;
}): Promise<{
  arcPacket: ArcCanonPacket;
  arcCanonBlock: string;
  inferredGenders: Record<string, GrammaticalGender>;
}> {
  const startChapter = params.targets[0]?.number ?? 1;
  const endChapter = params.targets[params.targets.length - 1]?.number ?? startChapter;
  const ext = (llmInferenceNamespace as Record<string, unknown>)
    .compileArcPreLinker as CompileArcPreLinkerFn | undefined;

  if (typeof ext === 'function') {
    try {
      const useRealLlm =
        params.llmConfig?.provider && params.llmConfig.provider !== 'deterministic';
      const llmPort = useRealLlm
        ? createPipelineLlmPort(params.llmConfig!, params.glossary, 'classic')
        : undefined;
      const res = await ext({
        chapters: params.targets.slice(0, 25),
        glossary: params.glossary,
        glossaryMeta: params.glossaryMeta,
        socialEdges: params.socialEdges,
        llmPort,
      });
      if (res?.arcPacket) {
        const arcCanonBlock = [
          res.arcPacket.frozenGlossaryBlock,
          res.arcPacket.frozenVoicesBlock,
          res.arcPacket.frozenSocialEdgesBlock,
        ]
          .filter(Boolean)
          .join('\n\n');
        return {
          arcPacket: res.arcPacket,
          arcCanonBlock,
          inferredGenders: res.inferredGenders || {},
        };
      }
    } catch {
      // Fallback cleanly to deterministic Arc Pre-Linker
    }
  }

  return compileArcPreLinkerDeterministic(params);
}

async function applyUnifiedDeltaPatcherSafe(params: {
  chapterNumber: number;
  titleEng: string;
  titleRus: string;
  engText: string;
  currentVerif: ChapterVerificationOutput;
  crossSlopIssues: CrossChapterSlopIssue[];
  previousChapters: Array<{ number: number; rusText?: string }>;
  glossary: CanonicalGlossary;
  glossaryMeta: Record<string, GlossaryTermMeta>;
  enabledRuleIds?: LintRuleId[];
  previousChapterSummary?: string;
  llmConfig?: LlmProviderConfig;
  proseTone: ProseTone;
}): Promise<{
  verified: ChapterVerificationOutput;
  crossSlopIssues: CrossChapterSlopIssue[];
  patched: boolean;
}> {
  const builder = (llmInferenceNamespace as Record<string, unknown>)
    .buildUnifiedDeltaPatcherPrompts as BuildUnifiedDeltaPatcherFn | undefined;
  if (
    typeof builder !== 'function' ||
    !params.llmConfig ||
    params.llmConfig.provider === 'deterministic'
  ) {
    return {
      verified: params.currentVerif,
      crossSlopIssues: params.crossSlopIssues,
      patched: false,
    };
  }

  try {
    const engParas = splitChapterParagraphs(params.engText);
    const rusParas = splitChapterParagraphs(params.currentVerif.rusText);
    const { filteredGlossary } = filterGlossaryForChapter(params.engText, params.glossary);
    const flawedSet = new Set<number>(params.currentVerif.flawedParagraphIndices || []);
    for (const slur of params.crossSlopIssues) {
      if (typeof slur.paragraphIndex === 'number' && slur.paragraphIndex >= 0) {
        flawedSet.add(slur.paragraphIndex);
      }
    }
    const flawedIndices = Array.from(flawedSet)
      .filter((i) => i >= 0 && i < rusParas.length)
      .sort((a, b) => a - b);
    if (flawedIndices.length === 0) {
      return {
        verified: params.currentVerif,
        crossSlopIssues: params.crossSlopIssues,
        patched: false,
      };
    }

    const characterVoicesBlock = buildCharacterVoicePromptBlock(
      filteredGlossary,
      params.glossaryMeta
    );
    const toneTitle =
      (PROSE_TONE_LABELS[params.proseTone] || PROSE_TONE_LABELS.classic).title;

    const prompts = builder({
      chapterNumber: params.chapterNumber,
      titleEng: params.titleEng,
      engParagraphs: engParas,
      rusParagraphs: rusParas,
      flawedIndices,
      lintIssues: params.currentVerif.lintReport.issues,
      slopIssues: params.crossSlopIssues,
      filteredGlossary,
      characterVoicesBlock,
      toneTitle,
    });

    const llmPort = createPipelineLlmPort(params.llmConfig, params.glossary, params.proseTone);
    const resp = await llmPort.complete({
      task: 'self_repair',
      systemInstruction: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      expectJson: false,
      temperature: 0.25,
      numCtx: params.llmConfig.numCtx ?? 16384,
      geminiModel: params.llmConfig.criticModelId || params.llmConfig.modelId || 'gemini-3.8-flash',
    });

    const workingParas = [...rusParas];
    let updatedCount = 0;
    const blockRegex = /\[(?:[a-z0-9]{2,4}\|)?#p(\d+)\]\s*\r?\n([\s\S]*?)(?=\r?\n\s*\[(?:[a-z0-9]{2,4}\|)?#p\d+\]|$)/gi;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRegex.exec(resp.text)) !== null) {
      const pIdx = Number(blockMatch[1]);
      const body = (blockMatch[2] || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
      if (
        Number.isInteger(pIdx) &&
        pIdx >= 0 &&
        pIdx < workingParas.length &&
        body &&
        workingParas[pIdx] !== '---'
      ) {
        workingParas[pIdx] = body;
        updatedCount++;
      }
    }

    let nextRusText =
      updatedCount > 0
        ? joinParagraphsPreservingSystemBoxes(workingParas)
        : params.currentVerif.rusText;
    if (updatedCount === 0) {
      const parsed = extractResilientJsonFromLlm<{
        patchedParagraphs?: Array<{ index: number; text?: string; rusText?: string }>;
        paragraphs?: Array<{ index: number; text?: string; rusText?: string }>;
        patches?: SurgicalPatchItem[];
      }>(resp.text, {});

      const paraUpdates = Array.isArray(parsed.patchedParagraphs)
        ? parsed.patchedParagraphs
        : Array.isArray(parsed.paragraphs)
          ? parsed.paragraphs
          : [];

      if (paraUpdates.length > 0) {
        for (const upd of paraUpdates) {
          if (
            typeof upd.index === 'number' &&
            upd.index >= 0 &&
            upd.index < workingParas.length
          ) {
            const replacement = (upd.text ?? upd.rusText ?? '').trim();
            if (replacement && workingParas[upd.index] !== '---') {
              workingParas[upd.index] = replacement;
              updatedCount++;
            }
          }
        }
        if (updatedCount > 0) {
          nextRusText = joinParagraphsPreservingSystemBoxes(workingParas);
        }
      } else if (Array.isArray(parsed.patches) && parsed.patches.length > 0) {
        const pRes = applySurgicalPatches(nextRusText, parsed.patches, params.glossary);
        if (pRes.appliedCount > 0) {
          nextRusText = pRes.patchedText;
        }
      }
    }

    if (nextRusText === params.currentVerif.rusText) {
      return {
        verified: params.currentVerif,
        crossSlopIssues: params.crossSlopIssues,
        patched: false,
      };
    }

    const candidateVerif = finalizeAndVerifyChapter({
      chapterNumber: params.chapterNumber,
      titleEng: params.titleEng,
      titleRus: params.titleRus,
      engText: params.engText,
      candidateRusText: nextRusText,
      glossary: params.glossary,
      glossaryMeta: params.glossaryMeta,
      enabledRuleIds: params.enabledRuleIds,
      runSurgicalDriftRepair: false,
      existingSummaryRus: params.currentVerif.summary,
      existingSummaryEng: params.currentVerif.summaryEng,
      aiCsiNotes: params.currentVerif.csiNotes,
    });
    const nextCrossSlop = detectCrossChapterSlopCooldown({
      currentChapterNumber: params.chapterNumber,
      rusText: candidateVerif.rusText,
      previousChapters: params.previousChapters,
      glossary: params.glossary,
      windowSize: 25,
    });

    // Strict non-regression guard: accept only if errors didn't worsen and either errors or cross-slop improved
    const errDelta =
      candidateVerif.lintReport.errorCount - params.currentVerif.lintReport.errorCount;
    const slopDelta = nextCrossSlop.length - params.crossSlopIssues.length;
    if (errDelta <= 0 && (errDelta < 0 || slopDelta < 0)) {
      return {
        verified: {
          ...candidateVerif,
          neuralAudit: params.currentVerif.neuralAudit,
          proseGateReport: params.currentVerif.proseGateReport,
          appliedFixes: [
            ...params.currentVerif.appliedFixes,
            'Unified Delta-Patcher applied',
          ],
        },
        crossSlopIssues: nextCrossSlop,
        patched: true,
      };
    }
  } catch {
    // Keep pre-patch verification result on failure
  }

  return {
    verified: params.currentVerif,
    crossSlopIssues: params.crossSlopIssues,
    patched: false,
  };
}

/**
 * Server-side 5-Phase Wavefront Batch Pipeline Orchestration Engine (`K = 3`).
 * Injects server LLM Arc Pre-Linker and Unified Delta-Patcher hooks into the core runner.
 */
export async function runPipelineBatchOnNovel<TNovel extends NovelProject = NovelProject>(
  options: PipelineBatchOptions<TNovel>
): Promise<{ updatedNovel: TNovel; processedChaptersCount: number }> {
  return runPipelineBatchOnNovelCore({
    ...options,
    serverHooks: options.serverHooks ?? {
      compileArcPreLinker: compileArcPreLinkerSafe,
      applyUnifiedDeltaPatcher: applyUnifiedDeltaPatcherSafe,
    },
  });
}
