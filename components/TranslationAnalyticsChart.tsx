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
import { BarChart3 } from 'lucide-react';
import {
  filterGlossaryForChapter,
  type CanonicalGlossary,
  type ScoutedTerm,
} from '@/lib/qa-linter';
import type { ChapterRecord } from '@/lib/seed-data';

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
}

export default function TranslationAnalyticsChart({
  chapters,
  glossary,
  scoutedTerms,
}: TranslationAnalyticsChartProps) {
  const chartData = useMemo<ChartDataPoint[]>(() => {
    const sorted = [...chapters].sort((a, b) => {
      if (a.number !== b.number) return a.number - b.number;
      return (a.subPart || '').localeCompare(b.subPart || '');
    });

    return sorted.map((ch) => {
      // Count canonical terms present in the chapter's source text
      const { filteredGlossary, matchedCount: canonInSource } = filterGlossaryForChapter(
        ch.engText,
        glossary
      );

      // Count how many of those canonical terms are actually represented in Russian translation
      let canonMatchedInRus = 0;
      const lowerRus = (ch.rusText || '').toLowerCase().replace(/ё/g, 'е');

      if (ch.rusText.trim()) {
        Object.values(filteredGlossary).forEach((bucket) => {
          Object.values(bucket || {}).forEach((rusTerm) => {
            const rusStr = String(rusTerm || '');
            const stems = rusStr
              .toLowerCase()
              .replace(/ё/g, 'е')
              .split(/\s+/)
              .filter((w) => w.length >= 2)
              .map((w) => {
                if (w.startsWith('камен')) return 'кам';
                if (w.startsWith('корен')) return 'кор';
                return w.slice(0, Math.min(4, Math.max(2, w.length - 2)));
              });

            const matched =
              stems.length === 0 || stems.every((stem) => lowerRus.includes(stem));
            if (matched) {
              canonMatchedInRus++;
            }
          });
        });
      }

      // Count unapproved scouted candidate terms present in this chapter
      let unapprovedInChapter = 0;
      scoutedTerms.forEach((st) => {
        if (!st.approved_for_glossary) {
          const escaped = st.eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${escaped}s?\\b`, 'i').test(ch.engText)) {
            unapprovedInChapter++;
          }
        }
      });

      const totalDetectedTerms = canonInSource + unapprovedInChapter;
      let glossaryCoveragePct = 0;

      if (ch.translated && ch.rusText.trim()) {
        if (totalDetectedTerms === 0) {
          glossaryCoveragePct = 100;
        } else {
          glossaryCoveragePct = Math.min(
            100,
            Math.round((canonMatchedInRus / totalDetectedTerms) * 100)
          );
        }
      } else if (totalDetectedTerms > 0) {
        // For untranslated chapters, show how much of its terminology is already in Canon vs Pending Scout
        glossaryCoveragePct = Math.min(
          100,
          Math.round((canonInSource / totalDetectedTerms) * 100)
        );
      }

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
      };
    });
  }, [chapters, glossary, scoutedTerms]);

  const summaryMetrics = useMemo(() => {
    const totalWordsRus = chartData.reduce((acc, d) => acc + d.wordsProcessed, 0);
    const avgCoverage =
      chartData.length > 0
        ? Math.round(
            chartData.reduce((acc, d) => acc + d.glossaryCoveragePct, 0) /
              chartData.length
          )
        : 0;
    return { totalWordsRus, avgCoverage };
  }, [chartData]);

  if (chartData.length === 0) return null;

  return (
    <section className="border-b border-white/[0.07] pb-6 pt-1 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="h-4 w-4 text-[#D99B26] shrink-0" />
          <div>
            <h2 className="font-display text-[clamp(0.9rem,1.1vw,1rem)] font-semibold tracking-[-0.025em] text-[#F1F5F9]">
              Динамика перевода и покрытие глоссария
            </h2>
            <p className="text-xs text-[#94A3B8]">
              Объём обработанных глав (слов RUS) по времени обновления и точность покрытия терминами канона (%)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs font-mono tabular-nums">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#D99B26] inline-block" />
            <span className="text-[#94A3B8]">Слов в переводе:</span>
            <strong className="text-[#F1F5F9]">{summaryMetrics.totalWordsRus} сл.</strong>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-400 inline-block" />
            <span className="text-[#94A3B8]">Среднее покрытие глоссария:</span>
            <strong className="text-emerald-400">{summaryMetrics.avgCoverage}%</strong>
          </div>
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
                <stop offset="5%" stopColor="#D99B26" stopOpacity={0.32} />
                <stop offset="95%" stopColor="#D99B26" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              stroke="#94A3B8"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            />
            <YAxis
              yAxisId="words"
              stroke="#94A3B8"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              unit=" сл."
            />
            <YAxis
              yAxisId="coverage"
              orientation="right"
              domain={[0, 100]}
              stroke="#34d399"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#161925',
                borderColor: 'rgba(255,255,255,0.1)',
                borderRadius: '0.5rem',
                fontSize: '12px',
                color: '#F1F5F9',
              }}
              labelStyle={{ color: '#F1F5F9', fontWeight: 600, marginBottom: '4px' }}
              formatter={(value, name) => {
                if (name === 'wordsProcessed') {
                  return [`${value} слов (RUS)`, 'Объём перевода'];
                }
                if (name === 'glossaryCoveragePct') {
                  return [`${value}%`, 'Покрытие глоссария'];
                }
                return [String(value), String(name)];
              }}
            />
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
