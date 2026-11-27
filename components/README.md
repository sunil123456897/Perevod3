# UI Studio Components (`components`)

## Overview
Клиентский интерфейс студии перевода веб-новелл на базе Next.js 15, React 19 и Tailwind CSS v4. Строго изолирован от серверных модулей `lib/` (LLM SDK, `node:sqlite`, CLI-адаптеров).

## Interface
- [`PipelineStudioApp`](./PipelineStudioApp.tsx): Корневой оркестратор студии (управление проектами, фильтрами, запуском конвейера и автосохранением с проверкой сессии `/api/auth`).
- [`StudioAuthGate`](./StudioAuthGate.tsx): Экран авторизации по `STUDIO_API_TOKEN` с установкой `HttpOnly` cookie через `/api/auth` до гидратации данных.
- [`components/studio/`](./studio/StudioModals.tsx):
  - `studio-helpers.ts` — чистые утилиты хэширования глоссария, парсинга фаз SSE и ZIP-выгрузки;
  - `useStudioJobStream.ts` — подписка на SSE `/api/jobs/[id]/events` с инкрементальной дозагрузкой изменённых глав (`fetchChapterFromServer`);
  - `StudioModals.tsx` — модальные окна (`LinterProfileModal`, `BulkImportModal`, `NewNovelModal`, `LlmEngineModal`, `GlossaryStopGateModal`).
- [`ParallelEditorView`](./ParallelEditorView.tsx) и [`components/editor/`](./editor/EditorInspectorPanels.tsx):
  - Редактор с Zen-режимом (`Ctrl+S` / `Esc`), быстрым каноном (`Ctrl+Shift+M`), вынесенными инспекторами (`EditorInspectorPanels.tsx`) и режимами `Абзацы 1:1` / `Word Diff` (`EditorModes.tsx`).
- [`QuickStartWizard`](./QuickStartWizard.tsx): 3-шаговый мастер с живым отображением провайдера (`llmConfig`), моделей Pass 1/Pass 2 и реальной готовности ключа / Colab.
- [`TranslationAnalyticsChart`](./TranslationAnalyticsChart.tsx): Лениво подключаемый через `next/dynamic(..., { ssr: false })` график Recharts (вынесен из критического JS-бандла `/`).
- [`GlossaryVaultView`](./GlossaryVaultView.tsx), [`RulateExportView`](./RulateExportView.tsx), [`ToastProvider`](./ToastProvider.tsx), [`GeminiCloudConfigPanel`](./GeminiCloudConfigPanel.tsx).

## Invariants
- **Client/Server Isolation**: В `components/` запрещены импорты серверных модулей (`@google/genai`, `node:sqlite`, `llm-inference-port.ts`, `pipeline-run-engine.ts`, `sqlite-db-server.ts`, `job-broker.ts` и т.д.).
- **Auth-First Hydration**: При активном `STUDIO_API_TOKEN` студия сначала проходит `StudioAuthGate` и только потом запускает `loadNovelsFromStorage` и восстановление SSE-задач.

## Verification
- Run: `npx tsc --noEmit && npm run lint && npm run build`
