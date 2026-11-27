'use client';

import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Cpu,
  Play,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  X,
  Upload,
  Zap,
  ShieldCheck,
  ArrowRight,
  Settings2,
} from 'lucide-react';
import type { NovelProject, ChapterRecord } from '@/lib/seed-data';
import type { LlmProviderConfig } from '@/lib/pipeline-types';

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
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [serverHasKey, setServerHasKey] = useState<boolean>(
    Boolean(process.env.NEXT_PUBLIC_GEMINI_API_KEY)
  );

  useEffect(() => {
    let mounted = true;
    fetch('/api/pipeline')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data && typeof data.hasServerApiKey === 'boolean') {
          setServerHasKey(data.hasServerApiKey);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const translatedCount = activeNovel.chapters.filter((c) => c.translated).length;
  const isExpanded = userExpanded !== null ? userExpanded : translatedCount === 0;

  const nextTargetChapter =
    activeNovel.chapters.find((c) => !c.translated) || activeNovel.chapters[0];

  const hasApiKey = Boolean(process.env.NEXT_PUBLIC_GEMINI_API_KEY) || serverHasKey;
  const isColabActive =
    llmConfig.provider === 'colab_ollama' && Boolean(llmConfig.colabEndpointUrl?.trim());
  const isEngineReady =
    llmConfig.provider === 'colab_ollama' ? isColabActive : hasApiKey;

  const primaryModelLabel = llmConfig.modelId || 'gemini-4-hydrogen';
  const criticModelLabel = llmConfig.criticModelId || primaryModelLabel;
  const stylistModelLabel = llmConfig.stylistModelId || criticModelLabel;

  const providerTitle =
    llmConfig.provider === 'colab_ollama'
      ? 'Google Colab L4 (Ollama)'
      : 'Google Gemini (Dual Rank)';

  const providerModelsSubtitle =
    llmConfig.provider === 'colab_ollama'
      ? `${primaryModelLabel}`
      : stylistModelLabel !== criticModelLabel
        ? `${primaryModelLabel} · ${criticModelLabel} · ${stylistModelLabel}`
        : `${primaryModelLabel} · ${criticModelLabel}`;

  const canonCount = Object.values(activeNovel.glossary).reduce(
    (acc, b) => acc + Object.keys(b || {}).length,
    0
  );

  if (isDismissed) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setIsDismissed(false);
            setUserExpanded(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#10131C] px-3 py-1.5 text-xs font-medium text-[#B0B8C9] transition-colors hover:border-white/[0.16] hover:text-[#F3F4F6]"
        >
          <Settings2 className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
          <span>Мастер запуска</span>
        </button>
      </div>
    );
  }

  if (!isExpanded) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#10131C] px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <span className="inline-flex items-center gap-2 font-medium text-[#F3F4F6]">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                isEngineReady ? 'bg-emerald-400' : 'bg-[#D99B26]'
              }`}
              aria-hidden="true"
            />
            {providerTitle}
          </span>
          <span className="hidden sm:inline font-mono text-[11px] text-[#8893A8] truncate">
            {providerModelsSubtitle}
          </span>
          {!isEngineReady && (
            <button
              type="button"
              onClick={onOpenLlmSettings}
              className="inline-flex items-center gap-1 rounded-md border border-[#D99B26]/40 bg-[#D99B26]/10 px-2 py-0.5 text-[11px] font-medium text-[#E5AC3D] hover:bg-[#D99B26]/20 transition-colors"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Нужен API-ключ или Colab
            </button>
          )}
          {nextTargetChapter && (
            <span className="text-[#B0B8C9] font-mono text-[11px] tabular-nums">
              · Цель: Гл. {nextTargetChapter.subPart || nextTargetChapter.number}
              {!nextTargetChapter.translated ? ' (новая)' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {nextTargetChapter && (
            <button
              type="button"
              onClick={() => onQuickTranslateChapter(nextTargetChapter)}
              disabled={isPipelineRunning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.11] bg-[#151925] px-2.5 py-1.5 text-xs font-medium text-[#F3F4F6] transition-colors hover:border-[#D99B26]/50 hover:text-[#E5AC3D] disabled:opacity-50"
            >
              {isPipelineRunning ? (
                <Zap className="h-3.5 w-3.5 animate-spin text-[#D99B26]" aria-hidden="true" />
              ) : (
                <Play className="h-3 w-3 fill-current text-[#D99B26]" aria-hidden="true" />
              )}
              <span>
                Перевести Гл. {nextTargetChapter.subPart || nextTargetChapter.number}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setUserExpanded(true)}
            aria-expanded={false}
            aria-label="Развернуть мастер быстрого запуска"
            className="inline-flex min-h-7 items-center gap-1 rounded-lg px-2 py-1 text-xs text-[#8893A8] transition-colors hover:bg-white/[0.05] hover:text-[#F3F4F6]"
          >
            <span className="hidden sm:inline">Мастер</span>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Мастер быстрого запуска"
      className="rounded-xl border border-white/[0.09] bg-[#10131C] p-4 sm:p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-[#F3F4F6]">
            Мастер быстрого запуска
          </h2>
          <p className="text-xs text-[#8893A8] mt-0.5">
            Выберите книгу, проверьте модели и запустите перевод следующей главы
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setUserExpanded(false)}
            aria-expanded={true}
            aria-label="Свернуть мастер быстрого запуска"
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-[#8893A8] transition-colors hover:bg-white/[0.05] hover:text-[#F3F4F6]"
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            aria-label="Скрыть мастер запуска"
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-[#8893A8] transition-colors hover:bg-white/[0.05] hover:text-[#F3F4F6]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0A0C12] p-3.5 space-y-3">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold text-[#D99B26]">
                1 · Проект и текст
              </span>
              <button
                type="button"
                onClick={onOpenImportModal}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#B0B8C9] hover:text-[#F3F4F6] underline underline-offset-4"
              >
                <Upload className="h-3 w-3 text-[#D99B26]" aria-hidden="true" />
                Импорт
              </button>
            </div>

            <select
              aria-label="Выбор активного проекта новеллы в мастере"
              value={activeNovel.id}
              onChange={(e) => onSelectNovel(e.target.value)}
              className="w-full rounded-lg border border-white/[0.1] bg-[#10131C] px-2.5 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
            >
              {novels.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.rusTitle || n.name} ({n.chapters.length} гл.)
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 text-xs text-[#B0B8C9]">
              <BookOpen className="h-3.5 w-3.5 text-[#8893A8] shrink-0" aria-hidden="true" />
              <span className="truncate">
                Цель: <strong className="text-[#F3F4F6]">Гл. {nextTargetChapter ? nextTargetChapter.subPart || nextTargetChapter.number : '—'}</strong>
                {nextTargetChapter && !nextTargetChapter.translated && (
                  <span className="ml-1 text-[#D99B26]">(новая)</span>
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[11px] text-[#8893A8]">
            <span>Канон глоссария</span>
            <span className="font-mono font-medium text-[#F3F4F6] tabular-nums">
              {canonCount} терм.
            </span>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0A0C12] p-3.5 space-y-3">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold text-[#D99B26]">
                2 · Движок моделей
              </span>
              <button
                type="button"
                onClick={onOpenLlmSettings}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#B0B8C9] hover:text-[#F3F4F6] underline underline-offset-4"
              >
                <Cpu className="h-3 w-3 text-[#D99B26]" aria-hidden="true" />
                Настроить
              </button>
            </div>

            <div className="rounded-lg border border-white/[0.08] bg-[#10131C] p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-[#F3F4F6] truncate">{providerTitle}</span>
                {isEngineReady ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Готов
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenLlmSettings}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-[#D99B26]/40 bg-[#D99B26]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#E5AC3D] hover:bg-[#D99B26]/20"
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Ключ
                  </button>
                )}
              </div>
              <div className="font-mono text-[11px] text-[#8893A8] truncate">
                {providerModelsSubtitle}
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-[#B0B8C9]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
              <span>Source Firewall и защита имён активны</span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[11px] text-[#8893A8]">
            <span>Шлюз отката</span>
            <span className="font-mono font-medium text-emerald-300">5 инвариантов Gsurf</span>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-[#D99B26]/30 bg-[#0A0C12] p-3.5 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold text-[#D99B26]">
                3 · Первый прогон
              </span>
              <span className="text-[11px] font-mono text-[#8893A8]">5 фаз</span>
            </div>

            <p className="text-xs text-[#B0B8C9] leading-relaxed">
              Перевод, вычитка, стилист и QA-проверка для{' '}
              <strong className="text-[#F3F4F6]">
                Главы {nextTargetChapter ? nextTargetChapter.subPart || nextTargetChapter.number : 1}
              </strong>
            </p>
          </div>

          <button
            type="button"
            onClick={() => nextTargetChapter && onQuickTranslateChapter(nextTargetChapter)}
            disabled={isPipelineRunning || !nextTargetChapter}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#D99B26] px-3.5 py-2.5 text-xs font-semibold text-[#090A0F] transition-colors hover:bg-[#E5AC3D] disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPipelineRunning ? (
              <>
                <Zap className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Идёт перевод...</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>
                  Перевести Главу {nextTargetChapter ? nextTargetChapter.subPart || nextTargetChapter.number : '1'}
                </span>
                <ArrowRight className="h-3.5 w-3.5 ml-auto" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
