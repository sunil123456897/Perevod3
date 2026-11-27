import {
  finalizeAndVerifyChapter,
  type ChapterVerificationOutput,
} from './chapter-verifier.ts';
import {
  batchLookaheadScoutChapters,
  buildSocialRegisterPromptBlock,
  buildCharacterVoicePromptBlock,
} from './canon-glossary-vault.ts';
import {
  annotateSceneDialogueAndZeroPronouns,
  classifyScenePacingMode,
} from './scene-analysis.ts';
import {
  buildDelTAContextPacket,
  detectCrossChapterSlopCooldown,
  SlidingWindowPriorityQueue,
  type DelTALongTermMatch,
  type DelTAShortTermPair,
} from './delta-diting.ts';
import {
  parseRubyAndGikunMarkup,
  normalizeKoreanOneLineParagraphs,
} from './ruby-korean-parser.ts';
import {
  runAdditionBySubtractionScout,
  filterScoutedTermsWithAgentS,
  filterGlossaryForChapter,
  splitChapterParagraphs,
  computeChapterQaSummary,
  updateHeroStateLedgerFromChapter,
  mergeSplitChapters,
  evaluateLorebookStateMachine,
  sampleChaptersStratifiedMonteCarlo,
  GENRE_PRESET_LABELS,
  PROSE_TONE_LABELS,
  type LorebookEntry,
} from './qa-linter.ts';
import type {
  ArcCanonPacket,
  CanonicalGlossary,
  ChapterQaSummary,
  ChapterStatus,
  CrossChapterSlopIssue,
  CsiCulturalNote,
  DitingQualityReport,
  GenrePreset,
  GlossaryCategory,
  GlossaryTermMeta,
  GrammaticalGender,
  HeroStateLedger,
  LintRuleId,
  LlmProviderConfig,
  ProseTone,
  ScoutedTerm,
  SocialRegisterEdge,
} from './pipeline-types.ts';
import type {
  ChapterRecord,
  ChapterVersionSnapshot,
  NovelProject,
} from './seed-data.ts';

export { sampleChaptersStratifiedMonteCarlo, evaluateLorebookStateMachine };

export interface PipelineTransportScoutRequest {
  engText: string;
  titleEng?: string;
  chapterNumber: number;
  glossary: CanonicalGlossary;
  scoutedTerms?: ScoutedTerm[];
  genrePreset?: GenrePreset;
  llmConfig?: LlmProviderConfig;
}

export interface PipelineTransportScoutResponse {
  engine?: string;
  discoveredTerms: Array<{
    eng: string;
    rus_suggested: string;
    category: GlossaryCategory;
    gender?: GrammaticalGender;
    context_snippet?: string;
    confidence?: number;
  }>;
  addedRecallCount?: number;
  subtractedNoiseCount?: number;
  subtractedSamples?: string[];
  degradedWarnings?: string[];
}

export interface PipelineTransportTranslateRequest {
  engText: string;
  titleEng: string;
  chapterNumber: number;
  glossary: CanonicalGlossary;
  glossaryMeta?: Record<string, GlossaryTermMeta>;
  scoutedTerms?: ScoutedTerm[];
  styleGuideMd?: string;
  genrePreset?: GenrePreset;
  proseTone?: ProseTone;
  previousChapterSummary?: string;
  previousChapterSummaryEng?: string;
  deltaShortTermWindow?: DelTAShortTermPair[];
  deltaLongTermMemories?: DelTALongTermMatch[];
  enabledRuleIds?: LintRuleId[];
  twoPassCritic?: boolean;
  heroLedger?: HeroStateLedger;
  llmConfig?: LlmProviderConfig;
  socialEdgesBlock?: string;
  lorebookBlock?: string;
  forwardQuestionsBlock?: string;
  sceneDialogueBlock?: string;
  useHashAnchors?: boolean;
  arcCanonBlock?: string;
  pacingMode?: string;
}

export interface PipelineTransportTranslateResponse {
  engine?: string;
  rusText: string;
  titleRus?: string;
  summary?: string;
  summaryEng?: string;
  csiNotes?: CsiCulturalNote[];
  ditingReport?: DitingQualityReport;
  proseGateReport?: ChapterVerificationOutput['proseGateReport'];
  neuralAudit?: ChapterVerificationOutput['neuralAudit'];
  scorecard?: unknown;
  slicedGlossaryCount?: number;
  deltaShortTermCount?: number;
  scenePacingMode?: string;
  pacingMode?: string;
  otqsScore?: number;
  stylistAcceptedCount?: number;
  stylistRolledBackCount?: number;
  rubyGikunCount?: number;
  alreadyVerified?: boolean;
  verified?: boolean;
  quarantined?: boolean;
  quarantineReason?: string;
  appliedFixes?: string[];
  lintReport?: ChapterVerificationOutput['lintReport'];
  wordCountEng?: number;
  wordCountRus?: number;
  degradedWarnings?: string[];
}

export interface PipelineTransportVerifyRequest {
  chapterNumber: number;
  titleEng: string;
  titleRus?: string;
  engText: string;
  rusText: string;
  glossary: CanonicalGlossary;
  glossaryMeta?: Record<string, GlossaryTermMeta>;
  enabledRuleIds?: LintRuleId[];
  genrePreset?: GenrePreset;
  proseTone?: ProseTone;
  llmConfig?: LlmProviderConfig;
  existingSummaryRus?: string;
  existingSummaryEng?: string;
  aiCsiNotes?: CsiCulturalNote[];
  previousChapters?: Array<{ number: number; rusText?: string }>;
  pacingMode?: string;
}

/**
 * Seam: PipelineTransportAdapter decouples batch execution from raw HTTP fetch.
 */
export interface PipelineTransportAdapter {
  scout(req: PipelineTransportScoutRequest): Promise<PipelineTransportScoutResponse>;
  translateAndEdit(
    req: PipelineTransportTranslateRequest
  ): Promise<PipelineTransportTranslateResponse>;
  verifyAndRepair?(
    req: PipelineTransportVerifyRequest
  ): Promise<ChapterVerificationOutput>;
}

/**
 * In-memory / mock adapter for pure tests without network calls.
 */
export class InMemoryPipelineTransportAdapter implements PipelineTransportAdapter {
  public mockScoutHandler?: (
    req: PipelineTransportScoutRequest
  ) => Promise<PipelineTransportScoutResponse>;
  public mockTranslateHandler?: (
    req: PipelineTransportTranslateRequest
  ) => Promise<PipelineTransportTranslateResponse>;

  constructor(handlers?: {
    mockScoutHandler?: (
      req: PipelineTransportScoutRequest
    ) => Promise<PipelineTransportScoutResponse>;
    mockTranslateHandler?: (
      req: PipelineTransportTranslateRequest
    ) => Promise<PipelineTransportTranslateResponse>;
  }) {
    this.mockScoutHandler = handlers?.mockScoutHandler;
    this.mockTranslateHandler = handlers?.mockTranslateHandler;
  }

