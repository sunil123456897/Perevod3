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
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#10131C] px-4 py-3 text-xs">
            <div className="flex items-center gap-2">
              <Columns2 className="h-4 w-4 text-[#D99B26]" aria-hidden="true" />
              <span className="font-semibold text-[#F3F4F6] tabular-nums">
                Поабзацная матрица 1:1 (ENG: {alignmentGrid.engCount} ↔ RUS:{' '}
                {alignmentGrid.rusCount})
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {alignmentGrid.hasDrift ? (
                <span className="text-rose-300 font-medium">
                  Обнаружено расхождение числа абзацев
                </span>
              ) : (
                <span className="text-emerald-300 font-medium">
                  Абзацы синхронизированы 1:1
                </span>
              )}
              <button
                type="button"
                onClick={onInstantRepair}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#151925] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-[#D99B26]/50"
              >
                <Wand2 className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
                <span>Ремонт абзацев</span>
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
                      ? 'border-white/[0.08] bg-[#10131C]'
                      : 'border-rose-500/40 bg-rose-950/15'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-[#8893A8] tabular-nums">
                      <span>Абзац #{row.index + 1} · ENG</span>
                      <span>{engWordCount} сл.</span>
                    </div>
                    <div className="font-serif text-[15px] text-[#F3F4F6]/90 leading-[1.75]">
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
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-[#D99B26]">Абзац #{row.index + 1} · RUS</span>
                      <span className={isOk ? 'text-emerald-300' : 'text-rose-300 font-semibold'}>
                        {rusWordCount} сл.
                        {row.missingNumbers.length > 0
                          ? ` · Потеряны числа: ${row.missingNumbers.join(', ')}`
                          : ''}
                      </span>
                    </div>
                    <textarea
                      aria-label={`Перевод абзаца ${row.index + 1}`}
                      value={row.rusParagraph}
                      onChange={(e) => onUpdateAlignedParagraph(row.index, e.target.value)}
                      rows={Math.max(3, Math.ceil(row.engParagraph.length / 85))}
                      placeholder="Введите перевод этого абзаца..."
                      className="w-full resize-y rounded-lg border border-white/[0.1] bg-[#0A0C12] p-3 font-serif text-[15px] leading-[1.75] text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
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
        <div className="rounded-xl border border-white/[0.09] bg-[#10131C] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3.5">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#F3F4F6]">
                Пословное сравнение изменений
                {comparedVersionLabel ? ` · База: ${comparedVersionLabel}` : ''}
              </h2>
              <p className="text-xs text-[#8893A8] mt-0.5">
                Красный зачёркнутый — удалено из старой версии; зелёный — добавлено в текущей редакции.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {lastPreRepairSnapshot && (
                <button
                  type="button"
                  onClick={onUndoRepair}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Отменить правки</span>
                </button>
              )}
              <button
                type="button"
                onClick={onExitInlineDiff}
                className="rounded-lg bg-[#D99B26] px-3.5 py-1.5 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D]"
              >
                Принять и вернуться
              </button>
            </div>
          </div>

          <div className="mx-auto max-w-[68ch] whitespace-pre-wrap text-base leading-[1.8] text-[#F3F4F6] font-serif">
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
                    className="rounded bg-emerald-500/20 px-1 py-0.5 font-medium text-emerald-200"
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
