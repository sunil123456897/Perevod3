'use client';

import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Sparkles,
  BookOpen,
  Eye,
  Save,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  History,
  Columns2,
  Radar,
  GitCompare,
  Undo2,
  Clock,
} from 'lucide-react';
import {
  finalizeAndVerifyChapter,
  runQaLinter,
  autoRepairRussianText,
  surgicalRepairDriftedParagraphs,
  generateChapterMemorySummary,
  generateBilingualChapterSummary,
  buildDelTAContextPacket,
  extractCsiCulturalNotes,
  evaluateDitingQuality,
  alignChapterParagraphs,
  detectTautologies,
  computeWordDiff,
  GENRE_PRESET_LABELS,
  PROSE_TONE_LABELS,
  type CanonicalGlossary,
  type GlossaryTermMeta,
  type LintRuleId,
  type GenrePreset,
  type ProseTone,
  type ScoutedTerm,
  type LlmProviderConfig,
} from '@/lib/qa-linter';
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
  onApplyCanonRipple?: (eng: string, newRus: string) => void;
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
  const [quickTermCategory, setQuickTermCategory] = useState<keyof CanonicalGlossary>('system_and_terms');
  const [quickTermRipple, setQuickTermRipple] = useState(true);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault();
        const sel = window.getSelection()?.toString().trim() || '';
        if (sel) {
          if (/[a-zA-Z]/.test(sel)) {
            setQuickTermEng(sel);
            setQuickTermRus('');
          } else {
            setQuickTermRus(sel);
            setQuickTermEng('');
          }
        }
        setShowQuickTermModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (syncedChapterId !== chapter.id) {
    setSyncedChapterId(chapter.id);
    setSyncedParentRus(chapter.rusText);
    setDraftTitleRus(chapter.titleRus);
    setDraftEng(chapter.engText);
    setDraftRus(chapter.rusText);
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
    return buildDelTAContextPacket(draftEng, previousChapter, earlier, glossary, 3);
  }, [allChapters, chapter.id, draftEng, previousChapter, glossary]);

  // CHORUS C3 Cultural Footnotes & Rationales
  const csiCulturalNotes = useMemo(() => {
    if (chapter.csiNotes && chapter.csiNotes.length > 0 && draftRus === chapter.rusText) {
      return chapter.csiNotes;
    }
    return extractCsiCulturalNotes(draftEng, draftRus, glossary);
  }, [chapter.csiNotes, chapter.rusText, draftEng, draftRus, glossary]);

  // DITING 6-Dimension Quality Report
  const ditingReport = useMemo(
    () => evaluateDitingQuality(draftEng, draftRus, glossary, glossaryMeta, enabledRuleIds),
    [draftEng, draftRus, glossary, glossaryMeta, enabledRuleIds]
  );

  const lintReport = useMemo(
    () =>
      runQaLinter(draftEng, draftRus, glossary, {
        enabledRuleIds,
        glossaryMeta,
      }),
    [draftEng, draftRus, glossary, enabledRuleIds, glossaryMeta]
  );

  // 1:1 Paragraph Alignment Grid
  const alignmentGrid = useMemo(
    () => alignChapterParagraphs(draftEng, draftRus),
    [draftEng, draftRus]
  );

  // Live bilingual summary synchronization with current draft
  const liveBilingualSummary = useMemo(() => {
    if (!draftEng.trim() || !draftRus.trim()) return null;
    return generateBilingualChapterSummary(
      chapter.number,
      chapter.titleEng,
      draftEng,
      draftTitleRus || `Глава ${chapter.number}`,
      draftRus
    );
  }, [chapter.number, chapter.titleEng, draftEng, draftTitleRus, draftRus]);

  const handleSyncSummaryToDraft = () => {
    if (liveBilingualSummary) {
      setDraftSummary(liveBilingualSummary.rus);
      setRepairNotice('Краткое содержание синхронизировано с текущим текстом.');
    }
  };

  const handleSaveQuickTerm = () => {
    if (!quickTermEng.trim() || !quickTermRus.trim()) return;
    if (onAddCanonTerm) {
      onAddCanonTerm(quickTermCategory, quickTermEng.trim(), quickTermRus.trim());
    }
    if (quickTermRipple && onApplyCanonRipple) {
      onApplyCanonRipple(quickTermEng.trim(), quickTermRus.trim());
    }
    const re = new RegExp(`\\b${quickTermEng.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'gi');
    if (re.test(draftRus)) {
      setDraftRus((prev) => prev.replace(re, quickTermRus.trim()));
    }
    setShowQuickTermModal(false);
    setRepairNotice(
      `Термин «${quickTermEng}» → «${quickTermRus}» добавлен в канон${
        quickTermRipple ? ' с Canon Ripple' : ''
      }.`
    );
  };

  // Tautology & Repetition Radar
  const tautologyItems = useMemo(() => detectTautologies(draftRus), [draftRus]);

  // Word-level Inline Diff when comparing before/after repair
  const wordDiffSegments = useMemo(() => {
    if (!lastPreRepairSnapshot) return [];
    return computeWordDiff(lastPreRepairSnapshot, draftRus);
  }, [lastPreRepairSnapshot, draftRus]);

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

  const versionHistoryList = useMemo<ChapterVersionSnapshot[]>(() => {
    const existing = chapter.versionHistory || [];
    if (existing.length > 0) return existing;
    if (!chapter.rusText.trim()) return [];
    const baseReport = runQaLinter(chapter.engText, chapter.rusText, glossary, {
      enabledRuleIds,
      glossaryMeta,
    });
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
        qaPassed: baseReport.passed,
        qaErrorCount: baseReport.errorCount,
      },
    ];
  }, [
    chapter.id,
    chapter.versionHistory,
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
    return next.slice(-12);
  };

  const handleInstantDeterministicRepair = () => {
    const preText = draftRus;
    const preReport = lintReport;
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
    setDraftSummary(nextSummary);
    setEditorMode('inline_diff');
    if (combinedFixes.length > 0) {
      setRepairNotice(`Исправлено автоматически: ${combinedFixes.join(' · ')}`);
    } else {
      setRepairNotice('Все 100% проверок QA пройдены.');
    }
    onSaveChapter({
      ...chapter,
      titleRus: draftTitleRus,
      engText: draftEng,
      rusText: repairedText,
      summary: nextSummary,
      versionHistory: updatedHistory,
      translated: Boolean(repairedText.trim()),
      edited: Boolean(repairedText.trim()),
      verified: postReport.passed && Boolean(repairedText.trim()),
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
    setIsAiRepairing(true);
    setRepairNotice('');
    setLastPreRepairSnapshot(draftRus);
    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'self_repair',
          chapterNumber: chapter.number,
          titleEng: chapter.titleEng,
          engText: draftEng,
          rusText: draftRus,
          glossary,
          glossaryMeta,
          enabledRuleIds,
          genrePreset,
          proseTone,
          previousChapterSummary: previousChapter?.summary || '',
          styleGuideMd,
          contextMd,
          llmConfig,
        }),
      });
      const data = await response.json();
      const nextRus = data.repairedText || data.rusText;
      if (nextRus) {
        const nextSummary =
          data.chapterSummary ||
          draftSummary ||
          generateChapterMemorySummary(
            chapter.number,
            draftTitleRus || chapter.titleEng,
            nextRus
          );
        setDraftRus(nextRus);
        setDraftSummary(nextSummary);
        setEditorMode('inline_diff');
        setRepairNotice(
          data.appliedFixes?.length
            ? `Литературный критик и QA: ${data.appliedFixes.join(' · ')}`
            : 'ИИ-редактор завершил вычитку.'
        );
        onSaveChapter({
          ...chapter,
          titleRus: draftTitleRus,
          engText: draftEng,
          rusText: nextRus,
          summary: nextSummary,
          translated: true,
          edited: true,
          verified: Boolean(data.lintReport?.passed),
          wordCountEng: draftEng.trim().split(/\s+/).filter(Boolean).length,
          wordCountRus: nextRus.trim().split(/\s+/).filter(Boolean).length,
          lastUpdated: new Date().toISOString().slice(0, 16).replace('T', ' '),
        });
      }
    } catch {
      const fallback = finalizeAndVerifyChapter({
        chapterNumber: chapter.number,
        titleEng: chapter.titleEng,
        titleRus: draftTitleRus,
        engText: draftEng,
        candidateRusText: draftRus,
        glossary,
        glossaryMeta,
        enabledRuleIds,
        runSurgicalDriftRepair: true,
      });
      setDraftRus(fallback.rusText);
      setEditorMode('inline_diff');
      setRepairNotice('Выполнен локальный авто-ремонт по правилам канона.');
    } finally {
      setIsAiRepairing(false);
    }
  };

  const handleManualSave = () => {
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
        qaPassed: lintReport.passed,
        qaErrorCount: lintReport.errorCount,
      },
    ]);
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
      verified: lintReport.passed && draftRus.trim().length > 0,
      wordCountEng: draftEng.trim().split(/\s+/).filter(Boolean).length,
      wordCountRus: draftRus.trim() ? draftRus.trim().split(/\s+/).length : 0,
      lastUpdated: nowStr,
    });
    setRepairNotice('Глава, версия в истории и память сюжета сохранены.');
  };

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
    <div className="space-y-4">
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

      {/* Version History Panel (Compare & Rollback across Pipeline Passes) */}
      {showVersionHistoryPanel && (
        <div
          role="region"
          aria-label="История версий главы"
          className="rounded-xl border border-amber-500/30 bg-slate-900/80 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-amber-300">
                История версий и результатов прохождения конвейера (Глава{' '}
                {chapter.subPart || chapter.number})
              </span>
              <p className="text-[11px] text-slate-400">
                Сравните любую предыдущую фазу конвейера с текущим текстом пословно (Diff) или
                откатите главу в один клик.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowVersionHistoryPanel(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Свернуть
            </button>
          </div>

          {versionHistoryList.length === 0 ? (
            <p className="text-xs text-slate-400">
              Для этой главы пока нет сохранённых версий — запустите перевод или нажмите «Сохранить».
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {[...versionHistoryList].reverse().map((snap, revIdx) => {
                const versionNumber = versionHistoryList.length - revIdx;
                const isIdenticalToCurrent = snap.rusText.trim() === draftRus.trim();

                return (
                  <div
                    key={snap.id}
                    className={`rounded-lg border p-3 text-xs space-y-2 transition ${
                      isIdenticalToCurrent
                        ? 'border-emerald-500/40 bg-emerald-950/15'
                        : 'border-slate-800 bg-slate-950/85'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                          v{versionNumber}
                        </span>
                        <span className="font-semibold text-slate-100">
                          {snap.stageLabel}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {snap.timestamp} · {snap.wordCountRus} сл.
                      </span>
                    </div>

                    <p className="line-clamp-2 text-slate-400 font-serif">
                      {snap.rusText}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span
                        className={`font-mono text-[11px] font-medium ${
                          snap.qaPassed ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {snap.qaPassed
                          ? '100% QA Pass'
                          : `Замечаний QA: ${snap.qaErrorCount}`}
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCompareWithVersion(snap)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300 transition"
                        >
                          <GitCompare className="h-3 w-3" />
                          Сравнить с текущим
                        </button>

                        {isIdenticalToCurrent ? (
                          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                            Активная версия
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRollbackToVersion(snap)}
                            className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/40 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25 transition"
                          >
                            <Undo2 className="h-3 w-3" />
                            Откатить к v{versionNumber}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tautology Radar Panel */}
      {showTautologyPanel && (
        <div className="rounded-xl border border-amber-500/30 bg-slate-900/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-300">
              Радар тавтологий и лексических повторов в соседних предложениях
            </span>
            <button
              type="button"
              onClick={() => setShowTautologyPanel(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Свернуть
            </button>
          </div>
          {tautologyItems.length === 0 ? (
            <p className="text-xs text-emerald-400">
              Лексических повторов в скользящем окне не обнаружено — проза разнообразна.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {tautologyItems.map((t, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-300">
                      Строка #{t.line} · повтор «{t.wordSample}» ({t.count} раза в абзаце)
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      основа: {t.stem}-
                    </span>
                  </div>
                  <p className="text-slate-400">«{t.snippet}»</p>
                  {t.synonymHint && (
                    <p className="text-emerald-400 font-medium">{t.synonymHint}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CHORUS C3 Cultural Footnotes (CSI) & DITING 6D Quality Judge Panel */}
      {showCsiDitingPanel && (
        <div
          role="region"
          aria-label="Культурные сноски CSI и оценка DITING"
          className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <span className="text-xs font-semibold text-amber-300">
                3-Ролевой конвейер LCD-MAS · Журнал культурных реалий CSI (CHORUS C3) и судья DITING
              </span>
              <p className="text-[11px] text-slate-400">
                Прозрачное обоснование адаптации идиом, гоноративов и терминов + многомерная оценка нарративной достоверности.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-emerald-400">
                {ditingReport.mqmGrade} · {ditingReport.overallScore}/100
              </span>
              <button
                type="button"
                onClick={() => setShowCsiDitingPanel(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Свернуть
              </button>
            </div>
          </div>

          {/* 6-Dimension DITING Score Strip */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Идиоматика', val: ditingReport.idiomAccuracy },
              { label: 'Связность сцен', val: ditingReport.referentialCohesion },
              { label: 'Голоса героев', val: ditingReport.characterVoiceFidelity },
              { label: 'Культурный код', val: ditingReport.culturalAdaptation },
              { label: 'Ритмика прозы', val: ditingReport.literaryRhythm },
              { label: 'Точность канона', val: ditingReport.terminologyPrecision },
            ].map((dim) => (
              <div
                key={dim.label}
                className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs"
              >
                <div className="text-[11px] text-slate-400 truncate">{dim.label}</div>
                <div
                  className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                    dim.val >= 95
                      ? 'text-emerald-400'
                      : dim.val >= 85
                        ? 'text-amber-300'
                        : 'text-rose-400'
                  }`}
                >
                  {dim.val}%
                </div>
              </div>
            ))}
          </div>

          {/* CSI Cultural Notes List */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">
              Обоснование решений локализатора CSI ({csiCulturalNotes.length})
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {csiCulturalNotes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/85 p-3 text-xs space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100">{note.sourcePhrase}</span>
                    <span className="font-mono text-[11px] text-amber-300">
                      {note.categoryLabel}
                    </span>
                  </div>
                  <div className="text-emerald-400 font-medium">
                    Адаптация: {note.adaptedRus}
                  </div>
                  <p className="text-slate-400 leading-relaxed">{note.rationale}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4-Component DelTA Memory & Continuity Inspector */}
      {showMemoryBar && (
        <div
          role="region"
          aria-label="Четырёхкомпонентная память DelTA"
          className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <span className="text-xs font-semibold text-amber-300">
                Четырёхуровневая память документа DelTA (Doc2Sent)
              </span>
              <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                Реестр сущностей R^(i): {deltaContextPacket.properNounCount} терм. · Окно M^(i):{' '}
                {deltaContextPacket.shortTermWindow.length} абз. ENG↔RUS · Долгосрочная память N^(i):{' '}
                {deltaContextPacket.longTermMemories.length} сцен
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowMemoryBar(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Свернуть
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-300">
                Двуязычное макро-резюме предыдущей главы (A_s [ENG] + A_t [RUS]){' '}
                {previousChapter ? `(Глава ${previousChapter.number})` : '(начало книги)'}
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs space-y-2 leading-relaxed">
                <div>
                  <span className="font-mono text-[11px] text-slate-500">ENG (A_s): </span>
                  <span className="text-slate-300">{deltaContextPacket.bilingualSummary.eng}</span>
                </div>
                <div className="border-t border-slate-800/80 pt-1.5">
                  <span className="font-mono text-[11px] text-amber-400">RUS (A_t): </span>
                  <span className="text-slate-200">{deltaContextPacket.bilingualSummary.rus}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300">
                  Память текущей главы (передаётся в следующую главу)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const auto = generateBilingualChapterSummary(
                      chapter.number,
                      chapter.titleEng,
                      draftEng,
                      draftTitleRus || chapter.titleEng,
                      draftRus
                    );
                    setDraftSummary(auto.rus);
                  }}
                  className="text-[11px] text-amber-400 hover:text-amber-300"
                >
                  Сгенерировать автоматически
                </button>
              </div>
              <textarea
                value={draftSummary}
                onChange={(e) => setDraftSummary(e.target.value)}
                rows={3}
                placeholder="Краткая сводка событий, прорывов и локаций этой главы..."
                className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Short-Term Sliding Window M^(i): Last 3 ENG <-> RUS paragraphs */}
          {deltaContextPacket.shortTermWindow.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-xs font-semibold text-slate-300">
                Краткосрочное скользящее окно M^(i) (3 последних абзаца ENG ↔ RUS из Главы{' '}
                {previousChapter?.number})
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {deltaContextPacket.shortTermWindow.map((pair) => (
                  <div
                    key={pair.index}
                    className="rounded-lg border border-slate-800 bg-slate-950/90 p-2.5 text-xs space-y-1.5"
                  >
                    <div className="font-mono text-[11px] text-slate-500">
                      Опорная пара #{pair.index}
                    </div>
                    <p className="line-clamp-2 text-slate-400">{pair.engParagraph}</p>
                    <p className="line-clamp-2 text-emerald-300/90 border-t border-slate-800/80 pt-1">
                      {pair.rusParagraph}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsible QA Issues List */}
      {hasIssues && showIssuesPanel && (
        <div className="rounded-xl border border-rose-500/30 bg-slate-900/80 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-300">
              Журнал замечаний QA-линтера ({GENRE_PRESET_LABELS[genrePreset].title} ·{' '}
              {PROSE_TONE_LABELS[proseTone].title})
            </span>
            <button
              type="button"
              onClick={handleInstantDeterministicRepair}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              Исправить все в 1 клик →
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {lintReport.issues.map((issue) => (
              <div
                key={issue.id}
                className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-xs"
              >
                <div className="font-medium text-slate-200">
                  {issue.ruleTitle}: {issue.explanation}
                </div>
                {issue.suggestion && (
                  <div className="mt-1 flex items-center gap-1 text-emerald-400">
                    <ChevronRight className="h-3 w-3 shrink-0" />
                    <span>{issue.suggestion}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible Style Guide Drawer */}
      {showContextDrawer && (
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Стилевой гид (STYLE_GUIDE.md)
            </label>
            <textarea
              value={editStyleMd}
              onChange={(e) => setEditStyleMd(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">
                Контекст мира (CONTEXT.md)
              </label>
              <button
                type="button"
                onClick={() => {
                  onUpdateStyleAndContext(editStyleMd, editContextMd);
                  setRepairNotice('Стилевой гид и контекст обновлены.');
                }}
                className="rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400"
              >
                Применить
              </button>
            </div>
            <textarea
              value={editContextMd}
              onChange={(e) => setEditContextMd(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
        </div>
      )}

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
            <div className="p-6 sm:p-8 text-base leading-[1.75] text-[#F1F5F9]/90 max-w-[65ch] min-h-[440px]">
              {renderHighlightedEnglish(draftEng)}
            </div>
          </div>

          {/* Right Pane: Russian Translation */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3 gap-2">
              <input
                type="text"
                aria-label="Заголовок главы на русском"
                value={draftTitleRus}
                onChange={(e) => setDraftTitleRus(e.target.value)}
                placeholder="Название главы на русском..."
                className="w-full bg-transparent text-xs font-medium text-[#F1F5F9] focus:outline-none"
              />
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

            <textarea
              aria-label="Текст перевода на русском"
              value={draftRus}
              onChange={(e) => setDraftRus(e.target.value)}
              placeholder="Нажмите «Перевести главу» или введите литературный перевод..."
              className="w-full max-w-[65ch] flex-1 min-h-[440px] resize-y bg-transparent p-6 sm:p-8 text-base leading-[1.75] text-[#F1F5F9] placeholder:text-[#64748B] focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* MODE 2: 1:1 Paragraph Alignment Grid */}
      {editorMode === 'aligned_1to1' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs">
            <div className="flex items-center gap-2">
              <Columns2 className="h-4 w-4 text-amber-400" />
              <span className="font-semibold text-slate-200">
                Поабзацная матрица выравнивания 1:1 (ENG: {alignmentGrid.engCount} абз. ↔ RUS:{' '}
                {alignmentGrid.rusCount} абз.)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {alignmentGrid.hasDrift ? (
                <span className="text-rose-400 font-medium">
                  Обнаружено расхождение числа абзацев — проверьте подсвеченные блоки
                </span>
              ) : (
                <span className="text-emerald-400 font-medium">
                  Все абзацы синхронизированы 1:1 без пропусков
                </span>
              )}
              <button
                type="button"
                onClick={handleInstantDeterministicRepair}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30"
              >
                <Wand2 className="h-3 w-3" />
                Точечный ремонт сбойных абзацев
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {alignmentGrid.pairs.map((row) => {
              const engWordCount = row.engParagraph
                ? row.engParagraph.split(/\s+/).filter(Boolean).length
                : 0;
              const rusWordCount = row.rusParagraph
                ? row.rusParagraph.split(/\s+/).filter(Boolean).length
                : 0;
              const isOk = !row.isDrifted && row.missingNumbers.length === 0;
              return (
                <div
                  key={row.index}
                  className={`grid grid-cols-1 gap-4 rounded-xl border p-4 lg:grid-cols-2 ${
                    isOk
                      ? 'border-slate-800 bg-slate-900/30'
                      : 'border-rose-500/40 bg-rose-950/15'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>Абзац #{row.index + 1} (ENG)</span>
                      <span>{engWordCount} слов</span>
                    </div>
                    <div className="text-sm text-slate-200 leading-relaxed">
                      {row.engParagraph ? (
                        renderHighlightedEnglish(row.engParagraph)
                      ) : (
                        <span className="italic text-rose-300">
                          [В оригинале нет соответствующего абзаца]
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-amber-300">Абзац #{row.index + 1} (RUS)</span>
                      <span className={isOk ? 'text-emerald-400' : 'text-rose-400 font-semibold'}>
                        {rusWordCount} слов
                        {row.missingNumbers.length > 0
                          ? ` · Потеряны числа: ${row.missingNumbers.join(', ')}`
                          : ''}
                      </span>
                    </div>
                    <textarea
                      value={row.rusParagraph}
                      onChange={(e) => handleUpdateAlignedParagraph(row.index, e.target.value)}
                      rows={Math.max(3, Math.ceil(row.engParagraph.length / 95))}
                      placeholder="Введите перевод этого абзаца..."
                      className="w-full rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-sm leading-relaxed text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODE 3: Word-Level Inline Diff with 1-Click Undo */}
      {editorMode === 'inline_diff' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h4 className="text-sm font-semibold text-white">
                Пословное сравнение изменений (Inline Word Diff)
                {comparedVersionLabel ? ` · База: ${comparedVersionLabel}` : ''}
              </h4>
              <p className="text-xs text-slate-400">
                Красный зачёркнутый текст — удалённые фрагменты старой версии; зелёный — новый
                текст в текущей редакции.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {lastPreRepairSnapshot && (
                <button
                  type="button"
                  onClick={handleUndoRepair}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Отменить правки
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditorMode('split')}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
              >
                Принять и вернуться в редактор
              </button>
            </div>
          </div>

          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200 font-serif">
            {wordDiffSegments.map((seg, i) => {
              if (seg.type === 'removed') {
                return (
                  <span
                    key={i}
                    className="rounded bg-rose-500/20 px-1 py-0.5 text-rose-300 line-through decoration-rose-400"
                  >
                    {seg.text}
                  </span>
                );
              }
              if (seg.type === 'added') {
                return (
                  <span
                    key={i}
                    className="rounded bg-emerald-500/25 px-1 py-0.5 font-medium text-emerald-200"
                  >
                    {seg.text}
                  </span>
                );
              }
              return <React.Fragment key={i}>{seg.text}</React.Fragment>;
            })}
          </div>
        </div>
      )}

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
                  onChange={(e) => setQuickTermEng(e.target.value)}
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
    </div>
  );
}
