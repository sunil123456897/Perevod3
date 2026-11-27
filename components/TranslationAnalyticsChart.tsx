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
    <div className="rounded-xl border border-[#F2EFE9]/[0.13] bg-[#1B1B21] px-3.5 py-2.5 text-[13px] text-[#F2EFE9] shadow-xl max-w-xs space-y-1.5">
      <div className="font-semibold text-[#F2EFE9]">{point.dateLabel}</div>
      <div className="space-y-1 tabular-nums text-[13px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#B8B4AC]">Объём перевода:</span>
          <span className="text-[#E3AE48] font-semibold">
            {point.wordsProcessed} слов (RUS)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#B8B4AC]">Покрытие глоссария:</span>
          <span className="text-[#6EE7B7] font-semibold">
            {point.glossaryCoveragePct}% ({point.canonHits}/{point.totalDetectedTerms})
          </span>
        </div>
      </div>
      {point.quarantined && (
        <div className="mt-1 rounded-lg border border-rose-500/35 bg-rose-950/35 px-2.5 py-1.5 text-[13px] text-[#FDA4AF] flex items-start gap-1.5">
          <AlertTriangle className="h-4 w-4 text-[#FDA4AF] shrink-0 mt-0.5" aria-hidden="true" />
          <span className="line-clamp-2">
            <strong className="font-semibold">Карантин:</strong>{' '}
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
    <section className="rounded-xl border border-[#F2EFE9]/[0.08] bg-[#141418] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="h-4 w-4 text-[#D69E36] shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-semibold text-[#F2EFE9]">
              Динамика перевода и покрытие глоссария
            </h2>
            <p className="text-[13px] text-[#8E8A82]">
              Объём обработанных глав и доля терминов канона
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-[13px] tabular-nums">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#D69E36] inline-block" aria-hidden="true" />
            <span className="text-[#8E8A82]">Слов в переводе:</span>
            <strong className="font-semibold text-[#F2EFE9]">
              {summaryMetrics.totalWordsRus.toLocaleString('ru-RU')} сл.
            </strong>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#6EE7B7] inline-block" aria-hidden="true" />
            <span className="text-[#8E8A82]">Среднее покрытие:</span>
            <strong className="font-semibold text-[#6EE7B7]">{summaryMetrics.avgCoverage}%</strong>
          </div>
          {summaryMetrics.quarantinedCount > 0 && (
            <div className="flex items-center gap-1.5 text-[#FDA4AF]">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Карантин:</span>
              <strong className="font-semibold">{summaryMetrics.quarantinedCount} гл.</strong>
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
                <stop offset="5%" stopColor="#D69E36" stopOpacity={0.26} />
                <stop offset="95%" stopColor="#D69E36" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(242,239,233,0.06)" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              stroke="#8E8A82"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: 'rgba(242,239,233,0.08)' }}
            />
            <YAxis
              yAxisId="words"
              stroke="#8E8A82"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              unit=" сл."
            />
            <YAxis
              yAxisId="coverage"
              orientation="right"
              domain={[0, 100]}
              stroke="#6EE7B7"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip content={<AnalyticsTooltip />} />
            <Area
              yAxisId="words"
              type="monotone"
              dataKey="wordsProcessed"
              stroke="#D69E36"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#wordsAreaGrad)"
              activeDot={{ r: 4, fill: '#D69E36' }}
            />
            <Line
              yAxisId="coverage"
              type="monotone"
              dataKey="glossaryCoveragePct"
              stroke="#52C79A"
              strokeWidth={2}
              dot={{ r: 3.5, fill: '#52C79A', strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#6EE7B7' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