  async scout(
    req: PipelineTransportScoutRequest
  ): Promise<PipelineTransportScoutResponse> {
    if (this.mockScoutHandler) {
      return this.mockScoutHandler(req);
    }
    const abs = runAdditionBySubtractionScout(
      req.engText,
      req.chapterNumber,
      req.glossary,
      req.scoutedTerms || []
    );
    return {
      discoveredTerms: abs.discoveredTerms.map((dt) => ({
        eng: dt.eng,
        rus_suggested: dt.rus_suggested,
        category: dt.category,
        gender: dt.gender || 'UNKNOWN',
        context_snippet: dt.context_snippet,
        confidence: dt.confidence || 0.95,
      })),
      addedRecallCount: abs.discoveredTerms.length,
      subtractedNoiseCount: Math.max(
        0,
        abs.discoveredTerms.length - abs.finalTerms.length
      ),
    };
  }

  async translateAndEdit(
    req: PipelineTransportTranslateRequest
  ): Promise<PipelineTransportTranslateResponse> {
    if (this.mockTranslateHandler) {
      return this.mockTranslateHandler(req);
    }
    // Deterministic pass 1 replacement
    let rus = req.engText
      .replace(/Origin Points/gi, 'Очки Истока')
      .replace(/Foundation Establishment/gi, 'Заложение Основ')
      .replace(/Stone Demon Sect/gi, 'Секта Каменных Демонов')
      .replace(/Lin Xuan/gi, 'Линь Сюань')
      .replace(/Chapter (\d+)/gi, 'Глава $1');

    return {
      rusText: rus,
      titleRus: req.titleEng
        ? `Глава ${req.chapterNumber}. ${req.titleEng}`
        : `Глава ${req.chapterNumber}`,
      summary: `Краткое содержание главы ${req.chapterNumber}`,
      summaryEng: `Summary of chapter ${req.chapterNumber}`,
      csiNotes: [],
      ditingReport: undefined,
    };
  }
}

/**
 * Production browser adapter using fetch('/api/pipeline') and optional sliding window queue.
 */
export class FetchPipelineTransportAdapter implements PipelineTransportAdapter {
  public baseUrl: string;
  public queue?: InstanceType<typeof SlidingWindowPriorityQueue>;

  constructor(options?: {
    baseUrl?: string;
    queue?: InstanceType<typeof SlidingWindowPriorityQueue>;
  }) {
    this.baseUrl = options?.baseUrl || '/api/pipeline';
    this.queue = options?.queue;
  }

  private async parseJsonOrThrow<T>(res: Response, actionLabel: string): Promise<T> {
    if (!res.ok) {
      let serverError = '';
      try {
        const errPayload = (await res.json()) as { error?: unknown } | null;
        if (typeof errPayload?.error === 'string' && errPayload.error.trim()) {
          serverError = errPayload.error.trim();
        }
      } catch {
        // Ignore non-JSON error payloads
      }
      throw new Error(
        serverError || `Pipeline transport ${actionLabel} failed with HTTP ${res.status}`
      );
    }
    return (await res.json()) as T;
  }

  async scout(
    req: PipelineTransportScoutRequest
  ): Promise<PipelineTransportScoutResponse> {
    const doFetch = async () => {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scout', ...req }),
      });
      return this.parseJsonOrThrow<PipelineTransportScoutResponse>(res, 'scout');
    };

    if (this.queue) {
      return this.queue.add(doFetch, {
        priority: 2,
        label: `scout-${req.chapterNumber}`,
      });
    }
    return doFetch();
  }

  async translateAndEdit(
    req: PipelineTransportTranslateRequest
  ): Promise<PipelineTransportTranslateResponse> {
    const doFetch = async () => {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'translate_and_edit', ...req }),
      });
      return this.parseJsonOrThrow<PipelineTransportTranslateResponse>(
        res,
        'translate_and_edit'
      );
    };

    if (this.queue) {
      return this.queue.add(doFetch, {
        priority: 1,
        label: `translate-${req.chapterNumber}`,
      });
    }
    return doFetch();
  }

  async verifyAndRepair(
    req: PipelineTransportVerifyRequest
  ): Promise<ChapterVerificationOutput> {
    const doFetch = async (): Promise<ChapterVerificationOutput> => {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'self_repair', ...req }),
      });
      const data = await this.parseJsonOrThrow<
        ChapterVerificationOutput & { repairedCount?: number }
      >(res, 'self_repair');

      if (data && typeof data.rusText === 'string' && data.lintReport && data.ditingReport) {
        return {
          titleRus: data.titleRus || req.titleRus || `Глава ${req.chapterNumber}`,
          rusText: data.rusText,
          summary: data.summary || req.existingSummaryRus || '',
          summaryEng: data.summaryEng || req.existingSummaryEng || '',
          appliedFixes: data.appliedFixes || [],
          surgicallyFixedParagraphs: data.surgicallyFixedParagraphs || [],
          flawedParagraphIndices: data.flawedParagraphIndices || [],
          lintReport: data.lintReport,
          csiNotes: data.csiNotes || req.aiCsiNotes || [],
          ditingReport: data.ditingReport,
          proseGateReport: data.proseGateReport,
          neuralAudit: data.neuralAudit,
          wordCountEng:
            data.wordCountEng ??
            req.engText.trim().split(/\s+/).filter(Boolean).length,
          wordCountRus:
            data.wordCountRus ??
            data.rusText.trim().split(/\s+/).filter(Boolean).length,
          verified: Boolean(data.verified ?? data.lintReport.passed),
        };
      }

      return finalizeAndVerifyChapter({
        chapterNumber: req.chapterNumber,
        titleEng: req.titleEng,
        titleRus: req.titleRus,
        engText: req.engText,
        candidateRusText: req.rusText,
        glossary: req.glossary,
        glossaryMeta: req.glossaryMeta,
        enabledRuleIds: req.enabledRuleIds,
        runSurgicalDriftRepair: true,
        existingSummaryRus: req.existingSummaryRus,
        existingSummaryEng: req.existingSummaryEng,
        aiCsiNotes: req.aiCsiNotes,
      });
    };

    if (this.queue) {
      return this.queue.add(doFetch, {
        priority: 1,
        label: `verify-${req.chapterNumber}`,
      });
    }
    return doFetch();
  }
}

