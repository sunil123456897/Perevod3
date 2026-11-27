'use client';

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { BarChart3, AlertTriangle } from 'lucide-react';
import {
  computeChapterGlossaryCoverage,
  type ChapterGlossaryCoverageResult,
} from '@/lib/canon-glossary-vault';
import type { CanonicalGlossary, ScoutedTerm } from '@/lib/pipeline-types';
import type { ChapterRecord } from '@/lib/seed-data';

const MAX_COVERAGE_CACHE_ENTRIES = 1000;
const chapterCoverageCache = new Map<string, ChapterGlossaryCoverageResult>();

function getMemoizedChapterCoverage(
  cacheKey: string,
  compute: () => ChapterGlossaryCoverageResult
): ChapterGlossaryCoverageResult {
  const existing = chapterCoverageCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const computed = compute();
  if (chapterCoverageCache.size >= MAX_COVERAGE_CACHE_ENTRIES) {
    const oldestKey = chapterCoverageCache.keys().next().value;
    if (oldestKey !== undefined) {
      chapterCoverageCache.delete(oldestKey);
    }
  }
  chapterCoverageCache.set(cacheKey, computed);
  return computed;
}

interface TranslationAnalyticsChartProps {
  chapters: ChapterRecord[];
  glossary: CanonicalGlossary;
  scoutedTerms: ScoutedTerm[];
}

interface ChartDataPoint {
  key: string;
  chapterLabel: string;
  dateLabel: string;
  wordsProcessed: number;
  wordsEng: number;
  glossaryCoveragePct: number;
  canonHits: number;
  totalDetectedTerms: number;
  translated: boolean;
  quarantined: boolean;
  quarantineReason?: string;
}

function fastStrHash(text: string): number {
  let h = 2166136261;
  const step = text.length > 2048 ? 8 : 2;
  for (let i = 0; i < text.length; i += step) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function AnalyticsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartDataPoint }>;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
    return null;
  }
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/[0.11] bg-[#151925] px-3.5 py-2.5 text-xs text-[#F3F4F6] shadow-xl max-w-xs space-y-1.5">
      <div className="font-semibold text-[#F3F4F6]">{point.dateLabel}</div>
      <div className="space-y-1 font-mono tabular-nums text-[11px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#B0B8C9]">Объём перевода:</span>
          <span className="text-[#D99B26] font-semibold">
            {point.wordsProcessed} слов (RUS)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#B0B8C9]">Покрытие глоссария:</span>
          <span className="text-emerald-300 font-semibold">
            {point.glossaryCoveragePct}% ({point.canonHits}/{point.totalDetectedTerms})
          </span>
        </div>
      </div>
      {point.quarantined && (
        <div className="mt-1 rounded border border-rose-500/35 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-200 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="line-clamp-2">
            <strong className="font-semibold text-rose-300">Карантин:</strong>{' '}
            {point.quarantineReason || 'Глава изолирована после сбоя перевода'}
          </span>
        </div>
      )}
    </div>
  );
}

