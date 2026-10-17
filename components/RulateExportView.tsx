'use client';

import React, { useState, useMemo } from 'react';
import {
  Download,
  Copy,
  Check,
  GitMerge,
  ShieldCheck,
} from 'lucide-react';
import {
  buildRulateExportPackages,
  type RulateExportPackage,
} from '@/lib/qa-linter';
import type { ChapterRecord } from '@/lib/seed-data';

interface RulateExportViewProps {
  novelName: string;
  chapters: ChapterRecord[];
  onMergeSplitChapters: (partAId: string, partBId: string, targetNumber: number) => void;
}

export default function RulateExportView({
  novelName,
  chapters,
  onMergeSplitChapters,
}: RulateExportViewProps) {
  const [subTab, setSubTab] = useState<'rulate' | 'merge'>('rulate');
  const [batchSize, setBatchSize] = useState(20);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [selectedBatchIdx, setSelectedBatchIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const splitCandidates = useMemo(
    () => chapters.filter((c) => Boolean(c.subPart)),
    [chapters]
  );
  const [partAId, setPartAId] = useState(splitCandidates[0]?.id || chapters[0]?.id || '');
  const [partBId, setPartBId] = useState(splitCandidates[1]?.id || chapters[1]?.id || '');
  const [targetMergeNum, setTargetMergeNum] = useState(7);
  const [mergeSuccessMsg, setMergeSuccessMsg] = useState('');

  const exportableChapters = useMemo(() => {
    return chapters
      .filter((c) => c.translated && c.rusText.trim().length > 0)
      .filter((c) => (onlyVerified ? c.verified : true))
      .map((c) => ({
        number: c.number,
        titleRus: c.titleRus || `Глава ${c.number}`,
        contentRus: c.rusText,
      }));
  }, [chapters, onlyVerified]);

  const packages: RulateExportPackage[] = useMemo(
    () => buildRulateExportPackages(novelName, exportableChapters, batchSize),
    [novelName, exportableChapters, batchSize]
  );

  const activePackage = packages[selectedBatchIdx] || packages[0] || null;

  const handleDownloadPackage = (pkg: RulateExportPackage) => {
    const blob = new Blob([pkg.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pkg.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyContent = async () => {
    if (!activePackage) return;
    await navigator.clipboard.writeText(activePackage.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTriggerMerge = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partAId || !partBId || partAId === partBId) return;
    onMergeSplitChapters(partAId, partBId, targetMergeNum);
    setMergeSuccessMsg(
      `Полуглавы объединены в Главу ${targetMergeNum}`
    );
  };

  return (
    <div className="space-y-6">
      {/* Clean Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-1">
          <button
            type="button"
            onClick={() => setSubTab('rulate')}
            className={`rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'rulate'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Пакеты для Рулейта ({packages.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('merge')}
            className={`rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'merge'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Склейка полуглав ({splitCandidates.length})
          </button>
        </div>

        {subTab === 'rulate' && (
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyVerified}
                onChange={(e) => {
                  setOnlyVerified(e.target.checked);
                  setSelectedBatchIdx(0);
                }}
                className="rounded border-slate-700 bg-slate-950 text-amber-500"
              />
              Только проверенные QA
            </label>

            <select
              aria-label="Количество глав в одном пакете"
              value={batchSize}
              onChange={(e) => {
                setBatchSize(Number(e.target.value));
                setSelectedBatchIdx(0);
              }}
              className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200"
            >
              <option value={5}>По 5 глав</option>
              <option value={10}>По 10 глав</option>
              <option value={20}>По 20 глав (макс.)</option>
            </select>
          </div>
        )}
      </div>

      {subTab === 'rulate' ? (
        packages.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 py-12 text-center">
            <p className="text-sm font-medium text-slate-300">
              Нет переведённых глав для экспорта
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-4 space-y-3">
              {packages.map((pkg, idx) => (
                <div
                  key={pkg.filename}
                  onClick={() => setSelectedBatchIdx(idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedBatchIdx(idx);
                  }}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                    selectedBatchIdx === idx
                      ? 'border-amber-500/60 bg-slate-900/80'
                      : 'border-slate-800 bg-slate-900/30 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-slate-100">
                      {pkg.chapterRange}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-slate-400">
                      {(pkg.byteSize / 1024).toFixed(1)} КБ
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
                    <span>{pkg.chapterCount} гл.</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-400 inline-flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Unix LF
                    </span>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-800/80 flex justify-end">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadPackage(pkg);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Скачать .md
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="lg:col-span-8 flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              {activePackage && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
                    <span className="font-mono text-xs text-slate-300 truncate">
                      {activePackage.filename}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyContent}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                            Скопировано
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Копировать
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <pre className="flex-1 overflow-auto rounded-lg border border-slate-800/80 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300 max-h-[420px] whitespace-pre-wrap">
                    {activePackage.content}
                  </pre>
                </>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 max-w-2xl space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Объединение разбитых глав (например, 7.1 + 7.2 → 7)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Склеивает английский оригинал и русский перевод двух полуглав через разделитель «---».
            </p>
          </div>

          <form onSubmit={handleTriggerMerge} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="merge-part-a" className="block text-xs text-slate-400 mb-1">
                  Первая часть
                </label>
                <select
                  id="merge-part-a"
                  value={partAId}
                  onChange={(e) => setPartAId(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                >
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      Глава {c.subPart || c.number}: {c.titleRus || c.titleEng}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="merge-part-b" className="block text-xs text-slate-400 mb-1">
                  Вторая часть
                </label>
                <select
                  id="merge-part-b"
                  value={partBId}
                  onChange={(e) => setPartBId(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                >
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      Глава {c.subPart || c.number}: {c.titleRus || c.titleEng}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-end gap-3">
              <div className="w-36">
                <label htmlFor="merge-target-num" className="block text-xs text-slate-400 mb-1">
                  Номер главы
                </label>
                <input
                  id="merge-target-num"
                  type="number"
                  min={1}
                  value={targetMergeNum}
                  onChange={(e) => setTargetMergeNum(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-mono tabular-nums text-slate-100"
                />
              </div>

              <button
                type="submit"
                disabled={!partAId || !partBId || partAId === partBId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors"
              >
                <GitMerge className="h-3.5 w-3.5" />
                Объединить
              </button>
            </div>
          </form>

          {mergeSuccessMsg && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-2.5 text-xs text-emerald-300">
              {mergeSuccessMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