export function autoMergeSplitChaptersInNovel<T extends NovelProject>(
  novel: T
): { updatedNovel: T; mergedCount: number } {
  let workingChapters = [...novel.chapters];
  let mergedSplitCount = 0;

  const splitParts = workingChapters.filter(
    (c) => c.subPart || (c.number % 1 !== 0)
  );

  const byBaseNumber = new Map<number, typeof splitParts>();
  splitParts.forEach((sp) => {
    const baseNum = Math.floor(sp.number);
    const list = byBaseNumber.get(baseNum) || [];
    list.push(sp);
    byBaseNumber.set(baseNum, list);
  });

  byBaseNumber.forEach((parts, baseNum) => {
    if (parts.length >= 2) {
      const [partA, partB] = [...parts].sort((a, b) =>
        (a.subPart || String(a.number)).localeCompare(
          b.subPart || String(b.number)
        )
      );
      const merged = mergeSplitChapters(
        { title: partA.titleEng, engText: partA.engText, rusText: partA.rusText },
        { title: partB.titleEng, engText: partB.engText, rusText: partB.rusText },
        baseNum
      );
      const mergedRec: ChapterRecord = {
        id: `ch-merged-${baseNum}-${Date.now()}`,
        number: baseNum,
        titleEng: merged.titleEng,
        titleRus: `Глава ${baseNum}. ${
          partA.titleRus
            ? partA.titleRus.replace(/^Глава\s+\d+[.:\s]*/i, '')
            : 'Объединённая глава'
        }`,
        engText: merged.engText,
        rusText: merged.rusText,
        scouted: Boolean(partA.scouted && partB.scouted),
        translated: Boolean(merged.rusText.trim()),
        edited: Boolean(merged.rusText.trim()),
        verified: false,
        wordCountEng: merged.engText.split(/\s+/).filter(Boolean).length,
        wordCountRus: merged.rusText
          ? merged.rusText.split(/\s+/).filter(Boolean).length
          : 0,
        lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
        summary: [partA.summary, partB.summary].filter(Boolean).join(' '),
      };
      workingChapters = [
        ...workingChapters.filter((c) => c.id !== partA.id && c.id !== partB.id),
        mergedRec,
      ].sort((a, b) => a.number - b.number);
      mergedSplitCount++;
    }
  });

  return {
    updatedNovel: {
      ...novel,
      chapters: workingChapters,
    },
    mergedCount: mergedSplitCount,
  };
}

/**
 * Pre-scouts target chapter range for the 60-second user Stop-Gate review modal.
 */
export function prepareGlossaryStopGateTerms(
  novel: {
    chapters: Array<{ number: number; titleEng: string; engText: string }>;
    glossary: CanonicalGlossary;
    scoutedTerms?: ScoutedTerm[];
  },
  startChapter: number,
  endChapter: number
): ScoutedTerm[] {
  const targets = novel.chapters.filter(
    (c) => c.number >= startChapter && c.number <= endChapter
  );
  if (targets.length === 0) return [];

  const lookahead = batchLookaheadScoutChapters(
    targets,
    novel.glossary,
    novel.scoutedTerms || []
  );
  const pendingInBuffer = (novel.scoutedTerms || []).filter(
    (t) => !t.approved_for_glossary
  );
  const seenEng = new Set<string>();
  const mergedTerms: ScoutedTerm[] = [];

  for (const term of lookahead.discoveredTerms) {
    seenEng.add(term.eng.toLowerCase());
    mergedTerms.push(term);
  }

  for (const pending of pendingInBuffer) {
    if (!seenEng.has(pending.eng.toLowerCase())) {
      seenEng.add(pending.eng.toLowerCase());
      mergedTerms.push(pending);
    }
  }

  return mergedTerms;
}

export type PipelineBatchProgressEvent =
  | {
      type: 'start';
      totalChapters: number;
      genrePreset: GenrePreset;
      proseTone: ProseTone;
    }
  | { type: 'pre_scout'; autoPromotedCount: number }
  | { type: 'chapter_start'; chapterId: string; chapterNumber: number }
  | {
      type: 'phase_step';
      chapterId: string;
      step: 1 | 2 | 3 | 4 | 5;
      label: string;
    }
  | {
      type: 'log';
      tag: string;
      message: string;
      level: 'info' | 'success' | 'warn' | 'error';
    }
  | { type: 'chapter_complete'; chapterId: string; chapter: ChapterRecord }
  | {
      type: 'batch_complete';
      updatedNovel: NovelProject;
      processedChaptersCount: number;
    }
  | { type: 'aborted'; processedChaptersCount: number };

export interface PipelineBatchOptions<TNovel extends NovelProject = NovelProject> {
  novel: TNovel;
  targetChapterIds?: string[];
  startChapter?: number;
  endChapter?: number;
  mode?: 'full_5_phase' | 'scout_only' | 'verify_only' | 'verify_and_repair';
  autoCanonEnabled?: boolean;
  twoPassCriticEnabled?: boolean;
  llmConfig?: LlmProviderConfig;
  transport: PipelineTransportAdapter;
  onProgress?: (event: PipelineBatchProgressEvent) => void;
  shouldAbort?: () => boolean;
  signal?: AbortSignal;
  wavefrontConcurrency?: number;
  serverHooks?: ServerPipelineBatchHooks;
}

export interface ServerPipelineBatchHooks {
  compileArcPreLinker?: (params: {
    targets: ChapterRecord[];
    glossary: CanonicalGlossary;
    glossaryMeta: Record<string, GlossaryTermMeta>;
    scoutedTerms: ScoutedTerm[];
    socialEdges?: SocialRegisterEdge[];
    llmConfig?: LlmProviderConfig;
  }) => Promise<{
    arcPacket: ArcCanonPacket;
    arcCanonBlock: string;
    inferredGenders: Record<string, GrammaticalGender>;
  }>;
  applyUnifiedDeltaPatcher?: (params: {
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
  }) => Promise<{
    verified: ChapterVerificationOutput;
    crossSlopIssues: CrossChapterSlopIssue[];
    patched: boolean;
  }>;
}

interface StageAPreparedChapter {
  normalizedEngText: string;
  pacingMode: string;
  sceneDialogueBlock?: string;
  lorebookBlock?: string;
  socialEdgesBlock?: string;
  forwardQuestionsBlock?: string;
  discoveredTerms: PipelineTransportScoutResponse['discoveredTerms'];
  scoutSucceeded: boolean;
  degradedWarnings: string[];
}

type WavefrontSlotResult =
  | { kind: 'scout_only'; chapter: ChapterRecord }
  | { kind: 'quarantined'; chapter: ChapterRecord; label: string; reason: string }
  | {
      kind: 'verified';
      chapter: ChapterRecord;
      label: string;
      appliedFixesCount: number;
      crossSlopFixedCount: number;
      fastPathUsed: boolean;
    };

function createConcurrencySemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire(): Promise<void> {
      if (active < limit) {
        active++;
        return;
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
      active++;
    },
    release(): void {
      active = Math.max(0, active - 1);
      const next = waiters.shift();
      if (next) next();
    },
  };
}

function inferDeterministicGenderFromContext(engText: string): GrammaticalGender {
  const lower = engText.toLowerCase();
  const hasFemale = /\b(?:she|her|hers|herself|lady|princess|queen|sister|girl|maiden|empress|matriarch)\b/.test(
    lower
  );
  const hasMale = /\b(?:he|him|his|himself|lord|prince|king|brother|boy|young master|patriarch)\b/.test(
    lower
  );
  if (hasFemale && !hasMale) return 'F';
  if (hasMale && !hasFemale) return 'M';
  return 'UNKNOWN';
}

