# Core Translation Engine & Verification (`lib`)

## Overview
Ядро конвейера автономного литературного перевода веб-новелл (JP/CN/KR/EN → RU). Модуль организован в виде строгого ациклического графа зависимостей (DAG, 0 циклических импортов) с жёстким разделением на браузерно-безопасные модули и серверные адаптеры.

## Layering (Zero-Cycle DAG)
### 1. Browser-Safe Leaf & Shared Core
- [`pipeline-types.ts`](./pipeline-types.ts): Общие типы конвейера, провайдеров, рубрик DITING / Decision 1, сцен и SSE-задач.
- [`seed-data.ts`](./seed-data.ts): Модели данных `ChapterRecord`, `NovelProject`, начальные проекты и пресеты.
- [`russian-morphology.ts`](./russian-morphology.ts): Склонение русских и составных терминов, заморозка слогов CJK-имён (`buildInflectedRussianForms`, `splitCompoundRussianTerm`).
- [`scene-analysis.ts`](./scene-analysis.ts): Классификация темпоритма сцен (`classifyScenePacingMode`), разметка диалогов/нулевых местоимений и отбор триплетов few-shot.
- [`ruby-korean-parser.ts`](./ruby-korean-parser.ts), [`epub-archive.ts`](./epub-archive.ts), [`storage-idb.ts`](./storage-idb.ts): AST фуриганы/корейской нормализации, EPUB/ZIP-архивы, браузерное хранилище и клиентский API (`fetchChapterFromServer`, `patchChapterOnServer`).
- [`qa-linter.ts`](./qa-linter.ts): 20 детерминированных правил русского слога, авто-ремонт пунктуации/тавтологий и экспорт Рулейт (чистый хаб без downstream `export *`).
- [`canon-glossary-vault.ts`](./canon-glossary-vault.ts), [`delta-diting.ts`](./delta-diting.ts), [`chapter-verifier.ts`](./chapter-verifier.ts): Каскад глоссария `Canon Ripple`, память DelTA + DITING 6D, Banded-DTW выравнивание, шлюз отката `verifyAndRollbackStylistPass` и 7-шаговый `finalizeAndVerifyChapter`.
- [`pipeline-batch-runner.ts`](./pipeline-batch-runner.ts): Браузерно-безопасный волновой раннер (`runPipelineBatchOnNovel`), `FetchPipelineTransportAdapter`, сбор `degradedWarnings`.

### 2. Server-Only Modules (Never imported from `components/`)
- [`api-security.ts`](./api-security.ts): Host/Origin guard, HMAC cookie + Bearer/Header auth (`verifyStudioApiRequest`), санитизация `LlmProviderConfig`, защита от SSRF.
- [`gemini-decision-engine.ts`](./gemini-decision-engine.ts), [`local-embed-client.ts`](./local-embed-client.ts): Оркестрация `gemini-decision-1` и локального CUDA-моста эмбеддингов.
- [`llm-inference-port.ts`](./llm-inference-port.ts): Ротация пула ключей `GEMINI_API_KEY` / `GOOGLE_API_KEYS` по бакетам `(project, model)`, `AntigravityCliAdapter`, `ColabOllamaAdapter`.
- [`chapter-verifier-server.ts`](./chapter-verifier-server.ts), [`pipeline-run-engine.ts`](./pipeline-run-engine.ts): Серверный асинхронный цикл (`verifyAndRepairChapterAsync`, `ServerPipelineExecutionAdapter`) с LLM-ремонтом и пробросом `degradedWarnings`.
- [`sqlite-db-server.ts`](./sqlite-db-server.ts), [`disk-db-server.ts`](./disk-db-server.ts), [`job-broker.ts`](./job-broker.ts): Персистентность в `node:sqlite` WAL (`process.getBuiltinModule('node:sqlite')`), сериализованная запись `novels_db.json` (flush при `close()`), межнодовый lock задач (`owner_pid`) и SSE-брокер.

## Invariants
- **Source Firewall**: Оригинал $x_s$ никогда не передаётся в `Pass 3 (Blind Literary Stylist)`.
- **Инварианты $G_{surf}$**: Нарушение чисел, терминов, баланса кавычек/скобок или длины $> \pm 45\%$ откатывает абзац к $y'[\text{\#pK}]$.
- **Node 22 strip-types**: Все относительные импорты внутри `lib/` и `scripts/` сохраняют расширение `.ts`, а `node:sqlite` загружается динамически через `process.getBuiltinModule('node:sqlite')`.

## Verification
- Run: `npm test` (полный набор тестов `lib/qa-linter.test.ts` + `lib/audit-fixes.test.ts`)
- Run: `npx tsc --noEmit`
