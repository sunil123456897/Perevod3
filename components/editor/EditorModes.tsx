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
      {/* MODE 2: 1:1 Paragraph Alignment Matrix — Flat Divided Sheet */}
      {editorMode === 'aligned_1to1' && (
        <div className="rounded-xl border border-[#F2EFE9]/[0.08] bg-[#141418] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2EFE9]/[0.08] bg-[#101014] px-5 py-3.5 text-[13px]">
            <div className="flex items-center gap-2">
              <Columns2 className="h-4 w-4 text-[#D69E36]" aria-hidden="true" />
              <span className="font-medium text-[#F2EFE9] tabular-nums">
                Матрица абзацев 1:1 (ENG {alignmentGrid.engCount} · RUS {alignmentGrid.rusCount})
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {alignmentGrid.hasDrift ? (
                <span className="text-[#FDA4AF] font-medium">
                  Расхождение числа абзацев
                </span>
              ) : (
                <span className="text-[#6EE7B7] font-medium">
                  Абзацы синхронизированы
                </span>
              )}
              <button
                type="button"
                onClick={onInstantRepair}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2EFE9]/[0.12] bg-[#1B1B21] px-3 py-1.5 text-[13px] font-medium text-[#F2EFE9] hover:border-[#D69E36]/50 transition-colors"
              >
                <Wand2 className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
                <span>Ремонт абзацев</span>
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#F2EFE9]/[0.07]">
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
                  className={`grid grid-cols-1 gap-5 p-5 lg:grid-cols-2 ${
                    isOk ? '' : 'bg-[#F07587]/[0.05]'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[13px] text-[#8E8A82] tabular-nums">
                      <span>Абзац #{row.index + 1} · ENG</span>
                      <span>{engWordCount} сл.</span>
                    </div>
                    <div className="font-serif text-[17px] text-[#F2EFE9]/90 leading-[1.75]">
                      {row.engParagraph ? (
                        renderHighlightedEnglish(row.engParagraph)
                      ) : (
                        <span className="italic text-[#FDA4AF]">
                          [В оригинале нет соответствующего абзаца]
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[13px] tabular-nums">
                      <span className="text-[#D69E36]">Абзац #{row.index + 1} · RUS</span>
                      <span className={isOk ? 'text-[#6EE7B7]' : 'text-[#FDA4AF] font-medium'}>
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
                      rows={Math.max(3, Math.ceil(row.engParagraph.length / 80))}
                      placeholder="Введите перевод этого абзаца..."
                      className="w-full resize-y rounded-lg border border-[#F2EFE9]/[0.1] bg-[#101014] p-3.5 font-serif text-[17px] leading-[1.75] text-[#F2EFE9] placeholder:text-[#8E8A82] focus:border-[#D69E36] focus:outline-none"
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
        <div className="rounded-xl border border-[#F2EFE9]/[0.09] bg-[#141418] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2EFE9]/[0.08] pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#F2EFE9]">
                Пословное сравнение изменений
                {comparedVersionLabel ? ` · База: ${comparedVersionLabel}` : ''}
              </h2>
              <p className="text-[13px] text-[#8E8A82] mt-1">
                Зачёркнутый красный: удалено из старой версии. Зелёный: добавлено в текущей редакции.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {lastPreRepairSnapshot && (
                <button
                  type="button"
                  onClick={onUndoRepair}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#F07587]/40 bg-[#F07587]/10 px-3 py-1.5 text-[13px] font-medium text-[#FDA4AF] hover:bg-[#F07587]/20 transition-colors"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Отменить правки</span>
                </button>
              )}
              <button
                type="button"
                onClick={onExitInlineDiff}
                className="rounded-lg bg-[#D69E36] px-4 py-1.5 text-[13px] font-semibold text-[#11100D] hover:bg-[#E3AE48] transition-colors"
              >
                Принять и вернуться
              </button>
            </div>
          </div>

          <div className="mx-auto max-w-[64ch] whitespace-pre-wrap text-[17px] leading-[1.8] text-[#F2EFE9] font-serif">
            {wordDiffSegments.map((seg, i) => {
              if (seg.type === 'removed') {
                return (
                  <span
                    key={i}
                    className="rounded bg-[#F07587]/20 px-1 py-0.5 text-[#FDA4AF] line-through decoration-[#F07587]"
                  >
                    {seg.text}
                  </span>
                );
              }
              if (seg.type === 'added') {
                return (
                  <span
                    key={i}
                    className="rounded bg-[#52C79A]/20 px-1 py-0.5 font-medium text-[#6EE7B7]"
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
