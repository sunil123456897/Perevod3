'use client';

import React from 'react';
import { Columns2, Undo2, Wand2 } from 'lucide-react';
import type { alignChapterParagraphs, computeWordDiff } from '@/lib/qa-linter';

interface EditorModesProps {
  editorMode: 'split' | 'aligned_1to1' | 'inline_diff';
  alignmentGrid: ReturnType<typeof alignChapterParagraphs>;
  renderHighlightedEnglish: (text: string) => React.ReactNode;
  onUpdateAlignedParagraph: (rowIndex: number, newRusParagraph: string) => void;
  onInstantRepair: () => void;
  comparedVersionLabel: string | null;
  wordDiffSegments: ReturnType<typeof computeWordDiff>;
  lastPreRepairSnapshot: string | null;
  onUndoRepair: () => void;
  onExitInlineDiff: () => void;
}

export default function EditorModes({
  editorMode,
  alignmentGrid,
  renderHighlightedEnglish,
  onUpdateAlignedParagraph,
  onInstantRepair,
  comparedVersionLabel,
  wordDiffSegments,
  lastPreRepairSnapshot,
  onUndoRepair,
  onExitInlineDiff,
}: EditorModesProps) {
  return (
    <>
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
                onClick={onInstantRepair}
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
                      onChange={(e) => onUpdateAlignedParagraph(row.index, e.target.value)}
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
                  onClick={onUndoRepair}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Отменить правки
                </button>
              )}
              <button
                type="button"
                onClick={onExitInlineDiff}
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
    </>
  );
}
