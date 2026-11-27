'use client';

import React, { useState } from 'react';
import {
  Check,
  Copy,
  Cpu,
  Download,
  Play,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { GeminiCloudConfigPanel } from '../GeminiCloudConfigPanel';
import {
  ALL_LINT_RULES,
  COLAB_L4_MODEL_CATALOG,
  GENRE_PRESET_LABELS,
  generateColabL4LaunchScript,
} from '@/lib/qa-linter';
import type {
  GenrePreset,
  GrammaticalGender,
  LintRuleId,
  LlmProviderConfig,
  ScoutedTerm,
} from '@/lib/pipeline-types';
import type { NovelProject } from '@/lib/seed-data';

export interface ColabPingState {
  loading: boolean;
  ok?: boolean;
  latencyMs?: number;
  runtime?: string;
  models?: string[];
  error?: string;
}

export function LinterProfileModal({
  isOpen,
  onClose,
  activeNovel,
  onGenrePresetChange,
  onToggleRuleId,
}: {
  isOpen: boolean;
  onClose: () => void;
  activeNovel: NovelProject;
  onGenrePresetChange: (nextGenre: GenrePreset) => void;
  onToggleRuleId: (ruleId: LintRuleId) => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qa-rules-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between">
          <div>
            <h3 id="qa-rules-modal-title" className="text-base font-semibold text-slate-100">
              Конструктор правил QA-линтера ({activeNovel.enabledRuleIds.length} из {ALL_LINT_RULES.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Адаптируйте проверки под конкретный жанр или включите/отключите отдельные правила вручную.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 pb-3">
          {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGenrePresetChange(g)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeNovel.genrePreset === g
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'border border-slate-800 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              {GENRE_PRESET_LABELS[g].title}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto space-y-2 pr-1 flex-1">
          {ALL_LINT_RULES.map((rule) => {
            const checked = activeNovel.enabledRuleIds.includes(rule.id);
            return (
              <label
                key={rule.id}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  checked
                    ? 'border-slate-700 bg-slate-950/90'
                    : 'border-slate-800/50 bg-slate-950/30 opacity-60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleRuleId(rule.id)}
                  className="mt-0.5 rounded border-slate-700 bg-slate-900 text-amber-500"
                />
                <div className="text-xs">
                  <div className="font-semibold text-slate-100">{rule.title}</div>
                  <div className="text-slate-400 mt-0.5">{rule.description}</div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

export function BulkImportModal({
  isOpen,
  onClose,
  importMode,
  setImportMode,
  uploadedFileCount,
  sanitizedRemovedCount,
  handleFileUploadBatch,
  sanitizeOnImport,
  setSanitizeOnImport,
  bulkRawText,
  setBulkRawText,
  newChNum,
  setNewChNum,
  newChTitleEng,
  setNewChTitleEng,
  newChEngText,
  setNewChEngText,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  importMode: 'single' | 'bulk';
  setImportMode: (mode: 'single' | 'bulk') => void;
  uploadedFileCount: number;
  sanitizedRemovedCount: number;
  handleFileUploadBatch: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sanitizeOnImport: boolean;
  setSanitizeOnImport: (val: boolean) => void;
  bulkRawText: string;
  setBulkRawText: (val: string) => void;
  newChNum: number;
  setNewChNum: (val: number) => void;
  newChTitleEng: string;
  setNewChTitleEng: (val: string) => void;
  newChEngText: string;
  setNewChEngText: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-chapter-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 id="add-chapter-modal-title" className="text-base font-semibold text-slate-100">
            Импорт глав в конвейер
          </h3>
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => setImportMode('bulk')}
              className={`rounded px-3 py-1 text-xs font-medium ${
                importMode === 'bulk'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Пакетная загрузка (несколько глав)
            </button>
            <button
              type="button"
              onClick={() => setImportMode('single')}
              className={`rounded px-3 py-1 text-xs font-medium ${
                importMode === 'single'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Одна глава
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {importMode === 'bulk' ? (
            <>
              <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/60 p-3 text-center">
                <label
                  htmlFor="bulk-files-input"
                  className="cursor-pointer inline-flex flex-col items-center gap-1 text-xs text-slate-300 hover:text-amber-300"
                >
                  <Upload className="h-4 w-4 text-amber-400" />
                  <span>
                    Выберите книгу <code className="font-mono text-amber-300">.epub</code> или файлы глав <code className="font-mono">.txt / .md</code>
                  </span>
                  {uploadedFileCount > 0 && (
                    <span className="text-emerald-400 font-medium">
                      Загружено файлов: {uploadedFileCount}
                      {sanitizedRemovedCount > 0
                        ? ` · Очищено мусора (TL Note/Patreon/Rulate): ${sanitizedRemovedCount} стр.`
                        : ''}
                    </span>
                  )}
                </label>
                <input
                  id="bulk-files-input"
                  type="file"
                  accept=".epub,.txt,.md"
                  multiple
                  onChange={handleFileUploadBatch}
                  className="hidden"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sanitizeOnImport}
                  onChange={(e) => setSanitizeOnImport(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-amber-500"
                />
                Автоочистка <code className="font-mono text-amber-300">TL Note</code>, Patreon/Discord-рекламы, водяных знаков Rulate и HTML-тегов
              </label>

              <div>
                <label
                  htmlFor="bulk-raw-textarea"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Или вставьте текст сразу нескольких глав (разделяются строками <code className="font-mono">Chapter N: ...</code>)
                </label>
                <textarea
                  id="bulk-raw-textarea"
                  rows={7}
                  required
                  value={bulkRawText}
                  onChange={(e) => setBulkRawText(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="new-ch-num" className="block text-xs text-slate-400 mb-1">
                  Номер главы
                </label>
                <input
                  id="new-ch-num"
                  type="number"
                  min={1}
                  required
                  value={newChNum}
                  onChange={(e) => setNewChNum(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="new-ch-title" className="block text-xs text-slate-400 mb-1">
                  Заголовок (ENG)
                </label>
                <input
                  id="new-ch-title"
                  type="text"
                  required
                  value={newChTitleEng}
                  onChange={(e) => setNewChTitleEng(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="new-ch-body" className="block text-xs text-slate-400 mb-1">
                  Текст главы (ENG)
                </label>
                <textarea
                  id="new-ch-body"
                  rows={5}
                  required
                  value={newChEngText}
                  onChange={(e) => setNewChEngText(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 px-4 py-2 text-xs text-slate-300 hover:text-white"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              {importMode === 'bulk' ? 'Распознать и загрузить главы' : 'Добавить главу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function NewNovelModal({
  isOpen,
  onClose,
  newNovelName,
  setNewNovelName,
  newNovelRusTitle,
  setNewNovelRusTitle,
  newNovelGenre,
  setNewNovelGenre,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  newNovelName: string;
  setNewNovelName: (val: string) => void;
  newNovelRusTitle: string;
  setNewNovelRusTitle: (val: string) => void;
  newNovelGenre: GenrePreset;
  setNewNovelGenre: (val: GenrePreset) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-novel-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <h3 id="add-novel-modal-title" className="text-base font-semibold text-slate-100">
          Создать проект книги
        </h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label htmlFor="new-novel-eng" className="block text-xs text-slate-400 mb-1">
              Оригинальное название (ENG)
            </label>
            <input
              id="new-novel-eng"
              type="text"
              required
              value={newNovelName}
              onChange={(e) => setNewNovelName(e.target.value)}
              placeholder="Напр., Sovereign of the Nine Heavens"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="new-novel-rus" className="block text-xs text-slate-400 mb-1">
              Русское название
            </label>
            <input
              id="new-novel-rus"
              type="text"
              value={newNovelRusTitle}
              onChange={(e) => setNewNovelRusTitle(e.target.value)}
              placeholder="Напр., Владыка Девяти Небес"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="new-novel-genre" className="block text-xs text-slate-400 mb-1">
              Жанровый профиль и пресет правил QA
            </label>
            <select
              id="new-novel-genre"
              value={newNovelGenre}
              onChange={(e) => setNewNovelGenre(e.target.value as GenrePreset)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            >
              {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
                <option key={g} value={g}>
                  {GENRE_PRESET_LABELS[g].title}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 px-4 py-2 text-xs text-slate-300 hover:text-white"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              Создать книгу
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LlmEngineModal({
  isOpen,
  onClose,
  llmConfig,
  setLlmConfig,
  colabPingState,
  onPingColab,
  onExportColabDriveBundle,
  driveBundleInputRef,
  onImportColabDriveBundle,
}: {
  isOpen: boolean;
  onClose: () => void;
  llmConfig: LlmProviderConfig;
  setLlmConfig: React.Dispatch<React.SetStateAction<LlmProviderConfig>>;
  colabPingState: ColabPingState | null;
  onPingColab: () => void;
  onExportColabDriveBundle: () => void;
  driveBundleInputRef: React.RefObject<HTMLInputElement | null>;
  onImportColabDriveBundle: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [copiedColabScript, setCopiedColabScript] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="colab-l4-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div className="w-full max-w-3xl rounded-xl border border-slate-800 bg-[#0F111A] p-6 space-y-5 max-h-[90vh] flex flex-col text-xs text-slate-200">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
          <div>
            <h3
              id="colab-l4-modal-title"
              className="text-base font-semibold text-slate-100 flex items-center gap-2"
            >
              <Cpu className="h-4 w-4 text-[#D99B26]" />
              Выделенный GPU Google Colab L4 (24 ГБ VRAM) и выбор модели
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Обход ошибок <code className="font-mono text-amber-300">503 Model is overloaded</code> и очередей Free Tier за счёт запуска открытых весов напрямую на вашей карте L4 в плане Google AI Ultra.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно настройки Colab L4"
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-5 pr-1 flex-1">
          {/* Step 1: Provider Switch */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="rounded-lg border border-white/[0.08] bg-[#090A0F] p-3 text-left opacity-50 cursor-not-allowed"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-300">
                  Подписка Antigravity CLI (agy)
                </span>
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                  Отключено (ToS)
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Временно отключено до обновления ToS 2 декабря. Используйте AI Studio API или Colab L4.
              </div>
            </button>
            <button
              type="button"
              onClick={() =>
                setLlmConfig((prev) => {
                  const colabModel = prev.modelId.includes(':') ? prev.modelId : 'gemma4:26b-a4b';
                  const keepColabSlot = (val?: string) =>
                    val && val.includes(':') ? val : colabModel;
                  return {
                    ...prev,
                    provider: 'colab_ollama',
                    modelId: colabModel,
                    criticModelId: keepColabSlot(prev.criticModelId),
                    stylistModelId: keepColabSlot(prev.stylistModelId),
                    scoutModelId: keepColabSlot(prev.scoutModelId),
                  };
                })
              }
              className={`rounded-lg border p-3 text-left transition-colors ${
                llmConfig.provider === 'colab_ollama'
                  ? 'border-[#D99B26] bg-[#D99B26]/10'
                  : 'border-white/[0.08] bg-[#090A0F] opacity-70 hover:opacity-100'
              }`}
            >
              <div className="font-semibold text-slate-100">
                Выделенный Google Colab L4 (Ollama / vLLM)
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Ноль ошибок 503, без лимита 15 RPM, 24 ГБ VRAM под Gemma 4 / Qwen 3 / TranslateGemma.
              </div>
            </button>
            <button
              type="button"
              onClick={() =>
                setLlmConfig((prev) => {
                  const needsCloudReset = (val?: string) =>
                    !val ||
                    val.includes(':') ||
                    /^(?:gemini-4-argon|claude-)/i.test(val) ||
                    /(?:-(?:low|medium|high|xhigh))$/i.test(val);
                  return {
                    ...prev,
                    provider: 'gemini_api',
                    modelId: needsCloudReset(prev.modelId) ? 'gemini-4-hydrogen' : prev.modelId,
                    criticModelId: needsCloudReset(prev.criticModelId)
                      ? 'gemini-3.8-flash'
                      : prev.criticModelId,
                    stylistModelId: needsCloudReset(prev.stylistModelId)
                      ? 'gemini-3.8-flash'
                      : prev.stylistModelId,
                    scoutModelId:
                      needsCloudReset(prev.scoutModelId) || prev.scoutModelId === 'gemini-3.8-flash-low'
                        ? 'gemini-3.1-flash-lite'
                        : prev.scoutModelId,
                    thinkingLevel: prev.thinkingLevel || 'auto_xhigh',
                    useDecisionEngine: prev.useDecisionEngine ?? true,
                  };
                })
              }
              className={`rounded-lg border p-3 text-left transition-colors ${
                llmConfig.provider === 'gemini_api'
                  ? 'border-[#D99B26] bg-[#D99B26]/10'
                  : 'border-white/[0.08] bg-[#090A0F] opacity-70 hover:opacity-100'
              }`}
            >
              <div className="font-semibold text-slate-100">
                Google AI Studio API (Облачный ключ)
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Gemini 4 Hydrogen + радар <code className="font-mono">gemini-decision-1</code> с авто-ротацией ключей и переливом.
              </div>
            </button>
          </div>

          <GeminiCloudConfigPanel
            llmConfig={llmConfig}
            onChange={setLlmConfig}
            hybridOnly={llmConfig.provider !== 'gemini_api'}
          />

          {/* Step 2: Endpoint URL & Health Check */}
          <div className="rounded-lg border border-white/[0.08] bg-[#090A0F] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="colab-endpoint-input"
                className="font-semibold text-slate-100"
              >
                1. Адрес туннеля Google Colab L4 (Cloudflare / Ngrok или локальный Ollama)
              </label>
              <a
                href="/colab_l4_translation_server.ipynb"
                download="colab_l4_translation_server.ipynb"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#D99B26]/40 bg-[#D99B26]/10 px-2.5 py-1 text-[11px] font-semibold text-[#D99B26] hover:bg-[#D99B26]/20"
              >
                <Download className="h-3 w-3" />
                Скачать готовый .ipynb для Colab L4
              </a>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="colab-endpoint-input"
                type="text"
                value={llmConfig.colabEndpointUrl}
                onChange={(e) =>
                  setLlmConfig((prev) => ({
                    ...prev,
                    colabEndpointUrl: e.target.value,
                  }))
                }
                placeholder="https://xxxx-xxxx.trycloudflare.com или http://localhost:11434"
                className="flex-1 rounded-md border border-white/[0.1] bg-[#11131C] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#D99B26] focus:outline-none"
              />
              <button
                type="button"
                disabled={colabPingState?.loading}
                onClick={onPingColab}
                className="rounded-md bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E3A836] disabled:opacity-50 whitespace-nowrap"
              >
                {colabPingState?.loading ? 'Проверка...' : 'Проверить связь с L4'}
              </button>
            </div>

            {colabPingState && !colabPingState.loading && (
              <div
                className={`rounded-md border px-3 py-2 text-[11px] ${
                  colabPingState.ok
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                }`}
              >
                {colabPingState.ok ? (
                  <span>
                    Связь установлена ({colabPingState.runtime}, пинг{' '}
                    <strong className="font-mono">{colabPingState.latencyMs} мс</strong>). Загруженные модели:{' '}
                    <code className="font-mono">
                      {(colabPingState.models || []).join(', ') || llmConfig.modelId}
                    </code>
                  </span>
                ) : (
                  <span>{colabPingState.error}</span>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Curated L4 24GB VRAM Model Catalog */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-100">
                2. Рейтинг лучших открытых моделей под 24 ГБ VRAM (NVIDIA L4) для перевода новелл
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">Тег модели:</span>
                <input
                  type="text"
                  aria-label="Пользовательский тег модели Ollama"
                  value={llmConfig.modelId}
                  onChange={(e) =>
                    setLlmConfig((prev) => ({ ...prev, modelId: e.target.value }))
                  }
                  className="w-44 rounded border border-white/[0.1] bg-[#090A0F] px-2.5 py-1 font-mono text-xs text-[#D99B26] focus:border-[#D99B26] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {COLAB_L4_MODEL_CATALOG.map((spec) => {
                const isSelected = llmConfig.modelId === spec.ollamaTag;
                return (
                  <div
                    key={spec.id}
                    onClick={() =>
                      setLlmConfig((prev) => {
                        const keepColabSlot = (val?: string) =>
                          val && val.includes(':') ? val : spec.ollamaTag;
                        return {
                          ...prev,
                          provider: 'colab_ollama',
                          modelId: spec.ollamaTag,
                          criticModelId: keepColabSlot(prev.criticModelId),
                          stylistModelId: keepColabSlot(prev.stylistModelId),
                          scoutModelId: keepColabSlot(prev.scoutModelId),
                        };
                      })
                    }
                    className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-[#D99B26] bg-[#D99B26]/[0.08]'
                        : 'border-white/[0.07] bg-[#090A0F] hover:border-white/[0.18]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100">
                          {spec.title}
                        </span>
                        <span className="rounded bg-[#D99B26]/20 px-2 py-0.5 text-[10px] font-semibold text-[#D99B26]">
                          {spec.roleBadge}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400 tabular-nums">
                        <span>VRAM: {spec.vramGb}</span>
                        <span>·</span>
                        <span className="text-emerald-400">{spec.speedOnL4}</span>
                        <span>·</span>
                        <span>Ctx: {spec.contextWindow}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                      <strong className="text-slate-100">Плюсы:</strong> {spec.strengthsRus}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      <strong className="text-slate-300">Нюанс:</strong> {spec.caveatsRus}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step 4: 1-Click Colab Cell Script */}
          <div className="rounded-lg border border-white/[0.08] bg-[#090A0F] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-100">
                3. Готовый код ячейки для Google Colab (GPU L4 · 24 ГБ VRAM)
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(
                    generateColabL4LaunchScript(llmConfig.modelId)
                  );
                  setCopiedColabScript(true);
                  setTimeout(() => setCopiedColabScript(false), 2500);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-slate-100 hover:bg-white/[0.1]"
              >
                {copiedColabScript ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    Скопировано!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-[#D99B26]" />
                    Скопировать код для Colab
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-40 overflow-y-auto rounded bg-[#050609] p-3 font-mono text-[11px] text-slate-300 leading-relaxed">
              {generateColabL4LaunchScript(llmConfig.modelId)}
            </pre>
          </div>

          {/* Step 5: Autonomous Overnight Google Drive Bundle */}
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-emerald-200">
                  4. Автономный ночной перевод через Google Drive (с выключенным ПК)
                </span>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Скачайте <code className="font-mono text-amber-300">kanon_project_bundle.json</code>, положите его в <code className="font-mono">/MyDrive/KanonXianxia/</code> и запустите Ячейку №2 в ноутбуке Colab. После каждой главы Colab атомарно перезаписывает чекпоинт на Google Диске.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onExportColabDriveBundle}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                <Download className="h-3.5 w-3.5" />
                Скачать бандл для ночного Google Drive
              </button>
              <input
                ref={driveBundleInputRef}
                type="file"
                accept=".json,application/json"
                onChange={onImportColabDriveBundle}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => driveBundleInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
              >
                <Upload className="h-3.5 w-3.5" />
                Загрузить готовый бандл с Google Drive
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/[0.07]">
          <span className="text-[11px] text-slate-400 font-mono">
            Активный движок:{' '}
            <strong className="text-slate-200">
              {llmConfig.provider === 'antigravity_cli'
                ? `agy CLI (Pass 1: ${llmConfig.modelId || 'gemini-3.8-flash-high'} · Pass 2: ${llmConfig.criticModelId || 'gemini-4-argon-medium'} · Pass 3: ${llmConfig.stylistModelId || 'claude-sonnet-5-5-high'})`
                : llmConfig.provider === 'colab_ollama'
                  ? `Colab L4 (${llmConfig.modelId})`
                  : `AI Studio API (Pass 1: ${llmConfig.modelId || 'gemini-4-hydrogen'} · Pass 2: ${llmConfig.criticModelId || 'gemini-3.8-flash'} · Pass 3: ${llmConfig.stylistModelId || llmConfig.criticModelId || 'gemini-3.8-flash'})`}
            </strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E3A836]"
          >
            Сохранить и закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

export function GlossaryStopGateModal({
  isOpen,
  onClose,
  startChapter,
  endChapter,
  canonCount,
  stopGateTerms,
  setStopGateTerms,
  onApproveAndTranslate,
}: {
  isOpen: boolean;
  onClose: () => void;
  startChapter: number;
  endChapter: number;
  canonCount: number;
  stopGateTerms: ScoutedTerm[];
  setStopGateTerms: React.Dispatch<React.SetStateAction<ScoutedTerm[]>>;
  onApproveAndTranslate: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stop-gate-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div className="w-full max-w-3xl rounded-xl border border-slate-800 bg-[#0F111A] p-6 space-y-4 max-h-[88vh] flex flex-col text-xs text-slate-200">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-3">
          <div>
            <h3
              id="stop-gate-modal-title"
              className="text-base font-semibold text-slate-100 flex items-center gap-2"
            >
              <ShieldCheck className="h-4 w-4 text-[#D99B26]" />
              Стоп-кран глоссария перед переводом (Главы {startChapter}–{endChapter})
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Проверьте или поправьте русские названия и грамматический род (М / Ж / Ср / Мн) новых терминов. После нажатия кнопки весь пакет глав переведётся строго по этому канону.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-2 pr-1 flex-1">
          {stopGateTerms.length === 0 ? (
            <div className="rounded-lg border border-white/[0.07] bg-[#090A0F] p-6 text-center text-slate-400">
              В главах {startChapter}–{endChapter} все ключевые термины уже находятся в утверждённом глоссарии ({canonCount} записей). Можно сразу запускать перевод!
            </div>
          ) : (
            stopGateTerms.map((term, idx) => {
              const currentGender = (term.gender || 'UNKNOWN') as GrammaticalGender;
              const isUnclassifiedCharacter =
                term.category === 'characters' && currentGender === 'UNKNOWN';
              return (
                <div
                  key={term.id || idx}
                  className={`grid grid-cols-1 sm:grid-cols-12 items-center gap-2 rounded-lg border p-2.5 ${
                    isUnclassifiedCharacter
                      ? 'border-amber-500/40 bg-amber-500/[0.06]'
                      : 'border-white/[0.08] bg-[#090A0F]'
                  }`}
                >
                  <div className="sm:col-span-4 font-mono text-xs text-amber-300 truncate flex items-center gap-1.5">
                    <span className="truncate">{term.eng}</span>
                    {isUnclassifiedCharacter && (
                      <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                        без пола
                      </span>
                    )}
                  </div>
                  <div className="sm:col-span-4">
                    <input
                      type="text"
                      aria-label={`Русский перевод для ${term.eng}`}
                      value={term.rus_suggested}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStopGateTerms((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, rus_suggested: val } : item
                          )
                        );
                      }}
                      className="w-full rounded border border-white/[0.12] bg-[#11131C] px-2.5 py-1 text-xs text-slate-100 focus:border-[#D99B26] focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <select
                      aria-label={`Род для ${term.eng}`}
                      value={currentGender}
                      onChange={(e) => {
                        const g = e.target.value as GrammaticalGender;
                        setStopGateTerms((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, gender: g } : item
                          )
                        );
                      }}
                      className={`w-full rounded border px-2 py-1 font-mono text-xs ${
                        isUnclassifiedCharacter
                          ? 'border-amber-500/50 bg-amber-950/30 text-amber-200'
                          : 'border-white/[0.12] bg-[#11131C] text-slate-200'
                      }`}
                    >
                      <option value="UNKNOWN">Не указан</option>
                      <option value="M">Род: М</option>
                      <option value="F">Род: Ж</option>
                      <option value="N">Род: Ср</option>
                      <option value="PL">Род: Мн</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setStopGateTerms((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
                    >
                      Убрать
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/[0.08]">
          <span className="text-[11px] text-slate-400 font-mono">
            Новых терминов к утверждению: <strong>{stopGateTerms.length}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 px-3.5 py-2 text-xs text-slate-300 hover:text-white"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={onApproveAndTranslate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E3A836]"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Утвердить канон и перевести главы {startChapter}–{endChapter}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
