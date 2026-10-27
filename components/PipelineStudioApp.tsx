'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Play,
  Square,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  FolderPlus,
  RotateCcw,
  ArrowRight,
  Terminal,
  Wand2,
  X,
  Upload,
  Download,
  SlidersHorizontal,
  Zap,
  ShieldCheck,
  Cpu,
  Copy,
  Check,
} from 'lucide-react';
import {
  finalizeAndVerifyChapter,
  prepareGlossaryStopGateTerms,
  autoMergeSplitChaptersInNovel,
  runPipelineBatchOnNovel,
  FetchPipelineTransportAdapter,
  serializeProjectBundle,
  deserializeProjectBundle,
  runQaLinter,
  autoRepairRussianText,
  surgicalRepairDriftedParagraphs,
  updateHeroStateLedgerFromChapter,
  batchLookaheadScoutChapters,
  buildRulateExportPackages,
  mergeSplitChapters,
  ALL_LINT_RULES,
  GENRE_PRESET_LABELS,
  PROSE_TONE_LABELS,
  getDefaultRulesForGenre,
  parseBulkChaptersInput,
  generateChapterMemorySummary,
  generateBilingualChapterSummary,
  buildDelTAContextPacket,
  extractCsiCulturalNotes,
  evaluateDitingQuality,
  SlidingWindowTaskQueue,
  previewAndApplyCanonRipple,
  computeChapterPipelineProgress,
  COLAB_L4_MODEL_CATALOG,
  AGY_CLI_MODEL_CATALOG,
  DEFAULT_LLM_PROVIDER_CONFIG,
  generateColabL4LaunchScript,
  normalizeColabEndpointUrl,
  sanitizeRawChapterText,
  parseEpubArchiveToChaptersAsync,
  type GlossaryCategory,
  type GrammaticalGender,
  type ScoutedTerm,
  type GenrePreset,
  type ProseTone,
  type LintRuleId,
  type CsiCulturalNote,
  type DitingQualityReport,
  type SlidingWindowQueueTelemetry,
  type LlmProviderConfig,
} from '@/lib/qa-linter';
import {
  INITIAL_NOVELS,
  type NovelProject,
  type ChapterRecord,
  type ChapterVersionSnapshot,
} from '@/lib/seed-data';
import {
  loadNovelsFromStorage,
  saveNovelsToStorage,
  clearNovelsStorage,
} from '@/lib/storage-idb';
import ParallelEditorView from './ParallelEditorView';
import GlossaryVaultView from './GlossaryVaultView';
import RulateExportView from './RulateExportView';
import TranslationAnalyticsChart from './TranslationAnalyticsChart';
import QuickStartWizard from './QuickStartWizard';
import { useToast } from './ToastProvider';
import { classifyScenePacingMode } from '@/lib/qa-linter';

type StudioTab = 'pipeline' | 'editor' | 'glossary' | 'export';
type PipelineMode = 'full_5_phase' | 'scout_only' | 'verify_and_repair';
type ChapterFilter = 'all' | 'verified' | 'needs_qa' | 'untranslated';

interface PipelineLogEntry {
  id: string;
  timestamp: string;
  phase: string;
  message: string;
  level: 'info' | 'success' | 'warn';
}

const STORAGE_KEY = 'xianxia_pipeline_studio_v3';

