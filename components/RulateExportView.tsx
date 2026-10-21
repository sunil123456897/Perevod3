'use client';

import React, { useState, useMemo } from 'react';
import {
  Download,
  Copy,
  Check,
  GitMerge,
  ShieldCheck,
  BookOpen,
  Sparkles,
  FileCode2,
} from 'lucide-react';
import {
  buildRulateExportPackages,
  buildEpub3Archive,
  GENRE_PRESET_LABELS,
  type RulateExportPackage,
  type HeroStateLedger,
  type GenrePreset,
} from '@/lib/qa-linter';
import type { ChapterRecord } from '@/lib/seed-data';

interface RulateExportViewProps {
  novelName: string;
  chapters: ChapterRecord[];
  heroLedger?: HeroStateLedger;
  genrePreset?: GenrePreset;
  onMergeSplitChapters: (partAId: string, partBId: string, targetNumber: number) => void;
}

export default function RulateExportView({
  novelName,
  chapters,
  heroLedger,
  genrePreset = 'xianxia',
  onMergeSplitChapters,
}: RulateExportViewProps) {
  const [subTab, setSubTab] = useState<'rulate' | 'epub' | 'merge'>('rulate');
  const [batchSize, setBatchSize] = useState(20);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [selectedBatchIdx, setSelectedBatchIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  // EPUB 3 Configuration State
  const [epubAuthor, setEpubAuthor] = useState('Kanon Xianxia Studio');
  const [epubTranslator, setEpubTranslator] = useState('Автономный конвейер LCD-MAS + DelTA');
  const [includeHeroPassport, setIncludeHeroPassport] = useState(true);
  const [includeCsiFootnotes, setIncludeCsiFootnotes] = useState(true);

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
        titleEng: c.titleEng,
        contentRus: c.rusText,
        summaryRus: c.summary,
        csiNotes: includeCsiFootnotes ? c.csiNotes : undefined,
      }));
  }, [chapters, onlyVerified, includeCsiFootnotes]);

  const packages: RulateExportPackage[] = useMemo(
    () => buildRulateExportPackages(novelName, exportableChapters, batchSize),
    [novelName, exportableChapters, batchSize]
  );

  const epubPackage = useMemo(() => {
    if (exportableChapters.length === 0) return null;
    return buildEpub3Archive({
      novelTitle: novelName,
      author: epubAuthor,
      translator: epubTranslator,
      genreLabel: GENRE_PRESET_LABELS[genrePreset]?.title || 'Сянься / ЛитРПГ',
      heroLedger: includeHeroPassport ? heroLedger : undefined,
      chapters: exportableChapters,
    });
  }, [
    novelName,
    epubAuthor,
    epubTranslator,
    genrePreset,
    includeHeroPassport,
    heroLedger,
    exportableChapters,
  ]);

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

  const handleDownloadEpub = () => {
    if (!epubPackage) return;
    const blob = new Blob([epubPackage.bytes.buffer as ArrayBuffer], {
      type: 'application/epub+zip',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = epubPackage.filename;
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
            onClick={() => setSubTab('epub')}
            className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'epub'
                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5 text-amber-400" />
            Сборка книги EPUB 3 ({exportableChapters.length} гл.)
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

        <div className="flex flex-wrap items-center gap-4">
          {subTab !== 'merge' && (
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
          )}

          {subTab === 'rulate' && (
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
          )}

          {epubPackage && subTab !== 'epub' && (
            <button
              type="button"
              onClick={handleDownloadEpub}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5 text-amber-400" />
              Скачать .epub ({(epubPackage.byteSize / 1024).toFixed(1)} КБ)
            </button>
          )}
        </div>
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
      ) : subTab === 'epub' ? (
        !epubPackage ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 py-12 text-center">
            <p className="text-sm font-medium text-slate-300">
              Нет переведённых глав для компиляции книги EPUB 3
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left column: EPUB 3 Compiler Settings & Download Action */}
            <div className="lg:col-span-5 space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400">
                    Стандарт IDPF EPUB 3.0 · Без сжатия mimetype
                  </span>
                  <h3 className="text-sm font-semibold text-slate-100 mt-0.5">
                    Компилятор электронной книги (.epub)
                  </h3>
                </div>
                <span className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-1 font-mono text-xs tabular-nums text-emerald-300">
                  {(epubPackage.byteSize / 1024).toFixed(1)} КБ
                </span>
              </div>

              <div className="space-y-3 pt-1">
                <div>
                  <label htmlFor="epub-author-input" className="block text-xs text-slate-400 mb-1">
                    Автор / Оригинальный источник (dc:creator)
                  </label>
                  <input
                    id="epub-author-input"
                    type="text"
                    value={epubAuthor}
                    onChange={(e) => setEpubAuthor(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                  />
                </div>

                <div>
                  <label htmlFor="epub-translator-input" className="block text-xs text-slate-400 mb-1">
                    Команда перевода / Конвейер
                  </label>
                  <input
                    id="epub-translator-input"
                    type="text"
                    value={epubTranslator}
                    onChange={(e) => setEpubTranslator(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeHeroPassport}
                      onChange={(e) => setIncludeHeroPassport(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-amber-500"
                    />
                    Включить титульный лист с «Паспортом состояния героя»
                  </label>

                  <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeCsiFootnotes}
                      onChange={(e) => setIncludeCsiFootnotes(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-amber-500"
                    />
                    Включить культурные сноски CHORUS C3 (CSI) в конце глав
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-400 font-mono tabular-nums">
                  {epubPackage.chapterCount} глав · UTF-8 XHTML
                </div>
                <button
                  type="button"
                  onClick={handleDownloadEpub}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Скачать {epubPackage.filename}
                </button>
              </div>
            </div>

            {/* Right column: EPUB 3 Container Structure & System Frame CSS Preview */}
            <div className="lg:col-span-7 space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-semibold text-slate-200">
                    Архитектура архива OEBPS и стили системных рамок ЛитРПГ/Сянься
                  </span>
                </div>
                <span className="text-[11px] font-mono text-emerald-400">
                  application/epub+zip (CRC-32 valid)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-1.5 font-mono">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-sans">
                    Дерево контейнера EPUB 3
                  </div>
                  <div className="text-amber-300">├── mimetype (20 B, STORE)</div>
                  <div className="text-slate-300">├── META-INF/container.xml</div>
                  <div className="text-slate-300">├── OEBPS/content.opf</div>
                  <div className="text-slate-300">├── OEBPS/nav.xhtml (TOC EPUB 3)</div>
                  <div className="text-slate-300">├── OEBPS/toc.ncx (Совместимость)</div>
                  <div className="text-slate-300">├── OEBPS/styles.css</div>
                  <div className="text-slate-300">├── OEBPS/title.xhtml (Паспорт)</div>
                  <div className="text-emerald-300">
                    └── OEBPS/chapter_1..{epubPackage.chapterCount}.xhtml
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Предпросмотр рамки <code className="font-mono text-amber-300">.system-box</code> в читалке
                  </div>
                  <div className="rounded-md border border-slate-600 border-l-4 border-l-amber-500 bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-200">
                    [Система: Обнаружен прорыв на 3-й уровень Конденсации Ци!]
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Все строки в квадратных скобках <code className="font-mono">[...]</code> или угловых кавычках автоматически верстаются в стилизованный системный блок для Apple Books, PocketBook и ЛитРес.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Оглавление книги (nav.xhtml)
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1.5 text-xs">
                  {exportableChapters.map((ch) => (
                    <div
                      key={ch.number}
                      className="flex items-center justify-between gap-2 border-b border-slate-900 pb-1 last:border-0"
                    >
                      <span className="text-slate-200 truncate">
                        <strong className="font-mono text-amber-400 mr-2">
                          #{ch.number}
                        </strong>
                        {ch.titleRus}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 shrink-0">
                        {ch.contentRus.trim().split(/\s+/).length} сл.
                        {ch.csiNotes && ch.csiNotes.length > 0 && (
                          <span className="ml-2 text-amber-300">
                            · {ch.csiNotes.length} CSI
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
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

