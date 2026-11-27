'use client';

import React from 'react';
import { GEMINI_CLOUD_MODEL_CATALOG } from '@/lib/qa-linter';
import type {
  GeminiThinkingLevel,
  LlmProviderConfig,
} from '@/lib/pipeline-types';

interface GeminiCloudConfigPanelProps {
  llmConfig: LlmProviderConfig;
  onChange: React.Dispatch<React.SetStateAction<LlmProviderConfig>>;
  hybridOnly?: boolean;
}

const THINKING_LEVEL_OPTIONS: Array<{
  value: GeminiThinkingLevel;
  label: string;
  hint: string;
}> = [
  {
    value: 'auto_xhigh',
    label: 'Auto (HIGH / XHIGH через Decision 1)',
    hint: 'Decision 1 переводит Hydrogen в XHIGH на сложных поэтических и многоголосых главах, а остальные ведёт на HIGH.',
  },
  {
    value: 'high',
    label: 'HIGH (баланс глубины и скорости)',
    hint: 'Штатный уровень размышления Gemini 4 Hydrogen и Gemini 3.8 Flash для основной массы глав.',
  },
  {
    value: 'xhigh',
    label: 'XHIGH (максимум глубины для Hydrogen)',
    hint: 'Предельный бюджет рассуждений Hydrogen; автоматически зажимается до HIGH при переливе на Flash.',
  },
  {
    value: 'medium',
    label: 'MEDIUM (ускоренный проход)',
    hint: 'Пониженная задержка для плотных экшен-сцен с простым синтаксисом.',
  },
  {
    value: 'low',
    label: 'LOW (минимальное размышление)',
    hint: 'Быстрая генерация с минимальными затратами токенов рассуждения.',
  },
];

