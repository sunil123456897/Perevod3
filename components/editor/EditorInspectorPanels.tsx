'use client';

import React, { useRef } from 'react';
import { ChevronRight, GitCompare, Undo2, X, CheckCircle2 } from 'lucide-react';
import {
  GENRE_PRESET_LABELS,
  PROSE_TONE_LABELS,
  type detectTautologies,
} from '@/lib/qa-linter';
import {
  buildDelTAContextPacket,
  evaluateDitingQuality,
  extractCsiCulturalNotes,
  generateBilingualChapterSummary,
} from '@/lib/delta-diting';
import type {
  GenrePreset,
  LintReport,
  ProseTone,
} from '@/lib/pipeline-types';
import type { ChapterRecord, ChapterVersionSnapshot } from '@/lib/seed-data';

export type InspectorTab = 'qa' | 'tautology' | 'csi' | 'delta' | 'history' | 'guide';

interface EditorInspectorPanelsProps {
  activeTab: InspectorTab | null;
  onSelectTab: (tab: InspectorTab) => void;
  onClose: () => void;
  chapter: ChapterRecord;
  previousChapter: ChapterRecord | null;
  draftTitleRus: string;
  draftEng: string;
  draftRus: string;
  draftSummary: string;
  setDraftSummary: (val: string) => void;
  versionHistoryList: ChapterVersionSnapshot[];
  onCompareWithVersion: (snap: ChapterVersionSnapshot) => void;
  onRollbackToVersion: (snap: ChapterVersionSnapshot) => void;
  tautologyItems: ReturnType<typeof detectTautologies>;
  ditingReport: ReturnType<typeof evaluateDitingQuality>;
  csiCulturalNotes: ReturnType<typeof extractCsiCulturalNotes>;
  deltaContextPacket: ReturnType<typeof buildDelTAContextPacket>;
  hasIssues: boolean;
  genrePreset: GenrePreset;
  proseTone: ProseTone;
  lintReport: LintReport;
  onInstantRepair: () => void;
  editStyleMd: string;
  setEditStyleMd: (val: string) => void;
  editContextMd: string;
  setEditContextMd: (val: string) => void;
  onApplyStyleAndContext: () => void;
}

