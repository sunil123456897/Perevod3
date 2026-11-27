'use client';

import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Play,
  AlertTriangle,
  X,
  Upload,
  Zap,
  ArrowRight,
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
  forceOpen?: boolean;
  onCloseForceOpen?: () => void;
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
  forceOpen = false,
  onCloseForceOpen,
}: QuickStartWizardProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [serverHasKey, setServerHasKey] = useState<boolean>(true);

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
  const nextTargetChapter =
    activeNovel.chapters.find((c) => !c.translated) || activeNovel.chapters[0];

  const hasApiKey = Boolean(process.env.NEXT_PUBLIC_GEMINI_API_KEY) || serverHasKey;
  const isColabActive =
    llmConfig.provider === 'colab_ollama' && Boolean(llmConfig.colabEndpointUrl?.trim());
  const isEngineReady =
    llmConfig.provider === 'colab_ollama' ? isColabActive : hasApiKey;

  const shouldRender = forceOpen || (!isDismissed && (translatedCount === 0 || !isEngineReady));
  if (!shouldRender) {
    return null;
  }

  const primaryModelLabel = llmConfig.modelId || 'gemini-4-hydrogen';
  const criticModelLabel = llmConfig.criticModelId || primaryModelLabel;
  const stylistModelLabel = llmConfig.stylistModelId || criticModelLabel;

  const providerTitle =
    llmConfig.provider === 'colab_ollama'
      ? 'Google Colab L4 (Ollama)'
      : 'Google AI Studio (Gemini)';

  const providerModelsSubtitle =
    llmConfig.provider === 'colab_ollama'
      ? primaryModelLabel
      : stylistModelLabel !== criticModelLabel
        ? `${primaryModelLabel} · ${criticModelLabel} · ${stylistModelLabel}`
        : `${primaryModelLabel} · ${criticModelLabel}`;

  const canonCount = Object.values(activeNovel.glossary).reduce(
    (acc, b) => acc + Object.keys(b || {}).length,
    0
  );

  const handleClose = () => {
    setIsDismissed(true);
    onCloseForceOpen?.();
  };

  return (
    <section
      aria-label="Быстрый старт перевода"
      className="rounded-xl border border-[#F2EFE9]/[0.09] bg-[#141418] p-5 space-y-5"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[#F2EFE9]/[0.08] pb-3.5">
        <div>
          <h2 className="font-display text-base font-semibold text-[#F2EFE9]">
            Подготовка первого запуска
          </h2>
          <p className="text-[13px] text-[#8E8A82] mt-0.5">
            Выберите книгу, проверьте подключение моделей и переведите первую главу
          </p>
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Скрыть мастер быстрого старта"
          className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-[#8E8A82] transition-colors duration-150 hover:bg-[#F2EFE9]/[0.06] hover:text-[#F2EFE9]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:divide-x md:divide-[#F2EFE9]/[0.08]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#F2EFE9]">Книга и исходники</h3>
            <button
              type="button"
              onClick={onOpenImportModal}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#D69E36] hover:text-[#E3AE48] transition-colors duration-150"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Импорт</span>
            </button>
          </div>

          <select
            aria-label="Выбор активного проекта новеллы в мастере"
            value={activeNovel.id}
            onChange={(e) => onSelectNovel(e.target.value)}
            className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-sm text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
          >
            {novels.map((n) => (
              <option key={n.id} value={n.id}>
                {n.rusTitle || n.name} ({n.chapters.length} гл.)
              </option>
            ))}
          </select>

          <p className="text-[13px] text-[#8E8A82] tabular-nums">
            В каноне {canonCount} терм. · Цель: Гл.{' '}
            {nextTargetChapter ? nextTargetChapter.subPart || nextTargetChapter.number : '1'}
          </p>
        </div>

        <div className="space-y-3 md:pl-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#F2EFE9]">Связка моделей</h3>
            <button
              type="button"
              onClick={onOpenLlmSettings}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#D69E36] hover:text-[#E3AE48] transition-colors duration-150"
            >
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Настроить</span>
            </button>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-[#F2EFE9] truncate">{providerTitle}</span>
              {isEngineReady ? (
                <span className="text-[13px] font-medium text-[#6EE7B7] shrink-0">Готов</span>
              ) : (
                <button
                  type="button"
                  onClick={onOpenLlmSettings}
                  className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-[#E3AE48] hover:underline"
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Нужен ключ</span>
                </button>
              )}
            </div>
            <p className="text-[13px] text-[#8E8A82] truncate">{providerModelsSubtitle}</p>
          </div>

          <p className="text-[13px] text-[#8E8A82]">
            Source Firewall и шлюз отката активны
          </p>
        </div>

        <div className="flex flex-col justify-between gap-3 md:pl-6">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[#F2EFE9]">Пробный прогон</h3>
            <p className="text-[13px] text-[#B8B4AC] leading-relaxed">
              Перевод, вычитка, стилист и QA для{' '}
              <strong className="font-medium text-[#F2EFE9]">
                Главы {nextTargetChapter ? nextTargetChapter.subPart || nextTargetChapter.number : 1}
              </strong>
            </p>
          </div>

          <button
            type="button"
            onClick={() => nextTargetChapter && onQuickTranslateChapter(nextTargetChapter)}
            disabled={isPipelineRunning || !nextTargetChapter}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#D69E36] px-4 py-2.5 text-sm font-semibold text-[#11100D] transition-colors duration-150 hover:bg-[#E3AE48] disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPipelineRunning ? (
              <>
                <Zap className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Идёт перевод...</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>
                  Перевести Главу {nextTargetChapter ? nextTargetChapter.subPart || nextTargetChapter.number : '1'}
                </span>
                <ArrowRight className="h-4 w-4 ml-auto" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
