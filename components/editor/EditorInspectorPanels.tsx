'use client';

import React from 'react';
import { ChevronRight, GitCompare, Undo2 } from 'lucide-react';
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

interface EditorInspectorPanelsProps {
  chapter: ChapterRecord;
  previousChapter: ChapterRecord | null;
  draftTitleRus: string;
  draftEng: string;
  draftRus: string;
  draftSummary: string;
  setDraftSummary: (val: string) => void;
  showVersionHistoryPanel: boolean;
  onCloseVersionHistory: () => void;
  versionHistoryList: ChapterVersionSnapshot[];
  onCompareWithVersion: (snap: ChapterVersionSnapshot) => void;
  onRollbackToVersion: (snap: ChapterVersionSnapshot) => void;
  showTautologyPanel: boolean;
  onCloseTautology: () => void;
  tautologyItems: ReturnType<typeof detectTautologies>;
  showCsiDitingPanel: boolean;
  onCloseCsiDiting: () => void;
  ditingReport: ReturnType<typeof evaluateDitingQuality>;
  csiCulturalNotes: ReturnType<typeof extractCsiCulturalNotes>;
  showMemoryBar: boolean;
  onCloseMemoryBar: () => void;
  deltaContextPacket: ReturnType<typeof buildDelTAContextPacket>;
  hasIssues: boolean;
  showIssuesPanel: boolean;
  genrePreset: GenrePreset;
  proseTone: ProseTone;
  lintReport: LintReport;
  onInstantRepair: () => void;
  showContextDrawer: boolean;
  editStyleMd: string;
  setEditStyleMd: (val: string) => void;
  editContextMd: string;
  setEditContextMd: (val: string) => void;
  onApplyStyleAndContext: () => void;
}

export default function EditorInspectorPanels({
  chapter,
  previousChapter,
  draftTitleRus,
  draftEng,
  draftRus,
  draftSummary,
  setDraftSummary,
  showVersionHistoryPanel,
  onCloseVersionHistory,
  versionHistoryList,
  onCompareWithVersion,
  onRollbackToVersion,
  showTautologyPanel,
  onCloseTautology,
  tautologyItems,
  showCsiDitingPanel,
  onCloseCsiDiting,
  ditingReport,
  csiCulturalNotes,
  showMemoryBar,
  onCloseMemoryBar,
  deltaContextPacket,
  hasIssues,
  showIssuesPanel,
  genrePreset,
  proseTone,
  lintReport,
  onInstantRepair,
  showContextDrawer,
  editStyleMd,
  setEditStyleMd,
  editContextMd,
  setEditContextMd,
  onApplyStyleAndContext,
}: EditorInspectorPanelsProps) {
  return (
    <>
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
              onClick={onCloseVersionHistory}
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
                          onClick={() => onCompareWithVersion(snap)}
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
                            onClick={() => onRollbackToVersion(snap)}
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
              onClick={onCloseTautology}
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
                onClick={onCloseCsiDiting}
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
              onClick={onCloseMemoryBar}
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
              onClick={onInstantRepair}
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
                onClick={onApplyStyleAndContext}
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
    </>
  );
}
