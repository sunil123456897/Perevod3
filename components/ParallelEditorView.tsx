'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Sparkles,
  BookOpen,
  Eye,
  Save,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  History,
  Columns2,
  Radar,
  GitCompare,
  Undo2,
  Clock,
  Maximize2,
  Minimize2,
  Type,
  BookmarkPlus,
} from 'lucide-react';
import { useToast } from './ToastProvider';
import EditorInspectorPanels from './editor/EditorInspectorPanels';
import EditorModes from './editor/EditorModes';
import {
  runQaLinter,
  generateChapterMemorySummary,
  alignChapterParagraphs,
  detectTautologies,
  computeWordDiff,
} from '@/lib/qa-linter';
import { finalizeAndVerifyChapter } from '@/lib/chapter-verifier';
import {
  generateBilingualChapterSummary,
  buildDelTAContextPacket,
  extractCsiCulturalNotes,
  evaluateDitingQuality,
} from '@/lib/delta-diting';
import type {
  ChapterQaSummary,
  CanonicalGlossary,
  GlossaryTermMeta,
  LintRuleId,
  GenrePreset,
  ProseTone,
  ScoutedTerm,
  LlmProviderConfig,
} from '@/lib/pipeline-types';
import type { ChapterRecord, ChapterVersionSnapshot } from '@/lib/seed-data';

interface ParallelEditorViewProps {
  chapter: ChapterRecord;
  allChapters: ChapterRecord[];
  onSelectChapter: (chapterId: string) => void;
  glossary: CanonicalGlossary;
  glossaryMeta: Record<string, GlossaryTermMeta>;
  enabledRuleIds: LintRuleId[];
  genrePreset: GenrePreset;
  proseTone: ProseTone;
  scoutedTerms: ScoutedTerm[];
  styleGuideMd: string;
  contextMd: string;
  onUpdateStyleAndContext: (styleMd: string, contextMd: string) => void;
  onSaveChapter: (updated: ChapterRecord) => void;
  onRunSingleChapterPipeline: (chapterId: string) => Promise<void>;
  isPipelineBusy: boolean;
  llmConfig?: LlmProviderConfig;
  onAddCanonTerm?: (category: keyof CanonicalGlossary, eng: string, rus: string) => void;
  onApplyCanonRipple?: (
    oldRusTerm: string,
    newRusTerm: string,
    targetEngKey?: string
  ) => number | void;
}

