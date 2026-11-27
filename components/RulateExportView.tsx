'use client';

import React, { useState, useMemo } from 'react';
import {
  Download,
  Copy,
  Check,
  GitMerge,
  ShieldCheck,
  BookOpen,
  FileCode2,
} from 'lucide-react';
import {
  buildRulateExportPackages,
  GENRE_PRESET_LABELS,
  type RulateExportPackage,
} from '@/lib/qa-linter';
import {
  buildEpub3Archive,
  createStoredZipArchive,
} from '@/lib/epub-archive';
import type { HeroStateLedger, GenrePreset } from '@/lib/pipeline-types';
import type { ChapterRecord } from '@/lib/seed-data';

function sanitizeArchiveSlug(name: string): string {
  const cleaned = (name || 'novel')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'novel';
}

function buildChapterZipFilename(
  ch: { number: number; subPart?: string },
  usedNames: Set<string>
): string {
  const padded = String(Math.max(0, Math.floor(ch.number))).padStart(4, '0');
  let suffix = '';
  if (ch.subPart && ch.subPart.trim()) {
    const rawSub = ch.subPart.trim();
    const prefixWithDot = `${Math.floor(ch.number)}.`;
    const subOnly = rawSub.startsWith(prefixWithDot)
      ? rawSub.slice(prefixWithDot.length)
      : rawSub.includes('.')
      ? rawSub.split('.').slice(1).join('_')
      : rawSub;
    const cleanSub = subOnly.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
    if (cleanSub) suffix = `_${cleanSub}`;
  } else if (ch.number % 1 !== 0) {
    const frac = String(ch.number).split('.')[1]?.replace(/[^a-z0-9_-]+/gi, '_');
    if (frac) suffix = `_${frac}`;
  }

  let candidate = `Chapter_${padded}${suffix}.txt`;
  let dedup = 2;
  while (usedNames.has(candidate)) {
    candidate = `Chapter_${padded}${suffix}_dup${dedup}.txt`;
    dedup += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

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
  const [includeUnverified, setIncludeUnverified] = useState(false);
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

  const {
    exportableChapters,
    quarantinedCount,
    unverifiedExcludedCount,
  } = useMemo(() => {
    const translatedReady = chapters.filter(
      (c) => c.translated && c.rusText.trim().length > 0
    );
    const qCount = translatedReady.filter((c) => c.status === 'quarantined').length;
    const unverifiedCount = translatedReady.filter(
      (c) => c.status !== 'quarantined' && !c.verified
    ).length;

    const filtered = translatedReady
      .filter((c) => c.status !== 'quarantined')
      .filter((c) => (includeUnverified ? true : Boolean(c.verified)))
      .sort((a, b) => {
        if (a.number !== b.number) return a.number - b.number;
        return (a.subPart || '').localeCompare(b.subPart || '');
      })
      .map((c) => ({
        number: c.number,
        subPart: c.subPart,
        titleRus: c.titleRus || `Глава ${c.subPart || c.number}`,
        titleEng: c.titleEng,
        contentRus: c.rusText,
        summaryRus: c.summary,
        csiNotes: includeCsiFootnotes ? c.csiNotes : undefined,
      }));

    return {
      exportableChapters: filtered,
      quarantinedCount: qCount,
      unverifiedExcludedCount: unverifiedCount,
    };
  }, [chapters, includeUnverified, includeCsiFootnotes]);

  const packages: RulateExportPackage[] = useMemo(
    () => buildRulateExportPackages(novelName, exportableChapters, batchSize),
    [novelName, exportableChapters, batchSize]
  );

  const totalExportWords = useMemo(
    () =>
      exportableChapters.reduce((sum, ch) => {
        const trimmed = ch.contentRus.trim();
        return sum + (trimmed ? trimmed.split(/\s+/).length : 0);
      }, 0),
    [exportableChapters]
  );

  const estimatedTextKb = useMemo(() => {
    const totalChars = exportableChapters.reduce(
      (sum, ch) => sum + ch.contentRus.length + ch.titleRus.length + 128,
      0
    );
    return Math.max(1, Math.round(totalChars / 1024));
  }, [exportableChapters]);

  const epubFilenamePreview = useMemo(
    () => `${sanitizeArchiveSlug(novelName)}.epub`,
    [novelName]
  );

  const activePackage = packages[selectedBatchIdx] || packages[0] || null;

  const triggerBinaryDownload = (
    bytes: Uint8Array,
    filename: string,
    mimeType: string
  ) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPackage = (pkg: RulateExportPackage) => {
    const blob = new Blob([pkg.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pkg.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllRulateZip = () => {
    if (packages.length === 0) return;
    const encoder = new TextEncoder();
    const files = packages.map((pkg) => ({
      path: pkg.filename,
      data: encoder.encode(pkg.content),
    }));
    const zipBytes = createStoredZipArchive(files);
    const slug = sanitizeArchiveSlug(novelName);
    triggerBinaryDownload(
      zipBytes,
      `${slug}_rulate_all_${packages.length}_volumes.zip`,
      'application/zip'
    );
  };

  const handleDownloadChaptersZip = () => {
    if (exportableChapters.length === 0) return;
    const encoder = new TextEncoder();
    const usedNames = new Set<string>();
    const manifestChapters: Array<{
      number: number;
      subPart?: string;
      filename: string;
      titleRus: string;
    }> = [];

    const files = exportableChapters.map((ch) => {
      const filename = buildChapterZipFilename(ch, usedNames);
      manifestChapters.push({
        number: ch.number,
        subPart: ch.subPart,
        filename,
        titleRus: ch.titleRus,
      });
      const normalizedBody = ch.contentRus.replace(/\r\n/g, '\n').trim();
      const textPayload = `${ch.titleRus}\n\n${normalizedBody}\n`;
      return {
        path: filename,
        data: encoder.encode(textPayload),
      };
    });

    files.unshift({
      path: '00_MANIFEST.json',
      data: encoder.encode(
        JSON.stringify(
          {
            novelTitle: novelName,
            chapterCount: exportableChapters.length,
            exportedAt: new Date().toISOString(),
            chapters: manifestChapters,
          },
          null,
          2
        )
      ),
    });

    const zipBytes = createStoredZipArchive(files);
    const slug = sanitizeArchiveSlug(novelName);
    triggerBinaryDownload(zipBytes, `${slug}_chapters.zip`, 'application/zip');
  };

  const handleDownloadEpub = () => {
    if (exportableChapters.length === 0) return;
    const built = buildEpub3Archive({
      novelTitle: novelName,
      author: epubAuthor,
      translator: epubTranslator,
      genreLabel: GENRE_PRESET_LABELS[genrePreset]?.title || 'Сянься / ЛитРПГ',
      heroLedger: includeHeroPassport ? heroLedger : undefined,
      chapters: exportableChapters,
    });
    triggerBinaryDownload(built.bytes, built.filename, 'application/epub+zip');
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

        <div className="flex flex-wrap items-center gap-3">
          {subTab !== 'merge' && (
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUnverified}
                  onChange={(e) => {
                    setIncludeUnverified(e.target.checked);
                    setSelectedBatchIdx(0);
                  }}
                  className="rounded border-slate-700 bg-slate-950 text-amber-500"
                />
                Включать непроверенные
              </label>
              {unverifiedExcludedCount > 0 && !includeUnverified && (
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-mono tabular-nums text-amber-300">
                  скрыто непроверенных: {unverifiedExcludedCount}
                </span>
              )}
              {quarantinedCount > 0 && (
                <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-mono tabular-nums text-rose-300">
                  в карантине: {quarantinedCount}
                </span>
              )}
            </div>
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

          {subTab === 'rulate' && packages.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadAllRulateZip}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Скачать все тома Rulate единым .zip ({packages.length})
            </button>
          )}

          {exportableChapters.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadChaptersZip}
              title="Каждая глава отдельным файлом Chapter_0001.txt (или Chapter_0007_1.txt для дробных) внутри ZIP"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 transition-colors tabular-nums"
            >
              <Download className="h-3.5 w-3.5 text-emerald-400" />
              ZIP по главам · Ranobelib/AT ({exportableChapters.length} ф.)
            </button>
          )}

          {exportableChapters.length > 0 && subTab !== 'epub' && (
            <button
              type="button"
              onClick={handleDownloadEpub}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition-colors tabular-nums"
            >
              <BookOpen className="h-3.5 w-3.5 text-amber-400" />
              Скачать .epub ({exportableChapters.length} гл.)
            </button>
          )}
        </div>
      </div>

      {subTab === 'rulate' ? (
        packages.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 py-12 text-center space-y-1">
            <p className="text-sm font-medium text-slate-300">
              Нет глав, готовых к экспорту
            </p>
            {(unverifiedExcludedCount > 0 || quarantinedCount > 0) && (
              <p className="text-xs text-slate-400 tabular-nums">
                Исключено непроверенных: {unverifiedExcludedCount} · в карантине: {quarantinedCount}
              </p>
            )}
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
        exportableChapters.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 py-12 text-center space-y-1">
            <p className="text-sm font-medium text-slate-300">
              Нет глав, готовых для компиляции книги EPUB 3
            </p>
            {(unverifiedExcludedCount > 0 || quarantinedCount > 0) && (
              <p className="text-xs text-slate-400 tabular-nums">
                Исключено непроверенных: {unverifiedExcludedCount} · в карантине: {quarantinedCount}
              </p>
            )}
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
                  ~{estimatedTextKb} КБ текст
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
                  {exportableChapters.length} гл. · {totalExportWords.toLocaleString('ru-RU')} сл.
                </div>
                <button
                  type="button"
                  onClick={handleDownloadEpub}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Скачать {epubFilenamePreview}
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
                    └── OEBPS/chapter_1..{exportableChapters.length}.xhtml
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Предпросмотр рамки <code className="font-mono text-amber-300">.system-box</code> в читалке
                  </div>
                  <div className="rounded-md border border-amber-500/40 bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-200">
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
                      key={`${ch.number}-${ch.subPart || ''}`}
                      className="flex items-center justify-between gap-2 border-b border-slate-900 pb-1 last:border-0"
                    >
                      <span className="text-slate-200 truncate">
                        <strong className="font-mono text-amber-400 mr-2 tabular-nums">
                          #{ch.subPart || ch.number}
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

