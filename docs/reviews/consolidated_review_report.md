# Consolidated Goldfish Review Report (Stages 5–9)

* **Target Document:** [`concepts_brief.md`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/concepts_brief.md)
* **Date:** 2026-10-29
* **Review Lenses Executed:** `egm-zoom-out` (Stages 5 & 8), `egm-design` (Stages 6 & 7), `egm-codebase-details` (Stage 9), `egm-implementation-readiness` (Stage 9)
* **Individual Stage Reports:**
  * [`zoom_out_report.md`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/zoom_out_report.md)
  * [`critic_report.md`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/critic_report.md)
  * [`implementation_readiness_report.md`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/implementation_readiness_report.md)

---

## 1. Consolidated Action Items by Priority

### 🔴 Blockers (Must Fix Before / During Implementation)

1. **`[BLK-1]` Отсутствие `RUS_WORD_TO_NUMBER` в `NUMBER_MISMATCH` и 4 механических гейтах (`lib/qa-linter.ts`, `lib/chapter-verifier.ts`)**:
   * **Суть:** `WRITTEN_NUMERAL_PATTERNS` (`lib/qa-linter.ts:319-365`) не штрафует числа `1–9` прописью; виновник принудительных цифр в прозе (*«3 духовных камня»*, *«2 пилюли»*) — правило `NUMBER_MISMATCH` (`lib/qa-linter.ts:1035-1054`) и 4 механических гейта (`alignChapterParagraphs`, `finalizeAndVerifyChapter`, `mergeRepairedParagraphsByIndex`, `verifyAndRollbackStylistPass`), которые извлекают только `/\d+/g`.
   * **Решение:** Экспортировать из [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts) функцию `extractNormalizedRussianNumbers(text: string): Set<string>`, которая извлекает как арабские числа, так и русские числительные `1–9` во всех падежах (`один/одна/одно/одну/одного...` → `'1'`, `два/две/двух/двое...` → `'2'`, ..., `девять/девяти...` → `'9'`), и подключить её в `NUMBER_MISMATCH`, `alignChapterParagraphs`, `mergeRepairedParagraphsByIndex` и `verifyAndRollbackStylistPass`.

2. **`[BLK-2]` Разрушение компактной вёрстки `--- ... ---` через `.join('\n\n')` и сдвиг индексов в `.split(/\n\n+/)`**:
   * **Суть:** `surgicalRepairDriftedParagraphs` (`lib/qa-linter.ts:2060`), `mergeRepairedParagraphsByIndex` (`lib/chapter-verifier.ts:435`) и `applyMechanicalGate` (`lib/chapter-verifier.ts:599`) склеивают абзацы безусловным `.join('\n\n')`. Одновременно `verifyAndRollbackStylistPass` (`lib/chapter-verifier.ts:476`) делит главу по `.split(/\n\n+/)`, из-за чего одиночный `\n` внутри `--- ... ---` склеит системное окно в один абзац и собьёт индексы относительно `alignChapterParagraphs` (который делит по `\n`).
   * **Решение:**
     1. В `verifyAndRollbackStylistPass` (`lib/chapter-verifier.ts:476`) заменить `.split(/\n\n+/)` на `.split('\n').map(l => l.trim()).filter(Boolean)` — единый контракт индексации во всём пайплайне.
     2. Создать хелпер `joinParagraphsPreservingSystemBoxes(paragraphs: string[]): string` и использовать его вместо `.join('\n\n')` в `surgicalRepairDriftedParagraphs`, `mergeRepairedParagraphsByIndex`, `applyMechanicalGate` и `normalizeRussianBookLayout`.
     3. Вызывать `normalizeRussianBookLayout` в `finalizeAndVerifyChapter` **после** `surgicalRepairDriftedParagraphs` и `autoRepairRussianText`.

3. **`[BLK-3]` Защита CSS-контракта `.system-box` и round-trip парсера EPUB (`lib/epub-archive.ts`)**:
   * **Суть:** В [`lib/epub-archive.ts:66-100`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L66-L100) уже используется `<div class="system-box">` с `<p class="system-line">` и CSS на строках `262-275`. Замена класса на `.system-panel` сломает стили и тест в `lib/audit-fixes.test.ts:473-481`. Кроме того, вставка `\u00A0` в XHTML без обратного `.replace(/\u00A0/g, ' ')` в `sanitizeRawChapterText` (`lib/epub-archive.ts:495`) сломает round-trip тест `parseEpubArchiveToChapters` (`lib/qa-linter.test.ts:595-621`).
   * **Решение:** Сохранить класс `.system-box`, добавить буферизацию идущих подряд строк `[...]` вне `---` в единый `<div class="system-box">`, привязывать `\u00A0` только к `—\u00A0` и русским единицам (`ли|цзинь|чжан|лян|му`), а в `sanitizeRawChapterText` нормализовать `\u00A0` обратно в обычный пробел `' '`.

---

### 🟡 Majors (Architectural Simplifications & Spec Completeness)