export async function compileArcPreLinkerDeterministic(params: {
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
  const combinedText = params.targets
    .slice(0, 25)
    .map((c) => c.engText)
    .join('\n\n');
  const { filteredGlossary } = filterGlossaryForChapter(combinedText, params.glossary);
  const inferredGenders: Record<string, GrammaticalGender> = {};
  for (const engName of Object.keys(filteredGlossary.characters || {})) {
    const existing = params.glossaryMeta[engName]?.gender;
    if (!existing || existing === 'UNKNOWN') {
      const snippetMatches: string[] = [];
      for (const ch of params.targets.slice(0, 25)) {
        const idx = ch.engText.indexOf(engName);
        if (idx >= 0) {
          snippetMatches.push(
            ch.engText.slice(Math.max(0, idx - 120), Math.min(ch.engText.length, idx + 220))
          );
        }
      }
      if (snippetMatches.length > 0) {
        inferredGenders[engName] = inferDeterministicGenderFromContext(
          snippetMatches.join(' ')
        );
      }
    }
  }

  const mergedMeta: Record<string, GlossaryTermMeta> = { ...params.glossaryMeta };
  for (const [k, g] of Object.entries(inferredGenders)) {
    if (g !== 'UNKNOWN') {
      mergedMeta[k] = { ...mergedMeta[k], gender: g };
    }
  }

  const frozenGlossaryBlock = Object.entries(filteredGlossary)
    .map(([cat, map]) => {
      const entries = Object.entries(map || {});
      return entries.length > 0
        ? `[${cat}] ${entries.map(([e, r]) => `${e}=${r}`).join('; ')}`
        : '';
    })
    .filter(Boolean)
    .join('\n');
  const frozenVoicesBlock = buildCharacterVoicePromptBlock(filteredGlossary, mergedMeta);
  const frozenSocialEdgesBlock =
    Array.isArray(params.socialEdges) && params.socialEdges.length > 0
      ? buildSocialRegisterPromptBlock(
          params.socialEdges,
          Object.keys(filteredGlossary.characters || {})
        )
      : '';

  const arcPacket: ArcCanonPacket = {
    arcId: `arc-${startChapter}-${endChapter}`,
    startChapter,
    endChapter,
    frozenGlossaryBlock,
    frozenVoicesBlock,
    frozenSocialEdgesBlock,
    cacheKey: `${startChapter}-${endChapter}-${Object.keys(filteredGlossary.characters || {}).length}`,
  };
  const arcCanonBlock = [
    frozenGlossaryBlock,
    frozenVoicesBlock,
    frozenSocialEdgesBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { arcPacket, arcCanonBlock, inferredGenders };
}

export async function runPipelineBatchOnNovelCore<TNovel extends NovelProject = NovelProject>(
  options: PipelineBatchOptions<TNovel>
): Promise<{ updatedNovel: TNovel; processedChaptersCount: number }> {
  const {
    novel,
    targetChapterIds,
    startChapter,
    endChapter,
    mode = 'full_5_phase',
    autoCanonEnabled = true,
    twoPassCriticEnabled = true,
    llmConfig,
    transport,
    onProgress,
    shouldAbort,
    signal,
    wavefrontConcurrency = 3,
    serverHooks,
  } = options;

  const isAborted = (): boolean => Boolean(signal?.aborted || shouldAbort?.());

  let targets: ChapterRecord[] = [];
  if (targetChapterIds && targetChapterIds.length > 0) {
    const idSet = new Set(targetChapterIds);
    targets = novel.chapters.filter((c) => idSet.has(c.id));
  } else if (startChapter !== undefined && endChapter !== undefined) {
    targets = novel.chapters.filter(
      (c) => c.number >= startChapter && c.number <= endChapter
    );
  } else {
    targets = [...novel.chapters];
  }

  targets.sort((a, b) => a.number - b.number);

  if (targets.length === 0) {
    return { updatedNovel: novel, processedChaptersCount: 0 };
  }

  onProgress?.({
    type: 'start',
    totalChapters: targets.length,
    genrePreset: novel.genrePreset,
    proseTone: novel.proseTone,
  });

  let workingGlossary = { ...novel.glossary };
  let workingGlossaryMeta = { ...novel.glossaryMeta };
  let workingScouted = [...novel.scoutedTerms];
  let workingLedger = novel.heroLedger ? { ...novel.heroLedger } : undefined;
  let arcCanonBlock: string | undefined;

  // Phase 0: Lookahead Batch Pre-Scouting & Two-Phase Arc Pre-Linker
  if (
    (mode === 'full_5_phase' || mode === 'scout_only') &&
    targets.length > 1 &&
    autoCanonEnabled
  ) {
    const lookahead = batchLookaheadScoutChapters(
      targets,
      workingGlossary,
      workingScouted
    );
    if (lookahead.autoPromotedCount > 0) {
      lookahead.discoveredTerms.forEach((dt) => {
        if (!dt.approved_for_glossary || !/[а-яёА-ЯЁ]/.test(dt.rus_suggested || '')) return;
        workingGlossary = {
          ...workingGlossary,
          [dt.category]: {
            ...(workingGlossary[dt.category] || {}),
            [dt.eng]: dt.rus_suggested,
          },
        };
        if (dt.gender) {
          workingGlossaryMeta = {
            ...workingGlossaryMeta,
            [dt.eng]: {
              ...workingGlossaryMeta[dt.eng],
              gender: dt.gender,
            },
          };
        }
      });
      workingScouted = [...workingScouted, ...lookahead.discoveredTerms];
      onProgress?.({
        type: 'pre_scout',
        autoPromotedCount: lookahead.autoPromotedCount,
      });
      onProgress?.({
        type: 'log',
        tag: 'ПРЕ-СКАУТ',
        message: `Lookahead-сканирование пакета (${targets.length} гл.): в канон зачислено ${lookahead.autoPromotedCount} сквозных терминов (точность ≥95%).`,
        level: 'success',
      });
    }
  }

  if (targets.length >= 2 && mode === 'full_5_phase') {
    const novelSocialEdges = (
      novel as unknown as { socialEdges?: SocialRegisterEdge[] }
    ).socialEdges;
    const preLinkerFn = serverHooks?.compileArcPreLinker ?? compileArcPreLinkerDeterministic;
    const preLinker = await preLinkerFn({
      targets,
      glossary: workingGlossary,
      glossaryMeta: workingGlossaryMeta,
      scoutedTerms: workingScouted,
      socialEdges: novelSocialEdges,
      llmConfig,
    });
    if (preLinker.arcCanonBlock) {
      arcCanonBlock = preLinker.arcCanonBlock;
    }
    if (autoCanonEnabled) {
      for (const [engName, inferredGender] of Object.entries(
        preLinker.inferredGenders
      )) {
        if (inferredGender && inferredGender !== 'UNKNOWN') {
          const curGender = workingGlossaryMeta[engName]?.gender;
          if (!curGender || curGender === 'UNKNOWN') {
            workingGlossaryMeta = {
              ...workingGlossaryMeta,
              [engName]: {
                ...workingGlossaryMeta[engName],
                gender: inferredGender,
              },
            };
          }
        }
      }
    }
  }

  // Track live non-quarantined chapters dynamically across iterations (C4)
  const liveChapterStateMap = new Map<string, ChapterRecord>();
  const updatedChaptersMap = new Map<string, ChapterRecord>();

  const computeDynamicSortedAll = (): ChapterRecord[] =>
    novel.chapters
      .map(
        (c) =>
          liveChapterStateMap.get(c.id) ?? updatedChaptersMap.get(c.id) ?? c
      )
      .filter((c) => c.status !== 'quarantined')
      .sort((a, b) => a.number - b.number);

  const initialSortedAll = computeDynamicSortedAll();
  const firstTargetIdx = initialSortedAll.findIndex((c) => c.id === targets[0]?.id);
  let rollingMemory = '';
  if (firstTargetIdx > 0 && initialSortedAll[firstTargetIdx - 1]?.summary) {
    rollingMemory = initialSortedAll[firstTargetIdx - 1].summary || '';
  }

  let processedCount = 0;
  let abortedFlag = false;
  let abortedEventEmitted = false;
  const emitAbortedOnce = () => {
    if (!abortedEventEmitted) {
      abortedEventEmitted = true;
      onProgress?.({ type: 'aborted', processedChaptersCount: processedCount });
    }
  };

  // Stage A: Lookahead Pre-Analysis & Pass 0 (strictly POST ruby/Korean normalization, <= 5 chapters ahead)
  const stageAPromises = new Map<number, Promise<StageAPreparedChapter>>();
  const ensureStageA = (idx: number): Promise<StageAPreparedChapter> => {
    const existing = stageAPromises.get(idx);
    if (existing) return existing;

    const task = (async (): Promise<StageAPreparedChapter> => {
      const ch = targets[idx];
      const rubyGikunRes = parseRubyAndGikunMarkup(ch.engText);
      const afterRuby =
        rubyGikunRes.foundCount > 0 ? rubyGikunRes.parsedText : ch.engText;
      const normalizedEngText =
        normalizeKoreanOneLineParagraphs(afterRuby).normalizedText;
      const pacingMode = classifyScenePacingMode(normalizedEngText);

      let lorebookBlock: string | undefined;
      const novelLore = (novel as unknown as { lorebook?: LorebookEntry[] }).lorebook;
      if (Array.isArray(novelLore) && novelLore.length > 0) {
        const loreRes = evaluateLorebookStateMachine(
          novelLore,
          ch.number,
          normalizedEngText
        );
        (novel as unknown as { lorebook?: LorebookEntry[] }).lorebook =
          loreRes.updatedEntries;
        lorebookBlock = loreRes.stateBlock;
      }

      let socialEdgesBlock: string | undefined;
      const novelEdges = (
        novel as unknown as { socialEdges?: SocialRegisterEdge[] }
      ).socialEdges;
      if (Array.isArray(novelEdges) && novelEdges.length > 0) {
        const charNames = Object.keys(workingGlossary.characters || {});
        socialEdgesBlock = buildSocialRegisterPromptBlock(novelEdges, charNames);
      }

      let forwardQuestionsBlock: string | undefined;
      if (workingLedger?.forwardQuestions && workingLedger.forwardQuestions.length > 0) {
        forwardQuestionsBlock = workingLedger.forwardQuestions
          .map(
            (q) =>
              `Q${q.id} (Ch.${q.createdAtChapter}): ${q.questionRus} [Status: ${q.status}]`
          )
          .join('\n');
      }

      const dialogueAnalysis = annotateSceneDialogueAndZeroPronouns(
        normalizedEngText,
        workingGlossary,
        workingGlossaryMeta,
        Array.isArray(novelEdges) ? novelEdges : []
      );
      const sceneDialogueBlock =
        dialogueAnalysis.annotations.length > 0
          ? dialogueAnalysis.promptSummaryBlock
          : undefined;

      let discoveredTerms: PipelineTransportScoutResponse['discoveredTerms'] = [];
      let scoutSucceeded = false;
      const degradedWarnings: string[] = [];
      if (mode === 'full_5_phase' || mode === 'scout_only') {
        try {
          const scoutRes = await transport.scout({
            engText: ch.engText,
            chapterNumber: ch.number,
            glossary: workingGlossary,
            scoutedTerms: workingScouted,
            genrePreset: novel.genrePreset,
            llmConfig,
          });
          discoveredTerms = scoutRes.discoveredTerms || [];
          if (Array.isArray(scoutRes.degradedWarnings)) {
            degradedWarnings.push(...scoutRes.degradedWarnings);
          }
          scoutSucceeded = true;
        } catch (err: unknown) {
          scoutSucceeded = false;
          degradedWarnings.push(
            `Scout transport error: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      return {
        normalizedEngText,
        pacingMode,
        sceneDialogueBlock,
        lorebookBlock,
        socialEdgesBlock,
        forwardQuestionsBlock,
        discoveredTerms,
        scoutSucceeded,
        degradedWarnings,
      };
    })();

    stageAPromises.set(idx, task);
    return task;
  };

  const stageCSemaphore = createConcurrencySemaphore(
    Math.max(1, wavefrontConcurrency)
  );
  const slotPromises: Array<Promise<WavefrontSlotResult>> = [];
  let nextCommitIdx = 0;

  const commitSlotResult = (res: WavefrontSlotResult) => {
    const stepTimeStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    if (res.kind === 'scout_only') {
      const rec: ChapterRecord = {
        ...res.chapter,
        lastUpdated: stepTimeStr,
      };
      updatedChaptersMap.set(rec.id, rec);
      onProgress?.({
        type: 'chapter_complete',
        chapterId: rec.id,
        chapter: rec,
      });
      processedCount++;
      return;
    }

    if (res.kind === 'quarantined') {
      onProgress?.({
        type: 'phase_step',
        chapterId: res.chapter.id,
        step: 5,
        label: 'Карантин (сбой LLM-провайдера)',
      });
      onProgress?.({
        type: 'log',
        tag: 'КАРАНТИН',
        message: `${res.label}: переведена в карантин (${res.reason}). Старый валидный текст и память DelTA сохранены без искажений.`,
        level: 'warn',
      });
      updatedChaptersMap.set(res.chapter.id, res.chapter);
      onProgress?.({
        type: 'chapter_complete',
        chapterId: res.chapter.id,
        chapter: res.chapter,
      });
      processedCount++;
      return;
    }

    onProgress?.({
      type: 'phase_step',
      chapterId: res.chapter.id,
      step: 4,
      label: res.fastPathUsed
        ? 'Fast-Path проверка и радар штампов'
        : 'Авто-ремонт и верификация QA',
    });

    if (res.appliedFixesCount > 0 || res.crossSlopFixedCount > 0) {
      onProgress?.({
        type: 'log',
        tag: 'АВТО-РЕМОНТ',
        message: `${res.label}: применено ${res.appliedFixesCount} QA-исправлений${
          res.crossSlopFixedCount > 0
            ? `, снято ${res.crossSlopFixedCount} кросс-главных штампов`
            : ''
        }.`,
        level: 'success',
      });
    }

    onProgress?.({
      type: 'phase_step',
      chapterId: res.chapter.id,
      step: 5,
      label: 'Верификация DITING и сохранение',
    });

    if (res.chapter.rusText.trim()) {
      workingLedger = updateHeroStateLedgerFromChapter(
        workingLedger,
        res.chapter.number,
        res.chapter.engText,
        res.chapter.rusText,
        workingGlossary
      );
    }

    liveChapterStateMap.set(res.chapter.id, res.chapter);
    updatedChaptersMap.set(res.chapter.id, res.chapter);
    onProgress?.({
      type: 'chapter_complete',
      chapterId: res.chapter.id,
      chapter: res.chapter,
    });
    processedCount++;
  };

  const commitReadySlots = async (drainAll: boolean) => {
    const threshold = drainAll ? 1 : Math.max(1, wavefrontConcurrency);
    while (slotPromises.length - nextCommitIdx >= threshold) {
      if (isAborted()) {
        abortedFlag = true;
        emitAbortedOnce();
        return;
      }
      const res = await slotPromises[nextCommitIdx];
      if (isAborted()) {
        abortedFlag = true;
        emitAbortedOnce();
        return;
      }
      nextCommitIdx++;
      commitSlotResult(res);
    }
  };

  // Stage B: Sequential Pass 1 + Dispatch into Stage C Parallel K=3 Pool
  for (let idx = 0; idx < targets.length; idx++) {
    if (isAborted()) {
      abortedFlag = true;
      emitAbortedOnce();
      break;
    }

    const ch = targets[idx];
    const label = `Глава ${ch.subPart || ch.number}`;

    // Warm Stage A lookahead strictly up to <= 5 chapters ahead
    const lookaheadLimit = Math.min(targets.length - 1, idx + 4);
    for (let k = idx; k <= lookaheadLimit; k++) {
      ensureStageA(k);
    }

    onProgress?.({
      type: 'chapter_start',
      chapterId: ch.id,
      chapterNumber: ch.number,
    });

    const stageA = await ensureStageA(idx);

    if (mode === 'full_5_phase' || mode === 'scout_only') {
      onProgress?.({
        type: 'phase_step',
        chapterId: ch.id,
        step: 1,
        label: 'Скаутинг терминов A−S',
      });

      if (stageA.scoutSucceeded) {
        const cleanedDiscovered = filterScoutedTermsWithAgentS(
          stageA.discoveredTerms,
          workingGlossary,
          workingScouted
        );

        const newTerms: ScoutedTerm[] = cleanedDiscovered.map((t, i) => {
          const hasCyrillic = Boolean(
            t.rus_suggested && /[а-яёА-ЯЁ]/.test(t.rus_suggested)
          );
          const conf = hasCyrillic
            ? t.confidence || 0.93
            : Math.min(t.confidence || 0.65, 0.65);
          const autoApproved =
            autoCanonEnabled &&
            hasCyrillic &&
            conf >= (novel.autoApproveThreshold ?? 0.92);
          return {
            id: `scout-${Date.now()}-${i}`,
            eng: t.eng,
            rus_suggested: t.rus_suggested,
            category: t.category || 'system_and_terms',
            gender: t.gender || 'UNKNOWN',
            chapter_first_seen: ch.number,
            context_snippet: t.context_snippet || ch.titleEng,
            approved_for_glossary: autoApproved,
            confidence: conf,
          };
        });

        const autoPromotedCount = newTerms.filter((t) => t.approved_for_glossary).length;
        const existingEng = new Set(workingScouted.map((st) => st.eng.toLowerCase()));
        const filteredNew = newTerms.filter(
          (nt) => !existingEng.has(nt.eng.toLowerCase())
        );

        const nextGlossary = { ...workingGlossary };
        const nextMeta = { ...workingGlossaryMeta };

        const updatedExistingScouted = workingScouted.map((st) => {
          const hasCyrillic = Boolean(
            st.rus_suggested && /[а-яёА-ЯЁ]/.test(st.rus_suggested)
          );
          if (
            autoCanonEnabled &&
            hasCyrillic &&
            !st.approved_for_glossary &&
            st.confidence >= (novel.autoApproveThreshold ?? 0.92)
          ) {
            nextGlossary[st.category] = {
              ...(nextGlossary[st.category] || {}),
              [st.eng]: st.rus_suggested,
            };
            if (st.gender) {
              nextMeta[st.eng] = {
                ...nextMeta[st.eng],
                gender: st.gender,
              };
            }
            return { ...st, approved_for_glossary: true };
          }
          return st;
        });

        filteredNew.forEach((nt) => {
          if (nt.approved_for_glossary && /[а-яёА-ЯЁ]/.test(nt.rus_suggested || '')) {
            nextGlossary[nt.category] = {
              ...(nextGlossary[nt.category] || {}),
              [nt.eng]: nt.rus_suggested,
            };
            if (nt.gender) {
              nextMeta[nt.eng] = { gender: nt.gender };
            }
          }
        });

        workingGlossary = nextGlossary;
        workingGlossaryMeta = nextMeta;
        workingScouted = [...updatedExistingScouted, ...filteredNew];

        onProgress?.({
          type: 'log',
          tag: 'СКАУТ A−S',
          message: `${label}: скаутинг завершён (${newTerms.length} терминов${
            autoPromotedCount > 0 ? `, авто-канон: +${autoPromotedCount}` : ''
          }).`,
          level: 'success',
        });
      } else {
        onProgress?.({
          type: 'log',
          tag: 'СКАУТ',
          message: `${label}: скаутинг пропущен из-за ошибки транспорта.`,
          level: 'warn',
        });
      }

      if (mode === 'scout_only') {
        const scoutOnlyWarnings = Array.from(new Set(stageA.degradedWarnings.filter(Boolean)));
        if (scoutOnlyWarnings.length > 0) {
          onProgress?.({
            type: 'log',
            tag: 'ДЕГРАДАЦИЯ',
            message: `${label}: частичный fallback (${scoutOnlyWarnings.join('; ')})`,
            level: 'warn',
          });
        }
        slotPromises.push(
          Promise.resolve({
            kind: 'scout_only',
            chapter: {
              ...ch,
              scouted: true,
              degradedWarnings: scoutOnlyWarnings.length > 0 ? scoutOnlyWarnings : undefined,
              lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
            },
          })
        );
        await commitReadySlots(false);
        if (abortedFlag) break;
        continue;
      }
    }

    if (isAborted()) {
      abortedFlag = true;
      emitAbortedOnce();
      break;
    }

    // Dynamic DelTA computation across live updated chapters (excluding quarantined)
    const sortedAll = computeDynamicSortedAll();
    const curIdx = sortedAll.findIndex((c) => c.id === ch.id);
    const prevCh = curIdx > 0 ? sortedAll[curIdx - 1] : null;
    const earlierChs = curIdx > 0 ? sortedAll.slice(0, curIdx) : [];

    let workingRus = ch.rusText;
    let workingTitleRus = ch.titleRus;
    let workingSummary = ch.summary || '';
    let workingSummaryEng = ch.summaryEng || '';
    let workingCsiNotes: CsiCulturalNote[] | undefined = ch.csiNotes;
    let workingDitingReport: DitingQualityReport | undefined = ch.ditingReport;
    let lastEngineUsed = ch.lastEngineUsed;
    let transportVerifiedOutput: ChapterVerificationOutput | undefined;
    const chapterDegradedWarnings: string[] = [...stageA.degradedWarnings];

    const needsTranslation =
      mode === 'full_5_phase' && (!ch.translated || ch.status === 'quarantined');

    if (needsTranslation) {
      onProgress?.({
        type: 'phase_step',
        chapterId: ch.id,
        step: 2,
        label: '3-агентный перевод LCD-MAS',
      });

      const deltaPacket = buildDelTAContextPacket(
        stageA.normalizedEngText,
        prevCh,
        earlierChs,
        workingGlossary,
        3
      );

      const transRes = await transport.translateAndEdit({
        engText: ch.engText,
        titleEng: ch.titleEng,
        chapterNumber: ch.number,
        glossary: workingGlossary,
        glossaryMeta: workingGlossaryMeta,
        scoutedTerms: workingScouted,
        styleGuideMd: novel.styleGuideMd,
        genrePreset: novel.genrePreset,
        proseTone: novel.proseTone,
        previousChapterSummary: rollingMemory || deltaPacket.bilingualSummary.rus,
        previousChapterSummaryEng: deltaPacket.bilingualSummary.eng,
        deltaShortTermWindow: deltaPacket.shortTermWindow,
        deltaLongTermMemories: deltaPacket.longTermMemories,
        enabledRuleIds: novel.enabledRuleIds,
        twoPassCritic: twoPassCriticEnabled,
        heroLedger: workingLedger,
        llmConfig,
        socialEdgesBlock: stageA.socialEdgesBlock,
        lorebookBlock: stageA.lorebookBlock,
        forwardQuestionsBlock: stageA.forwardQuestionsBlock,
        sceneDialogueBlock: stageA.sceneDialogueBlock,
        useHashAnchors: true,
        arcCanonBlock,
        pacingMode: stageA.pacingMode,
      });

      if (Array.isArray(transRes.degradedWarnings)) {
        chapterDegradedWarnings.push(...transRes.degradedWarnings);
      }
      const uniqueChapterWarnings = Array.from(
        new Set(chapterDegradedWarnings.filter(Boolean))
      );

      const isQuarantined =
        Boolean(transRes.quarantined) ||
        transRes.engine === 'quarantined-outage' ||
        !transRes.rusText ||
        /^\[КАРАНТИН:/i.test(transRes.rusText.trim());

      if (isQuarantined) {
        if (uniqueChapterWarnings.length > 0) {
          onProgress?.({
            type: 'log',
            tag: 'ДЕГРАДАЦИЯ',
            message: `${label}: частичный fallback (${uniqueChapterWarnings.join('; ')})`,
            level: 'warn',
          });
        }
        const existingValidRus =
          ch.rusText && !/^\[КАРАНТИН:/i.test(ch.rusText.trim()) ? ch.rusText : '';
        const quarantineReason =
          transRes.quarantineReason ||
          'Все провайдеры LLM недоступны при переводе главы';
        const stepTimeStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const quarantinedRecord: ChapterRecord = {
          ...ch,
          titleRus: existingValidRus
            ? ch.titleRus
            : transRes.titleRus || ch.titleRus || `Глава ${ch.number}`,
          rusText: existingValidRus,
          scouted: true,
          translated: Boolean(existingValidRus.trim()),
          edited: Boolean(existingValidRus.trim()),
          verified: false,
          status: 'quarantined',
          quarantineReason,
          degradedWarnings:
            uniqueChapterWarnings.length > 0 ? uniqueChapterWarnings : undefined,
          lastEngineUsed: transRes.engine || 'quarantined-outage',
          pacingMode: transRes.pacingMode || stageA.pacingMode,
          wordCountRus: existingValidRus.trim()
            ? existingValidRus.trim().split(/\s+/).filter(Boolean).length
            : 0,
          lastUpdated: stepTimeStr,
        };

        liveChapterStateMap.set(ch.id, quarantinedRecord);
        slotPromises.push(
          Promise.resolve({
            kind: 'quarantined',
            chapter: quarantinedRecord,
            label,
            reason: quarantineReason,
          })
        );
        await commitReadySlots(false);
        if (abortedFlag) break;
        continue;
      }

      workingRus = transRes.rusText;
      workingTitleRus = transRes.titleRus || ch.titleRus;
      workingSummary = transRes.summary || '';
      workingSummaryEng = transRes.summaryEng || '';
      lastEngineUsed = transRes.engine || lastEngineUsed;
      if (Array.isArray(transRes.csiNotes)) {
        workingCsiNotes = transRes.csiNotes;
      }
      if (transRes.ditingReport) {
        workingDitingReport = transRes.ditingReport;
      }
      if (transRes.alreadyVerified && transRes.lintReport && transRes.ditingReport) {
        transportVerifiedOutput = {
          rusText: transRes.rusText,
          titleRus: transRes.titleRus || ch.titleRus || `Глава ${ch.number}`,
          summary: transRes.summary || '',
          summaryEng: transRes.summaryEng || '',
          csiNotes: transRes.csiNotes || [],
          ditingReport: transRes.ditingReport,
          proseGateReport: transRes.proseGateReport,
          neuralAudit: transRes.neuralAudit,
          lintReport: transRes.lintReport,
          appliedFixes: transRes.appliedFixes || [],
          surgicallyFixedParagraphs: [],
          flawedParagraphIndices: [],
          verified: Boolean(transRes.verified ?? transRes.lintReport.passed),
          wordCountEng:
            transRes.wordCountEng ??
            ch.engText.trim().split(/\s+/).filter(Boolean).length,
          wordCountRus:
            transRes.wordCountRus ??
            transRes.rusText.trim().split(/\s+/).filter(Boolean).length,
        };
      }

      rollingMemory = workingSummary || rollingMemory;
      liveChapterStateMap.set(ch.id, {
        ...ch,
        titleRus: workingTitleRus,
        rusText: workingRus,
        summary: workingSummary,
        summaryEng: workingSummaryEng,
        status: 'translated',
        quarantineReason: undefined,
      });

      onProgress?.({
        type: 'log',
        tag: 'LCD-MAS',
        message: `${label}: 3-агентный перевод завершён.`,
        level: 'success',
      });
    }

    const uniqueChapterWarnings = Array.from(
      new Set(chapterDegradedWarnings.filter(Boolean))
    );
    if (uniqueChapterWarnings.length > 0) {
      onProgress?.({
        type: 'log',
        tag: 'ДЕГРАДАЦИЯ',
        message: `${label}: частичный fallback (${uniqueChapterWarnings.join('; ')})`,
        level: 'warn',
      });
    }

    if (isAborted()) {
      abortedFlag = true;
      emitAbortedOnce();
      break;
    }

    // Snapshot Stage C inputs so parallel K=3 workers execute deterministically without data races
    const glossarySnapshot = workingGlossary;
    const glossaryMetaSnapshot = workingGlossaryMeta;
    const earlierWindowSnapshot = earlierChs
      .slice(-25)
      .map((ec) => ({ number: ec.number, rusText: ec.rusText }));
    const rollingMemorySnapshot = rollingMemory;
    const workingHistory: ChapterVersionSnapshot[] = [...(ch.versionHistory || [])];

    const stageCTask = (async (): Promise<WavefrontSlotResult> => {
      await stageCSemaphore.acquire();
      try {
        let verified =
          transportVerifiedOutput ??
          (transport.verifyAndRepair
            ? await transport.verifyAndRepair({
                chapterNumber: ch.number,
                titleEng: ch.titleEng,
                titleRus: workingTitleRus,
                engText: ch.engText,
                rusText: workingRus,
                glossary: glossarySnapshot,
                glossaryMeta: glossaryMetaSnapshot,
                enabledRuleIds: novel.enabledRuleIds,
                genrePreset: novel.genrePreset,
                proseTone: novel.proseTone,
                llmConfig,
                existingSummaryRus: workingSummary,
                existingSummaryEng: workingSummaryEng,
                aiCsiNotes: workingCsiNotes,
                previousChapters: earlierWindowSnapshot,
                pacingMode: stageA.pacingMode,
              })
            : finalizeAndVerifyChapter({
                chapterNumber: ch.number,
                titleEng: ch.titleEng,
                titleRus: workingTitleRus,
                engText: ch.engText,
                candidateRusText: workingRus,
                glossary: glossarySnapshot,
                glossaryMeta: glossaryMetaSnapshot,
                enabledRuleIds: novel.enabledRuleIds,
                runSurgicalDriftRepair: true,
                existingSummaryRus: workingSummary,
                existingSummaryEng: workingSummaryEng,
                aiCsiNotes: workingCsiNotes,
              }));

        let crossSlopIssues = detectCrossChapterSlopCooldown({
          currentChapterNumber: ch.number,
          rusText: verified.rusText,
          previousChapters: earlierWindowSnapshot,
          glossary: glossarySnapshot,
          windowSize: 25,
        });

        const neuralOk =
          !verified.neuralAudit ||
          (verified.neuralAudit.lowPairs.length === 0 &&
            verified.neuralAudit.lowSimilarityCount === 0 &&
            verified.neuralAudit.meanCosine >= 0.72);
        const fastPathUsed =
          Boolean(transportVerifiedOutput) &&
          verified.lintReport.errorCount === 0 &&
          crossSlopIssues.length === 0 &&
          neuralOk;

        let crossSlopFixedCount = 0;
        if (
          !fastPathUsed &&
          (verified.lintReport.errorCount > 0 ||
            crossSlopIssues.length > 0 ||
            !neuralOk)
        ) {
          const preSlopCount = crossSlopIssues.length;
          const patchedRes = serverHooks?.applyUnifiedDeltaPatcher
            ? await serverHooks.applyUnifiedDeltaPatcher({
            chapterNumber: ch.number,
            titleEng: ch.titleEng,
            titleRus: verified.titleRus,
            engText: ch.engText,
            currentVerif: verified,
            crossSlopIssues,
            previousChapters: earlierWindowSnapshot,
            glossary: glossarySnapshot,
            glossaryMeta: glossaryMetaSnapshot,
            enabledRuleIds: novel.enabledRuleIds,
            previousChapterSummary: rollingMemorySnapshot,
            llmConfig,
            proseTone: novel.proseTone,
          })
            : { verified, crossSlopIssues, patched: false };
          if (patchedRes.patched) {
            verified = patchedRes.verified;
            crossSlopIssues = patchedRes.crossSlopIssues;
            crossSlopFixedCount = Math.max(0, preSlopCount - crossSlopIssues.length);
          }
        }

        const stepTimeStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const finalRus = verified.rusText;
        const finalTitleRus = verified.titleRus;
        const finalSummary = verified.summary;
        const finalSummaryEng = verified.summaryEng;
        const finalCsiNotes = verified.csiNotes;
        const finalDitingReport = verified.ditingReport || workingDitingReport;

        if (
          finalRus.trim() &&
          !workingHistory.some((v) => v.rusText.trim() === finalRus.trim())
        ) {
          workingHistory.push({
            id: `ver-p5-${ch.id}-${Date.now()}`,
            timestamp: stepTimeStr,
            stageLabel: 'Авто-ремонт QA и верификация DITING (Фаза 4–5)',
            titleRus: finalTitleRus,
            rusText: finalRus,
            wordCountRus: verified.wordCountRus,
            qaPassed: verified.verified,
            qaErrorCount: verified.lintReport.errorCount,
          });
          if (workingHistory.length > 10) {
            workingHistory.splice(0, workingHistory.length - 10);
          }
        }

        const qaSummary: ChapterQaSummary = computeChapterQaSummary(
          ch.engText,
          finalRus,
          glossarySnapshot,
          {
            glossaryMeta: glossaryMetaSnapshot,
            enabledRuleIds: novel.enabledRuleIds,
          }
        );

        const nextStatus: ChapterStatus = verified.verified
          ? 'verified'
          : finalRus.trim()
            ? 'translated'
            : 'pending';

        const updatedChapter: ChapterRecord = {
          ...ch,
          titleRus: finalTitleRus,
          rusText: finalRus,
          summary: finalSummary,
          summaryEng: finalSummaryEng,
          csiNotes: finalCsiNotes,
          ditingReport: finalDitingReport,
          versionHistory: workingHistory,
          scouted: true,
          translated: Boolean(finalRus.trim()),
          edited: Boolean(finalRus.trim()),
          verified: verified.verified,
          status: nextStatus,
          quarantineReason: undefined,
          degradedWarnings:
            uniqueChapterWarnings.length > 0 ? uniqueChapterWarnings : undefined,
          lastEngineUsed: lastEngineUsed || 'pipeline-batch-verifier',
          pacingMode: stageA.pacingMode,
          qaSummary,
          wordCountEng: verified.wordCountEng,
          wordCountRus: verified.wordCountRus,
          lastUpdated: stepTimeStr,
        };

        return {
          kind: 'verified',
          chapter: updatedChapter,
          label,
          appliedFixesCount: verified.appliedFixes.length,
          crossSlopFixedCount,
          fastPathUsed,
        };
      } finally {
        stageCSemaphore.release();
      }
    })();

    slotPromises.push(stageCTask);
    await commitReadySlots(false);
    if (abortedFlag) break;
  }

  if (!abortedFlag) {
    await commitReadySlots(true);
  }

  const finalChapters = novel.chapters.map(
    (ch) => updatedChaptersMap.get(ch.id) || ch
  );

  const updatedNovel: TNovel = {
    ...novel,
    glossary: workingGlossary,
    glossaryMeta: workingGlossaryMeta,
    scoutedTerms: workingScouted,
    heroLedger: workingLedger || novel.heroLedger,
    chapters: finalChapters,
  };

  onProgress?.({
    type: 'batch_complete',
    updatedNovel,
    processedChaptersCount: processedCount,
  });

  return { updatedNovel, processedChaptersCount: processedCount };
}

/**
 * Browser-safe batch runner wrapper (uses deterministic Arc Pre-Linker when server hooks are omitted).
 */
export async function runPipelineBatchOnNovel<TNovel extends NovelProject = NovelProject>(
  options: PipelineBatchOptions<TNovel>
): Promise<{ updatedNovel: TNovel; processedChaptersCount: number }> {
  return runPipelineBatchOnNovelCore(options);
}
