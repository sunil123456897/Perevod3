import {
  finalizeAndVerifyChapter,
  type ChapterVerificationOutput,
} from './chapter-verifier.ts';
import {
  batchLookaheadScoutChapters,
  buildSocialRegisterPromptBlock,
} from './canon-glossary-vault.ts';
import { annotateSceneDialogueAndZeroPronouns } from './llm-inference-port.ts';
import {
  runAdditionBySubtractionScout,
  filterScoutedTermsWithAgentS,
  buildDelTAContextPacket,
  updateHeroStateLedgerFromChapter,
  mergeSplitChapters,
  evaluateLorebookStateMachine,
  sampleChaptersStratifiedMonteCarlo,
  type CanonicalGlossary,
  type GlossaryCategory,
  type GlossaryTermMeta,
  type GrammaticalGender,
  type ScoutedTerm,
  type LintRuleId,
  type GenrePreset,
  type ProseTone,
  type HeroStateLedger,
  type CsiCulturalNote,
  type DitingQualityReport,
  type LlmProviderConfig,
  type DelTAShortTermPair,
  type DelTALongTermMatch,
  type LorebookEntry,
  type SocialRegisterEdge,
  SlidingWindowPriorityQueue,
} from './qa-linter.ts';
import type {
  NovelProject,
  ChapterRecord,
  ChapterVersionSnapshot,
} from './seed-data.ts';

export { sampleChaptersStratifiedMonteCarlo, evaluateLorebookStateMachine };

export interface PipelineTransportScoutRequest {
  engText: string;
  chapterNumber: number;
  glossary: CanonicalGlossary;
  scoutedTerms?: ScoutedTerm[];
  genrePreset?: GenrePreset;
  llmConfig?: LlmProviderConfig;
}

export interface PipelineTransportScoutResponse {
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
}

export interface PipelineTransportTranslateResponse {
  rusText: string;
  titleRus?: string;
  summary?: string;
  summaryEng?: string;
  csiNotes?: CsiCulturalNote[];
  ditingReport?: DitingQualityReport;
  proseGateReport?: ChapterVerificationOutput['proseGateReport'];
  neuralAudit?: ChapterVerificationOutput['neuralAudit'];
  scenePacingMode?: string;
  otqsScore?: number;
  stylistAcceptedCount?: number;
  stylistRolledBackCount?: number;
  rubyGikunCount?: number;
  alreadyVerified?: boolean;
  verified?: boolean;
  appliedFixes?: string[];
  lintReport?: ChapterVerificationOutput['lintReport'];
  wordCountEng?: number;
  wordCountRus?: number;
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
        gender: dt.gender || 'M',
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

  async scout(
    req: PipelineTransportScoutRequest
  ): Promise<PipelineTransportScoutResponse> {
    const doFetch = async () => {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scout', ...req }),
      });
      return res.json();
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
      return res.json();
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
      try {
        const res = await fetch(this.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'self_repair', ...req }),
        });
        if (res.ok) {
          const data = await res.json();
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
        }
      } catch {
        // Fallback to local synchronous verifier if offline
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

/**
 * Automatically merges fractional half-chapters (e.g., 7.1 + 7.2 -> 7) across a novel.
 */
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
}

/**
 * 5-Phase Batch Pipeline Orchestration Engine.
 * Executes Phase 0 (Lookahead pre-scout), Phase 1 (Scout A-S), Phase 2-3 (DelTA memory & LCD-MAS),
 * Phase 4-5 (Auto-Repair, finalizeAndVerifyChapter, HeroStateLedger updates, version history).
 */
