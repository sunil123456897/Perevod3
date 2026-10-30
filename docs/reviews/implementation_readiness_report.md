# Goldfish Implementation Readiness & Codebase Details Report (Stage 9)

**Target:** `c:\Users\vanya\Desktop\автономная-студия-перевода-веб-новелл\concepts_brief.md` (`Lines 65-116`)
**Reviewer Lenses:** `egm-codebase-details`, `egm-implementation-readiness`

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Ложное утверждение о `RUS_WORD_TO_NUMBER` и 5 точек проверки арабских цифр - Severity: 🔴 Blocker
* **Reviewer Lenses:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** `concepts_brief.md` (`Lines 74-75`), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L444), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1035-L1054), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L141-L144), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L422-L429), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L502-L513)
* **Discrepancy Description:** `WRITTEN_NUMERAL_PATTERNS` (`lib/qa-linter.ts:319-365`) не штрафует числа `1–9` прописью; истинная причина принудительных цифр в прозе — проверка `NUMBER_MISMATCH` и 4 механических гейта, которые ищут только `/\d+/g`.
* **Rationale & Recommendation:** Реализовать `extractNormalizedRussianNumbers(text: string): Set<string>` с поддержкой русских числительных `1–9` во всех падежах и подключить его в `runQaLinter` (`NUMBER_MISMATCH`), `alignChapterParagraphs`, `mergeRepairedParagraphsByIndex` и `verifyAndRollbackStylistPass`.

### 2. Противоречие CSS-контракту `.system-box` и поломка round-trip теста EPUB из-за `\u00A0` - Severity: 🔴 Blocker
* **Reviewer Lenses:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** `concepts_brief.md` (`Lines 100-102`), [`lib/epub-archive.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L66-L100), [`lib/epub-archive.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L495), [`lib/qa-linter.test.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.test.ts#L595-L621)
* **Discrepancy Description:**
  1. `renderChapterBodyToXhtml` уже использует `<div class="system-box">` и `<p class="system-line">`. Переименование в `.system-panel` сломает CSS (`lib/epub-archive.ts:262-275`) и тест в `lib/audit-fixes.test.ts:473-481`.
  2. Вставка `\u00A0` при генерации XHTML без обратного преобразования `.replace(/\u00A0/g, ' ')` в `sanitizeRawChapterText` (`lib/epub-archive.ts:495`) сломает round-trip тест `parseEpubArchiveToChapters` (`lib/qa-linter.test.ts:595-621`).
* **Rationale & Recommendation:** Сохранить `.system-box`, добавить буферизацию идущих подряд строк `[...]` вне `---`, привязывать `\u00A0` только к `—\u00A0` и русским единицам (`ли|цзинь|чжан|лян|му`), а в `sanitizeRawChapterText` нормализовать `\u00A0` обратно в обычный пробел `' '`.

### 3. Несовместимость сплиттера `.split(/\n\n+/)` в `verifyAndRollbackStylistPass` и `.join('\n\n')` при одиночном `\n` в системных окнах - Severity: 🟡 Major
* **Reviewer Lenses:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** `concepts_brief.md` (`Lines 94-96`), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L103), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L435), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L476), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L2058)
* **Discrepancy Description:**
  1. В `verifyAndRollbackStylistPass` (`lib/chapter-verifier.ts:476`) текст делится через `.split(/\n\n+/)`. Если блок `--- ... ---` склеен через `\n`, сплиттер воспримет его как один абзац и собьёт индексы относительно `alignChapterParagraphs`.
  2. `surgicalRepairDriftedParagraphs` (`lib/qa-linter.ts:2058`) и `mergeRepairedParagraphsByIndex` (`lib/chapter-verifier.ts:435`) перезаписывают вёрстку через `.join('\n\n')`.
* **Rationale & Recommendation:** В `verifyAndRollbackStylistPass` делить абзацы через `.split('\n').map(l => l.trim()).filter(Boolean)`, а для обратной сборки везде использовать `joinParagraphsPreservingSystemBoxes`. Вызывать `normalizeRussianBookLayout` после `surgicalRepairDriftedParagraphs` и `autoRepairRussianText`.

### 4. Неполные регулярные выражения для тегов `[...]` и морфологии `цзинь` - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** `concepts_brief.md` (`Lines 77, 92-93`)
* **Discrepancy Description:** Не заданы точные регулярные выражения для вложенных скобок с тире (`(Доступно улучшение — совместимость 85%)`), а регулярка `(\d+)\s+цзиней\b` пропускает форму `цзиня` после `2–4` (в случае составных чисел или если по канону требуется неизменяемое `цзинь`).
* **Rationale & Recommendation:** Зафиксировать точные регулярные выражения:
  - `/^\[([^:]+:\s*[^(\]\n]+?)\s+—\s+([^()\]\n]+)\]$/` → `[$1 ($2)]`
  - внутри строк `^\[.*\]$`: `/\(([^()]+?)\s+—\s+([^()]+?)\)/g` → `($1, $2)`
  - `/\[Бонус к скорости:\s*([+–-]?\d+%?)\s+к\s+скорости\s+передвижения\]/gi` → `[Бонус к скорости: $1 (передвижение)]`
  - `/(\d+)\s+цзиней\b/gi` → `$1 цзинь`.

### 5. Рассинхронизация Главы 5 (`ch-5`) между `data/novels_db.json` и `lib/seed-data.ts` - Severity: 🟡 Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** `concepts_brief.md` (`Lines 106-108`), [`lib/seed-data.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/seed-data.ts#L391-L412)
* **Discrepancy Description:** В `lib/seed-data.ts` глава `ch-5` имеет `rusText: ''` и `verified: false`, тогда как в `data/novels_db.json` она уже переведена и верифицирована.
* **Rationale & Recommendation:** Перенести эталонный вычитанный `rusText` и метаданные верификации `ch-5` в `lib/seed-data.ts`.

### 6. Устаревшие номера строк в ссылках на `lib/qa-linter.ts` и опечатка `ch-7.1` - Severity: 🟢 Nit
* **Reviewer Lenses:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** `concepts_brief.md` (`Lines 50, 67, 69, 77, 94`)
* **Discrepancy Description:** Указаны номера строк до декомпозиции `lib/qa-linter.ts`, а также `ch-7.1` вместо ID `ch-7-1`.
* **Rationale & Recommendation:** Обновить ссылки на строки и ID глав в `concepts_brief.md`.
