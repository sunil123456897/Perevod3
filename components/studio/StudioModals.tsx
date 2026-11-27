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
} from 'lucide-react';
import { GeminiCloudConfigPanel } from '../GeminiCloudConfigPanel';
import { StudioDialog } from './StudioDialog';
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
  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Правила QA-линтера (${activeNovel.enabledRuleIds.length} из ${ALL_LINT_RULES.length})`}
      subtitle="Адаптируйте проверки под жанр или включите/отключите отдельные правила вручную."
      titleId="qa-rules-modal-title"
      maxWidthClass="max-w-2xl"
      footer={
        <>
          <span className="font-mono text-[11px] text-[#8893A8] tabular-nums">
            Профиль: {GENRE_PRESET_LABELS[activeNovel.genrePreset].title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D] transition-colors"
          >
            Готово
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.08] pb-3.5">
          {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGenrePresetChange(g)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeNovel.genrePreset === g
                  ? 'bg-[#D99B26] text-[#090A0F] font-semibold'
                  : 'border border-white/[0.1] bg-[#0A0C12] text-[#B0B8C9] hover:text-[#F3F4F6]'
              }`}
            >
              {GENRE_PRESET_LABELS[g].title}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {ALL_LINT_RULES.map((rule) => {
            const checked = activeNovel.enabledRuleIds.includes(rule.id);
            return (
              <label
                key={rule.id}
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  checked
                    ? 'border-white/[0.12] bg-[#0A0C12]'
                    : 'border-white/[0.06] bg-[#0A0C12]/40 opacity-65'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleRuleId(rule.id)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-white/[0.2] bg-[#10131C]"
                />
                <div className="text-xs">
                  <div className="font-semibold text-[#F3F4F6]">{rule.title}</div>
                  <div className="text-[#8893A8] mt-0.5 leading-relaxed">
                    {rule.description}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </StudioDialog>
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
  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Импорт глав в конвейер"
      titleId="add-chapter-modal-title"
      maxWidthClass="max-w-xl"
      headerExtra={
        <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.1] bg-[#0A0C12] p-0.5">
          <button
            type="button"
            onClick={() => setImportMode('bulk')}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              importMode === 'bulk'
                ? 'bg-[#151925] text-[#F3F4F6]'
                : 'text-[#8893A8] hover:text-[#F3F4F6]'
            }`}
          >
            Пакетная
          </button>
          <button
            type="button"
            onClick={() => setImportMode('single')}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              importMode === 'single'
                ? 'bg-[#151925] text-[#F3F4F6]'
                : 'text-[#8893A8] hover:text-[#F3F4F6]'
            }`}
          >
            Одна глава
          </button>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3.5 text-xs">
        {importMode === 'bulk' ? (
          <>
            <div className="rounded-xl border border-dashed border-white/[0.15] bg-[#0A0C12] p-4 text-center">
              <label
                htmlFor="bulk-files-input"
                className="cursor-pointer inline-flex flex-col items-center gap-1.5 text-xs text-[#B0B8C9] hover:text-[#E5AC3D] transition-colors"
              >
                <Upload className="h-4 w-4 text-[#D99B26]" aria-hidden="true" />
                <span>
                  Выберите книгу <code className="font-mono text-[#E5AC3D]">.epub</code> или файлы глав{' '}
                  <code className="font-mono">.txt / .md</code>
                </span>
                {uploadedFileCount > 0 && (
                  <span className="text-emerald-300 font-medium">
                    Загружено файлов: {uploadedFileCount}
                    {sanitizedRemovedCount > 0
                      ? ` · Очищено мусора: ${sanitizedRemovedCount} стр.`
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

            <label className="flex items-center gap-2 text-xs text-[#B0B8C9] cursor-pointer">
              <input
                type="checkbox"
                checked={sanitizeOnImport}
                onChange={(e) => setSanitizeOnImport(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/[0.2] bg-[#0A0C12]"
              />
              <span>
                Автоочистка <code className="font-mono text-[#E5AC3D]">TL Note</code>, Patreon/Discord и водяных знаков Rulate
              </span>
            </label>

            <div>
              <label
                htmlFor="bulk-raw-textarea"
                className="block text-xs text-[#B0B8C9] mb-1.5"
              >
                Или вставьте текст глав (разделяются строками{' '}
                <code className="font-mono text-[#E5AC3D]">Chapter N: ...</code>)
              </label>
              <textarea
                id="bulk-raw-textarea"
                rows={7}
                required
                value={bulkRawText}
                onChange={(e) => setBulkRawText(e.target.value)}
                className="w-full resize-y rounded-lg border border-white/[0.1] bg-[#0A0C12] p-3 font-mono text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="new-ch-num" className="block text-xs text-[#B0B8C9] mb-1.5">
                Номер главы
              </label>
              <input
                id="new-ch-num"
                type="number"
                min={1}
                required
                value={newChNum}
                onChange={(e) => setNewChNum(Number(e.target.value))}
                className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs font-mono tabular-nums text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-ch-title" className="block text-xs text-[#B0B8C9] mb-1.5">
                Заголовок (ENG)
              </label>
              <input
                id="new-ch-title"
                type="text"
                required
                value={newChTitleEng}
                onChange={(e) => setNewChTitleEng(e.target.value)}
                className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-ch-body" className="block text-xs text-[#B0B8C9] mb-1.5">
                Текст главы (ENG)
              </label>
              <textarea
                id="new-ch-body"
                rows={6}
                required
                value={newChEngText}
                onChange={(e) => setNewChEngText(e.target.value)}
                className="w-full resize-y rounded-lg border border-white/[0.1] bg-[#0A0C12] p-3 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-4 py-2 text-xs text-[#B0B8C9] hover:text-[#F3F4F6]"
          >
            Отмена
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D]"
          >
            {importMode === 'bulk' ? 'Распознать и загрузить' : 'Добавить главу'}
          </button>
        </div>
      </form>
    </StudioDialog>
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
  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Создать проект книги"
      titleId="add-novel-modal-title"
      maxWidthClass="max-w-md"
    >
      <form onSubmit={onSubmit} className="space-y-3.5 text-xs">
        <div>
          <label htmlFor="new-novel-eng" className="block text-[#B0B8C9] mb-1.5">
            Оригинальное название (ENG)
          </label>
          <input
            id="new-novel-eng"
            type="text"
            autoFocus
            required
            value={newNovelName}
            onChange={(e) => setNewNovelName(e.target.value)}
            placeholder="Напр., Sovereign of the Nine Heavens"
            className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="new-novel-rus" className="block text-[#B0B8C9] mb-1.5">
            Русское название
          </label>
          <input
            id="new-novel-rus"
            type="text"
            value={newNovelRusTitle}
            onChange={(e) => setNewNovelRusTitle(e.target.value)}
            placeholder="Напр., Владыка Девяти Небес"
            className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="new-novel-genre" className="block text-[#B0B8C9] mb-1.5">
            Жанровый профиль и пресет правил QA
          </label>
          <select
            id="new-novel-genre"
            value={newNovelGenre}
            onChange={(e) => setNewNovelGenre(e.target.value as GenrePreset)}
            className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
          >
            {(Object.keys(GENRE_PRESET_LABELS) as GenrePreset[]).map((g) => (
              <option key={g} value={g}>
                {GENRE_PRESET_LABELS[g].title}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-4 py-2 text-xs text-[#B0B8C9] hover:text-[#F3F4F6]"
          >
            Отмена
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D]"
          >
            Создать книгу
          </button>
        </div>
      </form>
    </StudioDialog>
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

  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        <>
          <Cpu className="h-4 w-4 text-[#D99B26]" aria-hidden="true" />
          <span>Провайдеры ИИ: AI Studio API и Google Colab L4</span>
        </>
      }
      subtitle="Выберите маршрутизацию моделей по стадиям конвейера (перевод, критик, стилист, скаут) или подключите сервер Colab L4."
      titleId="colab-l4-modal-title"
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <span className="font-mono text-[11px] text-[#B0B8C9] truncate">
            Активно:{' '}
            <strong className="text-[#F3F4F6]">
              {llmConfig.provider === 'colab_ollama'
                ? `Colab L4 (${llmConfig.modelId})`
                : `AI Studio (${llmConfig.modelId || 'gemini-4-hydrogen'} → ${llmConfig.criticModelId || 'gemini-3.8-flash'} / ${llmConfig.stylistModelId || llmConfig.criticModelId || 'gemini-3.8-flash'})`}
            </strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D] shrink-0"
          >
            Сохранить и закрыть
          </button>
        </>
      }
    >
      <div className="space-y-5 text-xs text-[#B0B8C9]">
        {/* Provider Switch */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="rounded-xl border border-white/[0.08] bg-[#0A0C12] p-3 text-left opacity-50 cursor-not-allowed"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#B0B8C9]">
                Antigravity CLI (agy)
              </span>
              <span className="rounded bg-[#D99B26]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#E5AC3D]">
                Отключено (ToS)
              </span>
            </div>
            <div className="text-[11px] text-[#8893A8] mt-1 leading-relaxed">
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
            className={`rounded-xl border p-3 text-left transition-colors ${
              llmConfig.provider === 'colab_ollama'
                ? 'border-[#D99B26] bg-[#D99B26]/10'
                : 'border-white/[0.08] bg-[#0A0C12] hover:border-white/[0.18]'
            }`}
          >
            <div className="font-semibold text-[#F3F4F6]">
              Google Colab L4 (Ollama / vLLM)
            </div>
            <div className="text-[11px] text-[#8893A8] mt-1 leading-relaxed">
              24 ГБ VRAM без лимитов RPM: Gemma 4, Qwen 3, TranslateGemma.
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
            className={`rounded-xl border p-3 text-left transition-colors ${
              llmConfig.provider === 'gemini_api'
                ? 'border-[#D99B26] bg-[#D99B26]/10'
                : 'border-white/[0.08] bg-[#0A0C12] hover:border-white/[0.18]'
            }`}
          >
            <div className="font-semibold text-[#F3F4F6]">
              Google AI Studio API
            </div>
            <div className="text-[11px] text-[#8893A8] mt-1 leading-relaxed">
              Gemini 4 Hydrogen + радар Decision 1 с ротацией ключей и переливом.
            </div>
          </button>
        </div>

        <GeminiCloudConfigPanel
          llmConfig={llmConfig}
          onChange={setLlmConfig}
          hybridOnly={llmConfig.provider !== 'gemini_api'}
        />

        {/* Colab Endpoint & Ping */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0A0C12] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="colab-endpoint-input" className="font-semibold text-[#F3F4F6]">
              Адрес туннеля Google Colab L4 (Cloudflare / Ngrok или локальный Ollama)
            </label>
            <a
              href="/colab_l4_translation_server.ipynb"
              download="colab_l4_translation_server.ipynb"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D99B26]/40 bg-[#D99B26]/10 px-2.5 py-1 text-[11px] font-semibold text-[#E5AC3D] hover:bg-[#D99B26]/20"
            >
              <Download className="h-3 w-3" aria-hidden="true" />
              <span>Скачать .ipynb</span>
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
              className="flex-1 rounded-lg border border-white/[0.1] bg-[#10131C] px-3 py-2 font-mono text-xs text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
            />
            <button
              type="button"
              disabled={colabPingState?.loading}
              onClick={onPingColab}
              className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D] disabled:opacity-50 whitespace-nowrap"
            >
              {colabPingState?.loading ? 'Проверка...' : 'Проверить L4'}
            </button>
          </div>

          {colabPingState && !colabPingState.loading && (
            <div
              className={`rounded-lg border px-3 py-2 text-[11px] ${
                colabPingState.ok
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              {colabPingState.ok ? (
                <span>
                  Связь установлена ({colabPingState.runtime}, пинг{' '}
                  <strong className="font-mono">{colabPingState.latencyMs} мс</strong>). Модели:{' '}
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

        {/* L4 Catalog */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[#F3F4F6]">
              Открытые модели под 24 ГБ VRAM (NVIDIA L4)
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="custom-ollama-tag" className="text-[11px] text-[#8893A8]">
                Тег:
              </label>
              <input
                id="custom-ollama-tag"
                type="text"
                value={llmConfig.modelId}
                onChange={(e) =>
                  setLlmConfig((prev) => ({ ...prev, modelId: e.target.value }))
                }
                className="w-44 rounded-lg border border-white/[0.1] bg-[#0A0C12] px-2.5 py-1 font-mono text-xs text-[#E5AC3D] focus:border-[#D99B26] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {COLAB_L4_MODEL_CATALOG.map((spec) => {
              const isSelected = llmConfig.modelId === spec.ollamaTag;
              return (
                <button
                  key={spec.id}
                  type="button"
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
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    isSelected
                      ? 'border-[#D99B26] bg-[#D99B26]/10'
                      : 'border-white/[0.08] bg-[#0A0C12] hover:border-white/[0.18]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#F3F4F6]">{spec.title}</span>
                      <span className="rounded bg-[#D99B26]/20 px-2 py-0.5 text-[10px] font-semibold text-[#E5AC3D]">
                        {spec.roleBadge}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5 font-mono text-[11px] text-[#8893A8] tabular-nums">
                      <span>VRAM: {spec.vramGb}</span>
                      <span>·</span>
                      <span className="text-emerald-300">{spec.speedOnL4}</span>
                      <span>·</span>
                      <span>Ctx: {spec.contextWindow}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#B0B8C9] mt-1.5 leading-relaxed">
                    <strong className="text-[#F3F4F6]">Плюсы:</strong> {spec.strengthsRus}
                  </p>
                  <p className="text-[11px] text-[#8893A8] mt-0.5 leading-relaxed">
                    <strong className="text-[#B0B8C9]">Нюанс:</strong> {spec.caveatsRus}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Colab Launch Cell */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0A0C12] p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[#F3F4F6]">
              Код ячейки для Google Colab (GPU L4)
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(generateColabL4LaunchScript(llmConfig.modelId));
                setCopiedColabScript(true);
                setTimeout(() => setCopiedColabScript(false), 2500);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#151925] px-2.5 py-1 text-[11px] font-medium text-[#F3F4F6] hover:border-white/[0.25]"
            >
              {copiedColabScript ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  <span>Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />
                  <span>Копировать код</span>
                </>
              )}
            </button>
          </div>
          <pre className="max-h-36 overflow-y-auto studio-scroll rounded-lg border border-white/[0.06] bg-[#050609] p-3 font-mono text-[11px] text-[#B0B8C9] leading-relaxed">
            {generateColabL4LaunchScript(llmConfig.modelId)}
          </pre>
        </div>

        {/* Google Drive Bundle */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-4 space-y-2.5">
          <div>
            <span className="font-semibold text-emerald-200">
              Ночной перевод через Google Drive (авто-чекпоинт)
            </span>
            <p className="text-[11px] text-[#B0B8C9] mt-0.5 leading-relaxed">
              Положите <code className="font-mono text-[#E5AC3D]">kanon_project_bundle.json</code> в{' '}
              <code className="font-mono">/MyDrive/KanonXianxia/</code> и запустите Ячейку №2 в Colab.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onExportColabDriveBundle}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Скачать бандл Drive</span>
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#10131C] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-white/[0.25]"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Загрузить готовый бандл</span>
            </button>
          </div>
        </div>
      </div>
    </StudioDialog>
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
  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        <>
          <ShieldCheck className="h-4 w-4 text-[#D99B26]" aria-hidden="true" />
          <span>Стоп-кран глоссария (Главы {startChapter}–{endChapter})</span>
        </>
      }
      subtitle="Утвердите русские переводы и род (М / Ж / Ср / Мн) новых терминов перед пакетным переводом."
      titleId="stop-gate-modal-title"
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <span className="font-mono text-[11px] text-[#8893A8] tabular-nums">
            К утверждению: <strong className="text-[#F3F4F6]">{stopGateTerms.length}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/[0.12] bg-[#10131C] px-3.5 py-2 text-xs text-[#B0B8C9] hover:text-[#F3F4F6]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={onApproveAndTranslate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] hover:bg-[#E5AC3D]"
            >
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Утвердить и перевести {startChapter}–{endChapter}</span>
            </button>
          </div>
        </>
      }
    >
      <div className="space-y-2 text-xs">
        {stopGateTerms.length === 0 ? (
          <div className="rounded-xl border border-white/[0.08] bg-[#0A0C12] p-6 text-center text-[#8893A8]">
            В главах {startChapter}–{endChapter} все ключевые термины уже есть в каноне ({canonCount} записей). Можно запускать перевод.
          </div>
        ) : (
          stopGateTerms.map((term, idx) => {
            const currentGender = (term.gender || 'UNKNOWN') as GrammaticalGender;
            const isUnclassifiedCharacter =
              term.category === 'characters' && currentGender === 'UNKNOWN';
            return (
              <div
                key={term.id || idx}
                className={`grid grid-cols-1 sm:grid-cols-12 items-center gap-2 rounded-xl border p-2.5 ${
                  isUnclassifiedCharacter
                    ? 'border-[#D99B26]/40 bg-[#D99B26]/[0.06]'
                    : 'border-white/[0.08] bg-[#0A0C12]'
                }`}
              >
                <div className="sm:col-span-4 font-mono text-xs text-[#E5AC3D] truncate flex items-center gap-1.5">
                  <span className="truncate">{term.eng}</span>
                  {isUnclassifiedCharacter && (
                    <span className="shrink-0 rounded border border-[#D99B26]/40 bg-[#D99B26]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#E5AC3D]">
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
                    className="w-full rounded-lg border border-white/[0.12] bg-[#10131C] px-2.5 py-1.5 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
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
                    className={`w-full rounded-lg border px-2 py-1.5 font-mono text-xs ${
                      isUnclassifiedCharacter
                        ? 'border-[#D99B26]/50 bg-[#151925] text-[#E5AC3D]'
                        : 'border-white/[0.12] bg-[#10131C] text-[#F3F4F6]'
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
                    className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
                  >
                    Убрать
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </StudioDialog>
  );
}
