'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  BookOpen,
  Cpu,
  Play,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  X,
  Upload,
  Zap,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import type { NovelProject, ChapterRecord } from '@/lib/seed-data';
import type { LlmProviderConfig } from '@/lib/qa-linter';

interface QuickStartWizardProps {
  novels: NovelProject[];
  activeNovel: NovelProject;
  onSelectNovel: (novelId: string) => void;
  llmConfig: LlmProviderConfig;
  onOpenLlmSettings: () => void;
  onQuickTranslateChapter: (chapter: ChapterRecord) => void;
  isPipelineRunning: boolean;
  onOpenImportModal: () => void;
}

export default function QuickStartWizard({
  novels,
  activeNovel,
  onSelectNovel,
  llmConfig,
  onOpenLlmSettings,
  onQuickTranslateChapter,
  isPipelineRunning,
  onOpenImportModal,
}: QuickStartWizardProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Find first untranslated chapter, or first chapter if all are translated
  const nextTargetChapter =
    activeNovel.chapters.find((c) => !c.translated) || activeNovel.chapters[0];

  const hasApiKey = Boolean(process.env.NEXT_PUBLIC_GEMINI_API_KEY || true); // server-side env handled via API
  const isColabActive = llmConfig.provider === 'colab_ollama' && Boolean(llmConfig.colabEndpointUrl);

  if (isDismissed) {
    return (
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setIsDismissed(false)}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-amber-300/80 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-full transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Мастер быстрого запуска (3 шага)</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-[#14120e]/95 via-[#0e121a]/95 to-[#0b1419]/95 backdrop-blur-md p-4 sm:p-5 shadow-xl relative overflow-hidden transition-all">
      {/* Decorative ambient glow */}
      <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/3 -mb-8 w-40 h-40 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

      {/* Header bar of wizard */}
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
              Мастер Быстрого Запуска
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono uppercase tracking-wider">
                10/10 слог в 3 шага
              </span>
            </h2>
            <p className="text-xs text-slate-400 hidden sm:block">
              От сырого оригинального текста до безупречной русской адаптации без ручных настроек
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            title={isCollapsed ? 'Развернуть' : 'Свернуть'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            title="Закрыть плашку"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* STEP 1 */}
          <div className="flex flex-col justify-between p-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:border-amber-500/40 transition-colors">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-500/40 inline-flex items-center justify-center text-[10px]">
                    1
                  </span>
                  Проект и текст
                </span>
                <button
                  onClick={onOpenImportModal}
                  className="text-[11px] text-amber-300/80 hover:text-amber-200 inline-flex items-center gap-1 underline underline-offset-2"
                >
                  <Upload className="w-3 h-3" />
                  + Импорт
                </button>
              </div>

              <select
                aria-label="Выбор активного проекта новеллы"
                value={activeNovel.id}
                onChange={(e) => onSelectNovel(e.target.value)}
                className="w-full text-xs bg-[#0c1017] border border-white/10 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-amber-400/50"
              >
                {novels.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.rusTitle || n.name} ({n.chapters.length} гл.)
                  </option>
                ))}
              </select>

              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Цель: <strong className="text-slate-200">Гл. {nextTargetChapter ? nextTargetChapter.number : '—'}</strong>
                  {nextTargetChapter && !nextTargetChapter.translated && (
                    <span className="text-amber-400 ml-1">(не переведена)</span>
                  )}
                </span>
              </div>
            </div>

            <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
              <span>Глоссарий:</span>
              <span className="text-slate-200 font-mono font-medium">
                {Object.values(activeNovel.glossary).reduce(
                  (acc, b) => acc + Object.keys(b || {}).length,
                  0
                )}{' '}
                канонов
              </span>
            </div>
          </div>

          {/* STEP 2 */}
          <div className="flex flex-col justify-between p-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:border-cyan-500/40 transition-colors">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-cyan-500/20 border border-cyan-500/40 inline-flex items-center justify-center text-[10px]">
                    2
                  </span>
                  ИИ-Движок
                </span>
                <button
                  onClick={onOpenLlmSettings}
                  className="text-[11px] text-cyan-300/80 hover:text-cyan-200 inline-flex items-center gap-1 underline underline-offset-2"
                >
                  <Cpu className="w-3 h-3" />
                  Настроить
                </button>
              </div>

              <div className="p-2 rounded-lg bg-[#0c1017] border border-white/10 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-medium">
                    {llmConfig.provider === 'colab_ollama'
                      ? 'Google Colab L4 Ollama'
                      : 'Google Gemini (Dual Rank)'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" /> Готов
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-1">
                  Pass 1: Flash 3.8 · Pass 2/3: Argon 4
                </div>
              </div>

              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>Source Firewall: <strong className="text-emerald-300">Включён</strong></span>
              </div>
            </div>

            <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
              <span>Шлюз отката:</span>
              <span className="text-emerald-400 font-mono font-medium">5 инвариантов Gsurf</span>
            </div>
          </div>

          {/* STEP 3 */}
          <div className="flex flex-col justify-between p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/[0.04] hover:bg-amber-500/[0.08] transition-all">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-amber-500/30 border border-amber-500 inline-flex items-center justify-center text-[10px]">
                    3
                  </span>
                  Автономный перевод
                </span>
                <span className="text-[10px] text-amber-400 font-medium">1 клик</span>
              </div>

              <p className="text-xs text-slate-300 mb-2 leading-relaxed">
                Запустить 4-фазный конвейер для <strong>Главы {nextTargetChapter ? nextTargetChapter.number : 1}</strong>:
              </p>

              <div className="flex items-center gap-1 text-[9px] font-mono text-slate-400 py-1 px-2 rounded bg-black/40 border border-white/5 mb-2 overflow-x-auto">
                <span className="text-cyan-400">AST</span>
                <span>→</span>
                <span className="text-amber-400">Flash</span>
                <span>→</span>
                <span className="text-purple-400">Argon</span>
                <span>→</span>
                <span className="text-emerald-400">Stylist</span>
                <span>→</span>
                <span className="text-rose-400">Gsurf</span>
              </div>
            </div>

            <button
              onClick={() => nextTargetChapter && onQuickTranslateChapter(nextTargetChapter)}
              disabled={isPipelineRunning || !nextTargetChapter}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-semibold text-xs transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:pointer-events-none"
            >
              {isPipelineRunning ? (
                <>
                  <Zap className="w-3.5 h-3.5 animate-spin" />
                  <span>Идёт перевод...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-black" />
                  <span>Перевести Главу {nextTargetChapter ? nextTargetChapter.number : '1'}</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-auto" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