export function GeminiCloudConfigPanel({
  llmConfig,
  onChange,
  hybridOnly = false,
}: GeminiCloudConfigPanelProps) {
  const isCloudSlug = (raw?: string): raw is string =>
    Boolean(
      raw &&
        !raw.includes(':') &&
        !/^(?:gemini-4-argon|claude-)/i.test(raw) &&
        !/(?:-(?:low|medium|high|xhigh))$/i.test(raw)
    );

  const primaryValue = isCloudSlug(llmConfig.modelId)
    ? llmConfig.modelId
    : 'gemini-4-hydrogen';
  const criticValue = isCloudSlug(llmConfig.criticModelId)
    ? llmConfig.criticModelId
    : 'gemini-3.8-flash';
  const stylistValue = isCloudSlug(llmConfig.stylistModelId)
    ? llmConfig.stylistModelId
    : criticValue;
  const scoutValue = isCloudSlug(llmConfig.scoutModelId)
    ? llmConfig.scoutModelId
    : 'gemini-3.1-flash-lite';
  const thinkingValue: GeminiThinkingLevel = llmConfig.thinkingLevel || 'auto_xhigh';
  const decisionEnabled = llmConfig.useDecisionEngine !== false;

  const activePrimarySpec = GEMINI_CLOUD_MODEL_CATALOG.find((m) => m.id === primaryValue);
  const activeThinkingMeta = THINKING_LEVEL_OPTIONS.find((t) => t.value === thinkingValue);

  const decisionBar = (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 ${
        hybridOnly ? '' : 'pt-4 border-t border-[#F2EFE9]/[0.08]'
      }`}
    >
      <div className="space-y-1 max-w-2xl">
        <div className="text-sm font-semibold text-[#F2EFE9] tabular-nums">
          Радар и арбитр Gemini Decision 1 (до 10 000 RPD и 200 RPM)
        </div>
        <p className="text-[13px] text-[#8E8A82] leading-relaxed">
          За один проход оценивает 10 критериев LiTransProQA, фильтрует ложные термины и род, отсекает лишний Pass 2 и откатывает неудачные правки Стилиста в A/B-арбитраже.
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={decisionEnabled}
        onClick={() =>
          onChange((prev) => ({
            ...prev,
            useDecisionEngine: !(prev.useDecisionEngine !== false),
          }))
        }
        className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-colors shrink-0 ${
          decisionEnabled
            ? 'border-[#52C79A]/50 bg-[#52C79A]/15 text-[#6EE7B7] hover:bg-[#52C79A]/25'
            : 'border-[#F2EFE9]/[0.14] bg-[#101014] text-[#B8B4AC] hover:border-[#F2EFE9]/[0.24]'
        }`}
      >
        {decisionEnabled ? 'Decision 1 включён' : 'Включить Decision 1'}
      </button>
    </div>
  );

  if (hybridOnly) {
    return (
      <section
        aria-label="Гибридная экспертиза Gemini Decision 1"
        className="pt-5 border-t border-[#F2EFE9]/[0.08]"
      >
        {decisionBar}
      </section>
    );
  }

  return (
    <section
      aria-label="Облачная маршрутизация Google AI Studio"
      className="pt-5 border-t border-[#F2EFE9]/[0.08] space-y-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#F2EFE9]">
          Облачная связка Gemini 4 Hydrogen и Gemini Decision 1
        </h2>
        <span className="text-[13px] text-[#6EE7B7]">
          Ротация ключей: Hydrogen → 3.8 Flash → Gemma 4 31B
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <div>
          <label
            htmlFor="gemini-cloud-primary-select"
            className="block text-[13px] font-medium text-[#B8B4AC] mb-1.5"
          >
            Переводчик (Pass 1)
          </label>
          <select
            id="gemini-cloud-primary-select"
            value={primaryValue}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                provider: 'gemini_api',
                modelId: e.target.value,
              }))
            }
            className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-[13px] text-[#E3AE48] focus:border-[#D69E36] focus:outline-none"
          >
            {GEMINI_CLOUD_MODEL_CATALOG.filter((m) => m.role !== 'scout').map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.id})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="gemini-thinking-level-select"
            className="block text-[13px] font-medium text-[#B8B4AC] mb-1.5"
          >
            Глубина мышления (ThinkingConfig)
          </label>
          <select
            id="gemini-thinking-level-select"
            value={thinkingValue}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                thinkingLevel: e.target.value as GeminiThinkingLevel,
              }))
            }
            className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-[13px] text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
          >
            {THINKING_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="gemini-cloud-critic-select"
            className="block text-[13px] font-medium text-[#B8B4AC] mb-1.5"
          >
            Хирург (Pass 2 и Self-Repair)
          </label>
          <select
            id="gemini-cloud-critic-select"
            value={criticValue}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                criticModelId: e.target.value,
              }))
            }
            className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-[13px] text-[#6EE7B7] focus:border-[#D69E36] focus:outline-none"
          >
            {GEMINI_CLOUD_MODEL_CATALOG.filter((m) => m.role !== 'scout').map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.id})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="gemini-cloud-stylist-select"
            className="block text-[13px] font-medium text-[#B8B4AC] mb-1.5"
          >
            Слепой стилист (Pass 3)
          </label>
          <select
            id="gemini-cloud-stylist-select"
            value={stylistValue}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                stylistModelId: e.target.value,
              }))
            }
            className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-[13px] text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
          >
            {GEMINI_CLOUD_MODEL_CATALOG.filter((m) => m.role !== 'scout').map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.id})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="gemini-cloud-scout-select"
            className="block text-[13px] font-medium text-[#B8B4AC] mb-1.5"
          >
            Пре-скаут терминов (Pass 0)
          </label>
          <select
            id="gemini-cloud-scout-select"
            value={scoutValue}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                scoutModelId: e.target.value,
              }))
            }
            className="w-full rounded-lg border border-[#F2EFE9]/[0.12] bg-[#101014] px-3 py-2 text-[13px] text-[#F2EFE9] focus:border-[#D69E36] focus:outline-none"
          >
            {GEMINI_CLOUD_MODEL_CATALOG.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.id})
              </option>
            ))}
          </select>
        </div>
      </div>

      {activePrimarySpec && (
        <p className="text-[13px] text-[#B8B4AC] leading-relaxed tabular-nums">
          <span className="font-semibold text-[#F2EFE9]">{activePrimarySpec.title}</span>:{' '}
          {activePrimarySpec.quotaPerProject}, контекст {activePrimarySpec.contextWindow}.{' '}
          {activeThinkingMeta?.hint || activePrimarySpec.descriptionRus}{' '}
          Self-Repair идёт через слот Хирурга (<code className="font-mono text-[#6EE7B7]">{criticValue}</code>), экономя лимит Hydrogen; Pass 3 Стилист: <code className="font-mono text-[#E3AE48]">{stylistValue}</code>.
        </p>
      )}

      {decisionBar}
    </section>
  );
}