export default function TranslationAnalyticsChart({
  chapters,
  glossary,
  scoutedTerms,
}: TranslationAnalyticsChartProps) {
  const glossarySignature = useMemo(() => {
    let h = 2166136261;
    let count = 0;
    for (const [cat, bucket] of Object.entries(glossary)) {
      if (!bucket) continue;
      for (const [eng, rus] of Object.entries(bucket)) {
        count++;
        const line = `${cat}:${eng}=${rus}`;
        for (let i = 0; i < line.length; i++) {
          h ^= line.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
      }
    }
    return `${count}:${h >>> 0}`;
  }, [glossary]);

  const scoutedSignature = useMemo(() => {
    let h = 2166136261;
    let pendingCount = 0;
    for (const st of scoutedTerms) {
      if (st.approved_for_glossary) continue;
      pendingCount++;
      for (let i = 0; i < st.eng.length; i++) {
        h ^= st.eng.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
    }
    return `${pendingCount}:${h >>> 0}`;
  }, [scoutedTerms]);

  const chartData = useMemo<ChartDataPoint[]>(() => {
    const sorted = [...chapters].sort((a, b) => {
      if (a.number !== b.number) return a.number - b.number;
      return (a.subPart || '').localeCompare(b.subPart || '');
    });

    return sorted.map((ch) => {
      const cacheKey = `${ch.id}|${ch.engText.length}|${fastStrHash(ch.engText)}|${ch.rusText.length}|${fastStrHash(ch.rusText)}|${ch.translated ? 1 : 0}|${ch.lastUpdated || ''}|${glossarySignature}|${scoutedSignature}`;
      const {
        canonInSource,
        canonMatchedInRus,
        totalDetectedTerms,
        glossaryCoveragePct,
      } = getMemoizedChapterCoverage(cacheKey, () =>
        computeChapterGlossaryCoverage(ch, glossary, scoutedTerms)
      );

      const numLabel = `Гл. ${ch.subPart || ch.number}`;
      const shortDate = ch.lastUpdated
        ? ch.lastUpdated.slice(5) // MM-DD HH:mm
        : '—';

      return {
        key: ch.id,
        chapterLabel: numLabel,
        dateLabel: `${shortDate} (${numLabel})`,
        wordsProcessed: ch.translated ? ch.wordCountRus : 0,
        wordsEng: ch.wordCountEng,
        glossaryCoveragePct,
        canonHits: ch.translated ? canonMatchedInRus : canonInSource,
        totalDetectedTerms,
        translated: ch.translated,
        quarantined: ch.status === 'quarantined',
        quarantineReason: ch.quarantineReason,
      };
    });
  }, [chapters, glossary, scoutedTerms, glossarySignature, scoutedSignature]);

  const summaryMetrics = useMemo(() => {
    let totalWordsRus = 0;
    let coverageSum = 0;
    let quarantinedCount = 0;
    for (const d of chartData) {
      totalWordsRus += d.wordsProcessed;
      coverageSum += d.glossaryCoveragePct;
      if (d.quarantined) quarantinedCount++;
    }
    const avgCoverage =
      chartData.length > 0 ? Math.round(coverageSum / chartData.length) : 0;
    return { totalWordsRus, avgCoverage, quarantinedCount };
  }, [chartData]);

  if (chartData.length === 0) return null;

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#10131C] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="h-4 w-4 text-[#D99B26] shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-display text-sm font-semibold text-[#F3F4F6]">
              Динамика перевода и покрытие глоссария
            </h2>
            <p className="text-xs text-[#8893A8]">
              Объём обработанных глав (слов RUS) и доля терминов канона (%)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#D99B26] inline-block" aria-hidden="true" />
            <span className="text-[#8893A8]">Слов в переводе:</span>
            <strong className="text-[#F3F4F6]">{summaryMetrics.totalWordsRus.toLocaleString('ru-RU')} сл.</strong>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-400 inline-block" aria-hidden="true" />
            <span className="text-[#8893A8]">Среднее покрытие:</span>
            <strong className="text-emerald-300">{summaryMetrics.avgCoverage}%</strong>
          </div>
          {summaryMetrics.quarantinedCount > 0 && (
            <div className="flex items-center gap-1.5 text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
              <span>Карантин:</span>
              <strong className="text-rose-300">{summaryMetrics.quarantinedCount} гл.</strong>
            </div>
          )}
        </div>
      </div>

      <div className="h-56 w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
          >
            <defs>
              <linearGradient id="wordsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#D99B26" stopOpacity={0.28} />
                <stop offset="95%" stopColor="#D99B26" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              stroke="#8893A8"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            />
            <YAxis
              yAxisId="words"
              stroke="#8893A8"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              unit=" сл."
            />
            <YAxis
              yAxisId="coverage"
              orientation="right"
              domain={[0, 100]}
              stroke="#6ee7b7"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip content={<AnalyticsTooltip />} />
            <Area
              yAxisId="words"
              type="monotone"
              dataKey="wordsProcessed"
              stroke="#D99B26"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#wordsAreaGrad)"
              activeDot={{ r: 4, fill: '#D99B26' }}
            />
            <Line
              yAxisId="coverage"
              type="monotone"
              dataKey="glossaryCoveragePct"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 3.5, fill: '#10b981', strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#34d399' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