4. **`[MAJ-1]` Отказ от избыточного усложнения `GLOSSARY_CANON_VIOLATION` (YAGNI)**:
   * **Суть:** `GLOSSARY_CANON_VIOLATION` (`lib/qa-linter.ts:1056-1103`) уже проверяет раздельное вхождение стемов (`significantWords.every(stem => lowerRus.includes(stem))`). Обороты *«магический меч-артефакт»* и *«внешний пик Секты Каменных Демонов»* уже проходят проверку без изменения кода линтера. Корявые причастия (*«принадлежавшим»*, *«бывший магическим артефактом»*) находились в `lib/seed-data.ts`, `lib/llm-inference-port.ts` и `data/novels_db.json`.
   * **Решение:** Не менять алгоритм `GLOSSARY_CANON_VIOLATION`; вычистить шаблоны в `lib/seed-data.ts`, `lib/llm-inference-port.ts` и `data/novels_db.json`.

5. **`[MAJ-2]` Точные регулярные выражения для нормализации системных строк `[...]` и мер веса `цзинь`**:
   * **Суть:** Зафиксировать однозначные регулярные выражения в `autoRepairRussianText` и `normalizeRussianBookLayout`:
     * В `WEIGHT_UNITS` (`lib/qa-linter.ts:1566-1576`): `/(\d+)\s+цзиней\b/gi` → `$1 цзинь`.
     * Внутри строк `^\[[^\]]+\]$`:
       * замена вложенного тире внутри круглых скобок: `/\(([^()]+?)\s+—\s+([^()]+?)\)/g` → `($1, $2)` (например, `(Доступно улучшение — совместимость 85%)` → `(Доступно улучшение, совместимость 85%)`);
       * замена разделительного тире после ключа: `/^\[([^:]+:\s*[^(\]\n]+?)\s+—\s+([^()\]\n]+)\]$/` → `[$1 ($2)]` (например, `[Культивация: Очищение Ци — 3-й слой]` → `[Культивация: Очищение Ци (3-й слой)]`);
       * устранение тавтологии в бонусе скорости: `/\[Бонус к скорости:\s*([+–-]?\d+%?)\s+к\s+скорости\s+передвижения\]/gi` → `[Бонус к скорости: $1 (передвижение)]`.

6. **`[MAJ-3]` Синхронизация вычитанной Главы 5 (`ch-5`) между `data/novels_db.json` и `lib/seed-data.ts`**:
   * **Суть:** В `lib/seed-data.ts:391-412` у `ch-5` сейчас пустой `rusText: ''` и `verified: false`.
   * **Решение:** Перенести эталонный вычитанный текст `ch-5` и `verified: true` также в `lib/seed-data.ts`.

---

### 🟢 Nits

7. **`[NIT-1]` Корректировка номеров строк `lib/qa-linter.ts` и идентификаторов `ch-7-1`, `ch-7-2` в `concepts_brief.md`**.

---

## 2. Traceability Matrix

| Raw Finding (Report & ID) | Reviewer Lens | Severity | Consolidated Action Item | Resolution Status |
| :--- | :--- | :---: | :---: | :---: |
| `critic_report.md#1`, `zoom_out_report.md#1`, `implementation_readiness_report.md#1` | All 4 Lenses | 🔴 Blocker | `[BLK-1]` `extractNormalizedRussianNumbers` в 5 точках | Внесено в `concepts_brief.md` |
| `critic_report.md#2`, `zoom_out_report.md#4`, `implementation_readiness_report.md#3` | All 4 Lenses | 🔴 Blocker | `[BLK-2]` `joinParagraphsPreservingSystemBoxes` + фикс сплиттера `verifyAndRollbackStylistPass` | Внесено в `concepts_brief.md` |
| `zoom_out_report.md#2`, `implementation_readiness_report.md#2`, `implementation_readiness_report.md#4` | `egm-zoom-out`, `egm-codebase-details`, `egm-implementation-readiness` | 🔴 Blocker | `[BLK-3]` Сохранение `.system-box` + `\u00A0` unescape в `sanitizeRawChapterText` | Внесено в `concepts_brief.md` |
| `critic_report.md#3`, `zoom_out_report.md#3` | `egm-zoom-out`, `egm-design` | 🟡 Major | `[MAJ-1]` Отказ от модификации `GLOSSARY_CANON_VIOLATION` (YAGNI) | Внесено в `concepts_brief.md` |
| `zoom_out_report.md#5`, `implementation_readiness_report.md#4` | `egm-zoom-out`, `egm-implementation-readiness` | 🟡 Major | `[MAJ-2]` Точные regex для `[...]` и `цзиней -> цзинь` | Внесено в `concepts_brief.md` |
| `implementation_readiness_report.md#5` | `egm-codebase-details` | 🟡 Major | `[MAJ-3]` Синхронизация `ch-5` в `lib/seed-data.ts` | Внесено в `concepts_brief.md` |
| `critic_report.md#4`, `implementation_readiness_report.md#6` | All 4 Lenses | 🟢 Nit | `[NIT-1]` Актуализация номеров строк и `ch-7-1` / `ch-7-2` | Внесено в `concepts_brief.md` |
