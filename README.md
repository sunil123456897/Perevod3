# Автономная студия перевода веб-новелл (JP/CN/KR/EN → RU)

Профессиональный конвейер автономного литературного перевода длинных азиатских и англоязычных веб-новелл (сянься, уся, корейское литрпг, ранобэ, тёмное фэнтези) на русский язык с детерминированным контролем качества, морфологическим глоссарием и многопроходным рецензированием.

---

## Ключевая архитектура

1. **4-фазный конвейер со Source Firewall (MELT + Feature-Guided Rewriting)**:
   - **Pass 0 (Pre-Parsing & Frame Normalizer)**: AST-разбор японской фуриганы и гикуна (`RubyGikunParser`), склейка мобильных однострочных предложений корейских новелл (`normalizeKoreanOneLineParagraphs`), семантический чанкинг с замками `Dialogue Lock` и `Frame Lock`.
   - **Pass 1 (Draft Translation)**: Черновой перевод с инжекцией $k=3$ динамических триплетов Few-Shot по 5 темпоритмам сцен, 4-слойным KV-префиксом и продолжением при обрыве потока.
   - **Pass 2 (Surgical Critic & Bilingual LiTransProQA)**: Билингвальный аудит верности оригиналу ($x_s$) и пре-аудит `gemini-decision-1` с расчётом `otqs` и лимитом Куниловской ($\le 3$ директивы на абзац).
   - **Mechanical Gate**: Add-Only нормализация якорей `[#p0] [a7f|#p0]`, блокировка стирания канонических терминов в кавычках и косвенных падежах, подстрочное затенение терминов.
   - **Pass 3 (Blind Literary Stylist)**: Декондиционированная «слепая» художественная адаптация **без доступа к тексту оригинала ($x_s$)** по 6 законам Норы Галь с A/B-реферированием и поабзацным откатом по 5 инвариантам ($G_{surf}$).

2. **Детерминированный QA-линтер (20 правил) и диагностика деградаций**:
   - Универсальный форензик-аудит любой новеллы (`scripts/forensic-novel-audit.ts`) с динамическим извлечением мужских/женских/несклоняемых имён из `novel.glossary` и `glossaryMeta`.
   - При частичном fallback Pass 2/3 или `gemini-decision-1` предупреждения фиксируются в `degradedWarnings` главы и журнале конвейера.

3. **Хранилище, конкурентность и безопасность**:
   - Серверная БД `SQLite WAL` (`data/studio.db` через встроенный `node:sqlite`) с поглавным Optimistic Concurrency Control (`revision`), отложенным сериализованным зеркалом `data/novels_db.json` и межнодовыми/CLI lock-записями `owner_pid`.
   - Инкрементальное обновление глав в UI по SSE (`/api/jobs/[id]/events` + `GET /api/projects?novelId=&chapterId=`).
   - Опциональная защита токеном `STUDIO_API_TOKEN` через экран входа `StudioAuthGate` (`HttpOnly` HMAC cookie `studio_session`).

4. **Инфраструктура и транспорт**:
   - Мультимодельная маршрутизация: `Google AI Studio API` (пул `GEMINI_API_KEY` / `GOOGLE_API_KEYS` с независимым кулдауном по `(project, model)`), `Google Colab L4` (Ollama / vLLM) и локальный `Antigravity CLI (agy)`.
   - Экспорт для платформы Rulate (строгий Unix LF, 2-параметрический заголовок).

---

## Запуск и разработка

### Требования
- **Node.js 22.12+** (используется встроенный `node:sqlite` и нативный запуск `.ts` через type stripping)
- **pnpm 10+** (для детерминированной сборки и `Dockerfile`) или **npm**

### Установка зависимостей
```bash
pnpm install
# или
npm install
```

### Настройка окружения
Создайте файл `.env.local` на основе `.env.example`:
```bash
cp .env.example .env.local
```
Укажите API-ключ(и) Gemini и при необходимости токен защиты UI:
```env
GEMINI_API_KEY=your_gemini_api_key_here
# Опционально: пул дополнительных ключей и защита веб-интерфейса
GOOGLE_API_KEYS=""
STUDIO_API_TOKEN=""
```

### Запуск тестов, линтера и форензик-аудита
```bash
# Полный набор unit и integration тестов (lib/qa-linter.test.ts + lib/audit-fixes.test.ts)
npm test

# Проверка типов TypeScript и ESLint
npx tsc --noEmit && npm run lint

# Форензик-аудит новеллы и PROSE_GATE
node scripts/forensic-novel-audit.ts --novel my-step-daughters-are-the-villainesses --range 1-209 --gate
```

### Запуск локального сервера разработки и Production
```bash
npm run dev
# или production:
npm run build
npm run start
```
Откройте [http://localhost:3000](http://localhost:3000) в браузере.
