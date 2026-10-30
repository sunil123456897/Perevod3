# Goldfish Zoom-Out Review Report (Stage 5 & 8)

**Target:** `c:\Users\vanya\Desktop\автономная-студия-перевода-веб-новелл\concepts_brief.md` (`Lines 1-116`)
**Reviewer Lens:** `egm-zoom-out`

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Ложное допущение о наличии `RUS_WORD_TO_NUMBER` и откат стилиста в `applyMechanicalGate` - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** `concepts_brief.md` (`Lines 24, 43, 70-75`), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1036-L1053), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L421-L513)
* **Discrepancy Description:** Помимо `NUMBER_MISMATCH` и `mergeRepairedParagraphsByIndex`, в [`lib/chapter-verifier.ts:501-513`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L501-L513) функция [`applyMechanicalGate`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L469) проверяет сохранение арабских цифр (`origNums` vs `newNums`) и откатывает абзац стилиста при замене `3` на `три`.
* **Rationale & Recommendation:** Создать единый легковесный экстрактор чисел `extractNormalizedNumbers(text: string): Set<string>` (извлекающий как `\d+`, так и русские словесные числительные `1–9` во всех падежах) и использовать его в `NUMBER_MISMATCH`, `alignChapterParagraphs`, `mergeRepairedParagraphsByIndex` и `applyMechanicalGate`.

### 2. Дублирование существующего `<div class="system-box">` в `lib/epub-archive.ts` - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** `concepts_brief.md` (`Lines 36-37, 49, 98-103`), [`lib/epub-archive.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L66-L100)
* **Discrepancy Description:** Функция [`renderChapterBodyToXhtml`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L52) уже группирует строки между `---` в `<div class="system-box">` с дочерними `<p class="system-line">`, а таблица стилей [`lib/epub-archive.ts:262-275`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L262-L275) и тест в [`lib/audit-fixes.test.ts:473-481`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/audit-fixes.test.ts#L473-L481) завязаны именно на класс `.system-box`.
* **Rationale & Recommendation:** Не переименовывать `.system-box` в `.system-panel` / `.sys-box`. Сохранить существующий `.system-box` и добавить в `renderChapterBodyToXhtml` только микротипографику неразрывных пробелов (`\u00A0` после диалогового тире и между числом и единицей измерения).

### 3. Избыточное усложнение `GLOSSARY_CANON_VIOLATION` (YAGNI) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** `concepts_brief.md` (`Lines 17-20, 42, 67-68`), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1056-L1103)
* **Discrepancy Description:** `GLOSSARY_CANON_VIOLATION` в [`lib/qa-linter.ts:1089`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1089) уже проверяет раздельное вхождение стемов (`significantWords.every(stem => lowerRus.includes(stem))`), поэтому естественные обороты вроде *«магический меч-артефакт»* и *«внешний пик Секты Каменных Демонов»* уже проходят проверку без изменения алгоритма. Корявые причастия были захардкожены в [`lib/seed-data.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/seed-data.ts) и [`lib/llm-inference-port.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/llm-inference-port.ts#L748).
* **Rationale & Recommendation:** Отказаться от усложнения `GLOSSARY_CANON_VIOLATION` окном в 4 слова; исправить шаблоны в `lib/seed-data.ts`, `lib/llm-inference-port.ts` и `data/novels_db.json`.

### 4. Истинный источник двойных переносов внутри `--- ... ---` находится в `.join('\n\n')` - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** `concepts_brief.md` (`Lines 59, 94-95`), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L435)
* **Discrepancy Description:** `alignChapterParagraphs` делит по `\n` и фильтрует пустые строки, поэтому индексация абзацев не зависит от `\n` vs `\n\n`. Проблема возникает при обратной сборке через `.join('\n\n')` в `mergeRepairedParagraphsByIndex` (`lib/chapter-verifier.ts:435`), `applyMechanicalGate` (`lib/chapter-verifier.ts:599`) и `surgicalRepairDriftedParagraphs` (`lib/qa-linter.ts:2060`).
* **Rationale & Recommendation:** Заменить `.join('\n\n')` в этих функциях на общий хелпер `joinParagraphsPreservingSystemBoxes(paragraphs)`.

### 5. Перенос нормализации `35 цзиней -> 35 цзинь` в существующее правило `WEIGHT_UNITS` - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** `concepts_brief.md` (`Lines 79-97`), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1566-L1576)
* **Discrepancy Description:** В `autoRepairRussianText` уже есть блок `WEIGHT_UNITS`.
* **Rationale & Recommendation:** Добавить замену `(\d+)\s+цзиней\b` → `$1 цзинь` прямо в `WEIGHT_UNITS` внутри `autoRepairRussianText`.