export default function ParallelEditorView({
  chapter,
  allChapters,
  onSelectChapter,
  glossary,
  glossaryMeta,
  enabledRuleIds,
  genrePreset,
  proseTone,
  scoutedTerms,
  styleGuideMd,
  contextMd,
  onUpdateStyleAndContext,
  onSaveChapter,
  onRunSingleChapterPipeline,
  isPipelineBusy,
  llmConfig,
  onAddCanonTerm,
  onApplyCanonRipple,
}: ParallelEditorViewProps) {
  const [syncedChapterId, setSyncedChapterId] = useState(chapter.id);
  const [syncedParentRus, setSyncedParentRus] = useState(chapter.rusText);
  const [draftTitleRus, setDraftTitleRus] = useState(chapter.titleRus);
  const [draftEng, setDraftEng] = useState(chapter.engText);
  const [draftRus, setDraftRus] = useState(chapter.rusText);
  const [debouncedDraftTitleRus, setDebouncedDraftTitleRus] = useState(chapter.titleRus);
  const [debouncedDraftEng, setDebouncedDraftEng] = useState(chapter.engText);
  const [debouncedDraftRus, setDebouncedDraftRus] = useState(chapter.rusText);
  const [draftSummary, setDraftSummary] = useState(chapter.summary || '');
  const [highlightTerms, setHighlightTerms] = useState(false);
  const [editorMode, setEditorMode] = useState<'split' | 'aligned_1to1' | 'inline_diff'>(
    'split'
  );
  const [showContextDrawer, setShowContextDrawer] = useState(false);
  const [showMemoryBar, setShowMemoryBar] = useState(false);
  const [showCsiDitingPanel, setShowCsiDitingPanel] = useState(false);
  const [showVersionHistoryPanel, setShowVersionHistoryPanel] = useState(false);
  const [comparedVersionLabel, setComparedVersionLabel] = useState<string | null>(null);
  const [showIssuesPanel, setShowIssuesPanel] = useState(false);
  const [showTautologyPanel, setShowTautologyPanel] = useState(false);
  const [editStyleMd, setEditStyleMd] = useState(styleGuideMd);
  const [editContextMd, setEditContextMd] = useState(contextMd);
  const [repairNotice, setRepairNotice] = useState<string>('');
  const [isAiRepairing, setIsAiRepairing] = useState(false);
  const [lastPreRepairSnapshot, setLastPreRepairSnapshot] = useState<string | null>(null);

  // Quick Canon Term Modal & Canon Ripple (Ctrl+Shift+M)
  const [showQuickTermModal, setShowQuickTermModal] = useState(false);
  const [quickTermEng, setQuickTermEng] = useState('');
  const [quickTermRus, setQuickTermRus] = useState('');
  const [quickTermOldRus, setQuickTermOldRus] = useState('');
  const [quickTermCategory, setQuickTermCategory] = useState<keyof CanonicalGlossary>('system_and_terms');
  const [quickTermRipple, setQuickTermRipple] = useState(true);

  const toast = useToast();
  const handleManualSaveRef = useRef<() => void>(() => {});

  // Typography Preferences
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>('base');
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans' | 'mono'>('serif');
  const [lineHeight, setLineHeight] = useState<'normal' | 'relaxed' | 'loose'>('relaxed');
  const [columnWidth, setColumnWidth] = useState<'prose' | 'full'>('prose');
  const [showTypoMenu, setShowTypoMenu] = useState(false);

  // Zen / Focus Fullscreen Mode
  const [isZenMode, setIsZenMode] = useState(false);

  // Floating Selection Action Pill
  const [selectedTextSnippet, setSelectedTextSnippet] = useState<{
    text: string;
    isEnglish: boolean;
  } | null>(null);

  // Stylist View Mode
  const [stylistViewMode, setStylistViewMode] = useState<'final' | 'pre_stylist' | 'stylist_diff'>('final');

  const flatGlossaryPairs = useMemo(() => {
    const pairs: Array<{
      eng: string;
      rus: string;
      category: string;
      gender?: string;
      voiceNote?: string;
    }> = [];
    Object.entries(glossary).forEach(([cat, entries]) => {
      Object.entries((entries as Record<string, string>) || {}).forEach(([eng, rus]) => {
        pairs.push({
          eng,
          rus,
          category: cat,
          gender: glossaryMeta?.[eng]?.gender,
          voiceNote: glossaryMeta?.[eng]?.voiceNote,
        });
      });
    });
    return pairs.sort((a, b) => b.eng.length - a.eng.length);
  }, [glossary, glossaryMeta]);

  const openQuickTermFromSelection = useCallback(
    (selRaw: string) => {
      const sel = selRaw.trim();
      if (!sel) {
        setQuickTermOldRus('');
        setShowQuickTermModal(true);
        return;
      }
      const lowerSel = sel.toLowerCase();
      const matched = flatGlossaryPairs.find(
        (p) => p.eng.toLowerCase() === lowerSel || p.rus.toLowerCase() === lowerSel
      );
      if (matched) {
        setQuickTermEng(matched.eng);
        setQuickTermRus(matched.rus);
        setQuickTermOldRus(matched.rus);
        if (
          matched.category === 'characters' ||
          matched.category === 'realms' ||
          matched.category === 'sects_and_places' ||
          matched.category === 'system_and_terms' ||
          matched.category === 'units'
        ) {
          setQuickTermCategory(matched.category);
        }
      } else if (/[a-zA-Z]/.test(sel)) {
        setQuickTermEng(sel);
        setQuickTermRus('');
        setQuickTermOldRus('');
      } else {
        setQuickTermEng('');
        setQuickTermRus(sel);
        setQuickTermOldRus(sel);
      }
      setShowQuickTermModal(true);
    },
    [flatGlossaryPairs]
  );

  // Debounce heavy QA/DITING/CSI analysis while typing to avoid 75ms/keystroke lag
  useEffect(() => {
    if (
      draftRus === debouncedDraftRus &&
      draftEng === debouncedDraftEng &&
      draftTitleRus === debouncedDraftTitleRus
    ) {
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedDraftTitleRus(draftTitleRus);
      setDebouncedDraftEng(draftEng);
      setDebouncedDraftRus(draftRus);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    draftTitleRus,
    draftEng,
    draftRus,
    debouncedDraftTitleRus,
    debouncedDraftEng,
    debouncedDraftRus,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;
      if (isModifier && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
        e.preventDefault();
        handleManualSaveRef.current();
      } else if (isModifier && e.shiftKey && (e.key.toLowerCase() === 'm' || e.code === 'KeyM')) {
        e.preventDefault();
        const sel = window.getSelection()?.toString().trim() || '';
        openQuickTermFromSelection(sel);
      } else if (e.key === 'Escape' && isZenMode) {
        setIsZenMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZenMode, openQuickTermFromSelection]);

  if (syncedChapterId !== chapter.id) {
    setSyncedChapterId(chapter.id);
    setSyncedParentRus(chapter.rusText);
    setDraftTitleRus(chapter.titleRus);
    setDraftEng(chapter.engText);
    setDraftRus(chapter.rusText);
    setDebouncedDraftTitleRus(chapter.titleRus);
    setDebouncedDraftEng(chapter.engText);
    setDebouncedDraftRus(chapter.rusText);
    setDraftSummary(chapter.summary || '');
    setRepairNotice('');
    setLastPreRepairSnapshot(null);
    setComparedVersionLabel(null);
    setEditorMode('split');
  } else if (syncedParentRus !== chapter.rusText) {
    setSyncedParentRus(chapter.rusText);
    if (chapter.rusText !== draftRus) {
      setDraftTitleRus(chapter.titleRus);
      setDraftRus(chapter.rusText);
      setDebouncedDraftTitleRus(chapter.titleRus);
      setDebouncedDraftRus(chapter.rusText);
      setDraftSummary(chapter.summary || '');
    }
  }

  // Previous chapter memory for continuity
  const previousChapter = useMemo(() => {
    const sorted = [...allChapters].sort((a, b) => a.number - b.number);
    const idx = sorted.findIndex((c) => c.id === chapter.id);
    return idx > 0 ? sorted[idx - 1] : null;
  }, [allChapters, chapter.id]);

  // 4-Component DelTA Context Packet (R^(i), A_s/A_t, M^(i) 3 paragraphs, N^(i))
  const deltaContextPacket = useMemo(() => {
    const sorted = [...allChapters].sort((a, b) => a.number - b.number);
    const idx = sorted.findIndex((c) => c.id === chapter.id);
    const earlier = idx > 0 ? sorted.slice(0, idx) : [];
    return buildDelTAContextPacket(debouncedDraftEng, previousChapter, earlier, glossary, 3);
  }, [allChapters, chapter.id, debouncedDraftEng, previousChapter, glossary]);

  // CHORUS C3 Cultural Footnotes & Rationales (debounced)
  const csiCulturalNotes = useMemo(() => {
    if (chapter.csiNotes && chapter.csiNotes.length > 0 && debouncedDraftRus === chapter.rusText) {
      return chapter.csiNotes;
    }
    return extractCsiCulturalNotes(debouncedDraftEng, debouncedDraftRus, glossary);
  }, [chapter.csiNotes, chapter.rusText, debouncedDraftEng, debouncedDraftRus, glossary]);

  // DITING 6-Dimension Quality Report (debounced)
  const ditingReport = useMemo(
    () =>
      evaluateDitingQuality(
        debouncedDraftEng,
        debouncedDraftRus,
        glossary,
        glossaryMeta,
        enabledRuleIds
      ),
    [debouncedDraftEng, debouncedDraftRus, glossary, glossaryMeta, enabledRuleIds]
  );

  const lintReport = useMemo(
    () =>
      runQaLinter(debouncedDraftEng, debouncedDraftRus, glossary, {
        enabledRuleIds,
        glossaryMeta,
      }),
    [debouncedDraftEng, debouncedDraftRus, glossary, enabledRuleIds, glossaryMeta]
  );

  // 1:1 Paragraph Alignment Grid (live when actively editing aligned cells, debounced otherwise)
  const alignedEngInput = editorMode === 'aligned_1to1' ? draftEng : debouncedDraftEng;
  const alignedRusInput = editorMode === 'aligned_1to1' ? draftRus : debouncedDraftRus;
  const alignmentGrid = useMemo(
    () => alignChapterParagraphs(alignedEngInput, alignedRusInput),
    [alignedEngInput, alignedRusInput]
  );

  // Live bilingual summary synchronization with current draft (debounced)
  const liveBilingualSummary = useMemo(() => {
    if (!debouncedDraftEng.trim() || !debouncedDraftRus.trim()) return null;
    return generateBilingualChapterSummary(
      chapter.number,
      chapter.titleEng,
      debouncedDraftEng,
      debouncedDraftTitleRus || `Глава ${chapter.number}`,
      debouncedDraftRus
    );
  }, [chapter.number, chapter.titleEng, debouncedDraftEng, debouncedDraftTitleRus, debouncedDraftRus]);

  const handleSyncSummaryToDraft = () => {
    if (liveBilingualSummary) {
      setDraftSummary(liveBilingualSummary.rus);
      setRepairNotice('Краткое содержание синхронизировано с текущим текстом.');
    }
  };

  const handleSaveQuickTerm = () => {
    const engKey = quickTermEng.trim();
    const newRus = quickTermRus.trim();
    if (!engKey || !newRus) return;

    const existingEntry = flatGlossaryPairs.find(
      (p) => p.eng.toLowerCase() === engKey.toLowerCase()
    );
    const oldRusCandidate =
      quickTermOldRus.trim() && quickTermOldRus.trim() !== newRus
        ? quickTermOldRus.trim()
        : existingEntry && existingEntry.rus.trim() !== newRus
        ? existingEntry.rus.trim()
        : '';

    if (onAddCanonTerm) {
      onAddCanonTerm(quickTermCategory, engKey, newRus);
    }

    const rippleTargetOld = oldRusCandidate || engKey;
    let rippleCount: number | void = 0;
    if (quickTermRipple && onApplyCanonRipple && rippleTargetOld !== newRus) {
      rippleCount = onApplyCanonRipple(rippleTargetOld, newRus, engKey);
    }

    const termsToReplaceInDraft = Array.from(
      new Set([oldRusCandidate, engKey].filter((t) => Boolean(t) && t !== newRus))
    );
    if (termsToReplaceInDraft.length > 0) {
      setDraftRus((prev) => {
        let next = prev;
        for (const term of termsToReplaceInDraft) {
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = /^[a-zA-Z0-9\s'-]+$/.test(term)
            ? new RegExp(`\\b${escaped}\\b`, 'gi')
            : new RegExp(escaped, 'g');
          next = next.replace(re, newRus);
        }
        return next;
      });
    }

    setShowQuickTermModal(false);
    setQuickTermOldRus('');
    toast.success(
      oldRusCandidate
        ? `«${oldRusCandidate}» → «${newRus}» (${engKey})`
        : `«${engKey}» → «${newRus}» добавлен в канон`,
      'Канонический термин'
    );
    setRepairNotice(
      `Термин «${engKey}» → «${newRus}» сохранён в канон${
        quickTermRipple
          ? ` (Canon Ripple: «${rippleTargetOld}» → «${newRus}»${
              typeof rippleCount === 'number' && rippleCount > 0 ? `, обновлено ${rippleCount}` : ''
            })`
          : ''
      }.`
    );
  };

  // Typography Class computation for reading panes
  const typoClass = useMemo(() => {
    const sizeCls =
      fontSize === 'sm'
        ? 'text-sm'
        : fontSize === 'base'
        ? 'text-base'
        : fontSize === 'lg'
        ? 'text-lg'
        : 'text-xl';

    const fontCls =
      fontFamily === 'serif'
        ? 'font-serif'
        : fontFamily === 'mono'
        ? 'font-mono'
        : 'font-sans';

    const leadingCls =
      lineHeight === 'loose'
        ? 'leading-[2]'
        : lineHeight === 'normal'
        ? 'leading-[1.5]'
        : 'leading-[1.75]';

    const widthCls = columnWidth === 'prose' ? 'max-w-[68ch]' : 'max-w-none';

    return `${sizeCls} ${fontCls} ${leadingCls} ${widthCls}`;
  }, [fontSize, fontFamily, lineHeight, columnWidth]);

  // Pre-Stylist Snapshot for Pass 2 vs Pass 3 comparison
  const preStylistSnapshot = useMemo(() => {
    const found = (chapter.versionHistory || []).find(
      (v) =>
        v.stageLabel.includes('Pass 2') ||
        v.stageLabel.includes('Черновик') ||
        v.stageLabel.includes('черновик') ||
        v.stageLabel.includes('до авто-ремонта') ||
        v.stageLabel.includes('Фаза 2')
    );
    return found ? found.rusText : lastPreRepairSnapshot;
  }, [chapter.versionHistory, lastPreRepairSnapshot]);

  const stylistDiffSegments = useMemo(() => {
    if (!preStylistSnapshot || stylistViewMode !== 'stylist_diff') return [];
    return computeWordDiff(preStylistSnapshot, debouncedDraftRus);
  }, [preStylistSnapshot, debouncedDraftRus, stylistViewMode]);

  const handleEditorMouseUp = () => {
    const selection = window.getSelection();
    const selText = selection?.toString().trim() || '';
    if (selText.length >= 2 && selText.length <= 60 && !selText.includes('\n')) {
      const isEnglish = /[a-zA-Z]/.test(selText);
      setSelectedTextSnippet({ text: selText, isEnglish });
    } else {
      setSelectedTextSnippet(null);
    }
  };

  // Tautology & Repetition Radar (debounced)
  const tautologyItems = useMemo(
    () => detectTautologies(debouncedDraftRus),
    [debouncedDraftRus]
  );

  // Word-level Inline Diff when comparing before/after repair
  const wordDiffSegments = useMemo(() => {
    if (!lastPreRepairSnapshot || editorMode !== 'inline_diff') return [];
    return computeWordDiff(lastPreRepairSnapshot, debouncedDraftRus);
  }, [lastPreRepairSnapshot, debouncedDraftRus, editorMode]);

  const buildQaSummary = (
    report: { passed: boolean; errorCount: number; warningCount: number; score?: number },
    textLen: number
  ): ChapterQaSummary => ({
    passed: report.passed,
    score:
      typeof report.score === 'number'
        ? report.score
        : Math.max(0, 100 - report.errorCount * 15 - report.warningCount * 3),
    errorCount: report.errorCount,
    warningCount: report.warningCount,
    fingerprint: `${textLen}:${report.errorCount}:${report.warningCount}`,
    computedAt: new Date().toISOString(),
  });

  const versionHistoryList = useMemo<ChapterVersionSnapshot[]>(() => {
    const existing = chapter.versionHistory || [];
    if (existing.length > 0) return existing;
    if (!chapter.rusText.trim()) return [];
    const basePassed =
      chapter.qaSummary !== undefined
        ? chapter.qaSummary.passed
        : runQaLinter(chapter.engText, chapter.rusText, glossary, {
            enabledRuleIds,
            glossaryMeta,
          }).passed;
    const baseErrorCount =
      chapter.qaSummary !== undefined
        ? chapter.qaSummary.errorCount
        : runQaLinter(chapter.engText, chapter.rusText, glossary, {
            enabledRuleIds,
            glossaryMeta,
          }).errorCount;
    return [
      {
        id: `ver-init-${chapter.id}`,
        timestamp: chapter.lastUpdated || '2026-10-16 01:00',
        stageLabel: chapter.verified
          ? 'Верифицированный релиз конвейера (Фаза 5)'
          : 'Базовый перевод конвейера (Фаза 2)',
        titleRus: chapter.titleRus,
        rusText: chapter.rusText,
        wordCountRus: chapter.wordCountRus,
        qaPassed: basePassed,
        qaErrorCount: baseErrorCount,
      },
    ];
  }, [
    chapter.id,
    chapter.versionHistory,
    chapter.qaSummary,
    chapter.rusText,
    chapter.engText,
    chapter.titleRus,
    chapter.wordCountRus,
    chapter.verified,
    chapter.lastUpdated,
    glossary,
    enabledRuleIds,
    glossaryMeta,
  ]);

  const appendSnapshotsToHistory = (
    baseHistory: ChapterVersionSnapshot[],
    newSnapshots: ChapterVersionSnapshot[]
  ): ChapterVersionSnapshot[] => {
    const next = [...baseHistory];
    for (const snap of newSnapshots) {
      if (!snap.rusText.trim()) continue;
      const duplicate = next.some(
        (v) => v.rusText.trim() === snap.rusText.trim() && v.stageLabel === snap.stageLabel
      );
      if (!duplicate) {
        next.push(snap);
      }
    }
    return next.slice(-10);
  };

  const handleInstantDeterministicRepair = () => {
    const preText = draftRus;
    const preReport = runQaLinter(draftEng, preText, glossary, {
      enabledRuleIds,
      glossaryMeta,
    });
    setLastPreRepairSnapshot(preText);
    setComparedVersionLabel('Предыдущая редакция (до Авто-ремонта QA)');
    const verified = finalizeAndVerifyChapter({
      chapterNumber: chapter.number,
      titleEng: chapter.titleEng,
      titleRus: draftTitleRus,
      engText: draftEng,
      candidateRusText: draftRus,
      glossary,
      glossaryMeta,
      enabledRuleIds,
      runSurgicalDriftRepair: true,
      existingSummaryRus: draftSummary,
      existingSummaryEng: chapter.summaryEng,
      aiCsiNotes: chapter.csiNotes,
    });
    const repairedText = verified.rusText;
    const combinedFixes = verified.appliedFixes;
    const postReport = verified.lintReport;
    const nextSummary = verified.summary;
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const updatedHistory = appendSnapshotsToHistory(versionHistoryList, [
      {
        id: `ver-pre-qa-${Date.now()}`,
        timestamp: chapter.lastUpdated || nowStr,
        stageLabel: 'До авто-ремонта QA (исходный черновик)',
        titleRus: draftTitleRus,
        rusText: preText,
        wordCountRus: preText.trim().split(/\s+/).filter(Boolean).length,
        qaPassed: preReport.passed,
        qaErrorCount: preReport.errorCount,
      },
      {
        id: `ver-post-qa-${Date.now() + 1}`,
        timestamp: nowStr,
        stageLabel: 'Авто-ремонт QA и точечная правка (Фаза 4)',
        titleRus: draftTitleRus,
        rusText: repairedText,
        wordCountRus: repairedText.trim().split(/\s+/).filter(Boolean).length,
        qaPassed: postReport.passed,
        qaErrorCount: postReport.errorCount,
      },
    ]);

    setDraftRus(repairedText);
    setDebouncedDraftRus(repairedText);
    setDraftSummary(nextSummary);
    setEditorMode('inline_diff');
    if (combinedFixes.length > 0) {
      setRepairNotice(`Исправлено автоматически: ${combinedFixes.join(' · ')}`);
      toast.info(`Авто-ремонт QA: ${combinedFixes.length} исправлений`, 'Канон QA');
    } else {
      setRepairNotice('Все 100% проверок QA пройдены.');
      toast.success('Все 100% проверок QA пройдены', 'Канон QA');
    }
    const isVerified = postReport.passed && Boolean(repairedText.trim());
    onSaveChapter({
      ...chapter,
      titleRus: draftTitleRus,
      engText: draftEng,
      rusText: repairedText,
      summary: nextSummary,
      versionHistory: updatedHistory,
      translated: Boolean(repairedText.trim()),
      edited: Boolean(repairedText.trim()),
      verified: isVerified,
      status: isVerified ? 'verified' : repairedText.trim() ? 'translated' : 'pending',
      quarantineReason: isVerified ? undefined : chapter.quarantineReason,
      qaSummary: buildQaSummary(postReport, repairedText.length),
      wordCountEng: draftEng.trim().split(/\s+/).filter(Boolean).length,
      wordCountRus: repairedText.trim().split(/\s+/).filter(Boolean).length,
      lastUpdated: nowStr,
    });
  };

  const handleUndoRepair = () => {
    if (!lastPreRepairSnapshot) return;
    setDraftRus(lastPreRepairSnapshot);
    setLastPreRepairSnapshot(null);
    setComparedVersionLabel(null);
    setEditorMode('split');
    setRepairNotice('Откат выполнен: возвращена предыдущая редакция главы.');
  };

  const handleCompareWithVersion = (snap: ChapterVersionSnapshot) => {
    setLastPreRepairSnapshot(snap.rusText);
    setComparedVersionLabel(`${snap.stageLabel} (${snap.timestamp})`);
    setEditorMode('inline_diff');
    setRepairNotice(
      `Режим сравнения: версия «${snap.stageLabel}» (${snap.timestamp}) ↔ текущий текст главы.`
    );
  };

  const handleRollbackToVersion = (snap: ChapterVersionSnapshot) => {
    setLastPreRepairSnapshot(draftRus);
    setComparedVersionLabel(`До отката к «${snap.stageLabel}»`);
    setDraftTitleRus(snap.titleRus || draftTitleRus);
    setDraftRus(snap.rusText);
    const postRollbackReport = runQaLinter(draftEng, snap.rusText, glossary, {
      enabledRuleIds,
      glossaryMeta,
    });
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const updatedHistory = appendSnapshotsToHistory(versionHistoryList, [
      {
        id: `ver-rollback-${Date.now()}`,
        timestamp: nowStr,
        stageLabel: `Откат к версии: ${snap.stageLabel}`,
        titleRus: snap.titleRus || draftTitleRus,
        rusText: snap.rusText,
        wordCountRus: snap.rusText.trim().split(/\s+/).filter(Boolean).length,
        qaPassed: postRollbackReport.passed,
        qaErrorCount: postRollbackReport.errorCount,
      },
    ]);
    onSaveChapter({
      ...chapter,
      titleRus: snap.titleRus || draftTitleRus,
      engText: draftEng,
      rusText: snap.rusText,
      summary: draftSummary,
      versionHistory: updatedHistory,
      translated: Boolean(snap.rusText.trim()),
      edited: Boolean(snap.rusText.trim()),
      verified: postRollbackReport.passed && Boolean(snap.rusText.trim()),
      wordCountEng: draftEng.trim().split(/\s+/).filter(Boolean).length,
      wordCountRus: snap.rusText.trim().split(/\s+/).filter(Boolean).length,
      lastUpdated: nowStr,
    });
    setEditorMode('split');
    setRepairNotice(
      `Выполнен откат главы к версии «${snap.stageLabel}» (${snap.timestamp}).`
    );
  };

  const handleUpdateAlignedParagraph = (rowIndex: number, newRusParagraph: string) => {
    const nextParagraphs = alignmentGrid.pairs.map((r, idx) =>
      idx === rowIndex ? newRusParagraph : r.rusParagraph
    );
    const nonEmptyJoined = nextParagraphs.filter((p) => p.trim().length > 0).join('\n\n');
    setDraftRus(nonEmptyJoined);
  };

  const handleAiVerifierRepair = async () => {
    const preText = draftRus;
    const preReport = runQaLinter(draftEng, preText, glossary, {
      enabledRuleIds,
      glossaryMeta,
    });
    setIsAiRepairing(true);
    setRepairNotice('');
    setLastPreRepairSnapshot(preText);
    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'self_repair',
          chapterNumber: chapter.number,
          titleEng: chapter.titleEng,
          titleRus: draftTitleRus,
          engText: draftEng,
          rusText: preText,
          glossary,
          glossaryMeta,
          enabledRuleIds,
          genrePreset,
          proseTone,
          previousChapterSummary: previousChapter?.summary || '',
          existingSummaryRus: draftSummary,
          existingSummaryEng: chapter.summaryEng,
          styleGuideMd,
          contextMd,
          llmConfig,
        }),
      });
      const data = await response.json().catch(() => ({} as Record<string, unknown>));
      if (!response.ok || data?.ok === false) {
        const errMsg =
          (typeof data?.error === 'string' && data.error) ||
          `Сервер вернул HTTP ${response.status}`;
        throw new Error(errMsg);
      }

      const nextRus =
        typeof data?.repairedText === 'string'
          ? data.repairedText
          : typeof data?.rusText === 'string'
          ? data.rusText
          : '';

      if (data?.quarantined === true || nextRus.startsWith('[КАРАНТИН:')) {
        const qReason =
          (typeof data?.quarantineReason === 'string' && data.quarantineReason) ||
          'ИИ-редактор вернул неполный или повреждённый фрагмент';
        setLastPreRepairSnapshot(null);
        setRepairNotice(`ИИ-ремонт отклонён (карантин): ${qReason}. Текст не изменён.`);
        toast.warning(`Текст главы не изменён: ${qReason}`, 'Защита от порчи');
        return;
      }

      if (!nextRus.trim()) {
        throw new Error('ИИ-редактор вернул пустой ответ.');
      }

      const nextSummary =
        (typeof data?.chapterSummary === 'string' && data.chapterSummary) ||
        draftSummary ||
        generateChapterMemorySummary(
          chapter.number,
          draftTitleRus || chapter.titleEng,
          nextRus
        );
      const postReport =
        data?.lintReport && typeof (data.lintReport as { passed?: unknown }).passed === 'boolean'
          ? (data.lintReport as {
              passed: boolean;
              errorCount: number;
              warningCount: number;
              score?: number;
            })
          : runQaLinter(draftEng, nextRus, glossary, {
              enabledRuleIds,
              glossaryMeta,
            });
      const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const updatedHistory = appendSnapshotsToHistory(versionHistoryList, [
        {
          id: `ver-pre-ai-${Date.now()}`,
          timestamp: chapter.lastUpdated || nowStr,
          stageLabel: 'До ИИ-вычитки (редактор)',
          titleRus: draftTitleRus,
          rusText: preText,
          wordCountRus: preText.trim() ? preText.trim().split(/\s+/).filter(Boolean).length : 0,
          qaPassed: preReport.passed,
          qaErrorCount: preReport.errorCount,
        },
        {
          id: `ver-post-ai-${Date.now() + 1}`,
          timestamp: nowStr,
          stageLabel: 'ИИ-ремонт и верификация',
          titleRus: draftTitleRus,
          rusText: nextRus,
          wordCountRus: nextRus.trim().split(/\s+/).filter(Boolean).length,
          qaPassed: postReport.passed,
          qaErrorCount: postReport.errorCount,
        },
      ]);

      setDraftRus(nextRus);
      setDebouncedDraftRus(nextRus);
      setDraftSummary(nextSummary);
      setComparedVersionLabel('Предыдущая редакция (до ИИ-вычитки)');
      setEditorMode('inline_diff');
      const appliedFixes = Array.isArray(data?.appliedFixes)
        ? (data.appliedFixes as string[])
        : [];
      setRepairNotice(
        appliedFixes.length
          ? `Литературный критик и QA: ${appliedFixes.join(' · ')}`
          : 'ИИ-редактор завершил вычитку и сохранил снимок в историю.'
      );
      toast.success('ИИ-редактор завершил вычитку (снимок сохранён)', 'ИИ-ремонт');

      const isVerified = Boolean(postReport.passed) && Boolean(nextRus.trim());
      onSaveChapter({
        ...chapter,
        titleRus: draftTitleRus,
        engText: draftEng,
        rusText: nextRus,
        summary: nextSummary,
        versionHistory: updatedHistory,
        translated: true,
        edited: true,
        verified: isVerified,
        status: isVerified ? 'verified' : 'translated',
        quarantineReason: undefined,
        qaSummary: buildQaSummary(postReport, nextRus.length),
        lastEngineUsed:
          (typeof data?.engineLabel === 'string' && data.engineLabel) ||
          llmConfig?.provider ||
          chapter.lastEngineUsed,
        wordCountEng: draftEng.trim().split(/\s+/).filter(Boolean).length,
        wordCountRus: nextRus.trim().split(/\s+/).filter(Boolean).length,
        lastUpdated: nowStr,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Сбой сети или LLM';
      setLastPreRepairSnapshot(null);
      setRepairNotice(`Ошибка ИИ-вычитки: ${msg}. Текст главы не изменён.`);
      toast.error(msg, 'Ошибка ИИ-ремонта');
    } finally {
      setIsAiRepairing(false);
    }
  };

  const handleManualSave = () => {
    const freshLint = runQaLinter(draftEng, draftRus, glossary, {
      enabledRuleIds,
      glossaryMeta,
    });
    const nextSummary =
      draftSummary.trim() ||
      (draftRus.trim()
        ? generateChapterMemorySummary(
            chapter.number,
            draftTitleRus || chapter.titleEng,
            draftRus
          )
        : '');
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const updatedHistory = appendSnapshotsToHistory(versionHistoryList, [
      {
        id: `ver-manual-${Date.now()}`,
        timestamp: nowStr,
        stageLabel: 'Ручное сохранение в редакторе',
        titleRus: draftTitleRus,
        rusText: draftRus,
        wordCountRus: draftRus.trim() ? draftRus.trim().split(/\s+/).length : 0,
        qaPassed: freshLint.passed,
        qaErrorCount: freshLint.errorCount,
      },
    ]);
    const isVerified = freshLint.passed && draftRus.trim().length > 0;
    setDebouncedDraftTitleRus(draftTitleRus);
    setDebouncedDraftEng(draftEng);
    setDebouncedDraftRus(draftRus);
    setDraftSummary(nextSummary);
    onSaveChapter({
      ...chapter,
      titleRus: draftTitleRus,
      engText: draftEng,
      rusText: draftRus,
      summary: nextSummary,
      versionHistory: updatedHistory,
      translated: Boolean(draftRus.trim()),
      edited: Boolean(draftRus.trim()),
      verified: isVerified,
      status: isVerified ? 'verified' : draftRus.trim() ? 'translated' : 'pending',
      quarantineReason: isVerified ? undefined : chapter.quarantineReason,
      qaSummary: buildQaSummary(freshLint, draftRus.length),
      wordCountEng: draftEng.trim().split(/\s+/).filter(Boolean).length,
      wordCountRus: draftRus.trim() ? draftRus.trim().split(/\s+/).length : 0,
      lastUpdated: nowStr,
    });
    setRepairNotice('Глава, версия в истории и память сюжета сохранены.');
    toast.success(`Глава ${chapter.subPart || chapter.number} сохранена`, 'Сохранено');
  };

  useEffect(() => {
    handleManualSaveRef.current = handleManualSave;
  });

  const renderHighlightedEnglish = (text: string) => {
    if (!highlightTerms) {
      return <div className="whitespace-pre-wrap leading-relaxed">{text}</div>;
    }

    const segments: Array<{
      text: string;
      matched?: { eng: string; rus: string; gender?: string; voiceNote?: string };
    }> = [{ text }];

    flatGlossaryPairs.forEach(({ eng, rus, gender, voiceNote }) => {
      if (!eng || eng.length < 3) return;
      const escaped = eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(\\b${escaped}\\b)`, 'gi');

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.matched) continue;
        const parts = seg.text.split(regex);
        if (parts.length > 1) {
          const replacement: typeof segments = [];
          parts.forEach((part) => {
            if (!part) return;
            if (part.toLowerCase() === eng.toLowerCase()) {
              replacement.push({ text: part, matched: { eng, rus, gender, voiceNote } });
            } else {
              replacement.push({ text: part });
            }
          });
          segments.splice(i, 1, ...replacement);
          i += replacement.length - 1;
        }
      }
    });

    return (
      <div className="whitespace-pre-wrap leading-relaxed">
        {segments.map((seg, idx) =>
          seg.matched ? (
            <span
              key={idx}
              title={`Канон: ${seg.matched.rus}${seg.matched.gender ? ` (Род: ${seg.matched.gender})` : ''}${seg.matched.voiceNote ? ` · Речь: ${seg.matched.voiceNote}` : ''}`}
              className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-200 underline decoration-amber-400/60 decoration-dotted underline-offset-4 cursor-help"
            >
              {seg.text}
            </span>
          ) : (
            <React.Fragment key={idx}>{seg.text}</React.Fragment>
          )
        )}
      </div>
    );
  };

  const hasIssues =
    draftRus.trim().length > 0 &&
    (lintReport.errorCount > 0 || lintReport.warningCount > 0);

  return (
    <div
      className={
        isZenMode
          ? 'fixed inset-0 z-50 bg-[#090A0F] p-4 sm:p-6 overflow-y-auto flex flex-col space-y-4'
          : 'space-y-4'
      }
    >
      {/* Zen Mode Quick Status Bar */}
      {isZenMode && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs shrink-0 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="font-semibold text-amber-300">Zen-режим (Focus)</span>
            <span className="text-slate-400 hidden sm:inline">
              · Глава {chapter.subPart || chapter.number}: {draftTitleRus || chapter.titleEng}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleManualSave}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-amber-500 text-black font-semibold hover:bg-amber-400 transition"
            >
              <Save className="w-3.5 h-3.5" />
              Сохранить (Ctrl+S)
            </button>
            <button
              type="button"
              onClick={() => setIsZenMode(false)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition font-medium"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              Выход (Esc)
            </button>
          </div>
        </div>
      )}
      {/* Minimalist Editor Toolbar: Ghost Utilities + Single Primary Action */}
      <div className="flex flex-col gap-3 pb-4 border-b border-white/[0.06] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Выбор главы в редакторе"
            value={chapter.id}
            onChange={(e) => onSelectChapter(e.target.value)}
            className="rounded-md border border-white/[0.07] bg-[#11131C] px-3 py-1.5 text-xs font-medium text-[#F1F5F9] focus:border-[#D99B26] focus:outline-none cursor-pointer"
          >
            {allChapters.map((c) => (
              <option key={c.id} value={c.id} className="bg-[#11131C] text-[#F1F5F9]">
                Глава {c.subPart || c.number}: {c.titleRus || c.titleEng}
              </option>
            ))}
          </select>

          {/* 3 Editor View Modes: Split, 1:1 Paragraph Grid, Inline Diff */}
          <div className="flex items-center gap-0.5 rounded-md border border-white/[0.07] bg-[#11131C] p-0.5">
            <button
              type="button"
              onClick={() => setEditorMode('split')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                editorMode === 'split'
                  ? 'bg-white/[0.1] text-[#F1F5F9]'
                  : 'text-[#64748B] hover:text-[#94A3B8]'
              }`}
            >
              2 колонки
            </button>
            <button
              type="button"
              onClick={() => setEditorMode('aligned_1to1')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition ${
                editorMode === 'aligned_1to1'
                  ? 'bg-white/[0.1] text-[#F1F5F9]'
                  : 'text-[#64748B] hover:text-[#94A3B8]'
              }`}
              title="Поабзацная синхронизация 1:1 с контролем пропусков"
            >
              <Columns2 className="h-3.5 w-3.5" />
              Абзацы 1:1 ({alignmentGrid.engCount}/{alignmentGrid.rusCount})
            </button>
            {lastPreRepairSnapshot && (
              <button
                type="button"
                onClick={() => setEditorMode('inline_diff')}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition ${
                  editorMode === 'inline_diff'
                    ? 'bg-white/[0.1] text-[#F1F5F9]'
                    : 'text-[#D99B26] hover:text-[#F1F5F9]'
                }`}
              >
                <GitCompare className="h-3.5 w-3.5" />
                Diff правок
              </button>
            )}
          </div>

          {/* Live QA Status Indicator */}
          {draftRus.trim().length === 0 ? (
            <span className="text-xs text-[#64748B]">Ожидает перевода</span>
          ) : lintReport.passed ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400/90">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Канон соблюдён (100%)
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setShowIssuesPanel((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Ошибок: {lintReport.errorCount} · Предупр.: {lintReport.warningCount}
              {showIssuesPanel ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>

        {/* Single-Line Ghost Utilities + Primary Action */}
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1 shrink-0">
          {/* Typography Controls Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTypoMenu((prev) => !prev)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition whitespace-nowrap ${
                showTypoMenu
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]'
              }`}
              title="Настройки книжной типографики"
            >
              <Type className="h-3.5 w-3.5 text-amber-400" />
              Шрифт
            </button>

            {showTypoMenu && (
              <div className="absolute top-full right-0 mt-1.5 z-40 w-72 rounded-xl border border-white/10 bg-[#0c1017] p-3.5 shadow-2xl space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="text-xs font-semibold text-slate-200">Книжная типографика</span>
                  <button
                    type="button"
                    onClick={() => setShowTypoMenu(false)}
                    className="text-slate-400 hover:text-white text-xs px-1"
                  >
                    ✕
                  </button>
                </div>

                {/* Гарнитура */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Гарнитура</label>
                  <div className="grid grid-cols-3 gap-1">
                    {(['serif', 'sans', 'mono'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFontFamily(f)}
                        className={`py-1 text-xs rounded border text-center transition ${
                          fontFamily === f
                            ? 'border-amber-500 bg-amber-500/20 text-amber-200 font-semibold'
                            : 'border-white/5 bg-white/[0.02] text-slate-400 hover:text-white'
                        }`}
                      >
                        {f === 'serif' ? 'Роман (Serif)' : f === 'sans' ? 'Гротеск' : 'Моно'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Размер шрифта */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Размер кегля</label>
                  <div className="grid grid-cols-4 gap-1">
                    {(['sm', 'base', 'lg', 'xl'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFontSize(s)}
                        className={`py-1 text-xs rounded border text-center font-mono transition ${
                          fontSize === s
                            ? 'border-amber-500 bg-amber-500/20 text-amber-200 font-bold'
                            : 'border-white/5 bg-white/[0.02] text-slate-400 hover:text-white'
                        }`}
                      >
                        {s === 'sm' ? '14px' : s === 'base' ? '16px' : s === 'lg' ? '18px' : '20px'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Интервал */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Интерлиньяж</label>
                  <div className="grid grid-cols-3 gap-1">
                    {(['normal', 'relaxed', 'loose'] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLineHeight(l)}
                        className={`py-1 text-[11px] rounded border text-center transition ${
                          lineHeight === l
                            ? 'border-amber-500 bg-amber-500/20 text-amber-200 font-semibold'
                            : 'border-white/5 bg-white/[0.02] text-slate-400 hover:text-white'
                        }`}
                      >
                        {l === 'normal' ? '1.5' : l === 'relaxed' ? '1.75' : '2.0'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ширина колонки */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Ширина полосы текста</label>
                  <div className="grid grid-cols-2 gap-1">
                    {(['prose', 'full'] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setColumnWidth(w)}
                        className={`py-1 text-[11px] rounded border text-center transition ${
                          columnWidth === w
                            ? 'border-amber-500 bg-amber-500/20 text-amber-200 font-semibold'
                            : 'border-white/5 bg-white/[0.02] text-slate-400 hover:text-white'
                        }`}
                      >
                        {w === 'prose' ? 'Книжная (68ch)' : 'Во всю ширину'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Zen / Focus Mode Toggle */}
          <button
            type="button"
            onClick={() => setIsZenMode((prev) => !prev)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition whitespace-nowrap ${
              isZenMode
                ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]'
            }`}
            title={isZenMode ? 'Выйти из Zen-режима (Esc)' : 'Включить полноэкранный Zen-режим (Focus)'}
          >
            {isZenMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5 text-amber-400" />}
            Zen
          </button>

          <button
            type="button"
            onClick={() => setHighlightTerms((prev) => !prev)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition whitespace-nowrap ${
              highlightTerms
                ? 'bg-white/[0.08] text-[#F1F5F9]'
                : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            Термины
          </button>

          <button
            type="button"
            onClick={() => setShowTautologyPanel((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition whitespace-nowrap ${
              showTautologyPanel
                ? 'bg-white/[0.08] text-[#F1F5F9]'
                : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]'
            }`}
            title="Радар лексических повторов и тавтологий в соседних предложениях"
          >
            <Radar className="h-3.5 w-3.5" />
            Тавтологии ({tautologyItems.length})
          </button>

          <button
            type="button"
            onClick={() => setShowVersionHistoryPanel((prev) => !prev)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition whitespace-nowrap ${
              showVersionHistoryPanel
                ? 'bg-white/[0.08] text-[#F1F5F9]'
                : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]'
            }`}
            title="Открыть историю версий прохождения конвейера для сравнения и отката"
          >
            <Clock className="h-3.5 w-3.5" />
            История версий ({versionHistoryList.length})
          </button>

          <button
            type="button"
            onClick={() => setShowCsiDitingPanel((prev) => !prev)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition whitespace-nowrap ${
              showCsiDitingPanel
                ? 'bg-white/[0.08] text-[#F1F5F9]'
                : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]'
            }`}
            title="Культурные сноски CSI (CHORUS C3) и 6-мерная оценка DITING / MQM"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#D99B26]" />
            CSI & DITING ({csiCulturalNotes.length})
          </button>

          <button
            type="button"
            onClick={() => setShowMemoryBar((prev) => !prev)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition whitespace-nowrap ${
              showMemoryBar
                ? 'bg-white/[0.08] text-[#F1F5F9]'
                : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]'
            }`}
            title="Четырёхкомпонентная память DelTA: 3 абзаца ENG-RUS + двуязычное резюме"
          >
            <History className="h-3.5 w-3.5" />
            Память DelTA ({deltaContextPacket.shortTermWindow.length})
          </button>

          <button
            type="button"
            onClick={() => setShowContextDrawer((prev) => !prev)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition whitespace-nowrap ${
              showContextDrawer
                ? 'bg-white/[0.08] text-[#F1F5F9]'
                : 'text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Гид
          </button>

          {draftRus.trim().length > 0 && (
            <>
              <button
                type="button"
                onClick={handleInstantDeterministicRepair}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.09] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-[#F1F5F9] transition hover:bg-white/[0.08] whitespace-nowrap"
              >
                <Wand2 className="h-3.5 w-3.5 text-[#D99B26]" />
                Авто-ремонт QA
              </button>

              <button
                type="button"
                onClick={handleAiVerifierRepair}
                disabled={isAiRepairing || isPipelineBusy}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#94A3B8] transition hover:bg-white/[0.04] hover:text-[#F1F5F9] disabled:opacity-50 whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#D99B26]" />
                {isAiRepairing ? 'Вычитка...' : 'Критик'}
              </button>
            </>
          )}

          {lastPreRepairSnapshot && (
            <button
              type="button"
              onClick={handleUndoRepair}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9] whitespace-nowrap"
              title="Откатить последнее авто-исправление"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Откатить
            </button>
          )}

          {draftRus.trim().length === 0 && (
            <button
              type="button"
              onClick={() => onRunSingleChapterPipeline(chapter.id)}
              disabled={isPipelineBusy}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#D99B26] px-3 py-1 text-xs font-semibold text-[#090A0F] transition hover:bg-[#E3A836] disabled:opacity-50 whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Перевести главу
            </button>
          )}

          <button
            type="button"
            onClick={handleManualSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#D99B26] px-3 py-1 text-xs font-semibold text-[#090A0F] transition hover:bg-[#E3A836] whitespace-nowrap"
          >
            <Save className="h-3.5 w-3.5" />
            Сохранить
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {repairNotice && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-2 text-xs text-emerald-200">
          <span>{repairNotice}</span>
          <button
            type="button"
            onClick={() => setRepairNotice('')}
            className="text-emerald-400 hover:text-white"
          >
            Скрыть
          </button>
        </div>
      )}

      <EditorInspectorPanels
        chapter={chapter}
        previousChapter={previousChapter}
        draftTitleRus={draftTitleRus}
        draftEng={draftEng}
        draftRus={draftRus}
        draftSummary={draftSummary}
        setDraftSummary={setDraftSummary}
        showVersionHistoryPanel={showVersionHistoryPanel}
        onCloseVersionHistory={() => setShowVersionHistoryPanel(false)}
        versionHistoryList={versionHistoryList}
        onCompareWithVersion={handleCompareWithVersion}
        onRollbackToVersion={handleRollbackToVersion}
        showTautologyPanel={showTautologyPanel}
        onCloseTautology={() => setShowTautologyPanel(false)}
        tautologyItems={tautologyItems}
        showCsiDitingPanel={showCsiDitingPanel}
        onCloseCsiDiting={() => setShowCsiDitingPanel(false)}
        ditingReport={ditingReport}
        csiCulturalNotes={csiCulturalNotes}
        showMemoryBar={showMemoryBar}
        onCloseMemoryBar={() => setShowMemoryBar(false)}
        deltaContextPacket={deltaContextPacket}
        hasIssues={hasIssues}
        showIssuesPanel={showIssuesPanel}
        genrePreset={genrePreset}
        proseTone={proseTone}
        lintReport={lintReport}
        onInstantRepair={handleInstantDeterministicRepair}
        showContextDrawer={showContextDrawer}
        editStyleMd={editStyleMd}
        setEditStyleMd={setEditStyleMd}
        editContextMd={editContextMd}
        setEditContextMd={setEditContextMd}
        onApplyStyleAndContext={() => {
          onUpdateStyleAndContext(editStyleMd, editContextMd);
          setRepairNotice('Стилевой гид и контекст обновлены.');
        }}
      />

      {/* MODE 1: Unified Minimalist 2-Column Editorial Sheet */}
      {editorMode === 'split' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 rounded-xl border border-white/[0.07] bg-[#11131C]/70 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.06] overflow-hidden">
          {/* Left Pane: English Source */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3">
              <span className="text-xs font-medium text-[#94A3B8]">
                Оригинал (ENG) — {chapter.titleEng}
              </span>
              <span className="font-mono text-xs tabular-nums text-[#64748B]">
                {draftEng.trim().split(/\s+/).filter(Boolean).length} слов
              </span>
            </div>
            <div
              onMouseUp={handleEditorMouseUp}
              className={`p-6 sm:p-8 text-[#F1F5F9]/90 min-h-[440px] ${typoClass}`}
            >
              {renderHighlightedEnglish(draftEng)}
            </div>
          </div>

          {/* Right Pane: Russian Translation */}
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between border-b border-white/[0.06] px-6 py-2.5 gap-2">
              <input
                type="text"
                aria-label="Заголовок главы на русском"
                value={draftTitleRus}
                onChange={(e) => setDraftTitleRus(e.target.value)}
                placeholder="Название главы на русском..."
                className="w-full sm:w-auto flex-1 bg-transparent text-xs font-medium text-[#F1F5F9] focus:outline-none"
              />

              {/* Pass 2 vs Pass 3 Stylist Switcher */}
              <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/5">
                <button
                  type="button"
                  onClick={() => setStylistViewMode('final')}
                  className={`px-2 py-0.5 text-[10px] rounded transition ${
                    stylistViewMode === 'final'
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Финальный текст после прохода слепого стилиста Норы Галь и шлюза отката"
                >
                  Финал (Pass 3)
                </button>
                {preStylistSnapshot && (
                  <>
                    <button
                      type="button"
                      onClick={() => setStylistViewMode('pre_stylist')}
                      className={`px-2 py-0.5 text-[10px] rounded transition ${
                        stylistViewMode === 'pre_stylist'
                          ? 'bg-amber-500/20 text-amber-300 font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Черновик до прохода стилиста"
                    >
                      Черновик (Pass 2)
                    </button>
                    <button
                      type="button"
                      onClick={() => setStylistViewMode('stylist_diff')}
                      className={`px-2 py-0.5 text-[10px] rounded transition ${
                        stylistViewMode === 'stylist_diff'
                          ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Дифф правок стилиста"
                    >
                      Дифф стилиста
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-xs tabular-nums text-[#64748B]">
                  {draftRus.trim() ? draftRus.trim().split(/\s+/).length : 0} слов
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDraftRus(chapter.rusText);
                    setDraftTitleRus(chapter.titleRus);
                  }}
                  title="Сбросить несохранённые правки"
                  className="text-[#64748B] hover:text-[#F1F5F9]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {stylistViewMode === 'final' ? (
              <textarea
                aria-label="Текст перевода на русском"
                value={draftRus}
                onChange={(e) => setDraftRus(e.target.value)}
                onMouseUp={handleEditorMouseUp}
                onKeyUp={handleEditorMouseUp}
                placeholder="Нажмите «Перевести главу» или введите литературный перевод..."
                className={`w-full flex-1 min-h-[440px] resize-y bg-transparent p-6 sm:p-8 text-[#F1F5F9] placeholder:text-[#64748B] focus:outline-none ${typoClass}`}
              />
            ) : stylistViewMode === 'pre_stylist' ? (
              <div
                onMouseUp={handleEditorMouseUp}
                className={`p-6 sm:p-8 text-amber-200/90 whitespace-pre-wrap ${typoClass}`}
              >
                <div className="text-xs font-mono text-amber-400 mb-3 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                  Редакция черновика Pass 2 (до вмешательства «слепого стилиста» Норы Галь)
                </div>
                {preStylistSnapshot}
              </div>
            ) : (
              <div className={`p-6 sm:p-8 whitespace-pre-wrap ${typoClass}`}>
                <div className="text-xs font-mono text-cyan-400 mb-3 bg-cyan-500/10 p-2 rounded-lg border border-cyan-500/20">
                  Пословный дифф: красный — черновик Pass 2; зелёный — правки стилиста Норы Галь (Pass 3)
                </div>
                {stylistDiffSegments.map((seg, i) =>
                  seg.type === 'removed' ? (
                    <span
                      key={i}
                      className="bg-rose-500/20 text-rose-300 line-through decoration-rose-400 px-1 py-0.5 rounded mx-0.5"
                    >
                      {seg.text}
                    </span>
                  ) : seg.type === 'added' ? (
                    <span
                      key={i}
                      className="bg-emerald-500/20 text-emerald-300 font-semibold px-1 py-0.5 rounded mx-0.5"
                    >
                      {seg.text}
                    </span>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <EditorModes
        editorMode={editorMode}
        alignmentGrid={alignmentGrid}
        renderHighlightedEnglish={renderHighlightedEnglish}
        onUpdateAlignedParagraph={handleUpdateAlignedParagraph}
        onInstantRepair={handleInstantDeterministicRepair}
        comparedVersionLabel={comparedVersionLabel}
        wordDiffSegments={wordDiffSegments}
        lastPreRepairSnapshot={lastPreRepairSnapshot}
        onUndoRepair={handleUndoRepair}
        onExitInlineDiff={() => setEditorMode('split')}
      />

      {showQuickTermModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                Быстрое добавление в Канон (Ctrl+Shift+M)
              </h3>
              <button
                type="button"
                onClick={() => setShowQuickTermModal(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Оригинал (ENG / CJK):</label>
                <input
                  type="text"
                  value={quickTermEng}
                  onChange={(e) => {
                    const nextEng = e.target.value;
                    setQuickTermEng(nextEng);
                    const found = flatGlossaryPairs.find(
                      (p) => p.eng.toLowerCase() === nextEng.trim().toLowerCase()
                    );
                    if (found) {
                      setQuickTermOldRus(found.rus);
                    }
                  }}
                  placeholder="e.g. Origin Points, Lin Xuan"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Канонический русский перевод:</label>
                <input
                  type="text"
                  value={quickTermRus}
                  onChange={(e) => setQuickTermRus(e.target.value)}
                  placeholder="например: Очки Истока, Линь Сюань"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">
                  Прежний вариант для замены (если термин уже был в главах):
                </label>
                <input
                  type="text"
                  value={quickTermOldRus}
                  onChange={(e) => setQuickTermOldRus(e.target.value)}
                  placeholder="определяется автоматически по канону или выделению"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-slate-200 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Категория глоссария:</label>
                <select
                  value={quickTermCategory}
                  onChange={(e) => setQuickTermCategory(e.target.value as keyof CanonicalGlossary)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-amber-400 focus:outline-none"
                >
                  <option value="characters">Персонажи (characters)</option>
                  <option value="realms">Ступени культивации (realms)</option>
                  <option value="sects_and_places">Секты и локации (sects_and_places)</option>
                  <option value="system_and_terms">Техники и термины (system_and_terms)</option>
                  <option value="units">Меры и единицы (units)</option>
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1 text-slate-300">
                <input
                  type="checkbox"
                  checked={quickTermRipple}
                  onChange={(e) => setQuickTermRipple(e.target.checked)}
                  className="rounded border-slate-700 text-amber-500 focus:ring-0"
                />
                <span>Canon Ripple (каскадная замена во всех главах)</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowQuickTermModal(false)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSaveQuickTerm}
                disabled={!quickTermEng.trim() || !quickTermRus.trim()}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
              >
                Внести в Канон
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Selection Action Pill */}
      {selectedTextSnippet && (
        <div className="fixed bottom-7 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <button
            type="button"
            onClick={() => {
              openQuickTermFromSelection(selectedTextSnippet.text);
              setSelectedTextSnippet(null);
            }}
            className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-black font-semibold text-xs shadow-2xl shadow-amber-500/40 hover:from-amber-400 hover:to-amber-500 transition-all border border-amber-300 active:scale-95"
          >
            <BookmarkPlus className="w-4 h-4 shrink-0" />
            <span className="max-w-[200px] truncate">
              + В Канон: «<strong>{selectedTextSnippet.text}</strong>»
            </span>
            <span className="font-mono text-[10px] bg-black/20 px-1.5 py-0.5 rounded text-black/80 font-bold hidden sm:inline">
              Ctrl+Shift+M
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
