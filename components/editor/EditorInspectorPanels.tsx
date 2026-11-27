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
      className="rounded-xl border border-[#F2EFE9]/[0.09] bg-[#141418] flex flex-col overflow-hidden max-h-[480px] xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6.25rem)]"
    >
      {/* Inspector Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[#F2EFE9]/[0.08] px-4 py-3 shrink-0">
        <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#F2EFE9] tabular-nums">
          Инспектор главы {chapter.subPart || chapter.number}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть инспектор"
          className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-lg text-[#8E8A82] hover:bg-[#F2EFE9]/[0.06] hover:text-[#F2EFE9] transition-colors"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Single-Row Scrollable Tablist */}
      <div
        role="tablist"
        aria-label="Разделы инспектора"
        onKeyDown={handleTabKeyDown}
        className="flex items-center justify-between gap-0.5 overflow-x-auto studio-tablist border-b border-[#F2EFE9]/[0.08] bg-[#101014] px-2 shrink-0"
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
              className={`studio-tab inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-2.5 text-[13px] font-medium transition-colors ${
                isSelected ? 'text-[#F2EFE9]' : 'text-[#8E8A82] hover:text-[#F2EFE9]'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`text-[13px] tabular-nums ${
                    tab.id === 'qa' && qaCount > 0 ? 'text-[#FDA4AF] font-semibold' : 'text-[#8E8A82]'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab Panel — Flat Divided Layout (Zero Nested Cards) */}
      <div
        role="tabpanel"
        aria-labelledby={`inspector-tab-${activeTab}`}
        className="flex-1 overflow-y-auto studio-scroll p-4 space-y-4"
      >
        {activeTab === 'qa' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#F2EFE9]/[0.07]">
              <div className="text-[13px] text-[#B8B4AC]">
                <strong className="font-medium text-[#F2EFE9]">
                  {GENRE_PRESET_LABELS[genrePreset].title}
                </strong>{' '}
                · {PROSE_TONE_LABELS[proseTone].title}
              </div>
              {hasIssues && (
                <button
                  type="button"
                  onClick={onInstantRepair}
                  className="text-[13px] font-medium text-[#D69E36] hover:text-[#E3AE48] transition-colors"
                >
                  Исправить все →
                </button>
              )}
            </div>

            {!hasIssues ? (
              <div className="flex items-start gap-2.5 border-l-2 border-[#52C79A] pl-3 py-1 text-[13px]">
                <CheckCircle2
                  className="h-4 w-4 text-[#6EE7B7] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <div className="font-medium text-[#F2EFE9]">Замечаний QA не обнаружено</div>
                  <p className="text-[#B8B4AC] leading-relaxed">
                    Типографика, канон терминов, род персонажей и числа совпадают с оригиналом.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[#F2EFE9]/[0.07]">
                {lintReport.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="py-3 first:pt-0 last:pb-0 text-[13px] space-y-1.5"
                  >
                    <div className="text-[#F2EFE9] leading-relaxed">
                      <span className="font-medium text-[#FDA4AF]">{issue.ruleTitle}:</span>{' '}
                      {issue.explanation}
                    </div>
                    {issue.suggestion && (
                      <div className="flex items-start gap-1 text-[#6EE7B7] leading-relaxed">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
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
          <div>
            {tautologyItems.length === 0 ? (
              <p className="border-l-2 border-[#52C79A] pl-3 py-1 text-[13px] text-[#B8B4AC]">
                Лексических повторов в скользящем окне не обнаружено.
              </p>
            ) : (
              <div className="divide-y divide-[#F2EFE9]/[0.07]">
                {tautologyItems.map((t, idx) => (
                  <div
                    key={idx}
                    className="py-3 first:pt-0 last:pb-0 text-[13px] space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 tabular-nums">
                      <span className="font-medium text-[#E3AE48]">
                        Строка #{t.line} · «{t.wordSample}» ({t.count}×)
                      </span>
                      <span className="text-[#8E8A82]">{t.stem}-</span>
                    </div>
                    <p className="text-[#B8B4AC] leading-relaxed">«{t.snippet}»</p>
                    {t.synonymHint && (
                      <p className="text-[#6EE7B7]">{t.synonymHint}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'csi' && (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-[#F2EFE9]/[0.07]">
              <span className="text-[13px] text-[#B8B4AC]">Оценка DITING</span>
              <span className="text-sm font-semibold text-[#6EE7B7] tabular-nums">
                {ditingReport.mqmGrade} · {ditingReport.overallScore}/100
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 pb-4 border-b border-[#F2EFE9]/[0.07] tabular-nums">
              {[
                { label: 'Идиоматика', val: ditingReport.idiomAccuracy },
                { label: 'Связность сцен', val: ditingReport.referentialCohesion },
                { label: 'Голоса героев', val: ditingReport.characterVoiceFidelity },
                { label: 'Культурный код', val: ditingReport.culturalAdaptation },
                { label: 'Ритмика прозы', val: ditingReport.literaryRhythm },
                { label: 'Точность канона', val: ditingReport.terminologyPrecision },
              ].map((dim) => (
                <div key={dim.label} className="space-y-0.5">
                  <dt className="text-[13px] text-[#8E8A82] truncate">{dim.label}</dt>
                  <dd
                    className={`text-sm font-semibold ${
                      dim.val >= 95
                        ? 'text-[#6EE7B7]'
                        : dim.val >= 85
                          ? 'text-[#E3AE48]'
                          : 'text-[#FDA4AF]'
                    }`}
                  >
                    {dim.val}%
                  </dd>
                </div>
              ))}
            </dl>

            <div className="space-y-2">
              <div className="text-[13px] font-medium text-[#B8B4AC] tabular-nums">
                Культурные сноски CSI ({csiCulturalNotes.length})
              </div>
              {csiCulturalNotes.length === 0 ? (
                <p className="text-[13px] text-[#8E8A82]">
                  Сносок для этой главы пока нет.
                </p>
              ) : (
                <div className="divide-y divide-[#F2EFE9]/[0.07]">
                  {csiCulturalNotes.map((note) => (
                    <div
                      key={note.id}
                      className="py-3 first:pt-1 last:pb-0 text-[13px] space-y-1"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-[#F2EFE9]">{note.sourcePhrase}</span>
                        <span className="text-[#D69E36]">{note.categoryLabel}</span>
                      </div>
                      <div className="text-[#6EE7B7]">Адаптация: {note.adaptedRus}</div>
                      <p className="text-[#8E8A82] leading-relaxed">{note.rationale}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'delta' && (
          <div className="space-y-4">
            <div className="text-[13px] text-[#8E8A82] tabular-nums pb-3 border-b border-[#F2EFE9]/[0.07]">
              Сущности: {deltaContextPacket.properNounCount} · Окно:{' '}
              {deltaContextPacket.shortTermWindow.length} абз. · Сцен:{' '}
              {deltaContextPacket.longTermMemories.length}
            </div>

            <div className="space-y-2">
              <div className="text-[13px] font-medium text-[#B8B4AC]">
                Сводка предыдущей главы{' '}
                {previousChapter ? `(Гл. ${previousChapter.number})` : '(начало)'}
              </div>
              <div className="border-l-2 border-[#D69E36]/45 pl-3 space-y-2 text-[13px] leading-relaxed">
                <p className="text-[#B8B4AC]">
                  <span className="text-[#8E8A82]">ENG: </span>
                  {deltaContextPacket.bilingualSummary.eng}
                </p>
                <p className="text-[#F2EFE9]">
                  <span className="text-[#D69E36]">RUS: </span>
                  {deltaContextPacket.bilingualSummary.rus}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[#F2EFE9]/[0.07]">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="inspector-delta-summary"
                  className="text-[13px] font-medium text-[#F2EFE9]"
                >
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
                  className="text-[13px] font-medium text-[#D69E36] hover:text-[#E3AE48] transition-colors"
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
                className="w-full resize-y rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] p-3 text-[13px] leading-relaxed text-[#F2EFE9] placeholder:text-[#8E8A82] focus:border-[#D69E36] focus:outline-none"
              />
            </div>

            {deltaContextPacket.shortTermWindow.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[#F2EFE9]/[0.07]">
                <div className="text-[13px] font-medium text-[#B8B4AC]">
                  Окно контекста из Гл. {previousChapter?.number}
                </div>
                <div className="divide-y divide-[#F2EFE9]/[0.07]">
                  {deltaContextPacket.shortTermWindow.map((pair) => (
                    <div
                      key={pair.index}
                      className="py-2.5 first:pt-1 last:pb-0 text-[13px] space-y-1 leading-relaxed"
                    >
                      <div className="text-[#8E8A82] tabular-nums">Абзац #{pair.index}</div>
                      <p className="line-clamp-2 text-[#B8B4AC]">{pair.engParagraph}</p>
                      <p className="line-clamp-2 text-[#6EE7B7]">{pair.rusParagraph}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            {versionHistoryList.length === 0 ? (
              <p className="text-[13px] text-[#8E8A82]">
                Сохранённых снимков пока нет. Выполните перевод или нажмите «Сохранить».
              </p>
            ) : (
              <div className="divide-y divide-[#F2EFE9]/[0.07]">
                {[...versionHistoryList].reverse().map((snap, revIdx) => {
                  const versionNumber = versionHistoryList.length - revIdx;
                  const isCurrent = snap.rusText.trim() === draftRus.trim();

                  return (
                    <div
                      key={snap.id}
                      className={`py-3.5 first:pt-0 last:pb-0 text-[13px] space-y-2 ${
                        isCurrent ? 'border-l-2 border-[#52C79A] pl-3' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2 tabular-nums">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-semibold text-[#D69E36]">v{versionNumber}</span>
                          <span className="font-medium text-[#F2EFE9] truncate">
                            {snap.stageLabel}
                          </span>
                        </div>
                        <span className="text-[#8E8A82] shrink-0">
                          {snap.timestamp} · {snap.wordCountRus} сл.
                        </span>
                      </div>

                      <p className="line-clamp-2 text-[#B8B4AC] font-serif leading-relaxed">
                        {snap.rusText}
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <span
                          className={`tabular-nums font-medium ${
                            snap.qaPassed ? 'text-[#6EE7B7]' : 'text-[#FDA4AF]'
                          }`}
                        >
                          {snap.qaPassed ? 'QA 100%' : `Замечаний: ${snap.qaErrorCount}`}
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onCompareWithVersion(snap)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#F2EFE9]/[0.1] bg-[#1B1B21] px-2.5 py-1 text-[13px] font-medium text-[#F2EFE9] hover:border-[#F2EFE9]/[0.22] transition-colors"
                          >
                            <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Diff</span>
                          </button>

                          {isCurrent ? (
                            <span className="text-[13px] font-medium text-[#6EE7B7]">
                              Текущая
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onRollbackToVersion(snap)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#D69E36]/40 bg-[#D69E36]/12 px-2.5 py-1 text-[13px] font-medium text-[#E3AE48] hover:bg-[#D69E36]/22 transition-colors"
                            >
                              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Откатить</span>
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

        {activeTab === 'guide' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="inspector-style-md"
                className="block text-[13px] font-medium text-[#B8B4AC]"
              >
                Стилевой гид (STYLE_GUIDE.md)
              </label>
              <textarea
                id="inspector-style-md"
                value={editStyleMd}
                onChange={(e) => setEditStyleMd(e.target.value)}
                rows={6}
                className="w-full resize-y rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] p-3 font-mono text-[13px] leading-relaxed text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="inspector-context-md"
                  className="text-[13px] font-medium text-[#B8B4AC]"
                >
                  Контекст мира (CONTEXT.md)
                </label>
                <button
                  type="button"
                  onClick={onApplyStyleAndContext}
                  className="rounded-lg bg-[#D69E36] px-3 py-1.5 text-[13px] font-semibold text-[#11100D] hover:bg-[#E3AE48] transition-colors"
                >
                  Применить
                </button>
              </div>
              <textarea
                id="inspector-context-md"
                value={editContextMd}
                onChange={(e) => setEditContextMd(e.target.value)}
                rows={6}
                className="w-full resize-y rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] p-3 font-mono text-[13px] leading-relaxed text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
