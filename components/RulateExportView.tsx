'use client';

import React, { useState, useMemo, useRef } from 'react';
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

type ExportSubTab = 'rulate' | 'epub' | 'merge';

export default function RulateExportView({
  novelName,
  chapters,
  heroLedger,
  genrePreset = 'xianxia',
  onMergeSplitChapters,
}: RulateExportViewProps) {
  const [subTab, setSubTab] = useState<ExportSubTab>('rulate');
  const [batchSize, setBatchSize] = useState(20);
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [selectedBatchIdx, setSelectedBatchIdx] = useState(0);
  const [copied, setCopied] = useState(false);

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

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
    setMergeSuccessMsg(`Полуглавы объединены в Главу ${targetMergeNum}`);
  };

  const exportTabs: Array<{ id: ExportSubTab; label: string; icon?: React.ReactNode }> = [
    { id: 'rulate', label: `Пакеты для Рулейта (${packages.length})` },
    {
      id: 'epub',
      label: `Книга EPUB 3 (${exportableChapters.length} гл.)`,
      icon: <BookOpen className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />,
    },
    { id: 'merge', label: `Склейка полуглав (${splitCandidates.length})` },
  ];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = exportTabs.findIndex((t) => t.id === subTab);
    if (idx === -1) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % exportTabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + exportTabs.length) % exportTabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = exportTabs.length - 1;
    if (nextIdx >= 0) {
      e.preventDefault();
      setSubTab(exportTabs[nextIdx].id);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-Navigation & Export Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-2">
        <div
          role="tablist"
          aria-label="Режимы экспорта и склейки"
          onKeyDown={handleTabKeyDown}
          className="flex items-center gap-1 overflow-x-auto studio-tablist"
        >
          {exportTabs.map((t, i) => {
            const isSelected = subTab === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`export-tab-${t.id}`}
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSubTab(t.id)}
                className={`studio-tab inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isSelected ? 'text-[#F3F4F6]' : 'text-[#8893A8] hover:text-[#F3F4F6]'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {subTab !== 'merge' && (
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex items-center gap-2 text-xs text-[#B0B8C9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUnverified}
                  onChange={(e) => {
                    setIncludeUnverified(e.target.checked);
                    setSelectedBatchIdx(0);
                  }}
                  className="h-3.5 w-3.5 rounded border-white/[0.2] bg-[#0A0C12]"
                />
                <span>Включать непроверенные</span>
              </label>
              {unverifiedExcludedCount > 0 && !includeUnverified && (
                <span className="rounded border border-[#D99B26]/35 bg-[#D99B26]/10 px-2 py-0.5 font-mono text-[11px] tabular-nums text-[#E5AC3D]">
                  скрыто: {unverifiedExcludedCount}
                </span>
              )}
              {quarantinedCount > 0 && (
                <span className="rounded border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 font-mono text-[11px] tabular-nums text-rose-300">
                  карантин: {quarantinedCount}
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
              className="rounded-lg border border-white/[0.1] bg-[#10131C] px-3 py-1.5 font-mono text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
            >
              <option value={5}>По 5 глав</option>
              <option value={10}>По 10 глав</option>
              <option value={20}>По 20 глав (макс.)</option>
            </select>
          )}

          {exportableChapters.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadChaptersZip}
              title="Каждая глава отдельным файлом внутри ZIP"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#10131C] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-white/[0.2] transition-colors tabular-nums"
            >
              <Download className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>ZIP по главам ({exportableChapters.length})</span>
            </button>
          )}

          {exportableChapters.length > 0 && subTab !== 'epub' && (
            <button
              type="button"
              onClick={handleDownloadEpub}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#10131C] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-[#D99B26]/50 transition-colors tabular-nums"
            >
              <BookOpen className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
              <span>EPUB ({exportableChapters.length})</span>
            </button>
          )}

          {subTab === 'rulate' && packages.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadAllRulateZip}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-3.5 py-1.5 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D] transition-colors"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Все тома Rulate (.zip)</span>
            </button>
          )}
        </div>
      </div>

      {subTab === 'rulate' ? (
        <div role="tabpanel" aria-labelledby="export-tab-rulate">
          {packages.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-[#10131C] py-12 text-center space-y-1">
              <p className="text-sm font-medium text-[#F3F4F6]">
                Нет глав, готовых к экспорту
              </p>
              {(unverifiedExcludedCount > 0 || quarantinedCount > 0) && (
                <p className="text-xs text-[#8893A8] tabular-nums">
                  Исключено непроверенных: {unverifiedExcludedCount} · в карантине: {quarantinedCount}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="lg:col-span-4 space-y-3">
                {packages.map((pkg, idx) => {
                  const isActive = selectedBatchIdx === idx;
                  return (
                    <article
                      key={pkg.filename}
                      className={`rounded-xl border transition-colors ${
                        isActive
                          ? 'border-[#D99B26]/60 bg-[#151925]'
                          : 'border-white/[0.08] bg-[#10131C] hover:border-white/[0.16]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedBatchIdx(idx)}
                        aria-current={isActive ? 'true' : undefined}
                        className="w-full p-4 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-[#F3F4F6]">
                            {pkg.chapterRange}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-[#8893A8]">
                            {(pkg.byteSize / 1024).toFixed(1)} КБ
                          </span>
                        </div>

                        <div className="mt-1.5 flex items-center gap-2 text-xs text-[#B0B8C9] font-mono tabular-nums">
                          <span>{pkg.chapterCount} гл.</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-300 inline-flex items-center gap-1">
                            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            Unix LF
                          </span>
                        </div>
                      </button>

                      <div className="px-4 py-2.5 border-t border-white/[0.07] flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDownloadPackage(pkg)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#0A0C12] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-[#D99B26]/50 hover:text-[#E5AC3D] transition-colors"
                        >
                          <Download className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
                          <span>Скачать .md</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="lg:col-span-8 flex flex-col rounded-xl border border-white/[0.09] bg-[#10131C] p-5">
                {activePackage && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-white/[0.08]">
                      <span className="font-mono text-xs text-[#F3F4F6] truncate">
                        {activePackage.filename}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleDownloadPackage.bind(null, activePackage)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#151925] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-white/[0.2]"
                        >
                          <Download className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
                          <span>Скачать том</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyContent}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#151925] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-white/[0.2]"
                        >
                          {copied ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                              <span>Скопировано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Копировать</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <pre className="flex-1 overflow-auto studio-scroll rounded-lg border border-white/[0.07] bg-[#0A0C12] p-4 font-mono text-xs leading-relaxed text-[#B0B8C9] max-h-[460px] whitespace-pre-wrap">
                      {activePackage.content}
                    </pre>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      ) : subTab === 'epub' ? (
        <div role="tabpanel" aria-labelledby="export-tab-epub">
          {exportableChapters.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-[#10131C] py-12 text-center space-y-1">
              <p className="text-sm font-medium text-[#F3F4F6]">
                Нет глав, готовых для сборки книги EPUB 3
              </p>
              {(unverifiedExcludedCount > 0 || quarantinedCount > 0) && (
                <p className="text-xs text-[#8893A8] tabular-nums">
                  Исключено непроверенных: {unverifiedExcludedCount} · в карантине: {quarantinedCount}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="lg:col-span-5 space-y-4 rounded-xl border border-white/[0.09] bg-[#10131C] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-sm font-semibold text-[#F3F4F6]">
                      Компилятор электронной книги (.epub)
                    </h2>
                    <p className="text-[11px] font-mono text-[#8893A8] mt-1">
                      IDPF EPUB 3.0 · без сжатия mimetype
                    </p>
                  </div>
                  <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs tabular-nums text-emerald-300 shrink-0">
                    ~{estimatedTextKb} КБ
                  </span>
                </div>

                <div className="space-y-3 pt-1">
                  <div>
                    <label
                      htmlFor="epub-author-input"
                      className="block text-xs text-[#B0B8C9] mb-1.5"
                    >
                      Автор / Оригинальный источник (dc:creator)
                    </label>
                    <input
                      id="epub-author-input"
                      type="text"
                      value={epubAuthor}
                      onChange={(e) => setEpubAuthor(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="epub-translator-input"
                      className="block text-xs text-[#B0B8C9] mb-1.5"
                    >
                      Команда перевода / Конвейер
                    </label>
                    <input
                      id="epub-translator-input"
                      type="text"
                      value={epubTranslator}
                      onChange={(e) => setEpubTranslator(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2.5 text-xs text-[#B0B8C9] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeHeroPassport}
                        onChange={(e) => setIncludeHeroPassport(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-white/[0.2] bg-[#0A0C12]"
                      />
                      <span>Титульный лист с «Паспортом состояния героя»</span>
                    </label>

                    <label className="flex items-center gap-2.5 text-xs text-[#B0B8C9] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeCsiFootnotes}
                        onChange={(e) => setIncludeCsiFootnotes(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-white/[0.2] bg-[#0A0C12]"
                      />
                      <span>Культурные сноски CHORUS C3 (CSI) в конце глав</span>
                    </label>
                  </div>
                </div>

                <div className="pt-3 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-[#8893A8] font-mono tabular-nums">
                    {exportableChapters.length} гл. · {totalExportWords.toLocaleString('ru-RU')} сл.
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadEpub}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D] transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Скачать {epubFilenamePreview}</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-7 space-y-4 rounded-xl border border-white/[0.09] bg-[#10131C] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-[#D99B26]" aria-hidden="true" />
                    <span className="text-xs font-semibold text-[#F3F4F6]">
                      Структура архива OEBPS и оформление системных блоков
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-300">
                    application/epub+zip (CRC-32)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-white/[0.08] bg-[#0A0C12] p-3 space-y-1.5 font-mono">
                    <div className="text-[11px] text-[#8893A8] font-sans font-medium">
                      Контейнер EPUB 3
                    </div>
                    <div className="text-[#E5AC3D]">├── mimetype (20 B, STORE)</div>
                    <div className="text-[#B0B8C9]">├── META-INF/container.xml</div>
                    <div className="text-[#B0B8C9]">├── OEBPS/content.opf</div>
                    <div className="text-[#B0B8C9]">├── OEBPS/nav.xhtml</div>
                    <div className="text-[#B0B8C9]">├── OEBPS/toc.ncx</div>
                    <div className="text-[#B0B8C9]">├── OEBPS/styles.css</div>
                    <div className="text-[#B0B8C9]">├── OEBPS/title.xhtml</div>
                    <div className="text-emerald-300">
                      └── OEBPS/chapter_1..{exportableChapters.length}.xhtml
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/[0.08] bg-[#0A0C12] p-3 space-y-2">
                    <div className="text-[11px] text-[#8893A8] font-medium">
                      Предпросмотр рамки <code className="font-mono text-[#E5AC3D]">.system-box</code>
                    </div>
                    <div className="rounded-md border border-[#D99B26]/40 bg-[#10131C] px-3 py-2 font-mono text-[11px] text-[#F3F4F6]">
                      [Система: Обнаружен прорыв на 3-й уровень Конденсации Ци!]
                    </div>
                    <p className="text-[11px] text-[#8893A8] leading-relaxed">
                      Строки в квадратных скобках <code className="font-mono">[...]</code> оформляются системным блоком для читалок и ЛитРес.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-[#8893A8]">
                    Оглавление книги (nav.xhtml)
                  </div>
                  <div className="max-h-48 overflow-y-auto studio-scroll rounded-lg border border-white/[0.08] bg-[#0A0C12] p-3 space-y-1.5 text-xs">
                    {exportableChapters.map((ch) => (
                      <div
                        key={`${ch.number}-${ch.subPart || ''}`}
                        className="flex items-center justify-between gap-2 border-b border-white/[0.05] pb-1 last:border-0"
                      >
                        <span className="text-[#F3F4F6] truncate">
                          <strong className="font-mono text-[#D99B26] mr-2 tabular-nums">
                            #{ch.subPart || ch.number}
                          </strong>
                          {ch.titleRus}
                        </span>
                        <span className="font-mono text-[11px] text-[#8893A8] shrink-0 tabular-nums">
                          {ch.contentRus.trim().split(/\s+/).length} сл.
                          {ch.csiNotes && ch.csiNotes.length > 0 && (
                            <span className="ml-2 text-[#E5AC3D]">
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
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          aria-labelledby="export-tab-merge"
          className="rounded-xl border border-white/[0.09] bg-[#10131C] p-6 max-w-2xl space-y-4"
        >
          <div>
            <h2 className="font-display text-sm font-semibold text-[#F3F4F6]">
              Объединение разбитых глав (например, 7.1 + 7.2 → 7)
            </h2>
            <p className="text-xs text-[#8893A8] mt-1">
              Склеивает английский оригинал и русский перевод двух полуглав через разделитель «---».
            </p>
          </div>

          <form onSubmit={handleTriggerMerge} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="merge-part-a" className="block text-xs text-[#B0B8C9] mb-1.5">
                  Первая часть
                </label>
                <select
                  id="merge-part-a"
                  value={partAId}
                  onChange={(e) => setPartAId(e.target.value)}
                  className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
                >
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      Глава {c.subPart || c.number}: {c.titleRus || c.titleEng}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="merge-part-b" className="block text-xs text-[#B0B8C9] mb-1.5">
                  Вторая часть
                </label>
                <select
                  id="merge-part-b"
                  value={partBId}
                  onChange={(e) => setPartBId(e.target.value)}
                  className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
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
                <label htmlFor="merge-target-num" className="block text-xs text-[#B0B8C9] mb-1.5">
                  Номер главы
                </label>
                <input
                  id="merge-target-num"
                  type="number"
                  min={1}
                  value={targetMergeNum}
                  onChange={(e) => setTargetMergeNum(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs font-mono tabular-nums text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={!partAId || !partBId || partAId === partBId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D] disabled:opacity-40 transition-colors"
              >
                <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Объединить</span>
              </button>
            </div>
          </form>

          {mergeSuccessMsg && (
            <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
              {mergeSuccessMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