export async function runPipelineBatchOnNovel<TNovel extends NovelProject = NovelProject>(
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
  } = options;

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

  // Phase 0: Lookahead Batch Pre-Scouting
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

  // Track rolling memory across chapters
  const sortedAll = [...novel.chapters].sort((a, b) => a.number - b.number);
  const firstTargetIdx = sortedAll.findIndex((c) => c.id === targets[0]?.id);
  let rollingMemory = '';
  if (firstTargetIdx > 0 && sortedAll[firstTargetIdx - 1]?.summary) {
    rollingMemory = sortedAll[firstTargetIdx - 1].summary || '';
  }

  const updatedChaptersMap = new Map<string, ChapterRecord>();
  let processedCount = 0;

  for (const ch of targets) {
    if (shouldAbort?.()) {
      onProgress?.({ type: 'aborted', processedChaptersCount: processedCount });
      break;
    }

    onProgress?.({
      type: 'chapter_start',
      chapterId: ch.id,
      chapterNumber: ch.number,
    });
    const label = `Глава ${ch.subPart || ch.number}`;

    // Phase 1: Scouting A-S
    if (mode === 'full_5_phase' || mode === 'scout_only') {
      onProgress?.({
        type: 'phase_step',
        chapterId: ch.id,
        step: 1,
        label: 'Скаутинг терминов A−S',
      });
      try {
        const scoutRes = await transport.scout({
          engText: ch.engText,
          chapterNumber: ch.number,
          glossary: workingGlossary,
          scoutedTerms: workingScouted,
          genrePreset: novel.genrePreset,
          llmConfig,
        });

        const cleanedDiscovered = filterScoutedTermsWithAgentS(
          scoutRes.discoveredTerms || [],
          workingGlossary,
          workingScouted
        );

        const newTerms: ScoutedTerm[] = cleanedDiscovered.map(
          (t, i) => {
            const hasCyrillic = Boolean(t.rus_suggested && /[а-яёА-ЯЁ]/.test(t.rus_suggested));
            const conf = hasCyrillic ? t.confidence || 0.93 : Math.min(t.confidence || 0.65, 0.65);
            const autoApproved =
              autoCanonEnabled &&
              hasCyrillic &&
              conf >= (novel.autoApproveThreshold ?? 0.92);
            return {
              id: `scout-${Date.now()}-${i}`,
              eng: t.eng,
              rus_suggested: t.rus_suggested,
              category: t.category || 'system_and_terms',
              gender: t.gender || 'M',
              chapter_first_seen: ch.number,
              context_snippet: t.context_snippet || ch.titleEng,
              approved_for_glossary: autoApproved,
              confidence: conf,
            };
          }
        );

        const autoPromotedCount = newTerms.filter(
          (t) => t.approved_for_glossary
        ).length;
        const existingEng = new Set(
          workingScouted.map((st) => st.eng.toLowerCase())
        );
        const filteredNew = newTerms.filter(
          (nt) => !existingEng.has(nt.eng.toLowerCase())
        );

        const nextGlossary = { ...workingGlossary };
        const nextMeta = { ...workingGlossaryMeta };

        const updatedExistingScouted = workingScouted.map((st) => {
          const hasCyrillic = Boolean(st.rus_suggested && /[а-яёА-ЯЁ]/.test(st.rus_suggested));
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
      } catch {
        onProgress?.({
          type: 'log',
          tag: 'СКАУТ',
          message: `${label}: скаутинг пропущен из-за ошибки транспорта.`,
          level: 'warn',
        });
      }

      if (mode === 'scout_only') {
        const updatedRecord: ChapterRecord = {
          ...ch,
          scouted: true,
          lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
        };
        updatedChaptersMap.set(ch.id, updatedRecord);
        onProgress?.({
          type: 'chapter_complete',
          chapterId: ch.id,
          chapter: updatedRecord,
        });
        processedCount++;
        continue;
      }
    }

    if (shouldAbort?.()) {
      onProgress?.({ type: 'aborted', processedChaptersCount: processedCount });
      break;
    }

    let workingRus = ch.rusText;
    let workingTitleRus = ch.titleRus;
    let workingSummary = ch.summary || '';
    let workingSummaryEng = ch.summaryEng || '';
    let workingCsiNotes: CsiCulturalNote[] | undefined = ch.csiNotes;
    let workingDitingReport: DitingQualityReport | undefined = ch.ditingReport;
    let transportVerifiedOutput: ChapterVerificationOutput | undefined;
    const workingHistory: ChapterVersionSnapshot[] = [
      ...(ch.versionHistory || []),
    ];
    const stepTimeStr = new Date()
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');

    // Phase 2 & 3: DelTA Memory + LCD-MAS Translation
    if (mode === 'full_5_phase' && !ch.translated) {
      onProgress?.({
        type: 'phase_step',
        chapterId: ch.id,
        step: 2,
        label: '3-агентный перевод LCD-MAS',
      });

      const curIdx = sortedAll.findIndex((c) => c.id === ch.id);
      const prevCh = curIdx > 0 ? sortedAll[curIdx - 1] : null;
      const earlierChs = curIdx > 0 ? sortedAll.slice(0, curIdx) : [];
      const deltaPacket = buildDelTAContextPacket(
        ch.engText,
        prevCh,
        earlierChs,
        workingGlossary,
        3
      );

      // Wave 2 Context Extensions: Lorebook, Directed Social Registers, Chekhov's Forward Questions
      let activeLorebookBlock: string | undefined;
      const novelLore = (novel as unknown as { lorebook?: LorebookEntry[] }).lorebook;
      if (Array.isArray(novelLore) && novelLore.length > 0) {
        const loreRes = evaluateLorebookStateMachine(novelLore, ch.number, ch.engText);
        (novel as unknown as { lorebook?: LorebookEntry[] }).lorebook = loreRes.updatedEntries;
        activeLorebookBlock = loreRes.stateBlock;
      }

      let socialEdgesBlock: string | undefined;
      const novelEdges = (novel as unknown as { socialEdges?: SocialRegisterEdge[] }).socialEdges;
      if (Array.isArray(novelEdges) && novelEdges.length > 0) {
        const charNames = Object.keys(workingGlossary.characters || {});
        socialEdgesBlock = buildSocialRegisterPromptBlock(novelEdges, charNames);
      }

      let forwardQuestionsBlock: string | undefined;
      if (workingLedger?.forwardQuestions && workingLedger.forwardQuestions.length > 0) {
        forwardQuestionsBlock = workingLedger.forwardQuestions
          .map((q) => `Q${q.id} (Ch.${q.createdAtChapter}): ${q.questionRus} [Status: ${q.status}]`)
          .join('\n');
      }

      const dialogueAnalysis = annotateSceneDialogueAndZeroPronouns(
        ch.engText,
        workingGlossary,
        workingGlossaryMeta,
        Array.isArray(novelEdges) ? novelEdges : []
      );
      const sceneDialogueBlock =
        dialogueAnalysis.annotations.length > 0
          ? dialogueAnalysis.promptSummaryBlock
          : undefined;

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
        previousChapterSummary:
          rollingMemory || deltaPacket.bilingualSummary.rus,
        previousChapterSummaryEng: deltaPacket.bilingualSummary.eng,
        deltaShortTermWindow: deltaPacket.shortTermWindow,
        deltaLongTermMemories: deltaPacket.longTermMemories,
        enabledRuleIds: novel.enabledRuleIds,
        twoPassCritic: twoPassCriticEnabled,
        heroLedger: workingLedger,
        llmConfig,
        socialEdgesBlock,
        lorebookBlock: activeLorebookBlock,
        forwardQuestionsBlock,
        sceneDialogueBlock,
        useHashAnchors: true,
      });

      if (transRes.rusText) {
        workingRus = transRes.rusText;
        workingTitleRus = transRes.titleRus || ch.titleRus;
        workingSummary = transRes.summary || '';
        workingSummaryEng = transRes.summaryEng || '';
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

        onProgress?.({
          type: 'log',
          tag: 'LCD-MAS',
          message: `${label}: 3-агентный перевод завершён.`,
          level: 'success',
        });
      }
    }

    if (shouldAbort?.()) {
      onProgress?.({ type: 'aborted', processedChaptersCount: processedCount });
      break;
    }

    // Phase 4 & 5: Auto-Repair & Verification via ChapterVerificationPipeline
    onProgress?.({
      type: 'phase_step',
      chapterId: ch.id,
      step: 4,
      label: 'Авто-ремонт и верификация QA',
    });

    const verified =
      transportVerifiedOutput ??
      (transport.verifyAndRepair
        ? await transport.verifyAndRepair({
            chapterNumber: ch.number,
            titleEng: ch.titleEng,
            titleRus: workingTitleRus,
            engText: ch.engText,
            rusText: workingRus,
            glossary: workingGlossary,
            glossaryMeta: workingGlossaryMeta,
            enabledRuleIds: novel.enabledRuleIds,
            genrePreset: novel.genrePreset,
            proseTone: novel.proseTone,
            llmConfig,
            existingSummaryRus: workingSummary,
            existingSummaryEng: workingSummaryEng,
            aiCsiNotes: workingCsiNotes,
          })
        : finalizeAndVerifyChapter({
            chapterNumber: ch.number,
            titleEng: ch.titleEng,
            titleRus: workingTitleRus,
            engText: ch.engText,
            candidateRusText: workingRus,
            glossary: workingGlossary,
            glossaryMeta: workingGlossaryMeta,
            enabledRuleIds: novel.enabledRuleIds,
            runSurgicalDriftRepair: true,
            existingSummaryRus: workingSummary,
            existingSummaryEng: workingSummaryEng,
            aiCsiNotes: workingCsiNotes,
          }));

    if (verified.appliedFixes.length > 0) {
      onProgress?.({
        type: 'log',
        tag: 'АВТО-РЕМОНТ',
        message: `${label}: точечный ремонт абзацев и QA-линтер применили ${verified.appliedFixes.length} исправлений.`,
        level: 'success',
      });
    }

    onProgress?.({
      type: 'phase_step',
      chapterId: ch.id,
      step: 5,
      label: 'Верификация DITING и сохранение',
    });

    workingRus = verified.rusText;
    workingTitleRus = verified.titleRus;
    workingSummary = verified.summary;
    workingSummaryEng = verified.summaryEng;
    workingCsiNotes = verified.csiNotes;
    workingDitingReport = verified.ditingReport;
    rollingMemory = workingSummary || rollingMemory;

    if (workingRus.trim()) {
      workingLedger = updateHeroStateLedgerFromChapter(
        workingLedger,
        ch.number,
        ch.engText,
        workingRus,
        workingGlossary
      );
    }

    if (
      workingRus.trim() &&
      !workingHistory.some((v) => v.rusText.trim() === workingRus.trim())
    ) {
      workingHistory.push({
        id: `ver-p5-${ch.id}-${Date.now()}`,
        timestamp: stepTimeStr,
        stageLabel: 'Авто-ремонт QA и верификация DITING (Фаза 4–5)',
        titleRus: workingTitleRus,
        rusText: workingRus,
        wordCountRus: verified.wordCountRus,
        qaPassed: verified.verified,
        qaErrorCount: verified.lintReport.errorCount,
      });
    }

    const updatedChapter: ChapterRecord = {
      ...ch,
      titleRus: workingTitleRus,
      rusText: workingRus,
      summary: workingSummary,
      summaryEng: workingSummaryEng,
      csiNotes: workingCsiNotes,
      ditingReport: workingDitingReport,
      versionHistory: workingHistory,
      scouted: true,
      translated: Boolean(workingRus.trim()),
      edited: Boolean(workingRus.trim()),
      verified: verified.verified,
      wordCountEng: verified.wordCountEng,
      wordCountRus: verified.wordCountRus,
      lastUpdated: stepTimeStr,
    };

    updatedChaptersMap.set(ch.id, updatedChapter);
    onProgress?.({
      type: 'chapter_complete',
      chapterId: ch.id,
      chapter: updatedChapter,
    });
    processedCount++;
  }

  const finalChapters = novel.chapters.map((ch) =>
    updatedChaptersMap.get(ch.id) || ch
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