export default function EditorInspectorPanels({
  activeTab,
  onSelectTab,
  onClose,
  chapter,
  previousChapter,
  draftTitleRus,
  draftEng,
  draftRus,
  draftSummary,
  setDraftSummary,
  versionHistoryList,
  onCompareWithVersion,
  onRollbackToVersion,
  tautologyItems,
  ditingReport,
  csiCulturalNotes,
  deltaContextPacket,
  hasIssues,
  genrePreset,
  proseTone,
  lintReport,
  onInstantRepair,
  editStyleMd,
  setEditStyleMd,
  editContextMd,
  setEditContextMd,
  onApplyStyleAndContext,
}: EditorInspectorPanelsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (!activeTab) return null;

  const qaCount = lintReport.errorCount + lintReport.warningCount;
  const tabs: Array<{ id: InspectorTab; label: string; badge?: string | number }> = [
    { id: 'qa', label: 'QA', badge: qaCount > 0 ? qaCount : undefined },
    {
      id: 'tautology',
      label: 'Повторы',
      badge: tautologyItems.length > 0 ? tautologyItems.length : undefined,
    },
    { id: 'csi', label: 'CSI', badge: csiCulturalNotes.length },
    { id: 'delta', label: 'DelTA', badge: deltaContextPacket.shortTermWindow.length },
    { id: 'history', label: 'История', badge: versionHistoryList.length },
    { id: 'guide', label: 'Гид' },
  ];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (idx === -1) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    if (nextIdx >= 0) {
      e.preventDefault();
      onSelectTab(tabs[nextIdx].id);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  return (
    <aside
      aria-label="Инспектор главы"
      className="rounded-xl border border-white/[0.1] bg-[#10131C] flex flex-col overflow-hidden max-h-[440px] xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6.25rem)]"
    >
      {/* Inspector Header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-2.5 shrink-0">
        <h2 className="font-display text-xs font-semibold text-[#F3F4F6]">
          Инспектор главы {chapter.subPart || chapter.number}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть инспектор"
          className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-lg text-[#8893A8] hover:bg-white/[0.06] hover:text-[#F3F4F6] transition-colors"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Single-Row Scrollable Tablist */}
      <div
        role="tablist"
        aria-label="Разделы инспектора"
        onKeyDown={handleTabKeyDown}
        className="flex items-center gap-0.5 overflow-x-auto studio-tablist border-b border-white/[0.08] bg-[#0D1017] px-2 shrink-0"
      >
        {tabs.map((tab, i) => {
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`inspector-tab-${tab.id}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelectTab(tab.id)}
              className={`studio-tab inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-2 text-[11px] font-medium transition-colors ${
                isSelected ? 'text-[#F3F4F6]' : 'text-[#8893A8] hover:text-[#F3F4F6]'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    tab.id === 'qa' && qaCount > 0 ? 'text-rose-300' : 'text-[#8893A8]'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab Panel */}
      <div
        role="tabpanel"
        aria-labelledby={`inspector-tab-${activeTab}`}
        className="flex-1 overflow-y-auto studio-scroll p-4 space-y-3"
      >
        {activeTab === 'qa' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[#B0B8C9]">
                Профиль:{' '}
                <strong className="text-[#F3F4F6]">
                  {GENRE_PRESET_LABELS[genrePreset].title}
                </strong>{' '}
                · {PROSE_TONE_LABELS[proseTone].title}
              </div>
              {hasIssues && (
                <button
                  type="button"
                  onClick={onInstantRepair}
                  className="text-xs font-semibold text-[#D99B26] hover:text-[#E5AC3D]"
                >
                  Исправить все в 1 клик →
                </button>
              )}
            </div>

            {!hasIssues ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3.5 text-xs text-emerald-200">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="font-semibold">Замечаний QA не обнаружено</div>
                  <p className="text-[11px] text-emerald-200/80 mt-0.5">
                    Типографика, канон терминов, род персонажей и числа совпадают с оригиналом.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {lintReport.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="rounded-lg border border-white/[0.08] bg-[#0A0C12] p-3 text-xs space-y-1"
                  >
                    <div className="font-medium text-[#F3F4F6]">
                      <span className="text-rose-300">{issue.ruleTitle}:</span>{' '}
                      {issue.explanation}
                    </div>
                    {issue.suggestion && (
                      <div className="flex items-start gap-1 text-emerald-300 text-[11px]">
                        <ChevronRight className="h-3 w-3 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{issue.suggestion}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'tautology' && (
          <div className="space-y-2.5">
            {tautologyItems.length === 0 ? (
              <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3.5 text-xs text-emerald-200">
                Лексических повторов в скользящем окне не обнаружено.
              </p>
            ) : (
              tautologyItems.map((t, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-white/[0.08] bg-[#0A0C12] p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#E5AC3D]">
                      Строка #{t.line} · «{t.wordSample}» ({t.count}×)
                    </span>
                    <span className="font-mono text-[11px] text-[#8893A8]">
                      {t.stem}-
                    </span>
                  </div>
                  <p className="text-[#B0B8C9] leading-relaxed">«{t.snippet}»</p>
                  {t.synonymHint && (
                    <p className="text-emerald-300 font-medium text-[11px]">{t.synonymHint}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'csi' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-[#0A0C12] px-3 py-2 text-xs">
              <span className="text-[#B0B8C9]">Интегральная оценка DITING</span>
              <span className="font-mono font-semibold text-emerald-300 tabular-nums">
                {ditingReport.mqmGrade} · {ditingReport.overallScore}/100
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
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
                  className="rounded-lg border border-white/[0.08] bg-[#0A0C12] px-3 py-2 text-xs"
                >
                  <div className="text-[11px] text-[#8893A8] truncate">{dim.label}</div>
                  <div
                    className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                      dim.val >= 95
                        ? 'text-emerald-300'
                        : dim.val >= 85
                          ? 'text-[#E5AC3D]'
                          : 'text-rose-300'
                    }`}
                  >
                    {dim.val}%
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-[#B0B8C9]">
                Культурные сноски CSI ({csiCulturalNotes.length})
              </div>
              {csiCulturalNotes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-lg border border-white/[0.08] bg-[#0A0C12] p-3 text-xs space-y-1"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#F3F4F6]">{note.sourcePhrase}</span>
                    <span className="font-mono text-[11px] text-[#D99B26]">
                      {note.categoryLabel}
                    </span>
                  </div>
                  <div className="text-emerald-300 font-medium">
                    Адаптация: {note.adaptedRus}
                  </div>
                  <p className="text-[#8893A8] leading-relaxed">{note.rationale}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'delta' && (
          <div className="space-y-3">
            <div className="font-mono text-[11px] text-[#8893A8] tabular-nums">
              Сущности: {deltaContextPacket.properNounCount} · Окно:{' '}
              {deltaContextPacket.shortTermWindow.length} абз. · Сцен:{' '}
              {deltaContextPacket.longTermMemories.length}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[#B0B8C9]">
                Сводка предыдущей главы{' '}
                {previousChapter ? `(Гл. ${previousChapter.number})` : '(начало)'}
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-[#0A0C12] p-3 text-xs space-y-2 leading-relaxed">
                <div>
                  <span className="font-mono text-[11px] text-[#8893A8]">ENG: </span>
                  <span className="text-[#B0B8C9]">{deltaContextPacket.bilingualSummary.eng}</span>
                </div>
                <div className="border-t border-white/[0.06] pt-1.5">
                  <span className="font-mono text-[11px] text-[#D99B26]">RUS: </span>
                  <span className="text-[#F3F4F6]">{deltaContextPacket.bilingualSummary.rus}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="inspector-delta-summary" className="text-xs font-medium text-[#F3F4F6]">
                  Память текущей главы
                </label>
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
                  className="text-[11px] font-medium text-[#D99B26] hover:text-[#E5AC3D]"
                >
                  Сгенерировать
                </button>
              </div>
              <textarea
                id="inspector-delta-summary"
                value={draftSummary}
                onChange={(e) => setDraftSummary(e.target.value)}
                rows={3}
                placeholder="Краткая сводка событий, прорывов и локаций..."
                className="w-full resize-y rounded-lg border border-white/[0.1] bg-[#0A0C12] p-2.5 text-xs text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
              />
            </div>

            {deltaContextPacket.shortTermWindow.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-[#B0B8C9]">
                  Окно контекста из Гл. {previousChapter?.number}
                </div>
                {deltaContextPacket.shortTermWindow.map((pair) => (
                  <div
                    key={pair.index}
                    className="rounded-lg border border-white/[0.08] bg-[#0A0C12] p-2.5 text-xs space-y-1"
                  >
                    <div className="font-mono text-[11px] text-[#8893A8]">
                      Абзац #{pair.index}
                    </div>
                    <p className="line-clamp-2 text-[#8893A8]">{pair.engParagraph}</p>
                    <p className="line-clamp-2 text-emerald-300 border-t border-white/[0.06] pt-1">
                      {pair.rusParagraph}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-2.5">
            {versionHistoryList.length === 0 ? (
              <p className="text-xs text-[#8893A8]">
                Сохранённых снимков пока нет — выполните перевод или нажмите «Сохранить».
              </p>
            ) : (
              [...versionHistoryList].reverse().map((snap, revIdx) => {
                const versionNumber = versionHistoryList.length - revIdx;
                const isCurrent = snap.rusText.trim() === draftRus.trim();

                return (
                  <div
                    key={snap.id}
                    className={`rounded-lg border p-3 text-xs space-y-2 ${
                      isCurrent
                        ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                        : 'border-white/[0.08] bg-[#0A0C12]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-[#D99B26]/20 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#E5AC3D]">
                          v{versionNumber}
                        </span>
                        <span className="font-medium text-[#F3F4F6]">{snap.stageLabel}</span>
                      </div>
                      <span className="font-mono text-[11px] text-[#8893A8] tabular-nums">
                        {snap.timestamp} · {snap.wordCountRus} сл.
                      </span>
                    </div>

                    <p className="line-clamp-2 text-[#B0B8C9] font-serif">{snap.rusText}</p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span
                        className={`font-mono text-[11px] font-medium ${
                          snap.qaPassed ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {snap.qaPassed ? '100% QA' : `Замечаний: ${snap.qaErrorCount}`}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onCompareWithVersion(snap)}
                          className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] bg-[#10131C] px-2 py-1 text-[11px] font-medium text-[#F3F4F6] hover:border-[#D99B26]/50 transition-colors"
                        >
                          <GitCompare className="h-3 w-3" aria-hidden="true" />
                          <span>Diff</span>
                        </button>

                        {isCurrent ? (
                          <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
                            Текущая
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRollbackToVersion(snap)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#D99B26]/40 bg-[#D99B26]/15 px-2 py-1 text-[11px] font-semibold text-[#E5AC3D] hover:bg-[#D99B26]/25 transition-colors"
                          >
                            <Undo2 className="h-3 w-3" aria-hidden="true" />
                            <span>Откатить</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'guide' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="inspector-style-md" className="block text-xs font-medium text-[#B0B8C9]">
                Стилевой гид (STYLE_GUIDE.md)
              </label>
              <textarea
                id="inspector-style-md"
                value={editStyleMd}
                onChange={(e) => setEditStyleMd(e.target.value)}
                rows={5}
                className="w-full resize-y rounded-lg border border-white/[0.1] bg-[#0A0C12] p-3 font-mono text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="inspector-context-md" className="text-xs font-medium text-[#B0B8C9]">
                  Контекст мира (CONTEXT.md)
                </label>
                <button
                  type="button"
                  onClick={onApplyStyleAndContext}
                  className="rounded-lg bg-[#D99B26] px-3 py-1 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D]"
                >
                  Применить
                </button>
              </div>
              <textarea
                id="inspector-context-md"
                value={editContextMd}
                onChange={(e) => setEditContextMd(e.target.value)}
                rows={5}
                className="w-full resize-y rounded-lg border border-white/[0.1] bg-[#0A0C12] p-3 font-mono text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
