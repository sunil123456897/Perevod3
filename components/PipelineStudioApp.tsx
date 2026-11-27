'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Play,
  Square,
  Search,
  AlertTriangle,
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
  MoreHorizontal,
  FileText,
  ChevronDown,
} from 'lucide-react';
import {
  runQaLinter,
  buildRulateExportPackages,
  mergeSplitChapters,
  ALL_LINT_RULES,
  GENRE_PRESET_LABELS,
  PROSE_TONE_LABELS,
  getDefaultRulesForGenre,
  parseBulkChaptersInput,
  computeChapterPipelineProgress,
  DEFAULT_LLM_PROVIDER_CONFIG,
  normalizeColabEndpointUrl,
} from '@/lib/qa-linter';
import {
  prepareGlossaryStopGateTerms,
  autoMergeSplitChaptersInNovel,
  runPipelineBatchOnNovel,
  FetchPipelineTransportAdapter,
} from '@/lib/pipeline-batch-runner';
import { previewAndApplyCanonRipple } from '@/lib/canon-glossary-vault';
import {
  SlidingWindowTaskQueue,
  type SlidingWindowQueueTelemetry,
} from '@/lib/delta-diting';
import {
  createStoredZipArchive,
  sanitizeRawChapterText,
  parseEpubArchiveToChaptersAsync,
} from '@/lib/epub-archive';
import { classifyScenePacingMode } from '@/lib/scene-analysis';
import type {
  GlossaryCategory,
  GrammaticalGender,
  ScoutedTerm,
  GenrePreset,
  ProseTone,
  LintRuleId,
  LlmProviderConfig,
  LintReport,
  PipelineJobRecord,
} from '@/lib/pipeline-types';
import {
  INITIAL_NOVELS,
  type NovelProject,
  type ChapterRecord,
} from '@/lib/seed-data';
import {
  loadNovelsFromStorage,
  saveNovelsToStorage,
  clearNovelsStorage,
  patchChapterOnServer,
  serializeProjectBundle,
  deserializeProjectBundle,
} from '@/lib/storage-idb';
import ParallelEditorView from './ParallelEditorView';
import GlossaryVaultView from './GlossaryVaultView';
import RulateExportView from './RulateExportView';
import QuickStartWizard from './QuickStartWizard';
import StudioAuthGate from './StudioAuthGate';
import { useToast } from './ToastProvider';
import {
  type StudioTab,
  type PipelineMode,
  type ChapterFilter,
  type PipelineLogEntry,
  MAX_QA_MEMO_CACHE_ENTRIES,
  fastHash32,
  hashGlossaryAndRules,
  qaSummaryToLintReport,
  parsePhaseStepFromEvent,
  sanitizeZipSlug,
  triggerBlobDownload,
} from './studio/studio-helpers';
import { useStudioJobStream } from './studio/useStudioJobStream';
import {
  LinterProfileModal,
  BulkImportModal,
  NewNovelModal,
  LlmEngineModal,
  GlossaryStopGateModal,
  type ColabPingState,
} from './studio/StudioModals';
import { CommandPaletteModal } from './studio/CommandPaletteModal';

