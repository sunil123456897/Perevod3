'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Sparkles,
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
  ChevronDown,
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
  const editMenuRef = useRef<HTMLDivElement | null>(null);
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

  // Typography & View Preferences (Strictly 2 fonts: Literata & Golos Text; <= 64ch measure)
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>('base');
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans'>('serif');
  const [lineHeight, setLineHeight] = useState<'normal' | 'relaxed' | 'loose'>('relaxed');
  const [columnWidth, setColumnWidth] = useState<'prose' | 'full'>('prose');
  const [showTypoMenu, setShowTypoMenu] = useState(false);
  const [showEditMenu, setShowEditMenu] = useState(false);

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
    if (!showTypoMenu && !showEditMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (typoMenuRef.current && !typoMenuRef.current.contains(e.target as Node)) {
        setShowTypoMenu(false);
      }
      if (editMenuRef.current && !editMenuRef.current.contains(e.target as Node)) {
        setShowEditMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showTypoMenu, showEditMenu]);

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
        if (showEditMenu) {
          setShowEditMenu(false);
        } else if (showTypoMenu) {
          setShowTypoMenu(false);
        } else if (isZenMode) {
          setIsZenMode(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZenMode, showTypoMenu, showEditMenu, openQuickTermFromSelection, previousChapter, nextChapter, onSelectChapter]);

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
        ? 'text-[15px]'
        : fontSize === 'base'
        ? 'text-[17px]'
        : fontSize === 'lg'
        ? 'text-[19px]'
        : 'text-[21px]';

    const fontCls = fontFamily === 'serif' ? 'font-serif' : 'font-sans';

    const leadingCls =
      lineHeight === 'loose'
        ? 'leading-[1.95]'
        : lineHeight === 'normal'
        ? 'leading-[1.55]'
        : 'leading-[1.75]';

    const widthCls = columnWidth === 'prose' ? 'max-w-[64ch]' : 'max-w-none';

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
    ? 'h-[calc(100dvh-11.5rem)] min-h-[480px]'
    : 'h-[calc(100dvh-13.5rem)] min-h-[500px]';

  return (
    <div
      className={
        isZenMode
          ? 'fixed inset-0 z-50 bg-[#0D0D0F] p-4 sm:p-6 overflow-y-auto studio-scroll flex flex-col space-y-4'
          : 'space-y-4'
      }
    >
      {/* Zen Mode Quick Status Bar */}
      {isZenMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D69E36]/35 bg-[#141418] px-4 py-2.5 text-[13px] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-semibold text-[#E3AE48]">Zen-режим</span>
            <span className="text-[#B8B4AC] hidden sm:inline truncate">
              · Глава {chapter.subPart || chapter.number}: {draftTitleRus || chapter.titleEng}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleManualSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D69E36] px-3.5 py-1.5 text-[13px] font-semibold text-[#11100D] hover:bg-[#E3AE48] transition-colors"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Сохранить (Ctrl+S)</span>
            </button>
            <button
              type="button"
              onClick={() => setIsZenMode(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.12] bg-[#1B1B21] px-3 py-1.5 text-[13px] font-medium text-[#F2EFE9] hover:border-[#F2EFE9]/[0.24] transition-colors"
            >
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Выход (Esc)</span>
            </button>
          </div>
        </div>
      )}

      {/* Calm Single-Line Editorial Toolbar */}
      <div
        role="toolbar"
        aria-label="Инструменты редактора"
        className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-[#F2EFE9]/[0.08]"
      >
        <div
          role="group"
          aria-label="Навигация по главам и режим"
          className="flex flex-wrap items-center gap-2.5 min-w-0"
        >
          <div className="inline-flex items-center gap-1 min-w-0">
            <button
              type="button"
              disabled={!previousChapter}
              onClick={() => previousChapter && onSelectChapter(previousChapter.id)}
              aria-label="Предыдущая глава"
              title="Предыдущая глава (Alt+←)"
              className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-[#F2EFE9]/[0.1] bg-[#141418] text-[#B8B4AC] hover:border-[#F2EFE9]/[0.22] hover:text-[#F2EFE9] disabled:opacity-35 disabled:pointer-events-none transition-colors shrink-0"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            <select
              aria-label="Выбор главы в редакторе"
              value={chapter.id}
              onChange={(e) => onSelectChapter(e.target.value)}
              className="max-w-[210px] sm:max-w-[250px] truncate rounded-lg border border-[#F2EFE9]/[0.1] bg-[#141418] px-3 py-1.5 text-sm font-medium text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none cursor-pointer"
            >
              {sortedChapters.map((c) => {
                const rawTitle = (c.titleRus || c.titleEng || '').trim();
                const hasPrefix = /^(Глава|Chapter)\s+/i.test(rawTitle);
                const label = hasPrefix
                  ? rawTitle
                  : `Глава ${c.subPart || c.number}: ${rawTitle}`;
                return (
                  <option key={c.id} value={c.id} className="bg-[#141418] text-[#F2EFE9]">
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
              className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-[#F2EFE9]/[0.1] bg-[#141418] text-[#B8B4AC] hover:border-[#F2EFE9]/[0.22] hover:text-[#F2EFE9] disabled:opacity-35 disabled:pointer-events-none transition-colors shrink-0"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <span
            role="separator"
            aria-orientation="vertical"
            className="hidden sm:inline-block h-5 w-px bg-[#F2EFE9]/[0.1]"
          />

          {/* Connected Segmented View Mode */}
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[#F2EFE9]/[0.09] bg-[#141418] p-0.5">
            <button
              type="button"
              aria-pressed={editorMode === 'split'}
              onClick={() => setEditorMode('split')}
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors whitespace-nowrap ${
                editorMode === 'split'
                  ? 'bg-[#1B1B21] text-[#F2EFE9]'
                  : 'text-[#8E8A82] hover:text-[#F2EFE9]'
              }`}
            >
              2 колонки
            </button>
            <button
              type="button"
              aria-pressed={editorMode === 'aligned_1to1'}
              onClick={() => setEditorMode('aligned_1to1')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors whitespace-nowrap tabular-nums ${
                editorMode === 'aligned_1to1'
                  ? 'bg-[#1B1B21] text-[#F2EFE9]'
                  : 'text-[#8E8A82] hover:text-[#F2EFE9]'
              }`}
              title="Поабзацная матрица выравнивания 1:1"
            >
              <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>1:1 ({alignmentGrid.engCount}/{alignmentGrid.rusCount})</span>
            </button>
            {lastPreRepairSnapshot && (
              <button
                type="button"
                aria-pressed={editorMode === 'inline_diff'}
                onClick={() => setEditorMode('inline_diff')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors whitespace-nowrap ${
                  editorMode === 'inline_diff'
                    ? 'bg-[#1B1B21] text-[#E3AE48]'
                    : 'text-[#D69E36] hover:text-[#F2EFE9]'
                }`}
              >
                <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Diff</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Group: 5 Calm Controls */}
        <div
          role="group"
          aria-label="Качество, вид, правка, инспектор и сохранение"
          className="flex flex-wrap items-center gap-1.5"
        >
          {/* 1. Semantic QA Status Trigger */}
          {draftRus.trim().length === 0 ? (
            <span className="px-1 text-[13px] text-[#8E8A82]">Ожидает перевода</span>
          ) : lintReport.passed ? (
            <button
              type="button"
              onClick={() => selectInspectorTab('qa')}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-[#6EE7B7] hover:bg-[#52C79A]/10 transition-colors whitespace-nowrap"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>QA 100%</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => selectInspectorTab('qa')}
              title={`Ошибок: ${lintReport.errorCount}, предупреждений: ${lintReport.warningCount}`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-[#FDA4AF] hover:bg-[#F07587]/10 transition-colors whitespace-nowrap tabular-nums"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <span>
                {lintReport.errorCount > 0
                  ? `QA: ${lintReport.errorCount} ош.`
                  : `QA: ${lintReport.warningCount} пред.`}
              </span>
            </button>
          )}

          {/* 2. Unified View & Typography Popover */}
          <div className="relative" ref={typoMenuRef}>
            <button
              type="button"
              aria-expanded={showTypoMenu}
              aria-haspopup="true"
              onClick={() => {
                setShowEditMenu(false);
                setShowTypoMenu((prev) => !prev);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap ${
                showTypoMenu
                  ? 'border-[#D69E36]/50 bg-[#1B1B21] text-[#F2EFE9]'
                  : 'border-[#F2EFE9]/[0.1] bg-[#141418] text-[#B8B4AC] hover:border-[#F2EFE9]/[0.2] hover:text-[#F2EFE9]'
              }`}
              title="Книжная типографика и режим чтения"
            >
              <Type className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
              <span>Вид</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            {showTypoMenu && (
              <div className="absolute top-full left-0 lg:left-auto lg:right-0 mt-2 z-40 w-72 rounded-xl border border-[#F2EFE9]/[0.12] bg-[#1B1B21] p-4 shadow-[0_20px_48px_rgba(0,0,0,0.8)] space-y-4">
                <div className="flex items-center justify-between border-b border-[#F2EFE9]/[0.08] pb-2.5">
                  <span className="text-sm font-semibold text-[#F2EFE9]">Настройки чтения</span>
                  <button
                    type="button"
                    aria-label="Закрыть настройки чтения"
                    onClick={() => setShowTypoMenu(false)}
                    className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-[#8E8A82] hover:text-[#F2EFE9]"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[13px] text-[#8E8A82]">Гарнитура</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['serif', 'sans'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFontFamily(f)}
                        className={`py-1.5 text-[13px] rounded-lg border text-center transition-colors ${
                          fontFamily === f
                            ? 'border-[#D69E36] bg-[#D69E36]/15 text-[#E3AE48] font-medium'
                            : 'border-[#F2EFE9]/[0.08] bg-[#101014] text-[#B8B4AC] hover:text-[#F2EFE9]'
                        }`}
                      >
                        {f === 'serif' ? 'Literata' : 'Golos Text'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[13px] text-[#8E8A82]">Кегль (px)</span>
                  <div className="grid grid-cols-4 gap-1.5 tabular-nums">
                    {(['sm', 'base', 'lg', 'xl'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFontSize(s)}
                        className={`py-1.5 text-[13px] rounded-lg border text-center transition-colors ${
                          fontSize === s
                            ? 'border-[#D69E36] bg-[#D69E36]/15 text-[#E3AE48] font-semibold'
                            : 'border-[#F2EFE9]/[0.08] bg-[#101014] text-[#B8B4AC] hover:text-[#F2EFE9]'
                        }`}
                      >
                        {s === 'sm' ? '15' : s === 'base' ? '17' : s === 'lg' ? '19' : '21'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[13px] text-[#8E8A82]">Интерлиньяж</span>
                  <div className="grid grid-cols-3 gap-1.5 tabular-nums">
                    {(['normal', 'relaxed', 'loose'] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLineHeight(l)}
                        className={`py-1.5 text-[13px] rounded-lg border text-center transition-colors ${
                          lineHeight === l
                            ? 'border-[#D69E36] bg-[#D69E36]/15 text-[#E3AE48] font-medium'
                            : 'border-[#F2EFE9]/[0.08] bg-[#101014] text-[#B8B4AC] hover:text-[#F2EFE9]'
                        }`}
                      >
                        {l === 'normal' ? '1.55' : l === 'relaxed' ? '1.75' : '1.95'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[13px] text-[#8E8A82]">Полоса набора</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['prose', 'full'] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setColumnWidth(w)}
                        className={`py-1.5 text-[13px] rounded-lg border text-center transition-colors ${
                          columnWidth === w
                            ? 'border-[#D69E36] bg-[#D69E36]/15 text-[#E3AE48] font-medium'
                            : 'border-[#F2EFE9]/[0.08] bg-[#101014] text-[#B8B4AC] hover:text-[#F2EFE9]'
                        }`}
                      >
                        {w === 'prose' ? 'Книжная (64ch)' : 'Полная'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-[#F2EFE9]/[0.08] space-y-2.5 text-[13px] text-[#B8B4AC]">
                  <label className="flex items-center justify-between gap-2 cursor-pointer hover:text-[#F2EFE9]">
                    <span>Подсветка терминов</span>
                    <input
                      type="checkbox"
                      checked={highlightTerms}
                      onChange={(e) => setHighlightTerms(e.target.checked)}
                      className="h-4 w-4 rounded border-[#F2EFE9]/[0.2] bg-[#101014]"
                    />
                  </label>
                  {editorMode === 'split' && (
                    <label className="flex items-center justify-between gap-2 cursor-pointer hover:text-[#F2EFE9]">
                      <span>Синхронный скролл</span>
                      <input
                        type="checkbox"
                        checked={syncScroll}
                        onChange={(e) => setSyncScroll(e.target.checked)}
                        className="h-4 w-4 rounded border-[#F2EFE9]/[0.2] bg-[#101014]"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowTypoMenu(false);
                      setIsZenMode((prev) => !prev);
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-[#F2EFE9]/[0.09] bg-[#101014] px-3 py-2 text-[13px] font-medium text-[#F2EFE9] hover:border-[#D69E36]/50 transition-colors"
                  >
                    <span>{isZenMode ? 'Выйти из Zen-режима' : 'Полноэкранный Zen'}</span>
                    {isZenMode ? (
                      <Minimize2 className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 3. Editorial Repair / Translate Action */}
          {draftRus.trim().length > 0 ? (
            <div className="relative" ref={editMenuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={showEditMenu}
                onClick={() => {
                  setShowTypoMenu(false);
                  setShowEditMenu((prev) => !prev);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap ${
                  showEditMenu
                    ? 'border-[#D69E36]/50 bg-[#1B1B21] text-[#F2EFE9]'
                    : 'border-[#F2EFE9]/[0.1] bg-[#141418] text-[#F2EFE9] hover:border-[#F2EFE9]/[0.22]'
                }`}
              >
                <Wand2 className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
                <span>{isAiRepairing ? 'Вычитка...' : 'Правка'}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#8E8A82]" aria-hidden="true" />
              </button>

              {showEditMenu && (
                <div
                  role="menu"
                  aria-label="Инструменты правки главы"
                  className="absolute right-0 top-full mt-2 z-40 w-64 rounded-xl border border-[#F2EFE9]/[0.12] bg-[#1B1B21] p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.8)] text-sm"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowEditMenu(false);
                      handleInstantDeterministicRepair();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[#F2EFE9] hover:bg-[#F2EFE9]/[0.06] transition-colors"
                  >
                    <Wand2 className="h-4 w-4 text-[#D69E36]" aria-hidden="true" />
                    <span>Авто-ремонт QA</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isAiRepairing || isPipelineBusy}
                    onClick={() => {
                      setShowEditMenu(false);
                      handleAiVerifierRepair();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[#F2EFE9] hover:bg-[#F2EFE9]/[0.06] disabled:opacity-50 transition-colors"
                  >
                    <Sparkles className="h-4 w-4 text-[#D69E36]" aria-hidden="true" />
                    <span>{isAiRepairing ? 'Идёт ИИ-вычитка...' : 'Вычитка ИИ-критиком'}</span>
                  </button>
                  {lastPreRepairSnapshot && (
                    <>
                      <div className="my-1 border-t border-[#F2EFE9]/[0.08]" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowEditMenu(false);
                          handleUndoRepair();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[#FDA4AF] hover:bg-[#F07587]/10 transition-colors"
                      >
                        <Undo2 className="h-4 w-4" aria-hidden="true" />
                        <span>Откатить правки</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onRunSingleChapterPipeline(chapter.id)}
              disabled={isPipelineBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D69E36] px-3.5 py-1.5 text-[13px] font-semibold text-[#11100D] hover:bg-[#E3AE48] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Перевести главу</span>
            </button>
          )}

          {/* 4. Inspector Toggle */}
          <button
            type="button"
            aria-pressed={activeInspectorTab !== null}
            onClick={toggleInspector}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap tabular-nums ${
              activeInspectorTab !== null
                ? 'border-[#D69E36]/50 bg-[#1B1B21] text-[#F2EFE9]'
                : 'border-[#F2EFE9]/[0.1] bg-[#141418] text-[#B8B4AC] hover:border-[#F2EFE9]/[0.2] hover:text-[#F2EFE9]'
            }`}
            title="Инспектор главы: QA, повторы, CSI/DITING, DelTA-память, история версий, гид"
          >
            <PanelRight className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
            <span>Инспектор</span>
            {inspectorBadgeCount > 0 && (
              <span className="font-semibold text-[#D69E36]">{inspectorBadgeCount}</span>
            )}
          </button>

          {/* 5. Save Button — Brass Primary when dirty, calm surface when saved */}
          <button
            type="button"
            onClick={handleManualSave}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors whitespace-nowrap ${
              isDirty
                ? 'bg-[#D69E36] text-[#11100D] hover:bg-[#E3AE48]'
                : 'border border-[#F2EFE9]/[0.12] bg-[#1B1B21] text-[#F2EFE9] hover:border-[#F2EFE9]/[0.24]'
            }`}
            title="Сохранить главу (Ctrl+S)"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isDirty ? 'Сохранить' : 'Сохранено'}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {repairNotice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#52C79A]/35 bg-[#141418] px-4 py-2.5 text-[13px] text-[#6EE7B7]">
          <span>{repairNotice}</span>
          <button
            type="button"
            onClick={() => setRepairNotice('')}
            className="text-[#B8B4AC] hover:text-[#F2EFE9] shrink-0 transition-colors"
          >
            Скрыть
          </button>
        </div>
      )}

      {/* Workspace Area: Prose Sheet + Dockable Tabbed Inspector */}
      <div
        className={
          activeInspectorTab !== null
            ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start'
            : 'space-y-4'
        }
      >
        <div className="min-w-0 space-y-4 order-2 xl:order-1">
          {/* MODE 1: Unified Minimalist 2-Column Editorial Sheet */}
          {editorMode === 'split' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 rounded-xl border border-[#F2EFE9]/[0.09] bg-[#141418] divide-y lg:divide-y-0 lg:divide-x divide-[#F2EFE9]/[0.08] overflow-hidden">
              {/* Left Pane: English Source */}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center justify-between gap-3 border-b border-[#F2EFE9]/[0.08] bg-[#101014] px-5 py-3">
                  <span className="text-[13px] font-medium text-[#B8B4AC] truncate">
                    Оригинал (ENG) · {chapter.titleEng}
                  </span>
                  <span className="text-[13px] tabular-nums text-[#8E8A82] shrink-0">
                    {draftEng.trim().split(/\s+/).filter(Boolean).length} сл.
                  </span>
                </div>
                <div
                  ref={engScrollRef}
                  onScroll={handleEngPaneScroll}
                  onMouseUp={handleEditorMouseUp}
                  className={`${splitHeightClass} overflow-y-auto studio-scroll p-6 sm:p-8 text-[#F2EFE9]/90`}
                >
                  <div className={`mx-auto ${typoClass}`}>
                    {renderHighlightedEnglish(draftEng)}
                  </div>
                </div>
              </div>

              {/* Right Pane: Russian Translation */}
              <div className="flex flex-col min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F2EFE9]/[0.08] bg-[#101014] px-5 py-2.5">
                  <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                    <input
                      type="text"
                      aria-label="Заголовок главы на русском"
                      value={draftTitleRus}
                      onChange={(e) => setDraftTitleRus(e.target.value)}
                      placeholder="Название главы на русском..."
                      className="w-full bg-transparent text-sm font-semibold text-[#F2EFE9] placeholder:text-[#8E8A82] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {preStylistSnapshot && (
                      <div className="inline-flex items-center gap-0.5 rounded-lg border border-[#F2EFE9]/[0.09] bg-[#141418] p-0.5">
                        <button
                          type="button"
                          onClick={() => setStylistViewMode('final')}
                          className={`px-2 py-0.5 text-[13px] rounded transition-colors ${
                            stylistViewMode === 'final'
                              ? 'bg-[#1B1B21] text-[#6EE7B7] font-medium'
                              : 'text-[#8E8A82] hover:text-[#F2EFE9]'
                          }`}
                        >
                          Финал
                        </button>
                        <button
                          type="button"
                          onClick={() => setStylistViewMode('pre_stylist')}
                          className={`px-2 py-0.5 text-[13px] rounded transition-colors ${
                            stylistViewMode === 'pre_stylist'
                              ? 'bg-[#1B1B21] text-[#E3AE48] font-medium'
                              : 'text-[#8E8A82] hover:text-[#F2EFE9]'
                          }`}
                        >
                          Pass 2
                        </button>
                        <button
                          type="button"
                          onClick={() => setStylistViewMode('stylist_diff')}
                          className={`px-2 py-0.5 text-[13px] rounded transition-colors ${
                            stylistViewMode === 'stylist_diff'
                              ? 'bg-[#1B1B21] text-[#F2EFE9] font-medium'
                              : 'text-[#8E8A82] hover:text-[#F2EFE9]'
                          }`}
                        >
                          Дифф
                        </button>
                      </div>
                    )}

                    <span className="text-[13px] tabular-nums text-[#8E8A82]">
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
                        className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-lg text-[#8E8A82] hover:bg-[#F2EFE9]/[0.06] hover:text-[#F2EFE9] transition-colors"
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
                    className={`w-full ${splitHeightClass} overflow-y-auto studio-scroll resize-y bg-transparent p-6 sm:p-8 text-[#F2EFE9] placeholder:text-[#8E8A82] focus:outline-none ${typoClass} ${
                      columnWidth === 'prose' ? 'mx-auto' : ''
                    }`}
                  />
                ) : stylistViewMode === 'pre_stylist' ? (
                  <div
                    onMouseUp={handleEditorMouseUp}
                    className={`${splitHeightClass} overflow-y-auto studio-scroll p-6 sm:p-8 text-[#F2EFE9]/90 whitespace-pre-wrap`}
                  >
                    <div className="mb-4 border-l-2 border-[#D69E36] pl-3 py-1 text-[13px] text-[#E3AE48]">
                      Черновик Pass 2 (до финального прохода стилиста)
                    </div>
                    <div className={`mx-auto ${typoClass}`}>{preStylistSnapshot}</div>
                  </div>
                ) : (
                  <div
                    className={`${splitHeightClass} overflow-y-auto studio-scroll p-6 sm:p-8 whitespace-pre-wrap`}
                  >
                    <div className="mb-4 border-l-2 border-[#52C79A] pl-3 py-1 text-[13px] text-[#B8B4AC]">
                      Дифф правок стилиста: красный (Pass 2), зелёный (финал)
                    </div>
                    <div className={`mx-auto ${typoClass}`}>
                      {stylistDiffSegments.map((seg, i) =>
                        seg.type === 'removed' ? (
                          <span
                            key={i}
                            className="bg-[#F07587]/20 text-[#FDA4AF] line-through decoration-[#F07587] px-1 py-0.5 rounded mx-0.5"
                          >
                            {seg.text}
                          </span>
                        ) : seg.type === 'added' ? (
                          <span
                            key={i}
                            className="bg-[#52C79A]/20 text-[#6EE7B7] font-medium px-1 py-0.5 rounded mx-0.5"
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
            <Sparkles className="h-4 w-4 text-[#D69E36]" aria-hidden="true" />
            <span>Быстрое добавление в канон</span>
          </>
        }
        subtitle="Горячая клавиша в редакторе: Ctrl+Shift+M"
        titleId="quick-term-modal-title"
        maxWidthClass="max-w-md"
        footer={
          <>
            <span className="text-[13px] text-[#8E8A82]">
              Применится к главе и глоссарию
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowQuickTermModal(false)}
                className="rounded-lg border border-[#F2EFE9]/[0.12] bg-[#141418] px-3.5 py-2 text-[13px] text-[#B8B4AC] hover:text-[#F2EFE9] transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSaveQuickTerm}
                disabled={!quickTermEng.trim() || !quickTermRus.trim()}
                className="rounded-lg bg-[#D69E36] px-4 py-2 text-[13px] font-semibold text-[#11100D] hover:bg-[#E3AE48] disabled:opacity-50 transition-colors"
              >
                Внести в канон
              </button>
            </div>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div>
            <label htmlFor="quick-term-eng" className="block text-[13px] text-[#B8B4AC] mb-1.5 font-medium">
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
              className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-sm text-[#F2EFE9] placeholder:text-[#8E8A82] focus:border-[#D69E36] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="quick-term-rus" className="block text-[13px] text-[#B8B4AC] mb-1.5 font-medium">
              Канонический русский перевод
            </label>
            <input
              id="quick-term-rus"
              type="text"
              value={quickTermRus}
              onChange={(e) => setQuickTermRus(e.target.value)}
              placeholder="Напр., Очки Истока или Линь Сюань"
              className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-sm text-[#F2EFE9] placeholder:text-[#8E8A82] focus:border-[#D69E36] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="quick-term-old-rus" className="block text-[13px] text-[#B8B4AC] mb-1.5 font-medium">
              Прежний вариант для замены (опционально)
            </label>
            <input
              id="quick-term-old-rus"
              type="text"
              value={quickTermOldRus}
              onChange={(e) => setQuickTermOldRus(e.target.value)}
              placeholder="Подставляется автоматически по канону"
              className="w-full rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] px-3 py-2 text-sm text-[#B8B4AC] placeholder:text-[#8E8A82] focus:border-[#D69E36] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="quick-term-category" className="block text-[13px] text-[#B8B4AC] mb-1.5 font-medium">
              Категория глоссария
            </label>
            <select
              id="quick-term-category"
              value={quickTermCategory}
              onChange={(e) => setQuickTermCategory(e.target.value as keyof CanonicalGlossary)}
              className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-sm text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
            >
              <option value="characters">Персонажи (characters)</option>
              <option value="realms">Ступени культивации (realms)</option>
              <option value="sects_and_places">Секты и локации (sects_and_places)</option>
              <option value="system_and_terms">Техники и термины (system_and_terms)</option>
              <option value="units">Меры и единицы (units)</option>
            </select>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer pt-1 text-[13px] text-[#B8B4AC]">
            <input
              type="checkbox"
              checked={quickTermRipple}
              onChange={(e) => setQuickTermRipple(e.target.checked)}
              className="h-4 w-4 rounded border-[#F2EFE9]/[0.2] bg-[#101014]"
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
            className="flex items-center gap-2.5 rounded-full border border-[#D69E36]/55 bg-[#1B1B21]/95 px-4 py-2 text-[13px] font-medium text-[#F2EFE9] shadow-[0_14px_36px_rgba(0,0,0,0.8)] backdrop-blur-md hover:border-[#D69E36] transition-colors"
          >
            <BookmarkPlus className="h-4 w-4 shrink-0 text-[#D69E36]" aria-hidden="true" />
            <span className="max-w-[200px] truncate">
              В канон: <strong className="text-[#E3AE48]">«{selectedTextSnippet.text}»</strong>
            </span>
            <kbd className="font-mono text-[13px] leading-none rounded border border-[#F2EFE9]/[0.12] bg-[#101014] px-1.5 py-0.5 text-[#8E8A82] hidden sm:inline">
              Ctrl+Shift+M
            </kbd>
          </button>
        </div>
      )}
    </div>
  );
}
