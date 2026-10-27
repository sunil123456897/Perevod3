# Server API Endpoints (`app/api`)

## Overview
Серверный уровень Next.js App Router для оркестрации инференса LLM, маршрутизации промптов и серверного управления проектами.

## Interface
- [`POST /api/pipeline`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/app/api/pipeline/route.ts):
  - `action: 'translate'`: Выполнение полного 4-проходного цикла (Pass 0 AST/нормализация -> Pass 1 Draft -> Pass 2 Bilingual Critic -> Mechanical Gate -> Pass 3 Blind Stylist -> Step 4 Rollback Gate).
  - `action: 'scout'`: Автоматический скаутинг терминов и извлечение сущностей без перевода.
  - `action: 'verify'`: Детерминированная верификация текста главы по 20 правилам QA и поабзацный авто-ремонт.
  - `action: 'ping_colab'`: Проверка доступности туннеля Google Colab L4 Ollama и списка моделей в VRAM.
- [`GET / POST / PUT / DELETE /api/projects`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/app/api/projects/route.ts):
  - Управление проектами новелл, резервными копиями и бандлами.

## Invariants
- **Source Firewall Integrity**: В теле запроса к `Pass 3 (Blind Literary Stylist)` поле `sourceText` строго заменяется на `null` / пустую строку.
- **Транспортная устойчивость**: При сбое внешнего LLM API или сетевом таймауте возвращается структурированная ошибка с кодом `500` или локальный детерминированный откат к черновику Pass 1.
- **Безопасность окружения**: Ключ `GEMINI_API_KEY` считывается строго из `process.env` на стороне сервера и никогда не возвращается в JSON-ответах клиенту.

## Side Effects
- Исходящие HTTPS-запросы к Google Gemini API (`https://generativelanguage.googleapis.com`).
- Исходящие HTTP-запросы к туннелю Cloudflare / Colab L4 Ollama (`api/generate`, `api/tags`).

## Verification
- Run: `npm run build`
- Run: `node --test lib/qa-linter.test.ts`