export default function PipelineStudioApp() {
  const toast = useToast();
  const [novels, setNovels] = useState<NovelProject[]>(INITIAL_NOVELS);
  const [activeNovelId, setActiveNovelId] = useState<string>(INITIAL_NOVELS[0].id);
  const [activeTab, setActiveTab] = useState<StudioTab>('pipeline');
  const [selectedChapterId, setSelectedChapterId] = useState<string>(
    INITIAL_NOVELS[0].chapters[3]?.id || INITIAL_NOVELS[0].chapters[0].id
  );

  // Pipeline Orchestrator Controls
  const [startChapter, setStartChapter] = useState<number>(4);
  const [endChapter, setEndChapter] = useState<number>(6);
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('full_5_phase');
  const [autoCanonEnabled, setAutoCanonEnabled] = useState<boolean>(true);
  const [twoPassCriticEnabled, setTwoPassCriticEnabled] = useState<boolean>(true);
  const [parallelBatchEnabled, setParallelBatchEnabled] = useState<boolean>(true);
  const [isRunningPipeline, setIsRunningPipeline] = useState<boolean>(false);
  const [activePhaseStep, setActivePhaseStep] = useState<number>(0);
  const [runningChapterId, setRunningChapterId] = useState<string | null>(null);
  const [showLogDrawer, setShowLogDrawer] = useState<boolean>(false);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [autopilotBanner, setAutopilotBanner] = useState<string | null>(null);
  const [logs, setLogs] = useState<PipelineLogEntry[]>([
    {
      id: 'init-1',
      timestamp: '03:20:00',
      phase: 'СИСТЕМА',
      message:
        'Автономная фабрика перевода 3.0 готова: Lookahead-прескаут, точечный ремонт абзацев, авто-синонимайзер, защита от латиницы и Живой Паспорт Героя активны.',
      level: 'info',
    },
  ]);

  // Inventory table filters & multi-select
  const [chapterFilter, setChapterFilter] = useState<ChapterFilter>('all');
  const [chapterSearch, setChapterSearch] = useState<string>('');
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);

  // Bulk Import / Add Chapter Modal
  const [showAddChapterModal, setShowAddChapterModal] = useState(false);
  const [importMode, setImportMode] = useState<'single' | 'bulk'>('bulk');
  const [newChNum, setNewChNum] = useState<number>(8);
  const [newChTitleEng, setNewChTitleEng] = useState<string>(
    'Chapter 8: Refining the Foundation Establishment Pill'
  );
  const [newChEngText, setNewChEngText] = useState<string>(
    'Inside the Stone Demon Sect, Lin Xuan used 45 Spirit Stones and the Black Iron Cauldron weighing 50 jin to refine a Tier 2 Low Grade pill with a 90% success rate.'
  );
  const [bulkRawText, setBulkRawText] = useState<string>(
    `Chapter 8: Refining the Foundation Establishment Pill\nInside the Stone Demon Sect, Lin Xuan used 45 Spirit Stones and the Black Iron Cauldron weighing 50 jin to refine a Tier 2 Low Grade pill with a 90% success rate.\n\nChapter 9: Entering the Inner Sect\nElder Zhao and Su Qingxue welcomed Lin Xuan into the Inner Sect after he reached the 7th layer of Qi Refining with 500 Origin Points.`
  );
  const [uploadedFileCount, setUploadedFileCount] = useState<number>(0);
  const [sanitizeOnImport, setSanitizeOnImport] = useState<boolean>(true);
  const [sanitizedRemovedCount, setSanitizedRemovedCount] = useState<number>(0);

  // Glossary Stop-Gate Modal before Batch Translation (Q3: A & Q7: C)
  const [showStopGateModal, setShowStopGateModal] = useState<boolean>(false);
  const [stopGateTerms, setStopGateTerms] = useState<ScoutedTerm[]>([]);

  // Add Novel Modal
  const [showAddNovelModal, setShowAddNovelModal] = useState(false);
  const [newNovelName, setNewNovelName] = useState('');
  const [newNovelRusTitle, setNewNovelRusTitle] = useState('');
  const [newNovelGenre, setNewNovelGenre] = useState<GenrePreset>('xianxia');

  // Google Colab L4 (24GB VRAM) & Multi-Model Provider Configuration
  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedLlm = localStorage.getItem('xianxia_colab_llm_config_v1');
        if (savedLlm) {
          const parsed = JSON.parse(savedLlm) as Partial<LlmProviderConfig>;
          return { ...DEFAULT_LLM_PROVIDER_CONFIG, ...parsed };
        }
      } catch {
        // ignore storage errors
      }
    }
    return DEFAULT_LLM_PROVIDER_CONFIG;
  });
  const [showColabModal, setShowColabModal] = useState<boolean>(false);
  const [copiedColabScript, setCopiedColabScript] = useState<boolean>(false);
  const [colabPingState, setColabPingState] = useState<{
    loading: boolean;
    ok?: boolean;
    latencyMs?: number;
    runtime?: string;
    models?: string[];
    error?: string;
  } | null>(null);

  const abortRef = useRef<boolean>(false);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const driveBundleInputRef = useRef<HTMLInputElement | null>(null);
  const schedulerRef = useRef<SlidingWindowTaskQueue>(
    new SlidingWindowTaskQueue({
      concurrency: 3,
      maxRequestsPerWindow: 15,
      windowDurationMs: 60000,
    })
  );
  const [queueTelemetry, setQueueTelemetry] =
    useState<SlidingWindowQueueTelemetry | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('xianxia_colab_llm_config_v1', JSON.stringify(llmConfig));
    } catch {
      // ignore storage errors
    }
  }, [llmConfig]);

  const handlePingColabServer = async () => {
    const cleanUrl = normalizeColabEndpointUrl(llmConfig.colabEndpointUrl || '');
    if (!cleanUrl) {
      setColabPingState({
        loading: false,
        ok: false,
        error: 'Вставьте ссылку на туннель из вывода ячейки Google Colab (например, https://xxxx.trycloudflare.com).',
      });
      return;
    }
    setColabPingState({ loading: true });
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ping_colab',
          engText: '',
          glossary: activeNovel.glossary,
          llmConfig: {
            ...llmConfig,
            colabEndpointUrl: cleanUrl,
          },
        }),
      });
      const data = await res.json();
      setColabPingState({
        loading: false,
        ok: Boolean(data.ok),
        latencyMs: data.latencyMs,
        runtime: data.runtime,
        models: data.models,
        error: data.error,
      });
      if (data.ok) {
        appendLog(
          'COLAB L4',
          `Связь с сервером ${cleanUrl} установлена (${data.latencyMs} мс · модели в VRAM: ${(data.models || []).join(', ') || llmConfig.modelId}).`,
          'success'
        );
      }
    } catch {
      setColabPingState({
        loading: false,
        ok: false,
        error: 'Ошибка запроса к /api/pipeline при проверке туннеля Colab.',
      });
    }
  };

  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadNovelsFromStorage(INITIAL_NOVELS).then(({ novels: saved }) => {
      if (mounted) {
        if (Array.isArray(saved) && saved.length > 0) {
          setNovels(saved);
        }
        setIsHydrated(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isHydrated) {
      saveNovelsToStorage(novels);
    }
  }, [novels, isHydrated]);

  const activeNovel = novels.find((n) => n.id === activeNovelId) || novels[0];

  const activeChapter =
    activeNovel.chapters.find((c) => c.id === selectedChapterId) ||
    activeNovel.chapters[0];

  const appendLog = (
    phase: string,
    message: string,
    level: 'info' | 'success' | 'warn' = 'info'
  ) => {
    const now = new Date().toTimeString().slice(0, 8);
    setLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        phase,
        message,
        level,
      },
    ]);
  };

  const chaptersWithQa = useMemo(() => {
    return activeNovel.chapters.map((ch) => {
      const report = ch.rusText.trim()
        ? runQaLinter(ch.engText, ch.rusText, activeNovel.glossary, {
            enabledRuleIds: activeNovel.enabledRuleIds,
            glossaryMeta: activeNovel.glossaryMeta,
          })
        : null;
      return {
        chapter: ch,
        report,
      };
    });
  }, [activeNovel]);

  const filteredChapters = useMemo(() => {
    return chaptersWithQa.filter(({ chapter, report }) => {
      if (chapterFilter === 'verified' && !chapter.verified) return false;
      if (
        chapterFilter === 'needs_qa' &&
        (!chapter.translated || (report && report.passed))
      )
        return false;
      if (chapterFilter === 'untranslated' && chapter.translated) return false;

      if (chapterSearch.trim()) {
        const q = chapterSearch.toLowerCase();
        const matchEng = chapter.titleEng.toLowerCase().includes(q);
        const matchRus = chapter.titleRus.toLowerCase().includes(q);
        const matchNum = String(chapter.subPart || chapter.number).includes(q);
        return matchEng || matchRus || matchNum;
      }
      return true;
    });
  }, [chaptersWithQa, chapterFilter, chapterSearch]);

  const selectedChapterObjects = useMemo(() => {
    const idSet = new Set(selectedChapterIds);
    return activeNovel.chapters
      .filter((ch) => idSet.has(ch.id))
      .sort((a, b) => a.number - b.number);
  }, [activeNovel.chapters, selectedChapterIds]);

  const allFilteredSelected = useMemo(() => {
    if (filteredChapters.length === 0) return false;
    const idSet = new Set(selectedChapterIds);
    return filteredChapters.every(({ chapter }) => idSet.has(chapter.id));
  }, [filteredChapters, selectedChapterIds]);

  const handleToggleSelectChapter = (chapterId: string) => {
    setSelectedChapterIds((prev) =>
      prev.includes(chapterId)
        ? prev.filter((id) => id !== chapterId)
        : [...prev, chapterId]
    );
  };

  const handleToggleSelectAllFiltered = () => {
    const filteredIds = filteredChapters.map(({ chapter }) => chapter.id);
    if (allFilteredSelected) {
      const removeSet = new Set(filteredIds);
      setSelectedChapterIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setSelectedChapterIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleRunBulkSelectedPipeline = (mode: PipelineMode) => {
    if (selectedChapterObjects.length === 0 || isRunningPipeline) return;
    executePipelineOnChapters(selectedChapterObjects, mode);
  };

  const kpiStats = useMemo(() => {
    const total = activeNovel.chapters.length;
    const translatedCount = activeNovel.chapters.filter((c) => c.translated).length;
    const verifiedCount = activeNovel.chapters.filter((c) => c.verified).length;
    const canonCount = Object.values(activeNovel.glossary).reduce(
      (acc, bucket) => acc + Object.keys(bucket || {}).length,
      0
    );
    const scoutBufferCount = activeNovel.scoutedTerms.filter(
      (t) => !t.approved_for_glossary
    ).length;

    return {
      total,
      translatedCount,
      verifiedCount,
      canonCount,
      scoutBufferCount,
    };
  }, [activeNovel]);

  const updateActiveNovel = (updater: (novel: NovelProject) => NovelProject) => {
    setNovels((prev) =>
      prev.map((n) => (n.id === activeNovel.id ? updater(n) : n))
    );
  };

  const handleGenrePresetChange = (nextGenre: GenrePreset) => {
    const defaultRules = getDefaultRulesForGenre(nextGenre);
    updateActiveNovel((novel) => ({
      ...novel,
      genrePreset: nextGenre,
      enabledRuleIds: defaultRules,
    }));
    appendLog(
      'ЖАНР',
      `Применён профиль «${GENRE_PRESET_LABELS[nextGenre].title}» (${defaultRules.length} правил QA).`,
      'info'
    );
  };

  const handleProseToneChange = (nextTone: ProseTone) => {
    updateActiveNovel((novel) => ({
      ...novel,
      proseTone: nextTone,
    }));
    appendLog(
      'СТИЛЬ',
      `Тональность литературного критика: «${PROSE_TONE_LABELS[nextTone].title}».`,
      'info'
    );
  };

  const handleToggleRuleId = (ruleId: LintRuleId) => {
    updateActiveNovel((novel) => {
      const exists = novel.enabledRuleIds.includes(ruleId);
      const nextRules = exists
        ? novel.enabledRuleIds.filter((id) => id !== ruleId)
        : [...novel.enabledRuleIds, ruleId];
      return {
        ...novel,
        enabledRuleIds: nextRules,
      };
    });
  };

  const executePipelineOnChapters = async (
    targetChapters: ChapterRecord[],
    mode: PipelineMode
  ) => {
    if (targetChapters.length === 0 || isRunningPipeline) return;
    setIsRunningPipeline(true);
    abortRef.current = false;

    const transport = new FetchPipelineTransportAdapter({
      baseUrl: '/api/pipeline',
      queue: schedulerRef.current,
    });

    try {
      const res = await runPipelineBatchOnNovel({
        novel: activeNovel,
        targetChapterIds: targetChapters.map((c) => c.id),
        mode,
        autoCanonEnabled,
        twoPassCriticEnabled,
        llmConfig,
        transport,
        shouldAbort: () => abortRef.current,
        onProgress: (event) => {
          setQueueTelemetry(schedulerRef.current.getTelemetry());
          if (event.type === 'start') {
            appendLog(
              'СТАРТ',
              `Пакетная обработка (${event.totalChapters} гл.) · Жанр: ${GENRE_PRESET_LABELS[event.genrePreset].title} · Тон: ${PROSE_TONE_LABELS[event.proseTone].title}.`,
              'info'
            );
          } else if (event.type === 'chapter_start') {
            setRunningChapterId(event.chapterId);
          } else if (event.type === 'phase_step') {
            setActivePhaseStep(event.step);
          } else if (event.type === 'log') {
            appendLog(
              event.tag,
              event.message,
              event.level === 'error' ? 'warn' : event.level
            );
          } else if (event.type === 'chapter_complete') {
            updateActiveNovel((prev) => ({
              ...prev,
              chapters: prev.chapters.map((c) =>
                c.id === event.chapterId ? event.chapter : c
              ),
            }));
          } else if (event.type === 'batch_complete') {
            updateActiveNovel(() => event.updatedNovel);
          } else if (event.type === 'aborted') {
            appendLog('СТОП', 'Выполнение остановлено пользователем.', 'warn');
          }
        },
      });

      if (res?.updatedNovel) {
        updateActiveNovel(() => res.updatedNovel);
      }
    } catch (err) {
      appendLog(
        'ОШИБКА',
        `Сбой пакета конвейера: ${err instanceof Error ? err.message : String(err)}`,
        'warn'
      );
    } finally {
      setRunningChapterId(null);
      setActivePhaseStep(0);
      setIsRunningPipeline(false);
    }
  };

  const handleStartRangePipeline = () => {
    const targets = activeNovel.chapters.filter(
      (c) => c.number >= startChapter && c.number <= endChapter
    );
    executePipelineOnChapters(targets, pipelineMode);
  };

  const handleQuickTranslateChapter = (targetChapter: ChapterRecord) => {
    executePipelineOnChapters([targetChapter], 'full_5_phase');
    toast.info(
      `Запуск 4-проходного перевода Главы ${targetChapter.subPart || targetChapter.number}`,
      'Старт перевода'
    );
  };

  const handleTranslateNextBatch = (count = 3) => {
    const untranslated = activeNovel.chapters.filter((c) => !c.translated).slice(0, count);
    if (untranslated.length === 0) {
      toast.info('Все главы в новелле уже переведены!', 'Очередь пуста');
      return;
    }
    executePipelineOnChapters(untranslated, 'full_5_phase');
    toast.info(`Запущен пакетный перевод ${untranslated.length} глав...`, 'Пакетный запуск');
  };

  /**
   * "Стоп-кран глоссария перед переводом" (Q3: A & Q7: C):
   * Scans the target chapter range, discovers new terms + genders, and pauses for a 1-minute user review
   * before launching autonomous 2-pass translation.
   */
  const handleOpenGlossaryStopGate = () => {
    const mergedTerms = prepareGlossaryStopGateTerms(activeNovel, startChapter, endChapter);
    if (mergedTerms.length === 0 && !activeNovel.chapters.some((c) => c.number >= startChapter && c.number <= endChapter)) return;

    setStopGateTerms(mergedTerms);
    setShowStopGateModal(true);
    appendLog(
      'СТОП-КРАН ГЛОССАРИЯ',
      `Пре-скаут глав ${startChapter}–${endChapter} завершён: найдено ${mergedTerms.length} терминов для 1-минутной сверки перед переводом пакета.`,
      'info'
    );
  };

  const handleApproveStopGateAndTranslate = () => {
    updateActiveNovel((novel) => {
      const nextGlossary = { ...novel.glossary };
      const nextMeta = { ...novel.glossaryMeta };
      for (const term of stopGateTerms) {
        if (!term.eng.trim() || !term.rus_suggested.trim()) continue;
        nextGlossary[term.category] = {
          ...(nextGlossary[term.category] || {}),
          [term.eng.trim()]: term.rus_suggested.trim(),
        };
        nextMeta[term.eng.trim()] = {
          ...nextMeta[term.eng.trim()],
          gender: term.gender || 'M',
        };
      }
      return {
        ...novel,
        glossary: nextGlossary,
        glossaryMeta: nextMeta,
      };
    });

    setShowStopGateModal(false);
    appendLog(
      'КАНОН УТВЕРЖДЁН',
      `Утверждено ${stopGateTerms.length} терминов в Стоп-кране глоссария. Запуск 2-проходного перевода глав ${startChapter}–${endChapter}...`,
      'success'
    );

    setTimeout(() => {
      const targets = activeNovel.chapters.filter(
        (c) => c.number >= startChapter && c.number <= endChapter
      );
      executePipelineOnChapters(targets, 'full_5_phase');
    }, 50);
  };

  /**
   * Exports `kanon_project_bundle.json` for the autonomous overnight Google Drive + Colab L4 worker (`Q9: A`).
   */
  const handleExportColabDriveBundle = () => {
    const jsonStr = serializeProjectBundle({
      novel: activeNovel,
      llmConfig,
      format: 'v4.1',
    });
    const blob = new Blob([jsonStr], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kanon_project_bundle.json';
    a.click();
    URL.revokeObjectURL(url);
    appendLog(
      'GOOGLE DRIVE БАНДЛ',
      'Выгружен файл kanon_project_bundle.json для автономного ночного воркера в Google Colab L4 (Ячейка 2).',
      'success'
    );
  };

  const handleImportColabDriveBundle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const res = deserializeProjectBundle(raw);
      const importedProject = res.activeProject || res.novels[0];
      if (importedProject) {
        setNovels((prev) => {
          const exists = prev.some((n) => n.id === importedProject.id);
          return exists
            ? prev.map((n) => (n.id === importedProject.id ? importedProject : n))
            : [...prev, importedProject];
        });
        setActiveNovelId(importedProject.id);
        appendLog(
          'GOOGLE DRIVE БАНДЛ',
          `Импортирован ночной перевод из Google Drive («${importedProject.name}» · глав: ${importedProject.chapters.length}).`,
          'success'
        );
      }
    } catch {
      appendLog('ОШИБКА', 'Не удалось прочитать файл kanon_project_bundle.json.', 'warn');
    }
  };

  const handleRunFullAutopilotRelease = async () => {
    if (isRunningPipeline) return;
    setAutopilotBanner(null);

    // Step 1: Detect and auto-merge any split half-chapters (e.g., 7.1 + 7.2 -> Chapter 7)
    const { updatedNovel: mergedNovel, mergedCount: mergedSplitCount } = autoMergeSplitChaptersInNovel(activeNovel);
    let workingChapters = mergedNovel.chapters;
    if (mergedSplitCount > 0) {
      updateActiveNovel(() => mergedNovel);
      appendLog(
        'АВТО-СКЛЕЙКА',
        `Автопилот автоматически объединил дробные главы (${mergedSplitCount} склеек: 7.1 + 7.2 → Глава 7).`,
        'success'
      );
    }

    // Step 2: Select all chapters that need translation or QA repair
    const targets = workingChapters.filter((ch) => {
      if (!ch.translated || !ch.rusText.trim()) return true;
      const rep = runQaLinter(ch.engText, ch.rusText, activeNovel.glossary, {
        enabledRuleIds: activeNovel.enabledRuleIds,
        glossaryMeta: activeNovel.glossaryMeta,
      });
      return !rep.passed;
    });

    if (targets.length > 0) {
      await executePipelineOnChapters(targets, 'full_5_phase');
    }

    // Step 3: Build Rulate LF Export Package from all translated chapters
    setNovels((latestNovels) => {
      const currentNovel =
        latestNovels.find((n) => n.id === activeNovelId) || latestNovels[0];
      const readyForExport = currentNovel.chapters
        .filter((c) => c.rusText.trim().length > 0)
        .map((c) => ({
          number: c.number,
          titleRus: c.titleRus || `Глава ${c.number}`,
          contentRus: c.rusText,
        }));

      const packages = buildRulateExportPackages(currentNovel.name, readyForExport, 20);
      if (packages.length > 0) {
        const pkg = packages[0];
        const blob = new Blob([pkg.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = pkg.filename;
        a.click();
        URL.revokeObjectURL(url);

        setAutopilotBanner(
          `Полный Автопилот завершён: склеено дробных глав (${mergedSplitCount}), доведено до 100% QA (${readyForExport.length} гл.), паспорт героя обновлён, файл «${pkg.filename}» (строгий LF) выгружен.`
        );
      }
      return latestNovels;
    });
  };

  const handleSaveChapterFromEditor = (updated: ChapterRecord) => {
    updateActiveNovel((novel) => ({
      ...novel,
      chapters: novel.chapters.map((c) => (c.id === updated.id ? updated : c)),
    }));
  };

  const handleApproveScoutedTerm = (
    termId: string,
    customRus?: string,
    category?: GlossaryCategory,
    gender?: GrammaticalGender
  ) => {
    const target = activeNovel.scoutedTerms.find((t) => t.id === termId);
    if (!target) return;
    const finalCat = category || target.category;
    const finalRus = customRus?.trim() || target.rus_suggested;
    const finalGender = gender || target.gender || 'M';

    updateActiveNovel((novel) => ({
      ...novel,
      glossary: {
        ...novel.glossary,
        [finalCat]: {
          ...(novel.glossary[finalCat] || {}),
          [target.eng]: finalRus,
        },
      },
      glossaryMeta: {
        ...novel.glossaryMeta,
        [target.eng]: {
          ...novel.glossaryMeta[target.eng],
          gender: finalGender,
        },
      },
      scoutedTerms: novel.scoutedTerms.map((t) =>
        t.id === termId
          ? {
              ...t,
              rus_suggested: finalRus,
              gender: finalGender,
              approved_for_glossary: true,
            }
          : t
      ),
    }));
  };

  const handleAutoApproveHighConfidence = (threshold: number) => {
    let count = 0;
    updateActiveNovel((novel) => {
      const nextGlossary = { ...novel.glossary };
      const nextMeta = { ...novel.glossaryMeta };
      const nextScouted = novel.scoutedTerms.map((t) => {
        if (!t.approved_for_glossary && t.confidence >= threshold) {
          count++;
          nextGlossary[t.category] = {
            ...(nextGlossary[t.category] || {}),
            [t.eng]: t.rus_suggested,
          };
          nextMeta[t.eng] = {
            ...nextMeta[t.eng],
            gender: t.gender || 'M',
          };
          return { ...t, approved_for_glossary: true };
        }
        return t;
      });
      return {
        ...novel,
        glossary: nextGlossary,
        glossaryMeta: nextMeta,
        scoutedTerms: nextScouted,
      };
    });
    if (count > 0) {
      appendLog(
        'АВТО-КАНОН',
        `Автоматически зачислено в канон ${count} высокоточных терминов (≥${Math.round(threshold * 100)}%).`,
        'success'
      );
    }
  };

  const handleRejectScoutedTerm = (termId: string) => {
    updateActiveNovel((novel) => ({
      ...novel,
      scoutedTerms: novel.scoutedTerms.filter((t) => t.id !== termId),
    }));
  };

  const handleAddCanonTerm = (
    category: GlossaryCategory,
    eng: string,
    rus: string,
    gender?: GrammaticalGender,
    declensionNote?: string,
    voiceNote?: string
  ) => {
    updateActiveNovel((novel) => ({
      ...novel,
      glossary: {
        ...novel.glossary,
        [category]: {
          ...(novel.glossary[category] || {}),
          [eng]: rus,
        },
      },
      glossaryMeta: {
        ...novel.glossaryMeta,
        [eng]: {
          gender: gender || 'M',
          declensionNote,
          voiceNote,
        },
      },
    }));
  };

  const handleUpdateTermMeta = (
    eng: string,
    gender?: GrammaticalGender,
    declensionNote?: string,
    voiceNote?: string
  ) => {
    updateActiveNovel((novel) => ({
      ...novel,
      glossaryMeta: {
        ...novel.glossaryMeta,
        [eng]: {
          gender: gender || 'M',
          declensionNote,
          voiceNote,
        },
      },
    }));
  };

  const handleApplyCanonRipple = (
    oldRusTerm: string,
    newRusTerm: string,
    targetEngKey?: string
  ): number => {
    const result = previewAndApplyCanonRipple(
      activeNovel.chapters,
      oldRusTerm,
      newRusTerm
    );
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');

    updateActiveNovel((novel) => {
      const nextGlossary = { ...novel.glossary };
      (Object.keys(nextGlossary) as GlossaryCategory[]).forEach((cat) => {
        const bucket = { ...(nextGlossary[cat] || {}) };
        Object.entries(bucket).forEach(([eng, rus]) => {
          if (targetEngKey ? eng === targetEngKey : rus === oldRusTerm) {
            bucket[eng] = newRusTerm;
          }
        });
        nextGlossary[cat] = bucket;
      });

      const changeMap = new Map(result.changes.map((c) => [c.chapterId, c]));
      const nextChapters = novel.chapters.map((ch) => {
        const change = changeMap.get(ch.id);
        if (!change) return ch;
        const lint = runQaLinter(ch.engText, change.updatedRusText, nextGlossary, {
          enabledRuleIds: novel.enabledRuleIds,
          glossaryMeta: novel.glossaryMeta,
        });
        return {
          ...ch,
          titleRus: change.updatedTitleRus,
          rusText: change.updatedRusText,
          verified: lint.passed,
          wordCountRus: change.updatedRusText.split(/\s+/).filter(Boolean).length,
          lastUpdated: nowStr,
        };
      });

      return {
        ...novel,
        glossary: nextGlossary,
        chapters: nextChapters,
      };
    });

    appendLog(
      'КАСКАД-КАНОН',
      `Глобальная замена «${oldRusTerm}» → «${newRusTerm}»: обновлено ${result.totalOccurrences} вхождений в ${result.changes.length} главах.`,
      'success'
    );
    return result.totalOccurrences;
  };

  const handleExportProjectBackup = () => {
    const jsonStr = serializeProjectBundle({
      novels,
      format: 'v2.5',
    });
    const blob = new Blob([jsonStr], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kanon_xianxia_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog('БЭКАП', 'Полный слепок проекта экспортирован в JSON.', 'success');
  };

  const handleImportProjectBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = deserializeProjectBundle(text);
      const importedNovels = res.novels;
      if (importedNovels.length > 0) {
        setNovels(importedNovels);
        setActiveNovelId(importedNovels[0].id);
        setSelectedChapterId(importedNovels[0].chapters[0]?.id || '');
        appendLog(
          'БЭКАП',
          `Восстановлено произведений из JSON-слепка: ${importedNovels.length}.`,
          'success'
        );
      }
    } catch {
      appendLog('ОШИБКА', 'Не удалось прочитать JSON-файл резервной копии.', 'warn');
    }
  };

  const handleRemoveCanonTerm = (category: GlossaryCategory, eng: string) => {
    updateActiveNovel((novel) => {
      const nextBucket = { ...(novel.glossary[category] || {}) };
      delete nextBucket[eng];
      return {
        ...novel,
        glossary: {
          ...novel.glossary,
          [category]: nextBucket,
        },
      };
    });
  };

  const handleMergeSplitChapters = (
    partAId: string,
    partBId: string,
    targetNumber: number
  ) => {
    const partA = activeNovel.chapters.find((c) => c.id === partAId);
    const partB = activeNovel.chapters.find((c) => c.id === partBId);
    if (!partA || !partB) return;

    const merged = mergeSplitChapters(
      { title: partA.titleEng, engText: partA.engText, rusText: partA.rusText },
      { title: partB.titleEng, engText: partB.engText, rusText: partB.rusText },
      targetNumber
    );

    const lint = merged.rusText
      ? runQaLinter(merged.engText, merged.rusText, activeNovel.glossary, {
          enabledRuleIds: activeNovel.enabledRuleIds,
          glossaryMeta: activeNovel.glossaryMeta,
        })
      : null;

    const newRecord: ChapterRecord = {
      id: `ch-merged-${targetNumber}-${Date.now()}`,
      number: targetNumber,
      titleEng: merged.titleEng,
      titleRus: `Глава ${targetNumber}. Тайное царство Каменных Демонов`,
      engText: merged.engText,
      rusText: merged.rusText,
      summary: [partA.summary, partB.summary].filter(Boolean).join(' '),
      scouted: partA.scouted && partB.scouted,
      translated: Boolean(merged.rusText),
      edited: Boolean(merged.rusText),
      verified: Boolean(lint?.passed && merged.rusText),
      wordCountEng: merged.engText.split(/\s+/).length,
      wordCountRus: merged.rusText ? merged.rusText.split(/\s+/).length : 0,
      lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };

    updateActiveNovel((novel) => ({
      ...novel,
      chapters: [
        ...novel.chapters.filter((c) => c.id !== partAId && c.id !== partBId),
        newRecord,
      ].sort((a, b) => a.number - b.number),
    }));

    setSelectedChapterId(newRecord.id);
  };

  const handleFileUploadBatch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const items: Array<{ filename: string; content: string }> = [];
    let removedJunkTotal = 0;
    const maxExistingNum = activeNovel.chapters.reduce(
      (max, c) => Math.max(max, c.number),
      0
    );
    let nextChapNum = maxExistingNum + 1;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.name.toLowerCase().endsWith('.epub')) {
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          const epubRes = await parseEpubArchiveToChaptersAsync(buf);
          removedJunkTotal += epubRes.totalRemovedJunkLines;
          for (const ch of epubRes.chapters) {
            items.push({
              filename: ch.href,
              content: `Chapter ${nextChapNum++}: ${ch.titleEng}\n${ch.engText}`,
            });
          }
          appendLog(
            'ИМПОРТ EPUB',
            `Книга «${epubRes.bookTitle}» (${f.name}): распаковано ${epubRes.chapters.length} глав, очищено ${epubRes.totalRemovedJunkLines} строк мусора/водяных знаков.`,
            'success'
          );
        } catch {
          appendLog('ОШИБКА EPUB', `Не удалось распаковать архив ${f.name}.`, 'warn');
        }
      } else {
        const rawText = await f.text();
        const processed = sanitizeOnImport
          ? sanitizeRawChapterText(rawText)
          : { cleanedText: rawText, removedLinesCount: 0 };
        removedJunkTotal += processed.removedLinesCount;
        items.push({ filename: f.name, content: processed.cleanedText });
      }
    }

    const combinedPreview = items
      .map((it) =>
        /^Chapter\s+\d+/i.test(it.content.trim())
          ? it.content.trim()
          : `Chapter ${it.filename.replace(/\D+/g, '') || nextChapNum++}: ${it.filename}\n${it.content.trim()}`
      )
      .join('\n\n');

    setBulkRawText(combinedPreview);
    setUploadedFileCount(files.length);
    setSanitizedRemovedCount(removedJunkTotal);
  };

  const handleCreateOrBulkImportChapters = (e: React.FormEvent) => {
    e.preventDefault();
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');

    if (importMode === 'single') {
      if (!newChTitleEng.trim() || !newChEngText.trim()) return;
      const sanitizedSingle = sanitizeOnImport
        ? sanitizeRawChapterText(newChEngText)
        : { cleanedText: newChEngText.trim(), removedLinesCount: 0 };
      const id = `ch-${newChNum}-${Date.now()}`;
      const words = sanitizedSingle.cleanedText.split(/\s+/).filter(Boolean).length;
      const record: ChapterRecord = {
        id,
        number: newChNum,
        titleEng: newChTitleEng.trim(),
        titleRus: `Глава ${newChNum}`,
        engText: sanitizedSingle.cleanedText,
        rusText: '',
        scouted: false,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: words,
        wordCountRus: 0,
        lastUpdated: nowStr,
      };

      updateActiveNovel((novel) => ({
        ...novel,
        chapters: [...novel.chapters, record].sort((a, b) => a.number - b.number),
      }));
      setSelectedChapterId(id);
      setShowAddChapterModal(false);
      return;
    }

    // Bulk import mode (with optional sanitizer pass on pasted text)
    const maxExistingNum = activeNovel.chapters.reduce(
      (max, c) => Math.max(max, c.number),
      0
    );
    const sanitizedBulk = sanitizeOnImport
      ? sanitizeRawChapterText(bulkRawText)
      : { cleanedText: bulkRawText, removedLinesCount: 0 };
    const parsedList = parseBulkChaptersInput(
      [{ content: sanitizedBulk.cleanedText }],
      maxExistingNum + 1
    );
    if (parsedList.length === 0) return;

    const createdRecords: ChapterRecord[] = parsedList.map((item, idx) => ({
      id: `ch-bulk-${item.number}-${Date.now()}-${idx}`,
      number: item.number,
      titleEng: item.titleEng,
      titleRus: `Глава ${item.number}`,
      engText: item.engText,
      rusText: '',
      scouted: false,
      translated: false,
      edited: false,
      verified: false,
      wordCountEng: item.engText.split(/\s+/).length,
      wordCountRus: 0,
      lastUpdated: nowStr,
    }));

    updateActiveNovel((novel) => ({
      ...novel,
      chapters: [...novel.chapters, ...createdRecords].sort(
        (a, b) => a.number - b.number
      ),
    }));

    setSelectedChapterId(createdRecords[0].id);
    setEndChapter(createdRecords[createdRecords.length - 1].number);
    const totalCleanCount = sanitizedRemovedCount + sanitizedBulk.removedLinesCount;
    appendLog(
      'ИМПОРТ',
      `Массово загружено глав: ${createdRecords.length} (Главы ${createdRecords[0].number}–${createdRecords[createdRecords.length - 1].number})${totalCleanCount > 0 ? ` · Автоочистка удалила ${totalCleanCount} строк мусора/TL Note` : ''}.`,
      'success'
    );
    setSanitizedRemovedCount(0);
    setShowAddChapterModal(false);
  };

  const handleCreateNewNovel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNovelName.trim()) return;
    const id = newNovelName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const created: NovelProject = {
      id: `${id}-${Date.now()}`,
      name: newNovelName.trim(),
      rusTitle: newNovelRusTitle.trim() || newNovelName.trim(),
      author: 'Web Novel Author',
      sourceLang: 'ENG',
      genrePreset: newNovelGenre,
      proseTone: 'classic',
      autoApproveThreshold: 0.92,
      enabledRuleIds: getDefaultRulesForGenre(newNovelGenre),
      styleGuideMd: `# Стилевой гид: ${newNovelName.trim()}\n- Профиль жанра: ${GENRE_PRESET_LABELS[newNovelGenre].title}.`,
      contextMd: `# Синопсис\nНовое произведение.`,
      glossary: {
        realms: {
          'Qi Refining': 'Очищение Ци',
        },
        characters: {},
        sects_and_places: {},
        system_and_terms: {},
        units: newNovelGenre === 'xianxia' ? { jin: 'цзинь', liang: 'лян' } : {},
      },
      glossaryMeta: {},
      scoutedTerms: [],
      chapters: [
        {
          id: `ch-1-${Date.now()}`,
          number: 1,
          titleEng: 'Chapter 1: Awakening',
          titleRus: 'Глава 1. Пробуждение',
          engText:
            'At the 3rd layer of Qi Refining, the disciple held 10 Spirit Stones.',
          rusText: '',
          scouted: false,
          translated: false,
          edited: false,
          verified: false,
          wordCountEng: 13,
          wordCountRus: 0,
          lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
        },
      ],
    };

    setNovels((prev) => [...prev, created]);
    setActiveNovelId(created.id);
    setSelectedChapterId(created.chapters[0].id);
    setNewNovelName('');
    setNewNovelRusTitle('');
    setShowAddNovelModal(false);
  };

  const handleResetDemoData = () => {
    clearNovelsStorage();
    setNovels(INITIAL_NOVELS);
    setActiveNovelId(INITIAL_NOVELS[0].id);
    setSelectedChapterId(INITIAL_NOVELS[0].chapters[3].id);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#090A0F] text-[#F1F5F9]">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-6 pt-3.5 pb-4 border-b border-white/[0.07] bg-[#090A0F]">
        {/* Zone 1: Brand Title */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('pipeline');
          }}
          className="font-display text-[clamp(1.05rem,1.4vw,1.25rem)] font-bold tracking-[-0.025em] text-[#F1F5F9] whitespace-nowrap shrink-0"
        >
          Канон Сянься
        </a>

        {/* Zone 2: 4 Clean Single-Line Nav Links */}
        <nav
          aria-label="Основная навигация"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-[#94A3B8]"
        >
          <button
            type="button"
            onClick={() => setActiveTab('pipeline')}
            className={`hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'pipeline'
                ? 'border-[#D99B26] text-[#F1F5F9]'
                : 'border-transparent'
            }`}
          >
            Главы и конвейер
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className={`hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'editor'
                ? 'border-[#D99B26] text-[#F1F5F9]'
                : 'border-transparent'
            }`}
          >
            Редактор
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('glossary')}
            className={`hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'glossary'
                ? 'border-[#D99B26] text-[#F1F5F9]'
                : 'border-transparent'
            }`}
          >
            Глоссарий
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'export'
                ? 'border-[#D99B26] text-[#F1F5F9]'
                : 'border-transparent'
            }`}
          >
            Экспорт Рулейт
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={isRunningPipeline}
            onClick={() => {
              setActiveTab('pipeline');
              handleStartRangePipeline();
            }}
            className="px-4 py-2 text-xs font-semibold text-[#090A0F] bg-[#D99B26] rounded-md hover:bg-[#E3A836] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {isRunningPipeline ? 'Перевод...' : 'Запустить конвейер'}
          </button>
        </div>
      </header>

      {/* Mobile Navigation */}
      <div className="flex md:hidden items-center gap-2 overflow-x-auto border-b border-white/[0.07] bg-[#11131C] px-4 py-2">
        {[
          { id: 'pipeline', label: 'Главы' },
          { id: 'editor', label: 'Редактор' },
          { id: 'glossary', label: 'Глоссарий' },
          { id: 'export', label: 'Экспорт' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id as StudioTab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeTab === item.id ? 'bg-[#D99B26] text-[#090A0F]' : 'text-[#94A3B8]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Spacious Main Workspace */}
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 sm:px-8 py-8 space-y-7">
        {/* Minimalist Project Header Strip: Single-Line Layout */}
        <div className="flex flex-col gap-3 pb-5 border-b border-white/[0.06] lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="novel-project-select"
                aria-label="Выбор произведения"
                value={activeNovel.id}
                onChange={(e) => {
                  const nextNovel = novels.find((n) => n.id === e.target.value);
                  if (nextNovel) {
                    setActiveNovelId(nextNovel.id);
                    setSelectedChapterId(nextNovel.chapters[0]?.id || '');
                  }
                }}
                className="max-w-full truncate rounded-md border border-white/[0.07] bg-[#11131C] px-3 py-1.5 font-display text-sm font-semibold text-[#F1F5F9] focus:border-[#D99B26] focus:outline-none cursor-pointer"
              >
                {novels.map((n) => (
                  <option key={n.id} value={n.id} className="bg-[#11131C] text-[#F1F5F9]">
                    {n.rusTitle}
                  </option>
                ))}
              </select>

              <select
                id="genre-preset-select"
                aria-label="Жанровый профиль перевода"
                value={activeNovel.genrePreset}
                onChange={(e) => handleGenrePresetChange(e.target.value as GenrePreset)}
                className="rounded-md border border-transparent bg-transparent px-2 py-1 text-xs font-medium text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9] focus:border-white/[0.12] focus:outline-none cursor-pointer"
              >
                {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
                  <option key={g} value={g} className="bg-[#11131C] text-[#F1F5F9]">
                    {GENRE_PRESET_LABELS[g].title}
                  </option>
                ))}
              </select>

              <span className="text-white/[0.12] hidden sm:inline" aria-hidden="true">·</span>

              <select
                id="prose-tone-select"
                aria-label="Тональность литературного критика"
                value={activeNovel.proseTone}
                onChange={(e) => handleProseToneChange(e.target.value as ProseTone)}
                className="rounded-md border border-transparent bg-transparent px-2 py-1 text-xs font-medium text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9] focus:border-white/[0.12] focus:outline-none cursor-pointer"
              >
                {(Object.keys(PROSE_TONE_LABELS) as ProseTone[]).map((tone) => (
                  <option key={tone} value={tone} className="bg-[#11131C] text-[#F1F5F9]">
                    Тон: {PROSE_TONE_LABELS[tone].title}
                  </option>
                ))}
              </select>
            </div>

            {/* Quiet Monochrome Metadata Summary */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#64748B] font-mono tabular-nums">
              <span>
                Переведено <strong className="font-medium text-[#94A3B8]">{kpiStats.translatedCount}/{kpiStats.total}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                QA <strong className="font-medium text-[#94A3B8]">{kpiStats.verifiedCount} гл.</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Канон <strong className="font-medium text-[#94A3B8]">{kpiStats.canonCount}</strong>
              </span>
              {kpiStats.scoutBufferCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Новых терминов <strong className="font-medium text-[#D99B26]">+{kpiStats.scoutBufferCount}</strong>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Single-Line Ghost Utility Bar */}
          <div className="flex flex-wrap lg:flex-nowrap items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowColabModal(true)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                (llmConfig.provider === 'colab_ollama' && llmConfig.colabEndpointUrl?.trim()) ||
                llmConfig.provider === 'antigravity_cli'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  : 'border-[#D99B26]/30 bg-[#D99B26]/10 text-[#F1F5F9] hover:bg-[#D99B26]/20'
              }`}
              title="Настроить провайдер ИИ: локальный Antigravity CLI (agy), выделенный сервер Google Colab L4 или облачный Gemini API"
            >
              <Cpu className="h-3.5 w-3.5 text-[#D99B26]" />
              {llmConfig.provider === 'antigravity_cli'
                ? `agy CLI · ${llmConfig.modelId || 'gemini-3.8-flash-high'} → ${llmConfig.criticModelId || 'gemini-4-argon-medium'}`
                : llmConfig.provider === 'colab_ollama'
                  ? `Colab L4 · ${llmConfig.modelId}`
                  : 'AI Studio API'}
            </button>
            <button
              type="button"
              onClick={() => {
                setImportMode('bulk');
                setShowAddChapterModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[#94A3B8] hover:bg-white/[0.05] hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5 text-[#D99B26]" />
              Массовая загрузка глав
            </button>
            <button
              type="button"
              onClick={() => setShowRulesModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[#94A3B8] hover:bg-white/[0.05] hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Правила QA ({activeNovel.enabledRuleIds.length}/{ALL_LINT_RULES.length})
            </button>
            <button
              type="button"
              onClick={() => setShowAddNovelModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[#94A3B8] hover:bg-white/[0.05] hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Новая книга
            </button>
            <button
              type="button"
              onClick={handleExportProjectBackup}
              title="Экспорт полного бэкапа проекта (IndexedDB -> JSON)"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-[#64748B] hover:bg-white/[0.05] hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Бэкап
            </button>
            <input
              ref={backupInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportProjectBackup}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => backupInputRef.current?.click()}
              title="Восстановить проект из JSON-бэкапа"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-[#64748B] hover:bg-white/[0.05] hover:text-[#F1F5F9] transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              Импорт
            </button>
            <button
              type="button"
              onClick={() => setShowLogDrawer((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                showLogDrawer
                  ? 'bg-white/[0.08] text-[#F1F5F9]'
                  : 'text-[#64748B] hover:bg-white/[0.05] hover:text-[#F1F5F9]'
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              Журнал ({logs.length})
            </button>
            <button
              type="button"
              onClick={handleResetDemoData}
              aria-label="Сбросить демо-данные"
              title="Сбросить демо-данные"
              className="inline-flex items-center gap-1 rounded-md p-1.5 text-xs text-[#64748B] hover:bg-white/[0.05] hover:text-[#F1F5F9] transition-colors shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Collapsible Live Log Drawer */}
        {showLogDrawer && (
          <div className="rounded-xl border border-white/[0.07] bg-[#11131C] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#94A3B8]">
                Журнал событий конвейера
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  className="text-xs text-[#64748B] hover:text-[#F1F5F9]"
                >
                  Очистить
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogDrawer(false)}
                  aria-label="Закрыть журнал"
                  className="text-[#64748B] hover:text-[#F1F5F9]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-36 overflow-y-auto rounded-md bg-[#090A0F] p-3 font-mono text-xs space-y-1.5">
              {logs.map((entry) => (
                <div key={entry.id}>
                  <span className="text-[#64748B] tabular-nums">[{entry.timestamp}]</span>{' '}
                  <span className="text-[#D99B26] font-medium">{entry.phase}:</span>{' '}
                  <span className="text-[#94A3B8]">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'pipeline' && (
          <div className="space-y-6">
            {/* QuickStartWizard Component */}
            <QuickStartWizard
              novels={novels}
              activeNovel={activeNovel}
              onSelectNovel={(id) => setActiveNovelId(id)}
              llmConfig={llmConfig}
              onOpenLlmSettings={() => setShowColabModal(true)}
              onQuickTranslateChapter={handleQuickTranslateChapter}
              isPipelineRunning={isRunningPipeline}
              onOpenImportModal={() => {
                setImportMode('bulk');
                setShowAddChapterModal(true);
              }}
            />

            {/* Serene Single-Line Batch Pipeline Bar */}
            <section className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#11131C]/80 px-4 pt-3 pb-3.5">
              <div className="flex flex-wrap lg:flex-nowrap items-center gap-3">
                <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums shrink-0">
                  <span className="font-sans text-[#94A3B8]">Главы</span>
                  <input
                    id="start-ch-input"
                    aria-label="Начальная глава"
                    type="number"
                    min={1}
                    value={startChapter}
                    onChange={(e) => setStartChapter(Number(e.target.value))}
                    className="w-12 rounded-md border border-white/[0.07] bg-[#090A0F] px-2 py-1 text-center tabular-nums text-[#F1F5F9] focus:border-[#D99B26] focus:outline-none"
                  />
                  <span className="text-[#64748B]">—</span>
                  <input
                    id="end-ch-input"
                    aria-label="Конечная глава"
                    type="number"
                    min={startChapter}
                    value={endChapter}
                    onChange={(e) => setEndChapter(Number(e.target.value))}
                    className="w-12 rounded-md border border-white/[0.07] bg-[#090A0F] px-2 py-1 text-center tabular-nums text-[#F1F5F9] focus:border-[#D99B26] focus:outline-none"
                  />
                </div>

                <select
                  id="pipeline-mode-select"
                  aria-label="Режим конвейера"
                  value={pipelineMode}
                  onChange={(e) => setPipelineMode(e.target.value as PipelineMode)}
                  className="rounded-md border border-white/[0.07] bg-[#090A0F] px-2.5 py-1 text-xs text-[#94A3B8] hover:text-[#F1F5F9] focus:border-[#D99B26] focus:outline-none"
                >
                  <option value="full_5_phase">
                    Полный цикл (5 фаз)
                  </option>
                  <option value="scout_only">Только скаутинг терминов</option>
                  <option value="verify_and_repair">Только проверка и ремонт QA</option>
                </select>

                <div className="hidden xl:flex items-center gap-3 text-xs text-[#64748B] border-l border-white/[0.06] pl-3 whitespace-nowrap">
                  <label className="inline-flex items-center gap-1.5 hover:text-[#94A3B8] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoCanonEnabled}
                      onChange={(e) => setAutoCanonEnabled(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-white/[0.15] bg-[#090A0F] text-[#D99B26] focus:ring-0"
                    />
                    Авто-канон глоссария
                  </label>
                  <label className="inline-flex items-center gap-1.5 hover:text-[#94A3B8] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={twoPassCriticEnabled}
                      onChange={(e) => setTwoPassCriticEnabled(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-white/[0.15] bg-[#090A0F] text-[#D99B26] focus:ring-0"
                    />
                    2 прохода (Точность + Хирург-редактор)
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isRunningPipeline}
                  onClick={() => handleTranslateNextBatch(3)}
                  title="Найти следующие 3 непереведённые главы и запустить 4-проходный конвейер"
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  След. 3 гл. (1 клик)
                </button>

                <button
                  type="button"
                  disabled={isRunningPipeline}
                  onClick={handleOpenGlossaryStopGate}
                  title="Пре-скаут глав и 1-минутная проверка новых имён и рода (М/Ж) перед запуском перевода пакета"
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-[#D99B26]" />
                  Стоп-кран глоссария
                </button>

                <button
                  type="button"
                  disabled={isRunningPipeline}
                  onClick={handleRunFullAutopilotRelease}
                  title="Авто-склейка дробных глав + Lookahead пре-скаут + 2-проходный перевод + Точечный ремонт до 100% QA + Выгрузка файла Рулейт (LF)"
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-[#F1F5F9] hover:bg-white/[0.07] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Zap className="h-3.5 w-3.5 text-[#D99B26]" />
                  Полный Автопилот (В релиз)
                </button>

                <button
                  type="button"
                  disabled={isRunningPipeline}
                  onClick={handleStartRangePipeline}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#D99B26] px-3.5 py-1.5 text-xs font-semibold text-[#090A0F] hover:bg-[#E3A836] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Play className="h-3 w-3 fill-current" />
                  {isRunningPipeline
                    ? `Выполнение (${activePhaseStep}/5)...`
                    : `Запустить главы ${startChapter}–${endChapter}`}
                </button>

                {isRunningPipeline && (
                  <button
                    type="button"
                    onClick={() => {
                      abortRef.current = true;
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    Стоп
                  </button>
                )}
              </div>
            </section>

            {/* Autopilot Completion Banner */}
            {autopilotBanner && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#11131C] px-4 py-3 text-xs text-[#F1F5F9]">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>{autopilotBanner}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAutopilotBanner(null)}
                  className="text-[#94A3B8] hover:text-[#F1F5F9] shrink-0"
                >
                  Скрыть
                </button>
              </div>
            )}

            {/* PRIMARY WORKSPACE: Clean Minimalist Chapter Table */}
            <section className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1">
                  {[
                    { id: 'all', label: `Все главы (${activeNovel.chapters.length})` },
                    { id: 'verified', label: 'Проверены QA' },
                    { id: 'needs_qa', label: 'Требуют правки' },
                    { id: 'untranslated', label: 'Не переведены' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setChapterFilter(tab.id as ChapterFilter)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        chapterFilter === tab.id
                          ? 'bg-white/[0.08] text-[#F1F5F9]'
                          : 'text-[#64748B] hover:text-[#94A3B8]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#64748B]" />
                  <input
                    type="search"
                    aria-label="Поиск главы по номеру или названию"
                    value={chapterSearch}
                    onChange={(e) => setChapterSearch(e.target.value)}
                    placeholder="Поиск главы..."
                    className="w-full rounded-md border border-white/[0.07] bg-[#11131C] pl-8 pr-3 py-1 text-xs text-[#F1F5F9] placeholder:text-[#64748B] focus:border-[#D99B26] focus:outline-none"
                  />
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#11131C]/60">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="border-b border-white/[0.06] text-[11px] text-[#64748B]">
                    <tr>
                      <th className="w-10 px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label="Выбрать все отображаемые главы"
                          checked={allFilteredSelected}
                          onChange={handleToggleSelectAllFiltered}
                          className="h-3.5 w-3.5 rounded border-white/[0.15] bg-[#090A0F] text-[#D99B26] focus:ring-0 cursor-pointer"
                        />
                      </th>
                      <th className="px-4 py-3 font-normal font-mono w-14">№</th>
                      <th className="px-4 py-3 font-normal">Глава</th>
                      <th className="px-4 py-3 font-normal text-right">Слов</th>
                      <th className="px-4 py-3 font-normal text-right">Конвейер</th>
                      <th className="px-4 py-3 font-normal text-right">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {filteredChapters.map(({ chapter: ch, report }) => {
                      const isRowSelected = selectedChapterIds.includes(ch.id);
                      const progress = computeChapterPipelineProgress(
                        ch,
                        report,
                        activePhaseStep,
                        isRunningPipeline && runningChapterId === ch.id
                      );

                      const fillBarClass =
                        progress.state === 'verified'
                          ? 'bg-emerald-500/90'
                          : progress.state === 'running'
                            ? 'bg-[#D99B26] animate-pulse'
                            : progress.state === 'qa_attention'
                              ? 'bg-[#D99B26]/85'
                              : progress.state === 'scouted'
                                ? 'bg-slate-400'
                                : 'bg-transparent';

                      const pctTextClass =
                        progress.state === 'verified'
                          ? 'text-emerald-400/90'
                          : progress.state === 'running'
                            ? 'text-[#D99B26]'
                            : progress.state === 'qa_attention'
                              ? 'text-[#D99B26]'
                              : 'text-[#64748B]';

                      return (
                      <tr
                        key={ch.id}
                        className={`group transition-colors ${
                          isRowSelected
                            ? 'bg-[#D99B26]/[0.07] hover:bg-[#D99B26]/[0.11]'
                            : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <td className="w-10 px-3 pt-3.5 pb-4 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Выбрать главу ${ch.subPart || ch.number}`}
                            checked={isRowSelected}
                            onChange={() => handleToggleSelectChapter(ch.id)}
                            className="h-3.5 w-3.5 rounded border-white/[0.15] bg-[#090A0F] text-[#D99B26] focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 pt-3.5 pb-4 font-mono tabular-nums text-[#64748B] whitespace-nowrap">
                          {ch.subPart || ch.number}
                        </td>
                        <td className="px-4 pt-3.5 pb-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-[#F1F5F9] text-sm">
                              {ch.titleRus || ch.titleEng}
                            </span>
                            {/* Pacing Badge */}
                            {(() => {
                              const mode = classifyScenePacingMode(ch.rusText || ch.engText);
                              const badge =
                                mode === 'combat_action'
                                  ? { label: '⚔️ Бой', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/25' }
                                  : mode === 'cultivation_epiphany'
                                  ? { label: '🧘 Озарение', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' }
                                  : mode === 'comedy_banter'
                                  ? { label: '🎭 Пикировка', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25' }
                                  : mode === 'solemn_pathos'
                                  ? { label: '🏛️ Пафос', cls: 'text-purple-300 bg-purple-500/10 border-purple-500/25' }
                                  : { label: '🌸 Романтика', cls: 'text-pink-300 bg-pink-500/10 border-pink-500/25' };
                              return (
                                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${badge.cls}`}>
                                  {badge.label}
                                </span>
                              );
                            })()}
                          </div>
                          {ch.summary ? (
                            <div className="text-[#64748B] mt-0.5 line-clamp-1">
                              {ch.summary}
                            </div>
                          ) : (
                            ch.titleRus && (
                              <div className="text-[#64748B] mt-0.5">{ch.titleEng}</div>
                            )
                          )}
                        </td>
                        <td className="px-4 pt-3.5 pb-4 text-right font-mono tabular-nums text-[#64748B] whitespace-nowrap">
                          {ch.translated
                            ? `${ch.wordCountRus}`
                            : `${ch.wordCountEng} ENG`}
                        </td>
                        <td className="px-4 pt-3.5 pb-4 text-right whitespace-nowrap">
                          <div
                            title={progress.tooltip}
                            className="inline-flex flex-col items-end gap-1.5 min-w-[148px]"
                          >
                            <div className="flex items-center justify-end gap-2.5">
                              <div
                                role="progressbar"
                                aria-label={`Прогресс конвейера главы ${ch.subPart || ch.number}: ${progress.percent}%`}
                                aria-valuenow={progress.percent}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                className="relative h-1.5 w-24 sm:w-28 overflow-hidden rounded-[3px] bg-white/[0.06]"
                              >
                                <div
                                  className={`h-full rounded-[3px] transition-all duration-300 ${fillBarClass}`}
                                  style={{ width: `${progress.percent}%` }}
                                />
                                <div className="pointer-events-none absolute inset-0 grid grid-cols-5 divide-x divide-[#090A0F]/70">
                                  <span />
                                  <span />
                                  <span />
                                  <span />
                                  <span />
                                </div>
                              </div>
                              <span
                                className={`w-9 text-right font-mono text-[11px] tabular-nums ${pctTextClass}`}
                              >
                                {progress.percent}%
                              </span>
                            </div>

                            {/* 4-Pass Timeline Indicator */}
                            <div className="flex items-center gap-1 text-[9px] font-mono text-slate-500">
                              <span className={`px-1 py-0.2 rounded border ${ch.translated ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 font-semibold' : 'border-white/5'}`}>AST</span>
                              <span>·</span>
                              <span className={`px-1 py-0.2 rounded border ${ch.translated ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 font-semibold' : 'border-white/5'}`}>Flash</span>
                              <span>·</span>
                              <span className={`px-1 py-0.2 rounded border ${ch.translated ? 'border-purple-500/30 bg-purple-500/10 text-purple-300 font-semibold' : 'border-white/5'}`}>Argon</span>
                              <span>·</span>
                              <span className={`px-1 py-0.2 rounded border ${ch.verified ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-bold' : 'border-white/5'}`}>Stylist</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 pt-3.5 pb-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {!ch.translated ? (
                              <button
                                type="button"
                                disabled={isRunningPipeline}
                                onClick={() =>
                                  executePipelineOnChapters([ch], 'full_5_phase')
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-xs font-medium text-[#94A3B8] hover:border-[#D99B26]/40 hover:text-[#F1F5F9] transition-colors"
                              >
                                <Sparkles className="h-3 w-3 text-[#D99B26]" />
                                Перевести
                              </button>
                            ) : !report?.passed ? (
                              <button
                                type="button"
                                disabled={isRunningPipeline}
                                onClick={() =>
                                  executePipelineOnChapters([ch], 'verify_and_repair')
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-xs font-medium text-[#94A3B8] hover:border-white/[0.18] hover:text-[#F1F5F9] transition-colors"
                              >
                                <Wand2 className="h-3 w-3 text-[#D99B26]" />
                                Ремонт QA
                              </button>
                            ) : null}

                            <button
                              type="button"
                              aria-label={`Открыть главу ${ch.subPart || ch.number} в редакторе`}
                              onClick={() => {
                                setSelectedChapterId(ch.id);
                                setActiveTab('editor');
                              }}
                              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-[#94A3B8] hover:bg-white/[0.05] hover:text-[#F1F5F9] transition-colors"
                            >
                              Открыть
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Quiet Hero State Passport & Analytics Section Below the Table */}
              <div className="pt-4 space-y-6">
                {activeNovel.heroLedger && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-y border-white/[0.06] py-3 text-xs text-[#64748B]">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="font-medium text-[#94A3B8]">
                        Паспорт героя (Гл. {activeNovel.heroLedger.lastUpdatedChapter})
                      </span>
                      <span>
                        <strong className="font-medium text-[#F1F5F9]">{activeNovel.heroLedger.protagonistName}</strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-[#94A3B8]">
                        {activeNovel.heroLedger.cultivationRealm}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {activeNovel.heroLedger.resources.join(' · ')}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums">
                      {activeNovel.heroLedger.activeLocation}
                    </span>
                  </div>
                )}

                <TranslationAnalyticsChart
                  chapters={activeNovel.chapters}
                  glossary={activeNovel.glossary}
                  scoutedTerms={activeNovel.scoutedTerms}
                />
              </div>

              {/* Floating Bulk Action Bar (Z-Axis Elevated Inspector with Concentric Radii: rounded-xl outer, rounded-md inner) */}
              {selectedChapterObjects.length > 0 && (
                <div
                  role="region"
                  aria-label="Плавающая панель групповых действий"
                  className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-wrap sm:flex-nowrap w-max max-w-[95vw] items-center gap-3 rounded-xl border border-white/[0.12] bg-[#161925]/95 px-5 pt-3 pb-3.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_20px_40px_rgba(0,0,0,0.65)] backdrop-blur-md"
                >
                  <div className="flex items-center gap-2 pr-2 border-r border-white/[0.08]">
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-[#D99B26] px-1.5 font-mono text-xs font-bold text-[#090A0F] tabular-nums">
                      {selectedChapterObjects.length}
                    </span>
                    <div className="text-xs">
                      <div className="font-semibold text-[#F1F5F9]">
                        Выбрано глав: {selectedChapterObjects.length}
                      </div>
                      <div className="font-mono text-[11px] text-[#94A3B8] tabular-nums">
                        №{' '}
                        {selectedChapterObjects
                          .map((c) => c.subPart || c.number)
                          .join(', ')}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isRunningPipeline}
                    onClick={() => handleRunBulkSelectedPipeline('verify_and_repair')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Массовый QA-ремонт ({selectedChapterObjects.length})
                  </button>

                  <button
                    type="button"
                    disabled={isRunningPipeline}
                    onClick={() => handleRunBulkSelectedPipeline('scout_only')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Массовый скаутинг ({selectedChapterObjects.length})
                  </button>

                  <button
                    type="button"
                    disabled={isRunningPipeline}
                    onClick={() => handleRunBulkSelectedPipeline('full_5_phase')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#D99B26] px-3.5 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E3A836] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Полный цикл ({selectedChapterObjects.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedChapterIds([])}
                    aria-label="Снять выделение глав"
                    className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-[#090A0F] px-2.5 py-2 text-xs text-[#94A3B8] hover:text-[#F1F5F9] transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Сброс
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'editor' && activeChapter && (
          <ParallelEditorView
            chapter={activeChapter}
            allChapters={activeNovel.chapters}
            onSelectChapter={(id) => setSelectedChapterId(id)}
            glossary={activeNovel.glossary}
            glossaryMeta={activeNovel.glossaryMeta}
            enabledRuleIds={activeNovel.enabledRuleIds}
            genrePreset={activeNovel.genrePreset}
            proseTone={activeNovel.proseTone}
            scoutedTerms={activeNovel.scoutedTerms}
            styleGuideMd={activeNovel.styleGuideMd}
            contextMd={activeNovel.contextMd}
            onUpdateStyleAndContext={(styleMd, ctxMd) => {
              updateActiveNovel((n) => ({
                ...n,
                styleGuideMd: styleMd,
                contextMd: ctxMd,
              }));
            }}
            onSaveChapter={handleSaveChapterFromEditor}
            onRunSingleChapterPipeline={async (chId) => {
              const target = activeNovel.chapters.find((c) => c.id === chId);
              if (target) {
                await executePipelineOnChapters([target], 'full_5_phase');
              }
            }}
            isPipelineBusy={isRunningPipeline}
            llmConfig={llmConfig}
            onAddCanonTerm={handleAddCanonTerm}
            onApplyCanonRipple={handleApplyCanonRipple}
          />
        )}

        {activeTab === 'glossary' && (
          <GlossaryVaultView
            glossary={activeNovel.glossary}
            glossaryMeta={activeNovel.glossaryMeta}
            scoutedTerms={activeNovel.scoutedTerms}
            chapters={activeNovel.chapters}
            onApproveScoutedTerm={handleApproveScoutedTerm}
            onAutoApproveHighConfidence={handleAutoApproveHighConfidence}
            onRejectScoutedTerm={handleRejectScoutedTerm}
            onAddCanonTerm={handleAddCanonTerm}
            onUpdateTermMeta={handleUpdateTermMeta}
            onRemoveCanonTerm={handleRemoveCanonTerm}
            onApplyCanonRipple={handleApplyCanonRipple}
            onScoutChapterTerms={async (chId) => {
              const target = activeNovel.chapters.find((c) => c.id === chId);
              if (target) {
                await executePipelineOnChapters([target], 'scout_only');
              }
            }}
            isScouting={isRunningPipeline}
          />
        )}

        {activeTab === 'export' && (
          <RulateExportView
            novelName={activeNovel.name}
            chapters={activeNovel.chapters}
            heroLedger={activeNovel.heroLedger}
            genrePreset={activeNovel.genrePreset}
            onMergeSplitChapters={handleMergeSplitChapters}
          />
        )}
      </main>

      {/* Modal: Configurable QA Linter Rule Profile */}
      {showRulesModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qa-rules-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h3 id="qa-rules-modal-title" className="text-base font-semibold text-slate-100">
                  Конструктор правил QA-линтера ({activeNovel.enabledRuleIds.length} из {ALL_LINT_RULES.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Адаптируйте проверки под конкретный жанр или включите/отключите отдельные правила вручную.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 pb-3">
              {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => handleGenrePresetChange(g)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    activeNovel.genrePreset === g
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'border border-slate-800 bg-slate-950 text-slate-300 hover:text-white'
                  }`}
                >
                  {GENRE_PRESET_LABELS[g].title}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto space-y-2 pr-1 flex-1">
              {ALL_LINT_RULES.map((rule) => {
                const checked = activeNovel.enabledRuleIds.includes(rule.id);
                return (
                  <label
                    key={rule.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      checked
                        ? 'border-slate-700 bg-slate-950/90'
                        : 'border-slate-800/50 bg-slate-950/30 opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleRuleId(rule.id)}
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-amber-500"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-100">{rule.title}</div>
                      <div className="text-slate-400 mt-0.5">{rule.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Bulk Multi-Chapter Import or Single Chapter */}
      {showAddChapterModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-chapter-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 id="add-chapter-modal-title" className="text-base font-semibold text-slate-100">
                Импорт глав в конвейер
              </h3>
              <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setImportMode('bulk')}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    importMode === 'bulk'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Пакетная загрузка (несколько глав)
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('single')}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    importMode === 'single'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Одна глава
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateOrBulkImportChapters} className="space-y-3">
              {importMode === 'bulk' ? (
                <>
                  <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/60 p-3 text-center">
                    <label
                      htmlFor="bulk-files-input"
                      className="cursor-pointer inline-flex flex-col items-center gap-1 text-xs text-slate-300 hover:text-amber-300"
                    >
                      <Upload className="h-4 w-4 text-amber-400" />
                      <span>
                        Выберите книгу <code className="font-mono text-amber-300">.epub</code> или файлы глав <code className="font-mono">.txt / .md</code>
                      </span>
                      {uploadedFileCount > 0 && (
                        <span className="text-emerald-400 font-medium">
                          Загружено файлов: {uploadedFileCount}
                          {sanitizedRemovedCount > 0
                            ? ` · Очищено мусора (TL Note/Patreon/Rulate): ${sanitizedRemovedCount} стр.`
                            : ''}
                        </span>
                      )}
                    </label>
                    <input
                      id="bulk-files-input"
                      type="file"
                      accept=".epub,.txt,.md"
                      multiple
                      onChange={handleFileUploadBatch}
                      className="hidden"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sanitizeOnImport}
                      onChange={(e) => setSanitizeOnImport(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-amber-500"
                    />
                    Автоочистка <code className="font-mono text-amber-300">TL Note</code>, Patreon/Discord-рекламы, водяных знаков Rulate и HTML-тегов
                  </label>

                  <div>
                    <label
                      htmlFor="bulk-raw-textarea"
                      className="block text-xs text-slate-400 mb-1"
                    >
                      Или вставьте текст сразу нескольких глав (разделяются строками <code className="font-mono">Chapter N: ...</code>)
                    </label>
                    <textarea
                      id="bulk-raw-textarea"
                      rows={7}
                      required
                      value={bulkRawText}
                      onChange={(e) => setBulkRawText(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="new-ch-num" className="block text-xs text-slate-400 mb-1">
                      Номер главы
                    </label>
                    <input
                      id="new-ch-num"
                      type="number"
                      min={1}
                      required
                      value={newChNum}
                      onChange={(e) => setNewChNum(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-ch-title" className="block text-xs text-slate-400 mb-1">
                      Заголовок (ENG)
                    </label>
                    <input
                      id="new-ch-title"
                      type="text"
                      required
                      value={newChTitleEng}
                      onChange={(e) => setNewChTitleEng(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-ch-body" className="block text-xs text-slate-400 mb-1">
                      Текст главы (ENG)
                    </label>
                    <textarea
                      id="new-ch-body"
                      rows={5}
                      required
                      value={newChEngText}
                      onChange={(e) => setNewChEngText(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100"
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddChapterModal(false)}
                  className="rounded-lg border border-slate-800 px-4 py-2 text-xs text-slate-300 hover:text-white"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  {importMode === 'bulk' ? 'Распознать и загрузить главы' : 'Добавить главу'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add New Novel */}
      {showAddNovelModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-novel-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
            <h3 id="add-novel-modal-title" className="text-base font-semibold text-slate-100">
              Создать проект книги
            </h3>
            <form onSubmit={handleCreateNewNovel} className="space-y-3">
              <div>
                <label htmlFor="new-novel-eng" className="block text-xs text-slate-400 mb-1">
                  Оригинальное название (ENG)
                </label>
                <input
                  id="new-novel-eng"
                  type="text"
                  required
                  value={newNovelName}
                  onChange={(e) => setNewNovelName(e.target.value)}
                  placeholder="Напр., Sovereign of the Nine Heavens"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="new-novel-rus" className="block text-xs text-slate-400 mb-1">
                  Русское название
                </label>
                <input
                  id="new-novel-rus"
                  type="text"
                  value={newNovelRusTitle}
                  onChange={(e) => setNewNovelRusTitle(e.target.value)}
                  placeholder="Напр., Владыка Девяти Небес"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="new-novel-genre" className="block text-xs text-slate-400 mb-1">
                  Жанровый профиль и пресет правил QA
                </label>
                <select
                  id="new-novel-genre"
                  value={newNovelGenre}
                  onChange={(e) => setNewNovelGenre(e.target.value as GenrePreset)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                >
                  {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
                    <option key={g} value={g}>
                      {GENRE_PRESET_LABELS[g].title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddNovelModal(false)}
                  className="rounded-lg border border-slate-800 px-4 py-2 text-xs text-slate-300 hover:text-white"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  Создать книгу
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Google Colab L4 (24GB VRAM) & Open-Weights LLM Selector */}
      {showColabModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="colab-l4-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div className="w-full max-w-3xl rounded-xl border border-slate-800 bg-[#0F111A] p-6 space-y-5 max-h-[90vh] flex flex-col text-xs text-slate-200">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
              <div>
                <h3
                  id="colab-l4-modal-title"
                  className="text-base font-semibold text-slate-100 flex items-center gap-2"
                >
                  <Cpu className="h-4 w-4 text-[#D99B26]" />
                  Выделенный GPU Google Colab L4 (24 ГБ VRAM) и выбор модели
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Обход ошибок <code className="font-mono text-amber-300">503 Model is overloaded</code> и очередей Free Tier за счёт запуска открытых весов напрямую на вашей карте L4 в плане Google AI Ultra.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowColabModal(false)}
                aria-label="Закрыть окно настройки Colab L4"
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-5 pr-1 flex-1">
              {/* Step 1: Provider Switch */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setLlmConfig((prev) => ({
                      ...prev,
                      provider: 'antigravity_cli',
                      modelId:
                        prev.modelId && !prev.modelId.includes(':')
                          ? prev.modelId
                          : 'gemini-3.8-flash-high',
                      criticModelId: prev.criticModelId || 'gemini-4-argon-medium',
                      scoutModelId:
                        prev.scoutModelId && !prev.scoutModelId.includes(':')
                          ? prev.scoutModelId
                          : 'gemini-3.8-flash-low',
                    }))
                  }
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    llmConfig.provider === 'antigravity_cli'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-white/[0.08] bg-[#090A0F] opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="font-semibold text-emerald-300">
                    Подписка Antigravity CLI (agy)
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Локальный headless-режим <code className="font-mono">agy -p</code>: <code className="font-mono text-emerald-300">gemini-3.8-flash</code> на перевод + <code className="font-mono text-amber-300">gemini-4-argon</code> на финальное ревью.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setLlmConfig((prev) => ({
                      ...prev,
                      provider: 'colab_ollama',
                      modelId: prev.modelId.includes(':') ? prev.modelId : 'gemma4:26b-a4b',
                    }))
                  }
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    llmConfig.provider === 'colab_ollama'
                      ? 'border-[#D99B26] bg-[#D99B26]/10'
                      : 'border-white/[0.08] bg-[#090A0F] opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="font-semibold text-slate-100">
                    Выделенный Google Colab L4 (Ollama / vLLM)
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Ноль ошибок 503, без лимита 15 RPM, 24 ГБ VRAM под Gemma 4 / Qwen 3 / TranslateGemma.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setLlmConfig((prev) => ({ ...prev, provider: 'gemini_api' }))
                  }
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    llmConfig.provider === 'gemini_api'
                      ? 'border-[#D99B26] bg-[#D99B26]/10'
                      : 'border-white/[0.08] bg-[#090A0F] opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="font-semibold text-slate-100">
                    Google AI Studio API (Облачный ключ)
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Работа через <code className="font-mono">GEMINI_API_KEY</code> с автоматическим экспоненциальным повтором при 503.
                  </div>
                </button>
              </div>

              {/* Step 1.5: Two-Tier Antigravity CLI Configuration */}
              {llmConfig.provider === 'antigravity_cli' && (
                <div className="rounded-lg border border-emerald-500/35 bg-emerald-950/15 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-emerald-200">
                      Двухконтурная маршрутизация через локальный Antigravity CLI (<code className="font-mono">agy --input-format stream-json</code>)
                    </span>
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      Без расхода API-ключей · Поток stdin без лимита 8 КБ
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label
                        htmlFor="agy-primary-model-select"
                        className="block text-[11px] text-slate-300 mb-1"
                      >
                        Основная модель (Pass 1 & Self-Repair)
                      </label>
                      <select
                        id="agy-primary-model-select"
                        value={llmConfig.modelId || 'gemini-3.8-flash-high'}
                        onChange={(e) =>
                          setLlmConfig((prev) => ({ ...prev, modelId: e.target.value }))
                        }
                        className="w-full rounded border border-white/[0.12] bg-[#090A0F] px-2.5 py-1.5 font-mono text-xs text-emerald-300 focus:border-emerald-400 focus:outline-none"
                      >
                        {AGY_CLI_MODEL_CATALOG.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="agy-critic-model-select"
                        className="block text-[11px] text-slate-300 mb-1"
                      >
                        Тяжёлая проверка в конце (Pass 2 Хирург)
                      </label>
                      <select
                        id="agy-critic-model-select"
                        value={llmConfig.criticModelId || 'gemini-4-argon-medium'}
                        onChange={(e) =>
                          setLlmConfig((prev) => ({
                            ...prev,
                            criticModelId: e.target.value,
                          }))
                        }
                        className="w-full rounded border border-white/[0.12] bg-[#090A0F] px-2.5 py-1.5 font-mono text-xs text-amber-300 focus:border-[#D99B26] focus:outline-none"
                      >
                        {AGY_CLI_MODEL_CATALOG.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="agy-scout-model-select"
                        className="block text-[11px] text-slate-300 mb-1"
                      >
                        Пре-скаут терминов (Pass 0)
                      </label>
                      <select
                        id="agy-scout-model-select"
                        value={llmConfig.scoutModelId || 'gemini-3.8-flash-low'}
                        onChange={(e) =>
                          setLlmConfig((prev) => ({
                            ...prev,
                            scoutModelId: e.target.value,
                          }))
                        }
                        className="w-full rounded border border-white/[0.12] bg-[#090A0F] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-emerald-400 focus:outline-none"
                      >
                        {AGY_CLI_MODEL_CATALOG.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Endpoint URL & Health Check */}
              <div className="rounded-lg border border-white/[0.08] bg-[#090A0F] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="colab-endpoint-input"
                    className="font-semibold text-slate-100"
                  >
                    1. Адрес туннеля Google Colab L4 (Cloudflare / Ngrok или локальный Ollama)
                  </label>
                  <a
                    href="/colab_l4_translation_server.ipynb"
                    download="colab_l4_translation_server.ipynb"
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#D99B26]/40 bg-[#D99B26]/10 px-2.5 py-1 text-[11px] font-semibold text-[#D99B26] hover:bg-[#D99B26]/20"
                  >
                    <Download className="h-3 w-3" />
                    Скачать готовый .ipynb для Colab L4
                  </a>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="colab-endpoint-input"
                    type="text"
                    value={llmConfig.colabEndpointUrl}
                    onChange={(e) =>
                      setLlmConfig((prev) => ({
                        ...prev,
                        colabEndpointUrl: e.target.value,
                      }))
                    }
                    placeholder="https://xxxx-xxxx.trycloudflare.com или http://localhost:11434"
                    className="flex-1 rounded-md border border-white/[0.1] bg-[#11131C] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#D99B26] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={colabPingState?.loading}
                    onClick={handlePingColabServer}
                    className="rounded-md bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E3A836] disabled:opacity-50 whitespace-nowrap"
                  >
                    {colabPingState?.loading ? 'Проверка...' : 'Проверить связь с L4'}
                  </button>
                </div>

                {colabPingState && !colabPingState.loading && (
                  <div
                    className={`rounded-md border px-3 py-2 text-[11px] ${
                      colabPingState.ok
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    }`}
                  >
                    {colabPingState.ok ? (
                      <span>
                        Связь установлена ({colabPingState.runtime}, пинг{' '}
                        <strong className="font-mono">{colabPingState.latencyMs} мс</strong>). Загруженные модели:{' '}
                        <code className="font-mono">
                          {(colabPingState.models || []).join(', ') || llmConfig.modelId}
                        </code>
                      </span>
                    ) : (
                      <span>{colabPingState.error}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3: Curated L4 24GB VRAM Model Catalog */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">
                    2. Рейтинг лучших открытых моделей под 24 ГБ VRAM (NVIDIA L4) для перевода новелл
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Тег модели:</span>
                    <input
                      type="text"
                      aria-label="Пользовательский тег модели Ollama"
                      value={llmConfig.modelId}
                      onChange={(e) =>
                        setLlmConfig((prev) => ({ ...prev, modelId: e.target.value }))
                      }
                      className="w-44 rounded border border-white/[0.1] bg-[#090A0F] px-2.5 py-1 font-mono text-xs text-[#D99B26] focus:border-[#D99B26] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {COLAB_L4_MODEL_CATALOG.map((spec) => {
                    const isSelected = llmConfig.modelId === spec.ollamaTag;
                    return (
                      <div
                        key={spec.id}
                        onClick={() =>
                          setLlmConfig((prev) => ({
                            ...prev,
                            provider: 'colab_ollama',
                            modelId: spec.ollamaTag,
                          }))
                        }
                        className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-[#D99B26] bg-[#D99B26]/[0.08]'
                            : 'border-white/[0.07] bg-[#090A0F] hover:border-white/[0.18]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-100">
                              {spec.title}
                            </span>
                            <span className="rounded bg-[#D99B26]/20 px-2 py-0.5 text-[10px] font-semibold text-[#D99B26]">
                              {spec.roleBadge}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400 tabular-nums">
                            <span>VRAM: {spec.vramGb}</span>
                            <span>·</span>
                            <span className="text-emerald-400">{spec.speedOnL4}</span>
                            <span>·</span>
                            <span>Ctx: {spec.contextWindow}</span>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                          <strong className="text-slate-100">Плюсы:</strong> {spec.strengthsRus}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                          <strong className="text-slate-300">Нюанс:</strong> {spec.caveatsRus}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 4: 1-Click Colab Cell Script */}
              <div className="rounded-lg border border-white/[0.08] bg-[#090A0F] p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">
                    3. Готовый код ячейки для Google Colab (GPU L4 · 24 ГБ VRAM)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        generateColabL4LaunchScript(llmConfig.modelId)
                      );
                      setCopiedColabScript(true);
                      setTimeout(() => setCopiedColabScript(false), 2500);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-slate-100 hover:bg-white/[0.1]"
                  >
                    {copiedColabScript ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        Скопировано!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-[#D99B26]" />
                        Скопировать код для Colab
                      </>
                    )}
                  </button>
                </div>
                <pre className="max-h-40 overflow-y-auto rounded bg-[#050609] p-3 font-mono text-[11px] text-slate-300 leading-relaxed">
                  {generateColabL4LaunchScript(llmConfig.modelId)}
                </pre>
              </div>

              {/* Step 5: Autonomous Overnight Google Drive Bundle (Q9: A) */}
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-emerald-200">
                      4. Автономный ночной перевод через Google Drive (с выключенным ПК)
                    </span>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Скачайте <code className="font-mono text-amber-300">kanon_project_bundle.json</code>, положите его в <code className="font-mono">/MyDrive/KanonXianxia/</code> и запустите Ячейку №2 в ноутбуке Colab. После каждой главы Colab атомарно перезаписывает чекпоинт на Google Диске.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleExportColabDriveBundle}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Скачать бандл для ночного Google Drive
                  </button>
                  <input
                    ref={driveBundleInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportColabDriveBundle}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => driveBundleInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Загрузить готовый бандл с Google Drive
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/[0.07]">
              <span className="text-[11px] text-slate-400 font-mono">
                Активный движок:{' '}
                <strong className="text-slate-200">
                  {llmConfig.provider === 'antigravity_cli'
                    ? `agy CLI (Pass 1: ${llmConfig.modelId || 'gemini-3.8-flash-high'} · Pass 2: ${llmConfig.criticModelId || 'gemini-4-argon-medium'})`
                    : llmConfig.provider === 'colab_ollama'
                      ? `Colab L4 (${llmConfig.modelId})`
                      : 'Google AI Studio API'}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => setShowColabModal(false)}
                className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E3A836]"
              >
                Сохранить и закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Glossary Stop-Gate before Batch Translation (Q3: A & Q7: C) */}
      {showStopGateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stop-gate-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div className="w-full max-w-3xl rounded-xl border border-slate-800 bg-[#0F111A] p-6 space-y-4 max-h-[88vh] flex flex-col text-xs text-slate-200">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-3">
              <div>
                <h3
                  id="stop-gate-modal-title"
                  className="text-base font-semibold text-slate-100 flex items-center gap-2"
                >
                  <ShieldCheck className="h-4 w-4 text-[#D99B26]" />
                  Стоп-кран глоссария перед переводом (Главы {startChapter}–{endChapter})
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Проверьте или поправьте русские названия и грамматический род (М / Ж / Ср / Мн) новых терминов. После нажатия кнопки весь пакет глав переведётся строго по этому канону.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStopGateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2 pr-1 flex-1">
              {stopGateTerms.length === 0 ? (
                <div className="rounded-lg border border-white/[0.07] bg-[#090A0F] p-6 text-center text-slate-400">
                  В главах {startChapter}–{endChapter} все ключевые термины уже находятся в утверждённом глоссарии ({kpiStats.canonCount} записей). Можно сразу запускать перевод!
                </div>
              ) : (
                stopGateTerms.map((term, idx) => (
                  <div
                    key={term.id || idx}
                    className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#090A0F] p-2.5"
                  >
                    <div className="sm:col-span-4 font-mono text-xs text-amber-300 truncate">
                      {term.eng}
                    </div>
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        aria-label={`Русский перевод для ${term.eng}`}
                        value={term.rus_suggested}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStopGateTerms((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, rus_suggested: val } : item
                            )
                          );
                        }}
                        className="w-full rounded border border-white/[0.12] bg-[#11131C] px-2.5 py-1 text-xs text-slate-100 focus:border-[#D99B26] focus:outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <select
                        aria-label={`Род для ${term.eng}`}
                        value={term.gender || 'M'}
                        onChange={(e) => {
                          const g = e.target.value as GrammaticalGender;
                          setStopGateTerms((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, gender: g } : item
                            )
                          );
                        }}
                        className="w-full rounded border border-white/[0.12] bg-[#11131C] px-2 py-1 font-mono text-xs text-slate-200"
                      >
                        <option value="M">Род: М</option>
                        <option value="F">Род: Ж</option>
                        <option value="N">Род: Ср</option>
                        <option value="PL">Род: Мн</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setStopGateTerms((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
                      >
                        Убрать
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/[0.08]">
              <span className="text-[11px] text-slate-400 font-mono">
                Новых терминов к утверждению: <strong>{stopGateTerms.length}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowStopGateModal(false)}
                  className="rounded-lg border border-slate-800 px-3.5 py-2 text-xs text-slate-300 hover:text-white"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleApproveStopGateAndTranslate}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E3A836]"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Утвердить канон и перевести главы {startChapter}–{endChapter}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