const TranslationAnalyticsChart = dynamic(() => import('./TranslationAnalyticsChart'), {
  ssr: false,
  loading: () => (
    <div className="h-64 rounded-xl border border-[#F2EFE9]/[0.08] bg-[#141418]" />
  ),
});

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
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showMoreMenu, setShowMoreMenu] = useState<boolean>(false);
  const [showRunModesMenu, setShowRunModesMenu] = useState<boolean>(false);
  const [forceOpenWizard, setForceOpenWizard] = useState<boolean>(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const runModesRef = useRef<HTMLDivElement | null>(null);
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

  // AI Studio Cloud / Antigravity CLI / Colab L4 Provider Configuration
  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedLlm = localStorage.getItem('xianxia_colab_llm_config_v1');
        if (savedLlm) {
          const parsed = JSON.parse(savedLlm) as Partial<LlmProviderConfig>;
          if (
            parsed.provider === 'antigravity_cli' ||
            (parsed.provider === 'colab_ollama' && !parsed.colabEndpointUrl?.trim())
          ) {
            return DEFAULT_LLM_PROVIDER_CONFIG;
          }
          const stylistDefault =
            parsed.provider === 'colab_ollama'
              ? parsed.criticModelId || parsed.modelId || DEFAULT_LLM_PROVIDER_CONFIG.stylistModelId
              : DEFAULT_LLM_PROVIDER_CONFIG.stylistModelId;
          return {
            ...DEFAULT_LLM_PROVIDER_CONFIG,
            ...parsed,
            stylistModelId: parsed.stylistModelId || stylistDefault,
          };
        }
      } catch {
        // ignore storage errors
      }
    }
    return DEFAULT_LLM_PROVIDER_CONFIG;
  });
  const [showColabModal, setShowColabModal] = useState<boolean>(false);
  const [colabPingState, setColabPingState] = useState<ColabPingState | null>(null);
  const [authState, setAuthState] = useState<'checking' | 'locked' | 'ready'>('checking');
  const [authCheckError, setAuthCheckError] = useState<string | null>(null);
  const [authNonce, setAuthNonce] = useState<number>(0);

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
  const [activeJob, setActiveJob] = useState<PipelineJobRecord | null>(null);
  const [computedQaMap, setComputedQaMap] = useState<Record<string, LintReport>>({});
  const [computedPacingMap, setComputedPacingMap] = useState<Record<string, string>>({});

  const novelsRef = useRef<NovelProject[]>(novels);
  useEffect(() => {
    novelsRef.current = novels;
  }, [novels]);
  const skipNextAutosaveRef = useRef<boolean>(false);
  const qaCacheRef = useRef<Map<string, LintReport>>(new Map());
  const pacingCacheRef = useRef<Map<string, string>>(new Map());

  const appendLog = useCallback(
    (phase: string, message: string, level: 'info' | 'success' | 'warn' = 'info') => {
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
    },
    []
  );

  const {
    jobWaitersRef,
    refreshProjectsFromServer,
    subscribeToJobEvents,
  } = useStudioJobStream({
    novelsRef,
    skipNextAutosaveRef,
    setNovels,
    setActiveJob,
    setRunningChapterId,
    setActivePhaseStep,
    setIsRunningPipeline,
    appendLog,
    parsePhaseStepFromEvent,
    toast,
  });

  useEffect(() => {
    try {
      localStorage.setItem('xianxia_colab_llm_config_v1', JSON.stringify(llmConfig));
    } catch {
      // ignore storage errors
    }
  }, [llmConfig]);

  // Session Safety Guard: Prevent accidental tab closure during active pipeline batch
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRunningPipeline) {
        e.preventDefault();
        e.returnValue = 'Идёт пакетный перевод новеллы. Вы уверены, что хотите закрыть вкладку?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRunningPipeline]);

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
    (async () => {
      try {
        const authRes = await fetch('/api/auth', { cache: 'no-store' });
        if (!authRes.ok) {
          const errPayload = await authRes.json().catch(() => null);
          if (mounted) {
            setAuthCheckError(
              (typeof errPayload?.error === 'string' && errPayload.error) ||
                `Ошибка проверки доступа (/api/auth HTTP ${authRes.status}).`
            );
            setAuthState('locked');
          }
          return;
        }
        const authData = await authRes.json().catch(() => null);
        if (!authData?.ok) {
          if (mounted) {
            setAuthCheckError('Некорректный ответ сервиса авторизации /api/auth.');
            setAuthState('locked');
          }
          return;
        }
        if (authData.authRequired && !authData.authenticated) {
          if (mounted) {
            setAuthCheckError(null);
            setAuthState('locked');
          }
          return;
        }
      } catch {
        if (mounted) {
          setAuthCheckError('Не удалось связаться с сервером /api/auth для проверки доступа.');
          setAuthState('locked');
        }
        return;
      }

      if (!mounted) return;
      setAuthCheckError(null);
      setAuthState('ready');

      const { novels: saved } = await loadNovelsFromStorage(INITIAL_NOVELS);
      if (!mounted) return;
      if (Array.isArray(saved) && saved.length > 0) {
        skipNextAutosaveRef.current = true;
        setNovels(saved);
      }
      setIsHydrated(true);

      // Restore any running/queued server background job after reload
      try {
        const res = await fetch('/api/jobs', { cache: 'no-store' });
        if (!mounted || !res.ok) return;
        const data = await res.json().catch(() => null);
        const jobs = Array.isArray(data?.jobs) ? (data.jobs as PipelineJobRecord[]) : [];
        const active = jobs.find((j) => j.status === 'running' || j.status === 'queued');
        if (active && mounted) {
          setActiveJob(active);
          setIsRunningPipeline(true);
          appendLog(
            'ВОССТАНОВЛЕНИЕ',
            `Подключение к активной задаче ${active.id} (${active.completedChapters}/${active.totalChapters} гл.).`,
            'info'
          );
          subscribeToJobEvents(active.id, active.novelId);
        }
      } catch {
        // Jobs broker optional
      }
    })();

    return () => {
      mounted = false;
    };
  }, [appendLog, authNonce, subscribeToJobEvents]);

  useEffect(() => {
    if (authState !== 'ready' || !isHydrated) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      saveNovelsToStorage(novels).then((status) => {
        if (status === 'conflict_disk_newer') {
          toast.warn(
            'Файл data/novels_db.json был обновлён внешним процессом (например, CLI-раннером). Локальная копия сохранена в браузере, перезапись диска заблокирована — обновите страницу для синхронизации.'
          );
        }
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [authState, novels, isHydrated, toast]);

  const activeNovel = novels.find((n) => n.id === activeNovelId) || novels[0];

  const activeChapter =
    activeNovel.chapters.find((c) => c.id === selectedChapterId) ||
    activeNovel.chapters[0];

  const glossaryRulesHash = useMemo(
    () =>
      hashGlossaryAndRules(
        activeNovel.glossary,
        activeNovel.glossaryMeta,
        activeNovel.enabledRuleIds
      ),
    [activeNovel.glossary, activeNovel.glossaryMeta, activeNovel.enabledRuleIds]
  );

  const chaptersWithQa = useMemo(() => {
    if (activeTab !== 'pipeline') {
      return [];
    }

    return activeNovel.chapters.map((ch) => {
      if (!ch.rusText.trim()) {
        return { chapter: ch, report: null };
      }
      if (ch.qaSummary) {
        return { chapter: ch, report: qaSummaryToLintReport(ch.qaSummary) };
      }

      const cacheKey = `${ch.id}:${ch.engText.length}:${ch.rusText.length}:${fastHash32(ch.rusText)}:${ch.lastUpdated || ''}:${glossaryRulesHash}`;
      const cached = computedQaMap[cacheKey];
      if (cached) {
        return { chapter: ch, report: cached };
      }

      return {
        chapter: ch,
        report: {
          passed: Boolean(ch.verified),
          errorCount: ch.verified ? 0 : 1,
          warningCount: 0,
          score: ch.verified ? 100 : 60,
          issues: [],
          checkedNumbersCount: 0,
          glossaryMatchesCount: 0,
        } satisfies LintReport,
      };
    });
  }, [activeTab, activeNovel, glossaryRulesHash, computedQaMap]);

  // Compute missing QA reports & pacing modes asynchronously using useRef caches without blocking UI
  useEffect(() => {
    if (activeTab !== 'pipeline') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const qaCache = qaCacheRef.current;
    const pacingCache = pacingCacheRef.current;

    const missingQa: Array<{ key: string; ch: ChapterRecord }> = [];
    const pacingUpdates: Record<string, string> = {};
    const cachedQaHits: Record<string, LintReport> = {};

    for (const ch of activeNovel.chapters) {
      const sample = ch.rusText || ch.engText;
      if (!ch.pacingMode && sample) {
        const pKey = `${ch.id}:${sample.length}:${fastHash32(sample)}`;
        let mode = pacingCache.get(pKey);
        if (!mode) {
          mode = classifyScenePacingMode(sample);
          if (pacingCache.size >= MAX_QA_MEMO_CACHE_ENTRIES) {
            const firstKey = pacingCache.keys().next().value;
            if (firstKey !== undefined) pacingCache.delete(firstKey);
          }
          pacingCache.set(pKey, mode);
        }
        pacingUpdates[pKey] = mode;
      }

      if (!ch.rusText.trim() || ch.qaSummary) continue;
      const cacheKey = `${ch.id}:${ch.engText.length}:${ch.rusText.length}:${fastHash32(ch.rusText)}:${ch.lastUpdated || ''}:${glossaryRulesHash}`;
      const hit = qaCache.get(cacheKey);
      if (hit) {
        cachedQaHits[cacheKey] = hit;
      } else {
        missingQa.push({ key: cacheKey, ch });
      }
    }

    let cursor = 0;
    const runChunk = () => {
      if (cancelled) return;

      const chunkQa: Record<string, LintReport> =
        cursor === 0 ? { ...cachedQaHits } : {};
      const end = Math.min(cursor + 10, missingQa.length);
      for (; cursor < end; cursor++) {
        const item = missingQa[cursor];
        const computed = runQaLinter(item.ch.engText, item.ch.rusText, activeNovel.glossary, {
          enabledRuleIds: activeNovel.enabledRuleIds,
          glossaryMeta: activeNovel.glossaryMeta,
        });
        if (qaCache.size >= MAX_QA_MEMO_CACHE_ENTRIES) {
          const oldestKey = qaCache.keys().next().value;
          if (oldestKey !== undefined) qaCache.delete(oldestKey);
        }
        qaCache.set(item.key, computed);
        chunkQa[item.key] = computed;
      }

      if (Object.keys(pacingUpdates).length > 0 && cursor <= 10) {
        setComputedPacingMap((prev) => {
          let changed = false;
          for (const [k, v] of Object.entries(pacingUpdates)) {
            if (prev[k] !== v) {
              changed = true;
              break;
            }
          }
          return changed ? { ...prev, ...pacingUpdates } : prev;
        });
      }

      if (Object.keys(chunkQa).length > 0) {
        setComputedQaMap((prev) => {
          let changed = false;
          for (const [k, v] of Object.entries(chunkQa)) {
            if (prev[k] !== v) {
              changed = true;
              break;
            }
          }
          return changed ? { ...prev, ...chunkQa } : prev;
        });
      }

      if (!cancelled && cursor < missingQa.length) {
        timer = setTimeout(runChunk, 0);
      }
    };

    if (
      missingQa.length > 0 ||
      Object.keys(cachedQaHits).length > 0 ||
      Object.keys(pacingUpdates).length > 0
    ) {
      timer = setTimeout(runChunk, 0);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeTab, activeNovel, glossaryRulesHash]);

  const filteredChapters = useMemo(() => {
    return chaptersWithQa.filter(({ chapter, report }) => {
      if (chapterFilter === 'quarantined' && chapter.status !== 'quarantined') return false;
      if (
        chapterFilter === 'verified' &&
        (!chapter.verified || chapter.status === 'quarantined')
      )
        return false;
      if (
        chapterFilter === 'needs_qa' &&
        (!chapter.translated ||
          chapter.status === 'quarantined' ||
          (report && report.passed))
      )
        return false;
      if (
        chapterFilter === 'untranslated' &&
        (chapter.translated || chapter.status === 'quarantined')
      )
        return false;

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
    const verifiedCount = activeNovel.chapters.filter(
      (c) => c.verified && c.status !== 'quarantined'
    ).length;
    const quarantinedCount = activeNovel.chapters.filter(
      (c) => c.status === 'quarantined'
    ).length;
    const needsQaCount = chaptersWithQa.filter(
      ({ chapter, report }) =>
        chapter.translated &&
        chapter.status !== 'quarantined' &&
        Boolean(report && !report.passed)
    ).length;
    const untranslatedCount = activeNovel.chapters.filter(
      (c) => !c.translated && c.status !== 'quarantined'
    ).length;
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
      quarantinedCount,
      needsQaCount,
      untranslatedCount,
      canonCount,
      scoutBufferCount,
    };
  }, [activeNovel, chaptersWithQa]);

  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key.toLowerCase() === 'k' || e.code === 'KeyK')
      ) {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      } else if (e.key === 'Escape') {
        if (showMoreMenu) setShowMoreMenu(false);
        if (showRunModesMenu) setShowRunModesMenu(false);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [showMoreMenu, showRunModesMenu]);

  useEffect(() => {
    if (!showMoreMenu && !showRunModesMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
      if (runModesRef.current && !runModesRef.current.contains(e.target as Node)) {
        setShowRunModesMenu(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showMoreMenu, showRunModesMenu]);

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
    mode: PipelineMode,
    novelOverride?: NovelProject
  ): Promise<NovelProject | null> => {
    if (targetChapters.length === 0 || isRunningPipeline) return null;
    const targetNovel = novelOverride || activeNovel;
    setIsRunningPipeline(true);
    abortRef.current = false;

    // Step 1: Try Server SSE Job Broker (`POST /api/jobs` + EventSource)
    let startedServerJob = false;
    try {
      const novelsToPersist = novelsRef.current.some((n) => n.id === targetNovel.id)
        ? novelsRef.current.map((n) => (n.id === targetNovel.id ? targetNovel : n))
        : [...novelsRef.current, targetNovel];
      const flushStatus = await saveNovelsToStorage(novelsToPersist);

      if (flushStatus === 'Disk+IndexedDB') {
        const chapterNums = targetChapters.map((c) => c.number);
        const startCh = Math.min(...chapterNums);
        const endCh = Math.max(...chapterNums);
        const jobRes = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            novelId: targetNovel.id,
            targetChapterIds: targetChapters.map((c) => c.id),
            startChapter: startCh,
            endChapter: endCh,
            mode,
            autoCanonEnabled,
            twoPassCriticEnabled,
            llmConfig,
          }),
        });

        if (jobRes.ok) {
          const jobData = await jobRes.json().catch(() => null);
          const createdJob = jobData?.job as PipelineJobRecord | undefined;
          if (jobData?.ok && createdJob?.id) {
            startedServerJob = true;
            setActiveJob(createdJob);
            appendLog(
              'СТАРТ',
              `Серверная задача ${createdJob.id} (${targetChapters.length} гл.) · Жанр: ${GENRE_PRESET_LABELS[targetNovel.genrePreset].title} · Тон: ${PROSE_TONE_LABELS[targetNovel.proseTone].title}.`,
              'info'
            );
            return await new Promise<NovelProject | null>((resolve) => {
              jobWaitersRef.current.push(resolve);
              subscribeToJobEvents(createdJob.id, targetNovel.id);
            });
          }
        }
      }
    } catch {
      // Smoothly fall back to browser pipeline execution below
    }

    if (startedServerJob) {
      return null;
    }

    // Step 2: Graceful local browser fallback when `/api/jobs` is unavailable
    const transport = new FetchPipelineTransportAdapter({
      baseUrl: '/api/pipeline',
      queue: schedulerRef.current,
    });

    let finalNovel: NovelProject | null = targetNovel;
    try {
      const res = await runPipelineBatchOnNovel({
        novel: targetNovel,
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
            finalNovel = event.updatedNovel;
            updateActiveNovel(() => event.updatedNovel);
          } else if (event.type === 'aborted') {
            appendLog('СТОП', 'Выполнение остановлено пользователем.', 'warn');
          }
        },
      });

      if (res?.updatedNovel) {
        finalNovel = res.updatedNovel;
        updateActiveNovel(() => res.updatedNovel);
      }
      return finalNovel;
    } catch (err) {
      appendLog(
        'ОШИБКА',
        `Сбой пакета конвейера: ${err instanceof Error ? err.message : String(err)}`,
        'warn'
      );
      return finalNovel;
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
    const nextGlossary = { ...activeNovel.glossary };
    const nextMeta = { ...activeNovel.glossaryMeta };
    for (const term of stopGateTerms) {
      if (!term.eng.trim() || !term.rus_suggested.trim()) continue;
      nextGlossary[term.category] = {
        ...(nextGlossary[term.category] || {}),
        [term.eng.trim()]: term.rus_suggested.trim(),
      };
      nextMeta[term.eng.trim()] = {
        ...nextMeta[term.eng.trim()],
        gender:
          term.category === 'characters'
            ? ((term.gender as GrammaticalGender | undefined) || 'UNKNOWN')
            : term.gender,
      };
    }
    const nextNovel: NovelProject = {
      ...activeNovel,
      glossary: nextGlossary,
      glossaryMeta: nextMeta,
    };

    updateActiveNovel(() => nextNovel);

    setShowStopGateModal(false);
    appendLog(
      'КАНОН УТВЕРЖДЁН',
      `Утверждено ${stopGateTerms.length} терминов в Стоп-кране глоссария. Запуск 2-проходного перевода глав ${startChapter}–${endChapter}...`,
      'success'
    );

    const targets = nextNovel.chapters.filter(
      (c) => c.number >= startChapter && c.number <= endChapter
    );
    executePipelineOnChapters(targets, 'full_5_phase', nextNovel);
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
    const { updatedNovel: mergedNovel, mergedCount: mergedSplitCount } =
      autoMergeSplitChaptersInNovel(activeNovel);
    if (mergedSplitCount > 0) {
      updateActiveNovel(() => mergedNovel);
      appendLog(
        'АВТО-СКЛЕЙКА',
        `Автопилот автоматически объединил дробные главы (${mergedSplitCount} склеек: 7.1 + 7.2 → Глава 7).`,
        'success'
      );
    }

    // Step 2: Select all chapters that need translation, QA repair, or retry from quarantine
    const targets = mergedNovel.chapters.filter((ch) => {
      if (!ch.translated || !ch.rusText.trim() || ch.status === 'quarantined') return true;
      if (ch.qaSummary) return !ch.qaSummary.passed;
      const rep = runQaLinter(ch.engText, ch.rusText, mergedNovel.glossary, {
        enabledRuleIds: mergedNovel.enabledRuleIds,
        glossaryMeta: mergedNovel.glossaryMeta,
      });
      return !rep.passed;
    });

    const finishedNovel =
      targets.length > 0
        ? await executePipelineOnChapters(targets, 'full_5_phase', mergedNovel)
        : mergedNovel;

    // Step 3: Build Rulate LF Export Package STRICTLY from verified non-quarantined chapters
    const currentNovel =
      finishedNovel ||
      novelsRef.current.find((n) => n.id === mergedNovel.id) ||
      mergedNovel;

    const verifiedChapters = currentNovel.chapters
      .filter(
        (c) =>
          Boolean(c.verified) &&
          c.status !== 'quarantined' &&
          c.rusText.trim().length > 0
      )
      .sort(
        (a, b) =>
          a.number - b.number || (a.subPart || '').localeCompare(b.subPart || '')
      );
    const quarantinedCount = currentNovel.chapters.filter(
      (c) => c.status === 'quarantined'
    ).length;

    const readyForExport = verifiedChapters.map((c) => ({
      number: c.number,
      titleRus: c.titleRus || `Глава ${c.subPart || c.number}`,
      contentRus: c.rusText,
    }));

    const packages = buildRulateExportPackages(currentNovel.name, readyForExport, 20);
    const quarantineNotice =
      quarantinedCount > 0
        ? `, в карантине: ${quarantinedCount} гл. (исключены из выгрузки)`
        : '';

    if (packages.length === 1) {
      const pkg = packages[0];
      triggerBlobDownload(
        new Blob([pkg.content], { type: 'text/plain;charset=utf-8' }),
        pkg.filename
      );
      setAutopilotBanner(
        `Полный Автопилот завершён: склеено дробных глав (${mergedSplitCount}), проверено QA (${readyForExport.length} гл.)${quarantineNotice}, файл «${pkg.filename}» (строгий LF) выгружен.`
      );
    } else if (packages.length > 1) {
      const encoder = new TextEncoder();
      const zipBytes = createStoredZipArchive(
        packages.map((pkg) => ({
          path: pkg.filename,
          data: encoder.encode(pkg.content),
        }))
      );
      const zipCopy = new Uint8Array(zipBytes.byteLength);
      zipCopy.set(zipBytes);
      const zipFilename = `${sanitizeZipSlug(currentNovel.name)}_rulate_all_${packages.length}_volumes.zip`;
      triggerBlobDownload(
        new Blob([zipCopy.buffer], { type: 'application/zip' }),
        zipFilename
      );
      setAutopilotBanner(
        `Полный Автопилот завершён: склеено дробных глав (${mergedSplitCount}), проверено QA (${readyForExport.length} гл.)${quarantineNotice}, ${packages.length} томов упаковано в «${zipFilename}».`
      );
    } else {
      setAutopilotBanner(
        `Автопилот завершён: готовых проверенных глав нет (0 гл.)${quarantineNotice}.`
      );
    }
  };

  const handleSaveChapterFromEditor = (updated: ChapterRecord) => {
    const targetNovelId = activeNovel.id;
    skipNextAutosaveRef.current = true;
    updateActiveNovel((novel) => ({
      ...novel,
      chapters: novel.chapters.map((c) => (c.id === updated.id ? updated : c)),
    }));

    void patchChapterOnServer(
      targetNovelId,
      updated.id,
      updated,
      updated.revision
    ).then(async (res) => {
      if (res.conflict) {
        toast.warn(
          res.error ||
            'Глава была обновлена фоновой задачей на диске. Обновляем состояние студии...',
          'Конфликт ревизий'
        );
        await refreshProjectsFromServer();
        return;
      }
      if (res.ok && res.chapter) {
        const syncedChapter = res.chapter;
        skipNextAutosaveRef.current = true;
        setNovels((prev) =>
          prev.map((n) =>
            n.id === targetNovelId
              ? {
                  ...n,
                  chapters: n.chapters.map((c) =>
                    c.id === syncedChapter.id ? syncedChapter : c
                  ),
                }
              : n
          )
        );
        return;
      }
      // Browser-only / offline fallback: mirror updated novels into IndexedDB/localStorage
      await saveNovelsToStorage(novelsRef.current);
    });
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
    const finalGender: GrammaticalGender | undefined =
      finalCat === 'characters'
        ? gender || target.gender || 'UNKNOWN'
        : gender || target.gender;

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
            gender: t.category === 'characters' ? t.gender || 'UNKNOWN' : t.gender,
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
          gender: category === 'characters' ? gender || 'UNKNOWN' : gender,
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
          gender,
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
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Сбросить локальный кэш браузера и вернуть исходные демо-главы?'
      )
    ) {
      return;
    }
    clearNovelsStorage();
    setNovels(INITIAL_NOVELS);
    setActiveNovelId(INITIAL_NOVELS[0].id);
    setSelectedChapterId(INITIAL_NOVELS[0].chapters[3].id);
    toast.info('Демо-данные восстановлены');
  };

  if (authState === 'checking') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#0D0D0F] text-[#B8B4AC]">
        <div className="rounded-xl border border-[#F2EFE9]/[0.08] bg-[#141418] px-5 py-3 text-sm">
          Проверка доступа к студии...
        </div>
      </div>
    );
  }

  if (authState === 'locked') {
    return (
      <StudioAuthGate
        initialError={authCheckError}
        onAuthenticated={() => {
          setAuthCheckError(null);
          setAuthState('checking');
          setAuthNonce((n) => n + 1);
        }}
      />
    );
  }

  const engineStatusLabel =
    llmConfig.provider === 'colab_ollama'
      ? `Colab L4 · ${llmConfig.modelId}`
      : `AI Studio · ${llmConfig.modelId || 'gemini-4-hydrogen'}`;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#0D0D0F] text-[#F2EFE9]">
      <a
        href="#workspace-main"
        className="visually-hidden fixed left-3 top-3 z-50 rounded-lg bg-[#D69E36] px-4 py-2 text-sm font-semibold text-[#11100D] shadow-lg"
      >
        Перейти к рабочему пространству
      </a>

      {/* STICKY EDITORIAL WORKBENCH HEADER — ZERO DUPLICATE CTA, ZERO MONOGRAM BOX */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 sm:gap-8 px-3 sm:px-8 h-16 border-b border-[#F2EFE9]/[0.08] bg-[#0D0D0F]/92 backdrop-blur-md">
        <a
          href="#workspace-main"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('pipeline');
          }}
          className="inline-flex items-center whitespace-nowrap shrink-0 rounded-md text-lg font-bold tracking-[-0.03em] text-[#F2EFE9] hover:text-[#E3AE48] transition-colors"
        >
          Канон Сянься
        </a>

        <nav
          aria-label="Основная навигация"
          className="hidden md:flex items-center gap-7 text-sm font-medium h-full"
        >
          {[
            { id: 'pipeline' as StudioTab, label: 'Главы', badge: 0 },
            { id: 'editor' as StudioTab, label: 'Редактор', badge: 0 },
            {
              id: 'glossary' as StudioTab,
              label: 'Глоссарий',
              badge: kpiStats.scoutBufferCount,
            },
            { id: 'export' as StudioTab, label: 'Экспорт', badge: 0 },
          ].map((navItem) => {
            const isCurrent = activeTab === navItem.id;
            return (
              <button
                key={navItem.id}
                type="button"
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => setActiveTab(navItem.id)}
                className={`relative inline-flex items-center gap-1.5 h-full px-0.5 transition-colors whitespace-nowrap shrink-0 ${
                  isCurrent ? 'text-[#F2EFE9]' : 'text-[#8E8A82] hover:text-[#F2EFE9]'
                }`}
              >
                <span>{navItem.label}</span>
                {navItem.badge > 0 && (
                  <span className="text-[13px] font-semibold text-[#D69E36] tabular-nums">
                    +{navItem.badge}
                  </span>
                )}
                {isCurrent && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-[#D69E36]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            aria-label="Быстрый поиск главы или команды (Ctrl+K)"
            className="inline-flex items-center gap-2 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#141418] px-3 py-1.5 text-[13px] text-[#B8B4AC] transition-colors hover:border-[#F2EFE9]/[0.2] hover:text-[#F2EFE9]"
          >
            <Search className="h-3.5 w-3.5 text-[#8E8A82]" aria-hidden="true" />
            <span className="hidden sm:inline">Поиск</span>
            <kbd className="hidden xl:inline rounded border border-[#F2EFE9]/[0.1] bg-[#101014] px-1.5 py-0.5 font-mono text-[13px] leading-none text-[#8E8A82]">
              Ctrl+K
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setShowColabModal(true)}
            title={`Настроить модели (${engineStatusLabel})`}
            aria-label={`Настроить ИИ-движок: ${engineStatusLabel}`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap sm:max-w-[240px] ${
              llmConfig.provider === 'colab_ollama' && llmConfig.colabEndpointUrl?.trim()
                ? 'border-[#52C79A]/40 bg-[#52C79A]/10 text-[#6EE7B7] hover:bg-[#52C79A]/18'
                : 'border-[#F2EFE9]/[0.1] bg-[#141418] text-[#F2EFE9] hover:border-[#D69E36]/50'
            }`}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0 text-[#D69E36]" aria-hidden="true" />
            <span className="sm:hidden">
              {llmConfig.provider === 'colab_ollama' ? 'L4' : 'ИИ'}
            </span>
            <span className="hidden sm:inline truncate">{engineStatusLabel}</span>
          </button>

          <input
            ref={backupInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportProjectBackup}
            className="hidden"
          />

          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
              aria-label="Дополнительные действия проекта"
              onClick={() => setShowMoreMenu((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                showMoreMenu
                  ? 'border-[#D69E36]/50 bg-[#1B1B21] text-[#F2EFE9]'
                  : 'border-[#F2EFE9]/[0.1] bg-[#141418] text-[#B8B4AC] hover:border-[#F2EFE9]/[0.2] hover:text-[#F2EFE9]'
              }`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Ещё</span>
            </button>

            {showMoreMenu && (
              <div
                role="menu"
                aria-label="Дополнительные действия проекта"
                className="absolute right-0 top-full mt-2 z-40 w-64 rounded-xl border border-[#F2EFE9]/[0.12] bg-[#1B1B21] p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.78)] text-sm"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowAddNovelModal(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[#F2EFE9] hover:bg-[#F2EFE9]/[0.06] transition-colors"
                >
                  <FolderPlus className="h-4 w-4 text-[#D69E36]" aria-hidden="true" />
                  <span>Новая книга</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowLogDrawer((v) => !v);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[#F2EFE9] hover:bg-[#F2EFE9]/[0.06] transition-colors"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Terminal className="h-4 w-4 text-[#B8B4AC]" aria-hidden="true" />
                    <span>Журнал событий</span>
                  </span>
                  <span className="text-[13px] text-[#8E8A82] tabular-nums">
                    {logs.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setActiveTab('pipeline');
                    setForceOpenWizard(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[#F2EFE9] hover:bg-[#F2EFE9]/[0.06] transition-colors"
                >
                  <Sparkles className="h-4 w-4 text-[#D69E36]" aria-hidden="true" />
                  <span>Мастер запуска</span>
                </button>
                <div className="my-1.5 border-t border-[#F2EFE9]/[0.08]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleExportProjectBackup();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[#B8B4AC] hover:bg-[#F2EFE9]/[0.06] hover:text-[#F2EFE9] transition-colors"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Экспорт бэкапа (.json)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowMoreMenu(false);
                    backupInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[#B8B4AC] hover:bg-[#F2EFE9]/[0.06] hover:text-[#F2EFE9] transition-colors"
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span>Импорт бэкапа (.json)</span>
                </button>
                <div className="my-1.5 border-t border-[#F2EFE9]/[0.08]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleResetDemoData();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[#FDA4AF] hover:bg-[#F07587]/10 transition-colors"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span>Сбросить демо-данные</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <nav
        aria-label="Мобильная навигация"
        className="flex md:hidden items-center justify-between gap-1 overflow-x-auto studio-tablist border-b border-[#F2EFE9]/[0.08] bg-[#141418] px-3 py-2"
      >
        {[
          { id: 'pipeline' as StudioTab, label: 'Главы' },
          { id: 'editor' as StudioTab, label: 'Редактор' },
          {
            id: 'glossary' as StudioTab,
            label:
              kpiStats.scoutBufferCount > 0
                ? `Глоссарий +${kpiStats.scoutBufferCount}`
                : 'Глоссарий',
          },
          { id: 'export' as StudioTab, label: 'Экспорт' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={activeTab === item.id ? 'page' : undefined}
            onClick={() => setActiveTab(item.id)}
            className={`px-2.5 py-1.5 text-[13px] font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
              activeTab === item.id
                ? 'bg-[#D69E36] text-[#11100D] font-semibold'
                : 'text-[#B8B4AC] hover:text-[#F2EFE9]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* WORKSPACE MAIN */}
      <main
        id="workspace-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1320px] flex-1 px-4 sm:px-8 py-6 sm:py-8 space-y-6 focus:outline-none"
      >
        {/* Borderless Book Context Header — Hidden inside Editor so reading sheets own the viewport */}
        {activeTab !== 'editor' && (
          <section
            aria-label="Контекст произведения"
            className="pb-5 border-b border-[#F2EFE9]/[0.08] space-y-2.5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="w-full sm:w-auto sm:flex-1 min-w-0">
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
                  className="-ml-1.5 w-full sm:w-auto max-w-full truncate rounded-lg bg-transparent px-1.5 py-1 text-xl font-semibold tracking-[-0.025em] text-[#F2EFE9] hover:bg-[#F2EFE9]/[0.04] focus:outline-none focus:ring-2 focus:ring-[#D69E36] cursor-pointer"
                >
                  {novels.map((n) => (
                    <option key={n.id} value={n.id} className="bg-[#141418] text-[#F2EFE9] text-sm">
                      {n.rusTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setImportMode('bulk');
                    setShowAddChapterModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#141418] px-3 py-1.5 text-[13px] font-medium text-[#F2EFE9] hover:border-[#F2EFE9]/[0.22] transition-colors whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
                  <span>Загрузка глав</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowRulesModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#141418] px-3 py-1.5 text-[13px] font-medium text-[#B8B4AC] hover:border-[#F2EFE9]/[0.22] hover:text-[#F2EFE9] transition-colors whitespace-nowrap tabular-nums"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    Правила QA ({activeNovel.enabledRuleIds.length}/{ALL_LINT_RULES.length})
                  </span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-[#8E8A82] tabular-nums">
              <select
                id="genre-preset-select"
                aria-label="Жанровый профиль перевода"
                value={activeNovel.genrePreset}
                onChange={(e) => handleGenrePresetChange(e.target.value as GenrePreset)}
                className="-ml-1 rounded bg-transparent px-1 py-0.5 text-[13px] text-[#B8B4AC] hover:text-[#F2EFE9] focus:outline-none focus:ring-2 focus:ring-[#D69E36] cursor-pointer"
              >
                {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
                  <option key={g} value={g} className="bg-[#141418] text-[#F2EFE9]">
                    {GENRE_PRESET_LABELS[g].title}
                  </option>
                ))}
              </select>

              <span aria-hidden="true">·</span>

              <select
                id="prose-tone-select"
                aria-label="Тональность литературного критика"
                value={activeNovel.proseTone}
                onChange={(e) => handleProseToneChange(e.target.value as ProseTone)}
                className="rounded bg-transparent px-1 py-0.5 text-[13px] text-[#B8B4AC] hover:text-[#F2EFE9] focus:outline-none focus:ring-2 focus:ring-[#D69E36] cursor-pointer"
              >
                {(Object.keys(PROSE_TONE_LABELS) as ProseTone[]).map((tone) => (
                  <option key={tone} value={tone} className="bg-[#141418] text-[#F2EFE9]">
                    Тон: {PROSE_TONE_LABELS[tone].title}
                  </option>
                ))}
              </select>

              <span aria-hidden="true">·</span>
              <span>
                Переведено{' '}
                <strong className="font-medium text-[#F2EFE9]">
                  {kpiStats.translatedCount}/{kpiStats.total}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                QA <strong className="font-medium text-[#6EE7B7]">{kpiStats.verifiedCount} гл.</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Канон <strong className="font-medium text-[#F2EFE9]">{kpiStats.canonCount}</strong>
              </span>
              {kpiStats.scoutBufferCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('glossary')}
                    className="font-medium text-[#E3AE48] hover:underline underline-offset-4"
                  >
                    +{kpiStats.scoutBufferCount} в скауте →
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {/* Collapsible Live Log Drawer */}
        {showLogDrawer && (
          <div className="rounded-xl border border-[#F2EFE9]/[0.09] bg-[#141418] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#F2EFE9]">
                Журнал событий конвейера
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  className="text-[13px] text-[#8E8A82] hover:text-[#F2EFE9] transition-colors"
                >
                  Очистить
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogDrawer(false)}
                  aria-label="Закрыть журнал"
                  className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-lg text-[#8E8A82] hover:bg-[#F2EFE9]/[0.06] hover:text-[#F2EFE9] transition-colors"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="max-h-44 overflow-y-auto studio-scroll rounded-lg border border-[#F2EFE9]/[0.07] bg-[#101014] p-3.5 font-mono text-[13px] leading-relaxed space-y-1.5">
              {logs.length === 0 ? (
                <div className="text-[#8E8A82]">Журнал пуст</div>
              ) : (
                logs.map((entry) => (
                  <div key={entry.id}>
                    <span className="text-[#8E8A82] tabular-nums">[{entry.timestamp}]</span>{' '}
                    <span className="text-[#D69E36] font-medium">{entry.phase}:</span>{' '}
                    <span className="text-[#B8B4AC]">{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'pipeline' && (
          <div className="space-y-6">
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
              forceOpen={forceOpenWizard}
              onCloseForceOpen={() => setForceOpenWizard(false)}
            />

            {/* Single-Focal Batch Pipeline Bar — 1 Primary Brass CTA */}
            <section
              aria-label="Управление пакетным конвейером"
              className="flex flex-wrap items-center justify-between gap-3.5 rounded-xl border border-[#F2EFE9]/[0.08] bg-[#141418] px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-3 min-w-0">
                <div className="flex items-center gap-2 text-[13px] tabular-nums shrink-0">
                  <label htmlFor="start-ch-input" className="text-[#B8B4AC]">
                    Главы
                  </label>
                  <input
                    id="start-ch-input"
                    aria-label="Начальная глава"
                    type="number"
                    min={1}
                    value={startChapter}
                    onChange={(e) => setStartChapter(Number(e.target.value))}
                    className="w-16 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] px-2.5 py-1.5 text-center text-sm tabular-nums text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
                  />
                  <span className="text-[#8E8A82]" aria-hidden="true">–</span>
                  <input
                    id="end-ch-input"
                    aria-label="Конечная глава"
                    type="number"
                    min={startChapter}
                    value={endChapter}
                    onChange={(e) => setEndChapter(Number(e.target.value))}
                    className="w-16 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] px-2.5 py-1.5 text-center text-sm tabular-nums text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
                  />
                </div>

                <select
                  id="pipeline-mode-select"
                  aria-label="Режим конвейера"
                  value={pipelineMode}
                  onChange={(e) => setPipelineMode(e.target.value as PipelineMode)}
                  className="rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] px-3 py-1.5 text-[13px] text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
                >
                  <option value="full_5_phase">Полный цикл (5 фаз)</option>
                  <option value="scout_only">Только скаутинг терминов</option>
                  <option value="verify_and_repair">Только проверка и ремонт QA</option>
                </select>

                <div className="hidden lg:flex items-center gap-4 text-[13px] text-[#B8B4AC] border-l border-[#F2EFE9]/[0.08] pl-3.5 whitespace-nowrap">
                  <label className="inline-flex items-center gap-2 hover:text-[#F2EFE9] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoCanonEnabled}
                      onChange={(e) => setAutoCanonEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-[#F2EFE9]/[0.2] bg-[#101014]"
                    />
                    <span>Авто-канон</span>
                  </label>
                  <label className="inline-flex items-center gap-2 hover:text-[#F2EFE9] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={twoPassCriticEnabled}
                      onChange={(e) => setTwoPassCriticEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-[#F2EFE9]/[0.2] bg-[#101014]"
                    />
                    <span>2 прохода и стилист</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto min-w-0">
                <button
                  type="button"
                  disabled={isRunningPipeline}
                  onClick={() => handleTranslateNextBatch(3)}
                  title="Найти следующие 3 непереведённые главы и запустить конвейер"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#1B1B21] px-3 py-2 text-[13px] font-medium text-[#F2EFE9] hover:border-[#F2EFE9]/[0.22] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <Zap className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
                  <span>След. 3 гл.</span>
                </button>

                <div className="relative" ref={runModesRef}>
                  <button
                    type="button"
                    disabled={isRunningPipeline}
                    aria-haspopup="menu"
                    aria-expanded={showRunModesMenu}
                    onClick={() => setShowRunModesMenu((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#1B1B21] px-3 py-2 text-[13px] font-medium text-[#B8B4AC] hover:border-[#F2EFE9]/[0.22] hover:text-[#F2EFE9] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <span>Режимы</span>
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>

                  {showRunModesMenu && (
                    <div
                      role="menu"
                      aria-label="Специальные режимы запуска"
                      className="absolute right-0 top-full mt-2 z-40 w-72 rounded-xl border border-[#F2EFE9]/[0.12] bg-[#1B1B21] p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.78)]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowRunModesMenu(false);
                          handleOpenGlossaryStopGate();
                        }}
                        className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-[#F2EFE9]/[0.06] transition-colors"
                      >
                        <ShieldCheck
                          className="h-4 w-4 text-[#D69E36] shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <span className="space-y-0.5">
                          <span className="block text-sm font-medium text-[#F2EFE9]">
                            Стоп-кран глоссария
                          </span>
                          <span className="block text-[13px] text-[#8E8A82]">
                            Проверить новые имена и род (М/Ж) до перевода
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowRunModesMenu(false);
                          handleRunFullAutopilotRelease();
                        }}
                        className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-[#F2EFE9]/[0.06] transition-colors"
                      >
                        <Zap
                          className="h-4 w-4 text-[#D69E36] shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <span className="space-y-0.5">
                          <span className="block text-sm font-medium text-[#F2EFE9]">
                            Полный автопилот в релиз
                          </span>
                          <span className="block text-[13px] text-[#8E8A82]">
                            Склейка, пре-скаут, перевод, QA и выгрузка Rulate
                          </span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={isRunningPipeline}
                  onClick={handleStartRangePipeline}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#D69E36] px-4 py-2 text-sm font-semibold text-[#11100D] hover:bg-[#E3AE48] disabled:opacity-50 transition-colors whitespace-nowrap tabular-nums"
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  <span>
                    {isRunningPipeline
                      ? `Выполнение (${activePhaseStep}/5)...`
                      : `Запустить главы ${startChapter}–${endChapter}`}
                  </span>
                </button>

                {isRunningPipeline && (
                  <button
                    type="button"
                    onClick={() => {
                      abortRef.current = true;
                      if (activeJob?.id) {
                        fetch(`/api/jobs?jobId=${encodeURIComponent(activeJob.id)}`, {
                          method: 'DELETE',
                        }).catch(() => {});
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#F07587]/40 bg-[#F07587]/12 px-3 py-2 text-[13px] font-semibold text-[#FDA4AF] hover:bg-[#F07587]/22 transition-colors"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span>Стоп</span>
                  </button>
                )}
              </div>
            </section>

            {/* Active Background Job SSE Status Strip */}
            {activeJob && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D69E36]/35 bg-[#141418] px-4 py-3 text-[13px] text-[#F2EFE9] tabular-nums">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-medium text-[#E3AE48]">Задача {activeJob.id}</span>
                  <span aria-hidden="true" className="text-[#8E8A82]">·</span>
                  <span className="text-[#B8B4AC]">
                    Главы: {activeJob.completedChapters}/{activeJob.totalChapters} ({activeJob.progressPct}%)
                  </span>
                  {activeJob.currentChapter !== null && (
                    <span className="text-[#8E8A82]">
                      · Гл. {activeJob.currentChapter}
                    </span>
                  )}
                  {activeJob.quarantinedChapters > 0 && (
                    <span className="font-medium text-[#FDA4AF]">
                      · Карантин: {activeJob.quarantinedChapters}
                    </span>
                  )}
                </div>
                <span className="text-[#B8B4AC]">
                  Поток SSE: {activeJob.status}
                </span>
              </div>
            )}

            {/* Autopilot Completion Banner */}
            {autopilotBanner && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#52C79A]/35 bg-[#141418] px-4 py-3 text-[13px] text-[#F2EFE9]">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 text-[#6EE7B7] shrink-0" aria-hidden="true" />
                  <span>{autopilotBanner}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAutopilotBanner(null)}
                  className="text-[#B8B4AC] hover:text-[#F2EFE9] shrink-0 transition-colors"
                >
                  Скрыть
                </button>
              </div>
            )}

            {/* PRIMARY WORKSPACE: Editorial Chapter Table */}
            <section aria-label="Список глав произведения" className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-[#F2EFE9]/[0.08] pb-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-5">
                  {[
                    {
                      id: 'all' as ChapterFilter,
                      label: `Все (${activeNovel.chapters.length})`,
                      alertBadge: 0,
                    },
                    {
                      id: 'verified' as ChapterFilter,
                      label: `Проверены (${kpiStats.verifiedCount})`,
                      alertBadge: 0,
                    },
                    {
                      id: 'needs_qa' as ChapterFilter,
                      label: `Правка (${kpiStats.needsQaCount})`,
                      alertBadge: 0,
                    },
                    {
                      id: 'untranslated' as ChapterFilter,
                      label: `Без перевода (${kpiStats.untranslatedCount})`,
                      alertBadge: 0,
                    },
                    {
                      id: 'quarantined' as ChapterFilter,
                      label: 'Карантин',
                      alertBadge: kpiStats.quarantinedCount,
                    },
                  ].map((tab) => {
                    const isActive = chapterFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setChapterFilter(tab.id)}
                        className={`relative inline-flex items-center gap-1.5 pb-1.5 sm:pb-2.5 sm:-mb-[11px] text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums border-b-2 ${
                          isActive
                            ? 'border-[#D69E36] text-[#F2EFE9]'
                            : 'border-transparent text-[#8E8A82] hover:text-[#F2EFE9]'
                        }`}
                      >
                        <span>{tab.label}</span>
                        {tab.alertBadge > 0 && (
                          <span className="font-semibold text-[#FDA4AF]">
                            {tab.alertBadge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="relative w-full sm:w-64 mb-0.5">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8E8A82]"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    aria-label="Фильтр глав по номеру или названию"
                    value={chapterSearch}
                    onChange={(e) => setChapterSearch(e.target.value)}
                    placeholder="Фильтр по № или названию..."
                    className="w-full rounded-lg border border-[#F2EFE9]/[0.1] bg-[#141418] pl-9 pr-3 py-1.5 text-sm text-[#F2EFE9] placeholder:text-[#8E8A82] focus:border-[#D69E36] focus:outline-none"
                  />
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#F2EFE9]/[0.08] bg-[#141418]">
                <table className="w-full text-left text-[13px] tabular-nums">
                  <caption className="visually-hidden">
                    Список глав произведения {activeNovel.rusTitle}
                  </caption>
                  <thead className="border-b border-[#F2EFE9]/[0.08] bg-[#101014] text-[13px] text-[#8E8A82]">
                    <tr>
                      <th scope="col" className="w-11 px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label="Выбрать все отображаемые главы"
                          checked={allFilteredSelected}
                          onChange={handleToggleSelectAllFiltered}
                          className="h-4 w-4 rounded border-[#F2EFE9]/[0.2] bg-[#101014] cursor-pointer"
                        />
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium w-14">
                        №
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Глава
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium text-right">
                        Слов
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium text-right">
                        Готовность
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium text-right">
                        Действие
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2EFE9]/[0.06]">
                    {filteredChapters.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center">
                          <div className="mx-auto max-w-sm space-y-2.5">
                            <FileText
                              className="mx-auto h-6 w-6 text-[#8E8A82]"
                              aria-hidden="true"
                            />
                            <p className="text-sm font-medium text-[#F2EFE9]">
                              Главы по выбранному фильтру не найдены
                            </p>
                            <p className="text-[13px] text-[#8E8A82]">
                              {chapterSearch
                                ? `По запросу «${chapterSearch}» ничего не нашлось.`
                                : 'В текущей категории пока нет глав.'}
                            </p>
                            {(chapterFilter !== 'all' || chapterSearch.trim().length > 0) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setChapterFilter('all');
                                  setChapterSearch('');
                                }}
                                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.12] bg-[#1B1B21] px-3.5 py-1.5 text-[13px] font-medium text-[#F2EFE9] hover:border-[#D69E36]/50 transition-colors"
                              >
                                Сбросить фильтры
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredChapters.map(({ chapter: ch, report }) => {
                        const isRowSelected = selectedChapterIds.includes(ch.id);
                        const isQuarantined = ch.status === 'quarantined';
                        const isThisChapterRunning = isRunningPipeline && runningChapterId === ch.id;
                        const progress = computeChapterPipelineProgress(
                          ch,
                          report,
                          activePhaseStep,
                          isThisChapterRunning
                        );

                        const fillBarClass = isQuarantined
                          ? 'bg-[#F07587]'
                          : progress.state === 'verified'
                            ? 'bg-[#52C79A]'
                            : progress.state === 'running' || progress.state === 'qa_attention'
                              ? 'bg-[#D69E36]'
                              : progress.state === 'scouted'
                                ? 'bg-[#8E8A82]'
                                : 'bg-transparent';

                        const pctTextClass = isQuarantined
                          ? 'text-[#FDA4AF]'
                          : progress.state === 'verified'
                            ? 'text-[#6EE7B7]'
                            : progress.state === 'running' || progress.state === 'qa_attention'
                              ? 'text-[#E3AE48]'
                              : 'text-[#8E8A82]';

                        const issueCount = report ? report.errorCount + report.warningCount : 0;
                        const statusSubLabel = isThisChapterRunning
                          ? `Фаза ${activePhaseStep}/5`
                          : isQuarantined
                            ? 'Карантин'
                            : ch.verified
                              ? 'Проверено QA'
                              : ch.translated
                                ? issueCount > 0
                                  ? `QA: ${issueCount} замеч.`
                                  : 'Черновик'
                                : ch.scouted
                                  ? 'Скаут'
                                  : 'В очереди';

                        const pacingSample = ch.pacingMode ? '' : ch.rusText || ch.engText;
                        const pacingKey =
                          ch.pacingMode || !pacingSample
                            ? ''
                            : `${ch.id}:${pacingSample.length}:${fastHash32(pacingSample)}`;
                        const pacingMode =
                          ch.pacingMode || (pacingKey ? computedPacingMap[pacingKey] : null);

                        const pacingLabel = !pacingMode
                          ? ''
                          : pacingMode === 'combat_action'
                            ? 'Бой'
                            : pacingMode === 'cultivation_epiphany'
                              ? 'Озарение'
                              : pacingMode === 'comedy_banter'
                                ? 'Пикировка'
                                : pacingMode === 'solemn_pathos'
                                  ? 'Пафос'
                                  : 'Диалог';

                        const subtitleText = ch.summary || (ch.titleRus ? ch.titleEng : '');

                        return (
                          <tr
                            key={ch.id}
                            className={`group transition-colors ${
                              isRowSelected
                                ? 'bg-[#D69E36]/[0.08] hover:bg-[#D69E36]/[0.12]'
                                : isQuarantined
                                  ? 'bg-[#F07587]/[0.05] hover:bg-[#F07587]/[0.08]'
                                  : 'hover:bg-[#F2EFE9]/[0.025]'
                            }`}
                          >
                            <td className="w-11 px-3 py-4 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Выбрать главу ${ch.subPart || ch.number}`}
                                checked={isRowSelected}
                                onChange={() => handleToggleSelectChapter(ch.id)}
                                className="h-4 w-4 rounded border-[#F2EFE9]/[0.2] bg-[#101014] cursor-pointer"
                              />
                            </td>
                            <td className="px-4 py-4 tabular-nums text-[#8E8A82] whitespace-nowrap">
                              {ch.subPart || ch.number}
                            </td>
                            <td className="px-4 py-4">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedChapterId(ch.id);
                                  setActiveTab('editor');
                                }}
                                className="text-left font-medium text-sm text-[#F2EFE9] hover:text-[#E3AE48] transition-colors"
                              >
                                {ch.titleRus || ch.titleEng}
                              </button>
                              {isQuarantined && ch.quarantineReason && (
                                <div className="text-[13px] text-[#FDA4AF] mt-1">
                                  Причина: {ch.quarantineReason}
                                </div>
                              )}
                              {(subtitleText || pacingLabel) && (
                                <div className="text-[13px] text-[#8E8A82] mt-0.5 line-clamp-1">
                                  {pacingLabel && (
                                    <span className="text-[#B8B4AC]">{pacingLabel}</span>
                                  )}
                                  {pacingLabel && subtitleText ? ' · ' : ''}
                                  {subtitleText}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4 text-right tabular-nums text-[#8E8A82] whitespace-nowrap">
                              {ch.translated ? `${ch.wordCountRus}` : `${ch.wordCountEng} ENG`}
                            </td>
                            <td className="px-4 py-4 text-right whitespace-nowrap">
                              <div
                                title={progress.tooltip}
                                className="inline-flex flex-col items-end gap-1 min-w-[144px]"
                              >
                                <div className="flex items-center justify-end gap-2">
                                  <div
                                    role="progressbar"
                                    aria-label={`Прогресс конвейера главы ${ch.subPart || ch.number}: ${progress.percent}%`}
                                    aria-valuenow={progress.percent}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    className="relative h-1.5 w-24 overflow-hidden rounded-[2px] bg-[#F2EFE9]/[0.08]"
                                  >
                                    <div
                                      className={`h-full rounded-[2px] transition-[width] duration-300 ${fillBarClass}`}
                                      style={{ width: `${progress.percent}%` }}
                                    />
                                    <div className="pointer-events-none absolute inset-0 grid grid-cols-5 divide-x divide-[#0D0D0F]/80">
                                      <span />
                                      <span />
                                      <span />
                                      <span />
                                      <span />
                                    </div>
                                  </div>
                                  <span
                                    className={`w-10 text-right text-[13px] tabular-nums ${pctTextClass}`}
                                  >
                                    {progress.percent}%
                                  </span>
                                </div>
                                <span
                                  className={`inline-flex items-center gap-1 text-[13px] ${pctTextClass}`}
                                >
                                  {isQuarantined && (
                                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                  <span>{statusSubLabel}</span>
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {isQuarantined ? (
                                  <button
                                    type="button"
                                    disabled={isRunningPipeline}
                                    onClick={() =>
                                      executePipelineOnChapters([ch], 'full_5_phase')
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg border border-[#F07587]/40 bg-[#F07587]/12 px-2.5 py-1.5 text-[13px] font-medium text-[#FDA4AF] hover:bg-[#F07587]/22 disabled:opacity-50 transition-colors"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Повторить</span>
                                  </button>
                                ) : !ch.translated ? (
                                  <button
                                    type="button"
                                    disabled={isRunningPipeline}
                                    onClick={() =>
                                      executePipelineOnChapters([ch], 'full_5_phase')
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#1B1B21] px-2.5 py-1.5 text-[13px] font-medium text-[#F2EFE9] hover:border-[#D69E36]/50 disabled:opacity-50 transition-colors"
                                  >
                                    <Sparkles className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
                                    <span>Перевести</span>
                                  </button>
                                ) : !report?.passed ? (
                                  <button
                                    type="button"
                                    disabled={isRunningPipeline}
                                    onClick={() =>
                                      executePipelineOnChapters([ch], 'verify_and_repair')
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg border border-[#F2EFE9]/[0.1] bg-[#1B1B21] px-2.5 py-1.5 text-[13px] font-medium text-[#F2EFE9] hover:border-[#D69E36]/50 disabled:opacity-50 transition-colors"
                                  >
                                    <Wand2 className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
                                    <span>Ремонт QA</span>
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  aria-label={`Открыть главу ${ch.subPart || ch.number} в редакторе`}
                                  onClick={() => {
                                    setSelectedChapterId(ch.id);
                                    setActiveTab('editor');
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[#B8B4AC] hover:bg-[#F2EFE9]/[0.06] hover:text-[#F2EFE9] transition-colors"
                                >
                                  <span>Открыть</span>
                                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Hero State Passport (Flat Horizontal Strip) & Analytics */}
              <div className="pt-4 space-y-6">
                {activeNovel.heroLedger && (
                  <div className="flex flex-wrap items-baseline justify-between gap-3 border-y border-[#F2EFE9]/[0.08] py-3.5 text-[13px] text-[#8E8A82] tabular-nums">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium text-[#B8B4AC]">
                        Паспорт героя (Гл. {activeNovel.heroLedger.lastUpdatedChapter})
                      </span>
                      <strong className="font-semibold text-[#F2EFE9]">
                        {activeNovel.heroLedger.protagonistName}
                      </strong>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#B8B4AC]">
                        {activeNovel.heroLedger.cultivationRealm}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{activeNovel.heroLedger.resources.join(' · ')}</span>
                    </div>
                    <span className="text-[#B8B4AC]">
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

              {/* Floating Bulk Action Bar */}
              {selectedChapterObjects.length > 0 && (
                <div
                  role="region"
                  aria-label="Плавающая панель групповых действий"
                  className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex flex-wrap sm:flex-nowrap w-max max-w-[95vw] items-center gap-2.5 rounded-xl border border-[#F2EFE9]/[0.14] bg-[#1B1B21]/95 px-4 py-3 shadow-[0_20px_48px_rgba(0,0,0,0.82)] backdrop-blur-md"
                >
                  <div className="flex items-center gap-3 pr-3 border-r border-[#F2EFE9]/[0.08] tabular-nums">
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-[#D69E36] px-1.5 text-[13px] font-bold text-[#11100D]">
                      {selectedChapterObjects.length}
                    </span>
                    <div className="text-[13px]">
                      <div className="font-semibold text-[#F2EFE9]">
                        Выбрано: {selectedChapterObjects.length}
                      </div>
                      <div className="text-[#B8B4AC]">
                        №{' '}
                        {selectedChapterObjects
                          .slice(0, 6)
                          .map((c) => c.subPart || c.number)
                          .join(', ')}
                        {selectedChapterObjects.length > 6
                          ? ` и ещё ${selectedChapterObjects.length - 6}`
                          : ''}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isRunningPipeline}
                    onClick={() => handleRunBulkSelectedPipeline('verify_and_repair')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.12] bg-[#141418] px-3 py-1.5 text-[13px] font-medium text-[#F2EFE9] hover:border-[#52C79A]/50 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <Wand2 className="h-3.5 w-3.5 text-[#6EE7B7]" aria-hidden="true" />
                    <span>Ремонт QA</span>
                  </button>

                  <button
                    type="button"
                    disabled={isRunningPipeline}
                    onClick={() => handleRunBulkSelectedPipeline('scout_only')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.12] bg-[#141418] px-3 py-1.5 text-[13px] font-medium text-[#F2EFE9] hover:border-[#F2EFE9]/[0.25] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <Search className="h-3.5 w-3.5 text-[#B8B4AC]" aria-hidden="true" />
                    <span>Скаутинг</span>
                  </button>

                  <button
                    type="button"
                    disabled={isRunningPipeline}
                    onClick={() => handleRunBulkSelectedPipeline('full_5_phase')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#D69E36] px-3.5 py-1.5 text-[13px] font-semibold text-[#11100D] hover:bg-[#E3AE48] disabled:opacity-50 transition-colors whitespace-nowrap tabular-nums"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span>Полный цикл ({selectedChapterObjects.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedChapterIds([])}
                    aria-label="Снять выделение глав"
                    className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] px-2 text-[#B8B4AC] hover:text-[#F2EFE9] transition-colors"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
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

      <LinterProfileModal
        isOpen={showRulesModal}
        onClose={() => setShowRulesModal(false)}
        activeNovel={activeNovel}
        onGenrePresetChange={handleGenrePresetChange}
        onToggleRuleId={handleToggleRuleId}
      />

      <BulkImportModal
        isOpen={showAddChapterModal}
        onClose={() => setShowAddChapterModal(false)}
        importMode={importMode}
        setImportMode={setImportMode}
        uploadedFileCount={uploadedFileCount}
        sanitizedRemovedCount={sanitizedRemovedCount}
        handleFileUploadBatch={handleFileUploadBatch}
        sanitizeOnImport={sanitizeOnImport}
        setSanitizeOnImport={setSanitizeOnImport}
        bulkRawText={bulkRawText}
        setBulkRawText={setBulkRawText}
        newChNum={newChNum}
        setNewChNum={setNewChNum}
        newChTitleEng={newChTitleEng}
        setNewChTitleEng={setNewChTitleEng}
        newChEngText={newChEngText}
        setNewChEngText={setNewChEngText}
        onSubmit={handleCreateOrBulkImportChapters}
      />

      <NewNovelModal
        isOpen={showAddNovelModal}
        onClose={() => setShowAddNovelModal(false)}
        newNovelName={newNovelName}
        setNewNovelName={setNewNovelName}
        newNovelRusTitle={newNovelRusTitle}
        setNewNovelRusTitle={setNewNovelRusTitle}
        newNovelGenre={newNovelGenre}
        setNewNovelGenre={setNewNovelGenre}
        onSubmit={handleCreateNewNovel}
      />

      <LlmEngineModal
        isOpen={showColabModal}
        onClose={() => setShowColabModal(false)}
        llmConfig={llmConfig}
        setLlmConfig={setLlmConfig}
        colabPingState={colabPingState}
        onPingColab={handlePingColabServer}
        onExportColabDriveBundle={handleExportColabDriveBundle}
        driveBundleInputRef={driveBundleInputRef}
        onImportColabDriveBundle={handleImportColabDriveBundle}
      />

      <GlossaryStopGateModal
        isOpen={showStopGateModal}
        onClose={() => setShowStopGateModal(false)}
        startChapter={startChapter}
        endChapter={endChapter}
        canonCount={kpiStats.canonCount}
        stopGateTerms={stopGateTerms}
        setStopGateTerms={setStopGateTerms}
        onApproveAndTranslate={handleApproveStopGateAndTranslate}
      />

      <CommandPaletteModal
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        chapters={activeNovel.chapters}
        activeTab={activeTab}
        onNavigateTab={(tab) => setActiveTab(tab)}
        onSelectChapter={(id) => setSelectedChapterId(id)}
        onOpenLlmSettings={() => setShowColabModal(true)}
        onOpenRules={() => setShowRulesModal(true)}
        onOpenImport={() => {
          setImportMode('bulk');
          setShowAddChapterModal(true);
        }}
        onOpenNewNovel={() => setShowAddNovelModal(true)}
        onToggleLogs={() => setShowLogDrawer((v) => !v)}
        onTranslateNext3={() => handleTranslateNextBatch(3)}
        isRunningPipeline={isRunningPipeline}
      />
    </div>
  );
}
