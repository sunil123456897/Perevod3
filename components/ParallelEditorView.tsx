'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Sparkles,
  Eye,
  Save,
  RotateCcw,
  Columns2,
  GitCompare,
  Undo2,
  Maximize2,
  Minimize2,
  Type,
  BookmarkPlus,
  ArrowLeft,
  ArrowRight,
  PanelRight,
  Link2,
  X,
} from 'lucide-react';
import { useToast } from './ToastProvider';
import EditorInspectorPanels, { type InspectorTab } from './editor/EditorInspectorPanels';
import EditorModes from './editor/EditorModes';
import { StudioDialog } from './studio/StudioDialog';
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
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab | null>(null);
  const lastInspectorTabRef = useRef<InspectorTab>('qa');
  const [comparedVersionLabel, setComparedVersionLabel] = useState<string | null>(null);
  const [syncScroll, setSyncScroll] = useState<boolean>(true);
  const engScrollRef = useRef<HTMLDivElement | null>(null);
  const rusTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isSyncingScrollRef = useRef<boolean>(false);
  const typoMenuRef = useRef<HTMLDivElement | null>(null);
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

  const sortedChapters = useMemo(
    () => [...allChapters].sort((a, b) => a.number - b.number),
    [allChapters]
  );
  const currentChapterIndex = sortedChapters.findIndex((c) => c.id === chapter.id);
  const previousChapter =
    currentChapterIndex > 0 ? sortedChapters[currentChapterIndex - 1] : null;
  const nextChapter =
    currentChapterIndex >= 0 && currentChapterIndex < sortedChapters.length - 1
      ? sortedChapters[currentChapterIndex + 1]
      : null;

  const isDirty =
    draftRus !== chapter.rusText ||
    draftTitleRus !== chapter.titleRus ||
    draftSummary !== (chapter.summary || '');

  const selectInspectorTab = useCallback((tab: InspectorTab) => {
    lastInspectorTabRef.current = tab;
    setActiveInspectorTab(tab);
  }, []);

  const toggleInspector = useCallback(() => {
    setActiveInspectorTab((prev) =>
      prev ? null : lastInspectorTabRef.current
    );
  }, []);

  const handleEngPaneScroll = useCallback(() => {
    if (!syncScroll || isSyncingScrollRef.current) return;
    const src = engScrollRef.current;
    const dst = rusTextareaRef.current;
    if (!src || !dst) return;
    const maxSrc = src.scrollHeight - src.clientHeight;
    const maxDst = dst.scrollHeight - dst.clientHeight;
    if (maxSrc <= 0 || maxDst <= 0) return;
    isSyncingScrollRef.current = true;
    dst.scrollTop = (src.scrollTop / maxSrc) * maxDst;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  }, [syncScroll]);

  const handleRusPaneScroll = useCallback(() => {
    if (!syncScroll || isSyncingScrollRef.current) return;
    const src = rusTextareaRef.current;
    const dst = engScrollRef.current;
    if (!src || !dst) return;
    const maxSrc = src.scrollHeight - src.clientHeight;
    const maxDst = dst.scrollHeight - dst.clientHeight;
    if (maxSrc <= 0 || maxDst <= 0) return;
    isSyncingScrollRef.current = true;
    dst.scrollTop = (src.scrollTop / maxSrc) * maxDst;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  }, [syncScroll]);

  useEffect(() => {
    if (!showTypoMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (typoMenuRef.current && !typoMenuRef.current.contains(e.target as Node)) {
        setShowTypoMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showTypoMenu]);

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
      } else if (e.altKey && !isModifier && !e.shiftKey && e.key === 'ArrowLeft' && previousChapter) {
        e.preventDefault();
        onSelectChapter(previousChapter.id);
      } else if (e.altKey && !isModifier && !e.shiftKey && e.key === 'ArrowRight' && nextChapter) {
        e.preventDefault();
        onSelectChapter(nextChapter.id);
      } else if (e.key === 'Escape') {
        if (showTypoMenu) {
          setShowTypoMenu(false);
        } else if (isZenMode) {
          setIsZenMode(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZenMode, showTypoMenu, openQuickTermFromSelection, previousChapter, nextChapter, onSelectChapter]);

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

  // 4-Component DelTA Context Packet (R^(i), A_s/A_t, M^(i) 3 paragraphs, N^(i))
  const deltaContextPacket = useMemo(() => {
    const idx = sortedChapters.findIndex((c) => c.id === chapter.id);
    const earlier = idx > 0 ? sortedChapters.slice(0, idx) : [];
    return buildDelTAContextPacket(debouncedDraftEng, previousChapter, earlier, glossary, 3);
  }, [sortedChapters, chapter.id, debouncedDraftEng, previousChapter, glossary]);

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

  const inspectorBadgeCount =
    lintReport.errorCount + lintReport.warningCount + tautologyItems.length;

  const splitHeightClass = isZenMode
    ? 'h-[calc(100dvh-13.5rem)] min-h-[460px]'
    : 'h-[min(68dvh,740px)] min-h-[460px]';

  return (
    <div
      className={
        isZenMode
          ? 'fixed inset-0 z-50 bg-[#090A0F] p-4 sm:p-6 overflow-y-auto studio-scroll flex flex-col space-y-4'
          : 'space-y-4'
      }
    >
      {/* Zen Mode Quick Status Bar */}
      {isZenMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D99B26]/35 bg-[#10131C] px-4 py-2.5 text-xs shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-2 w-2 rounded-full bg-[#D99B26]" aria-hidden="true" />
            <span className="font-semibold text-[#E5AC3D]">Zen-режим</span>
            <span className="text-[#B0B8C9] hidden sm:inline truncate">
              · Глава {chapter.subPart || chapter.number}: {draftTitleRus || chapter.titleEng}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleManualSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-3 py-1.5 font-semibold text-[#090A0F] hover:bg-[#E5AC3D] transition-colors"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Сохранить (Ctrl+S)</span>
            </button>
            <button
              type="button"
              onClick={() => setIsZenMode(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#151925] px-2.5 py-1.5 font-medium text-[#F3F4F6] hover:border-white/[0.25] transition-colors"
            >
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Выход (Esc)</span>
            </button>
          </div>
        </div>
      )}

      {/* Streamlined Editorial Toolbar */}
      <div
        role="toolbar"
        aria-label="Инструменты редактора"
        className="flex flex-wrap items-center justify-between gap-2.5 pb-3.5 border-b border-white/[0.07]"
      >
        <div role="group" aria-label="Навигация по главам и режим" className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={!previousChapter}
              onClick={() => previousChapter && onSelectChapter(previousChapter.id)}
              aria-label="Предыдущая глава"
              title="Предыдущая глава (Alt+←)"
              className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-[#10131C] text-[#B0B8C9] hover:border-white/[0.2] hover:text-[#F3F4F6] disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <select
              aria-label="Выбор главы в редакторе"
              value={chapter.id}
              onChange={(e) => onSelectChapter(e.target.value)}
              className="max-w-[230px] sm:max-w-[300px] truncate rounded-lg border border-white/[0.09] bg-[#10131C] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none cursor-pointer"
            >
              {sortedChapters.map((c) => {
                const rawTitle = (c.titleRus || c.titleEng || '').trim();
                const hasPrefix = /^(Глава|Chapter)\s+/i.test(rawTitle);
                const label = hasPrefix
                  ? rawTitle
                  : `Глава ${c.subPart || c.number}: ${rawTitle}`;
                return (
                  <option key={c.id} value={c.id} className="bg-[#10131C] text-[#F3F4F6]">
                    {label}
                  </option>
                );
              })}
            </select>

            <button
              type="button"
              disabled={!nextChapter}
              onClick={() => nextChapter && onSelectChapter(nextChapter.id)}
              aria-label="Следующая глава"
              title="Следующая глава (Alt+→)"
              className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-[#10131C] text-[#B0B8C9] hover:border-white/[0.2] hover:text-[#F3F4F6] disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <span role="separator" aria-orientation="vertical" className="hidden sm:inline-block h-5 w-px bg-white/[0.09]" />

          {/* View Modes */}
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-[#10131C] p-0.5">
            <button
              type="button"
              aria-pressed={editorMode === 'split'}
              onClick={() => setEditorMode('split')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                editorMode === 'split'
                  ? 'bg-[#151925] text-[#F3F4F6] border border-white/[0.12]'
                  : 'border border-transparent text-[#8893A8] hover:text-[#F3F4F6]'
              }`}
            >
              2 колонки
            </button>
            <button
              type="button"
              aria-pressed={editorMode === 'aligned_1to1'}
              onClick={() => setEditorMode('aligned_1to1')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                editorMode === 'aligned_1to1'
                  ? 'bg-[#151925] text-[#F3F4F6] border border-white/[0.12]'
                  : 'border border-transparent text-[#8893A8] hover:text-[#F3F4F6]'
              }`}
              title="Поабзацная матрица выравнивания 1:1"
            >
              <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Абзацы 1:1 ({alignmentGrid.engCount}/{alignmentGrid.rusCount})</span>
            </button>
            {lastPreRepairSnapshot && (
              <button
                type="button"
                aria-pressed={editorMode === 'inline_diff'}
                onClick={() => setEditorMode('inline_diff')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  editorMode === 'inline_diff'
                    ? 'bg-[#151925] text-[#E5AC3D] border border-[#D99B26]/40'
                    : 'border border-transparent text-[#D99B26] hover:text-[#F3F4F6]'
                }`}
              >
                <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Diff</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Group: QA Badge, View Toggles, Inspector & Actions */}
        <div
          role="group"
          aria-label="Оформление, инспектор и сохранение"
          className="flex flex-wrap items-center gap-1.5"
        >
          {/* Clickable Live QA Pill -> opens Inspector directly to QA tab */}
          {draftRus.trim().length === 0 ? (
            <span className="px-2 py-1 text-xs text-[#8893A8]">Ожидает перевода</span>
          ) : lintReport.passed ? (
            <button
              type="button"
              onClick={() => selectInspectorTab('qa')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>QA 100%</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => selectInspectorTab('qa')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-colors tabular-nums"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                QA: {lintReport.errorCount} ош. · {lintReport.warningCount} пред.
              </span>
            </button>
          )}

          {/* Typography Popover */}
          <div className="relative" ref={typoMenuRef}>
            <button
              type="button"
              aria-expanded={showTypoMenu}
              aria-haspopup="true"
              onClick={() => setShowTypoMenu((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                showTypoMenu
                  ? 'border-[#D99B26]/50 bg-[#151925] text-[#F3F4F6]'
                  : 'border-white/[0.08] bg-[#10131C] text-[#B0B8C9] hover:border-white/[0.16] hover:text-[#F3F4F6]'
              }`}
              title="Настройки книжной типографики"
            >
              <Type className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
              <span>Шрифт</span>
            </button>

            {showTypoMenu && (
              <div className="absolute top-full left-0 mt-1.5 z-40 w-72 rounded-xl border border-white/[0.12] bg-[#151925] p-4 shadow-[0_20px_48px_rgba(0,0,0,0.78)] space-y-3.5">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                  <span className="text-xs font-semibold text-[#F3F4F6]">Книжная типографика</span>
                  <button
                    type="button"
                    aria-label="Закрыть настройки шрифта"
                    onClick={() => setShowTypoMenu(false)}
                    className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-[#8893A8] hover:text-[#F3F4F6]"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[11px] text-[#8893A8]">Гарнитура</span>
                  <div className="grid grid-cols-3 gap-1">
                    {(['serif', 'sans', 'mono'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFontFamily(f)}
                        className={`py-1.5 text-xs rounded-lg border text-center transition-colors ${
                          fontFamily === f
                            ? 'border-[#D99B26] bg-[#D99B26]/15 text-[#E5AC3D] font-semibold'
                            : 'border-white/[0.07] bg-[#0A0C12] text-[#B0B8C9] hover:text-[#F3F4F6]'
                        }`}
                      >
                        {f === 'serif' ? 'Literata' : f === 'sans' ? 'Inter' : 'Mono'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[11px] text-[#8893A8]">Размер кегля</span>
                  <div className="grid grid-cols-4 gap-1">
                    {(['sm', 'base', 'lg', 'xl'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFontSize(s)}
                        className={`py-1.5 text-xs rounded-lg border text-center font-mono transition-colors ${
                          fontSize === s
                            ? 'border-[#D99B26] bg-[#D99B26]/15 text-[#E5AC3D] font-bold'
                            : 'border-white/[0.07] bg-[#0A0C12] text-[#B0B8C9] hover:text-[#F3F4F6]'
                        }`}
                      >
                        {s === 'sm' ? '14' : s === 'base' ? '16' : s === 'lg' ? '18' : '20'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[11px] text-[#8893A8]">Интерлиньяж</span>
                  <div className="grid grid-cols-3 gap-1">
                    {(['normal', 'relaxed', 'loose'] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLineHeight(l)}
                        className={`py-1.5 text-[11px] rounded-lg border text-center font-mono transition-colors ${
                          lineHeight === l
                            ? 'border-[#D99B26] bg-[#D99B26]/15 text-[#E5AC3D] font-semibold'
                            : 'border-white/[0.07] bg-[#0A0C12] text-[#B0B8C9] hover:text-[#F3F4F6]'
                        }`}
                      >
                        {l === 'normal' ? '1.5' : l === 'relaxed' ? '1.75' : '2.0'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[11px] text-[#8893A8]">Полоса набора</span>
                  <div className="grid grid-cols-2 gap-1">
                    {(['prose', 'full'] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setColumnWidth(w)}
                        className={`py-1.5 text-[11px] rounded-lg border text-center transition-colors ${
                          columnWidth === w
                            ? 'border-[#D99B26] bg-[#D99B26]/15 text-[#E5AC3D] font-semibold'
                            : 'border-white/[0.07] bg-[#0A0C12] text-[#B0B8C9] hover:text-[#F3F4F6]'
                        }`}
                      >
                        {w === 'prose' ? 'Книжная (68ch)' : 'На всю ширину'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            aria-pressed={highlightTerms}
            onClick={() => setHighlightTerms((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              highlightTerms
                ? 'border-[#D99B26]/50 bg-[#D99B26]/15 text-[#E5AC3D]'
                : 'border-white/[0.08] bg-[#10131C] text-[#B0B8C9] hover:border-white/[0.16] hover:text-[#F3F4F6]'
            }`}
            title="Подсвечивать термины глоссария в оригинале"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Термины</span>
          </button>

          {editorMode === 'split' && (
            <button
              type="button"
              aria-pressed={syncScroll}
              onClick={() => setSyncScroll((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                syncScroll
                  ? 'border-white/[0.18] bg-[#151925] text-[#F3F4F6]'
                  : 'border-white/[0.08] bg-[#10131C] text-[#8893A8] hover:text-[#F3F4F6]'
              }`}
              title="Синхронная прокрутка оригинала и перевода"
            >
              <Link2 className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
              <span className="hidden sm:inline">Синхр.</span>
            </button>
          )}

          <button
            type="button"
            aria-pressed={isZenMode}
            onClick={() => setIsZenMode((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              isZenMode
                ? 'border-[#D99B26]/50 bg-[#D99B26]/15 text-[#E5AC3D]'
                : 'border-white/[0.08] bg-[#10131C] text-[#B0B8C9] hover:border-white/[0.16] hover:text-[#F3F4F6]'
            }`}
            title={isZenMode ? 'Выйти из Zen-режима (Esc)' : 'Полноэкранный режим редактирования'}
          >
            {isZenMode ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
            )}
            <span>Zen</span>
          </button>

          <button
            type="button"
            aria-pressed={activeInspectorTab !== null}
            onClick={toggleInspector}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeInspectorTab !== null
                ? 'border-[#D99B26]/50 bg-[#151925] text-[#F3F4F6]'
                : 'border-white/[0.08] bg-[#10131C] text-[#B0B8C9] hover:border-white/[0.16] hover:text-[#F3F4F6]'
            }`}
            title="Инспектор главы: QA, повторы, CSI/DITING, DelTA-память, история версий, гид"
          >
            <PanelRight className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
            <span>Инспектор</span>
            {inspectorBadgeCount > 0 && (
              <span className="rounded-full bg-[#D99B26]/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#E5AC3D] leading-none tabular-nums">
                {inspectorBadgeCount}
              </span>
            )}
          </button>

          <span role="separator" aria-orientation="vertical" className="hidden sm:inline-block h-5 w-px bg-white/[0.09]" />

          {draftRus.trim().length > 0 && (
            <>
              <button
                type="button"
                onClick={handleInstantDeterministicRepair}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#151925] px-2.5 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-[#D99B26]/50 transition-colors whitespace-nowrap"
              >
                <Wand2 className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
                <span>Авто-ремонт</span>
              </button>

              <button
                type="button"
                onClick={handleAiVerifierRepair}
                disabled={isAiRepairing || isPipelineBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#10131C] px-2.5 py-1.5 text-xs font-medium text-[#B0B8C9] hover:border-white/[0.18] hover:text-[#F3F4F6] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
                <span>{isAiRepairing ? 'Вычитка...' : 'Критик'}</span>
              </button>
            </>
          )}

          {lastPreRepairSnapshot && (
            <button
              type="button"
              onClick={handleUndoRepair}
              className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#10131C] px-2.5 py-1.5 text-xs font-medium text-[#B0B8C9] hover:text-[#F3F4F6] whitespace-nowrap"
              title="Откатить последнее исправление"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Откат</span>
            </button>
          )}

          {draftRus.trim().length === 0 && (
            <button
              type="button"
              onClick={() => onRunSingleChapterPipeline(chapter.id)}
              disabled={isPipelineBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D99B26]/50 bg-[#D99B26]/15 px-3 py-1.5 text-xs font-semibold text-[#E5AC3D] hover:bg-[#D99B26]/25 disabled:opacity-50 whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Перевести главу</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleManualSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-3.5 py-1.5 text-xs font-semibold text-[#090A0F] transition-colors hover:bg-[#E5AC3D] whitespace-nowrap"
            title="Сохранить главу (Ctrl+S)"
          >
            {isDirty && (
              <span
                aria-label="Есть несохранённые изменения"
                className="h-1.5 w-1.5 rounded-full bg-[#090A0F]"
              />
            )}
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isDirty ? 'Сохранить' : 'Сохранено'}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {repairNotice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-[#10131C] px-4 py-2.5 text-xs text-emerald-200">
          <span>{repairNotice}</span>
          <button
            type="button"
            onClick={() => setRepairNotice('')}
            className="text-emerald-300 hover:text-[#F3F4F6] shrink-0"
          >
            Скрыть
          </button>
        </div>
      )}

      {/* Workspace Area: Prose Sheet + Dockable Tabbed Inspector */}
      <div
        className={
          activeInspectorTab !== null
            ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px] gap-4 items-start'
            : 'space-y-4'
        }
      >
        <div className="min-w-0 space-y-4 order-2 xl:order-1">
          {/* MODE 1: Unified Minimalist 2-Column Editorial Sheet */}
          {editorMode === 'split' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 rounded-xl border border-white/[0.09] bg-[#10131C] divide-y lg:divide-y-0 lg:divide-x divide-white/[0.07] overflow-hidden">
              {/* Left Pane: English Source */}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] bg-[#0D1017] px-5 py-2.5">
                  <span className="text-xs font-medium text-[#B0B8C9] truncate">
                    Оригинал (ENG) — {chapter.titleEng}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-[#8893A8] shrink-0">
                    {draftEng.trim().split(/\s+/).filter(Boolean).length} сл.
                  </span>
                </div>
                <div
                  ref={engScrollRef}
                  onScroll={handleEngPaneScroll}
                  onMouseUp={handleEditorMouseUp}
                  className={`${splitHeightClass} overflow-y-auto studio-scroll p-6 sm:p-7 text-[#F3F4F6]/90`}
                >
                  <div className={`mx-auto ${typoClass}`}>
                    {renderHighlightedEnglish(draftEng)}
                  </div>
                </div>
              </div>

              {/* Right Pane: Russian Translation */}
              <div className="flex flex-col min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-[#0D1017] px-5 py-2">
                  <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                    {isDirty && (
                      <span
                        className="h-2 w-2 rounded-full bg-[#D99B26] shrink-0"
                        title="Несохранённые изменения"
                      />
                    )}
                    <input
                      type="text"
                      aria-label="Заголовок главы на русском"
                      value={draftTitleRus}
                      onChange={(e) => setDraftTitleRus(e.target.value)}
                      placeholder="Название главы на русском..."
                      className="w-full bg-transparent text-xs font-semibold text-[#F3F4F6] placeholder:text-[#8893A8] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {preStylistSnapshot && (
                      <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-[#0A0C12] p-0.5">
                        <button
                          type="button"
                          onClick={() => setStylistViewMode('final')}
                          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                            stylistViewMode === 'final'
                              ? 'bg-[#151925] text-emerald-300 font-semibold'
                              : 'text-[#8893A8] hover:text-[#F3F4F6]'
                          }`}
                        >
                          Финал
                        </button>
                        <button
                          type="button"
                          onClick={() => setStylistViewMode('pre_stylist')}
                          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                            stylistViewMode === 'pre_stylist'
                              ? 'bg-[#151925] text-[#E5AC3D] font-semibold'
                              : 'text-[#8893A8] hover:text-[#F3F4F6]'
                          }`}
                        >
                          Pass 2
                        </button>
                        <button
                          type="button"
                          onClick={() => setStylistViewMode('stylist_diff')}
                          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                            stylistViewMode === 'stylist_diff'
                              ? 'bg-[#151925] text-sky-300 font-semibold'
                              : 'text-[#8893A8] hover:text-[#F3F4F6]'
                          }`}
                        >
                          Дифф
                        </button>
                      </div>
                    )}

                    <span className="font-mono text-xs tabular-nums text-[#8893A8]">
                      {draftRus.trim() ? draftRus.trim().split(/\s+/).length : 0} сл.
                    </span>

                    {isDirty && (
                      <button
                        type="button"
                        onClick={() => {
                          setDraftRus(chapter.rusText);
                          setDraftTitleRus(chapter.titleRus);
                        }}
                        aria-label="Сбросить несохранённые правки"
                        title="Сбросить несохранённые правки"
                        className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-[#8893A8] hover:bg-white/[0.06] hover:text-[#F3F4F6]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                {stylistViewMode === 'final' ? (
                  <textarea
                    ref={rusTextareaRef}
                    onScroll={handleRusPaneScroll}
                    aria-label="Текст перевода на русском"
                    value={draftRus}
                    onChange={(e) => setDraftRus(e.target.value)}
                    onMouseUp={handleEditorMouseUp}
                    onKeyUp={handleEditorMouseUp}
                    placeholder="Нажмите «Перевести главу» или введите литературный перевод..."
                    className={`w-full ${splitHeightClass} overflow-y-auto studio-scroll resize-y bg-transparent p-6 sm:p-7 text-[#F3F4F6] placeholder:text-[#8893A8] focus:outline-none ${typoClass} ${
                      columnWidth === 'prose' ? 'mx-auto' : ''
                    }`}
                  />
                ) : stylistViewMode === 'pre_stylist' ? (
                  <div
                    onMouseUp={handleEditorMouseUp}
                    className={`${splitHeightClass} overflow-y-auto studio-scroll p-6 sm:p-7 text-[#F3F4F6]/90 whitespace-pre-wrap`}
                  >
                    <div className="mb-3 rounded-lg border border-[#D99B26]/30 bg-[#0A0C12] px-3 py-2 font-mono text-xs text-[#E5AC3D]">
                      Черновик Pass 2 (до финального прохода стилиста)
                    </div>
                    <div className={`mx-auto ${typoClass}`}>{preStylistSnapshot}</div>
                  </div>
                ) : (
                  <div
                    className={`${splitHeightClass} overflow-y-auto studio-scroll p-6 sm:p-7 whitespace-pre-wrap`}
                  >
                    <div className="mb-3 rounded-lg border border-sky-500/30 bg-[#0A0C12] px-3 py-2 font-mono text-xs text-sky-300">
                      Дифф правок стилиста: красный — Pass 2, зелёный — финал
                    </div>
                    <div className={`mx-auto ${typoClass}`}>
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
                            className="bg-emerald-500/20 text-emerald-200 font-semibold px-1 py-0.5 rounded mx-0.5"
                          >
                            {seg.text}
                          </span>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        )
                      )}
                    </div>
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
        </div>

        {activeInspectorTab !== null && (
          <div className="order-1 xl:order-2">
            <EditorInspectorPanels
              activeTab={activeInspectorTab}
              onSelectTab={selectInspectorTab}
              onClose={() => setActiveInspectorTab(null)}
              chapter={chapter}
              previousChapter={previousChapter}
              draftTitleRus={draftTitleRus}
              draftEng={draftEng}
              draftRus={draftRus}
              draftSummary={draftSummary}
              setDraftSummary={setDraftSummary}
              versionHistoryList={versionHistoryList}
              onCompareWithVersion={handleCompareWithVersion}
              onRollbackToVersion={handleRollbackToVersion}
              tautologyItems={tautologyItems}
              ditingReport={ditingReport}
              csiCulturalNotes={csiCulturalNotes}
              deltaContextPacket={deltaContextPacket}
              hasIssues={hasIssues}
              genrePreset={genrePreset}
              proseTone={proseTone}
              lintReport={lintReport}
              onInstantRepair={handleInstantDeterministicRepair}
              editStyleMd={editStyleMd}
              setEditStyleMd={setEditStyleMd}
              editContextMd={editContextMd}
              setEditContextMd={setEditContextMd}
              onApplyStyleAndContext={() => {
                onUpdateStyleAndContext(editStyleMd, editContextMd);
                setRepairNotice('Стилевой гид и контекст обновлены.');
              }}
            />
          </div>
        )}
      </div>

      {/* Native Quick Canon Term Dialog */}
      <StudioDialog
        isOpen={showQuickTermModal}
        onClose={() => setShowQuickTermModal(false)}
        title={
          <>
            <Sparkles className="h-4 w-4 text-[#D99B26]" aria-hidden="true" />
            <span>Быстрое добавление в канон</span>
          </>
        }
        subtitle="Горячая клавиша в редакторе: Ctrl+Shift+M"
        titleId="quick-term-modal-title"
        maxWidthClass="max-w-md"
        footer={
          <>
            <span className="text-[11px] text-[#8893A8]">
              Применится к текущей главе и глоссарию
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowQuickTermModal(false)}
                className="rounded-lg border border-white/[0.12] bg-[#10131C] px-3.5 py-2 text-xs text-[#B0B8C9] hover:text-[#F3F4F6]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSaveQuickTerm}
                disabled={!quickTermEng.trim() || !quickTermRus.trim()}
                className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D] disabled:opacity-50"
              >
                Внести в канон
              </button>
            </div>
          </>
        }
      >
        <div className="space-y-3.5 text-xs">
          <div>
            <label htmlFor="quick-term-eng" className="block text-[#B0B8C9] mb-1.5 font-medium">
              Оригинал (ENG / CJK)
            </label>
            <input
              id="quick-term-eng"
              type="text"
              autoFocus
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
              placeholder="Напр., Origin Points или Lin Xuan"
              className="w-full rounded-lg border border-white/[0.12] bg-[#0A0C12] px-3 py-2 text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="quick-term-rus" className="block text-[#B0B8C9] mb-1.5 font-medium">
              Канонический русский перевод
            </label>
            <input
              id="quick-term-rus"
              type="text"
              value={quickTermRus}
              onChange={(e) => setQuickTermRus(e.target.value)}
              placeholder="Напр., Очки Истока или Линь Сюань"
              className="w-full rounded-lg border border-white/[0.12] bg-[#0A0C12] px-3 py-2 text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="quick-term-old-rus" className="block text-[#B0B8C9] mb-1.5 font-medium">
              Прежний вариант для замены (опционально)
            </label>
            <input
              id="quick-term-old-rus"
              type="text"
              value={quickTermOldRus}
              onChange={(e) => setQuickTermOldRus(e.target.value)}
              placeholder="Подставляется автоматически по канону"
              className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-[#B0B8C9] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="quick-term-category" className="block text-[#B0B8C9] mb-1.5 font-medium">
              Категория глоссария
            </label>
            <select
              id="quick-term-category"
              value={quickTermCategory}
              onChange={(e) => setQuickTermCategory(e.target.value as keyof CanonicalGlossary)}
              className="w-full rounded-lg border border-white/[0.12] bg-[#0A0C12] px-3 py-2 text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
            >
              <option value="characters">Персонажи (characters)</option>
              <option value="realms">Ступени культивации (realms)</option>
              <option value="sects_and_places">Секты и локации (sects_and_places)</option>
              <option value="system_and_terms">Техники и термины (system_and_terms)</option>
              <option value="units">Меры и единицы (units)</option>
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1 text-[#B0B8C9]">
            <input
              type="checkbox"
              checked={quickTermRipple}
              onChange={(e) => setQuickTermRipple(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/[0.2] bg-[#0A0C12]"
            />
            <span>Canon Ripple (каскадная замена во всех главах)</span>
          </label>
        </div>
      </StudioDialog>

      {/* Floating Selection Action Pill */}
      {selectedTextSnippet && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <button
            type="button"
            onClick={() => {
              openQuickTermFromSelection(selectedTextSnippet.text);
              setSelectedTextSnippet(null);
            }}
            className="flex items-center gap-2.5 rounded-full border border-[#D99B26]/55 bg-[#151925]/95 px-4 py-2 text-xs font-medium text-[#F3F4F6] shadow-[0_14px_36px_rgba(0,0,0,0.75)] backdrop-blur-md hover:border-[#D99B26] transition-colors"
          >
            <BookmarkPlus className="h-4 w-4 shrink-0 text-[#D99B26]" aria-hidden="true" />
            <span className="max-w-[200px] truncate">
              В канон: <strong className="text-[#E5AC3D]">«{selectedTextSnippet.text}»</strong>
            </span>
            <kbd className="font-mono text-[10px] rounded border border-white/[0.12] bg-[#0A0C12] px-1.5 py-0.5 text-[#8893A8] hidden sm:inline">
              Ctrl+Shift+M
            </kbd>
          </button>
        </div>
      )}
    </div>
  );
}
