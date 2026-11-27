# Server API Endpoints (`app/api`)

## Overview
Серверный уровень Next.js App Router для аутентификации, оркестрации инференса LLM, фоновых SSE-задач и персистентного SQLite WAL + JSON хранилища проектов.

## Interface
- [`GET / POST / DELETE /api/auth`](./auth/route.ts):
  - Проверка и управление сессией `STUDIO_API_TOKEN`: `GET` возвращает `{ ok, authRequired, authenticated }`; `POST { token }` устанавливает `HttpOnly; SameSite=Strict` HMAC-SHA256 cookie `studio_session`; `DELETE` очищает сессию.
- [`GET / POST /api/pipeline`](./pipeline/route.ts):
  - `GET`: статус серверного пула ключей (`hasServerApiKey`, `configuredKeyCount`) и Colab URL.
  - `POST`: `action: 'scout' | 'translate_and_edit' | 'self_repair' | 'finalize' | 'ping_colab'` (SSRF-валидация URL и проброс `degradedWarnings` при частичном fallback).
- [`GET / POST / PATCH /api/projects`](./projects/route.ts):
  - `GET`: полный слепок проектов или инкрементальная выдача одной главы через `?novelId=&chapterId=` (`getChapterById`).
  - `POST`: атомарная запись слепка с проверкой `baseUpdatedAt` (`409` при внешнем обновлении).
  - `PATCH`: поглавное OCC-обновление (`action: 'patch_chapter'`, проверка `expectedRevision`, отложенная синхронизация зеркала `data/novels_db.json`).
- [`GET / POST / DELETE /api/jobs`](./jobs/route.ts) и [`GET /api/jobs/[id]/events`](./jobs/%5Bid%5D/events/route.ts):
  - Фоновый брокер конвейера с межнодовым/CLI lock через `owner_pid` (`409` при живом конкурирующем процессе) и SSE-потоком событий (`snapshot`, `phase`, `chapter_done`, `chapter_quarantined`, `completed`, `failed`, `cancelled`) с `chapterId`.

## Invariants
- **Периметр безопасности (`api-security.ts`)**: Все роуты проверяют `Host` allowlist, защиту мутаций (`Origin` / `Sec-Fetch-Site`), а при заданном `STUDIO_API_TOKEN` требуют `Authorization: Bearer ...`, `X-Studio-Token` или валидный cookie `studio_session`.
- **Source Firewall Integrity**: В промпт `Pass 3 (Blind Literary Stylist)` оригинал $x_s$ не передаётся ни при каких условиях.
- **Fail-Closed и карантин**: При полном сбое LLM на Pass 1 глава переводится в `quarantined` без порчи прежнего `rusText`; при частичных сбоях Pass 2/3 или Decision 1 возвращаются `degradedWarnings`.
- **Безопасность секретов**: Ключи `GEMINI_API_KEY` / `GOOGLE_API_KEYS` и `STUDIO_API_TOKEN` считываются только на сервере из `process.env` и никогда не утекают клиенту.

## Verification
- Run: `npm test && npx tsc --noEmit && npm run build`
