# Концепт-бриф и проектная спецификация: Качество и типографика русского текста 10/10 (v2 — Post-Goldfish Review)

* **Author:** Antigravity & User
* **Date:** 2026-10-29
* **Status:** Выверено по итогам Goldfish Review (`egm-zoom-out`, `egm-design`, `egm-codebase-details`, `egm-implementation-readiness` → [`consolidated_review_report.md`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/consolidated_review_report.md))
* **Target Repository:** `c:\Users\vanya\Desktop\автономная-студия-перевода-веб-новелл`

## Overview

Доведение литературного качества, синтаксической естественности и книжной вёрстки русского перевода веб-новелл (сянься / LitRPG) с текущего уровня ~8/10 до издательского эталона 10/10.

По итогам перекрёстного аудита верифицированных глав (`ch-1`..`ch-3`, `ch-5`, `ch-7-1`, `ch-7-2`) в [`data/novels_db.json`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/data/novels_db.json) и [`lib/seed-data.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/seed-data.ts), а также кода [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts) и [`lib/epub-archive.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts) выявлены и верифицированы точные механизмы всех оставшихся дефектов.

## Analysis

1. **Принудительные цифры `1–9` в художественной прозе (`NUMBER_MISMATCH` и механические гейты)**:
   * В `ch-1`: *«смотрел на 3 духовных камня, оставшихся в его мешочке»*. В `ch-3`: *«внимательно изучал 9 сияющих пилюль»*, *«принял 2 пилюли»*.
   * Точная причина в коде (`[VERIFIED]`): правило `WRITTEN_NUMERALS` ([`lib/qa-linter.ts:319-365, 724-742`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L319-L365)) штрафует только числа `>= 20` и порядковые номера слоёв/ярусов (`шестом слое` → `6-м слое`). Однако `NUMBER_MISMATCH` ([`lib/qa-linter.ts:1035-1054`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1035-L1054)), `alignChapterParagraphs` ([`lib/qa-linter.ts:443-445`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L443-L445)), `mergeRepairedParagraphsByIndex` ([`lib/chapter-verifier.ts:421-429`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L421-L429)) и `verifyAndRollbackStylistPass` ([`lib/chapter-verifier.ts:501-513`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L501-L513)) извлекают только арабские цифры `/\d+/g`. Любая замена `3` на `три` в прозе сейчас вызывает ошибку `NUMBER_MISMATCH` и откат стилиста.
2. **Разрыв системных окон LitRPG (`--- ... ---`) двойными переносами `\n\n` и баг `.split(/\n\n+/)`**:
   * В `ch-1` и `ch-5` между каждой строкой `[Носитель: ...]`, `[Очки Истока: ...]` вставлен двойной перенос `\n\n`.
   * Точная причина в коде (`[VERIFIED]`): `surgicalRepairDriftedParagraphs` ([`lib/qa-linter.ts:2060`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L2060)), `mergeRepairedParagraphsByIndex` ([`lib/chapter-verifier.ts:435`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L435)) и `applyMechanicalGate` ([`lib/chapter-verifier.ts:599`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L599)) склеивают массив строк безусловным `.join('\n\n')`. Кроме того, `verifyAndRollbackStylistPass` ([`lib/chapter-verifier.ts:476`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L476)) делит текст через `.split(/\n\n+/)` вместо `.split('\n').map(l => l.trim()).filter(Boolean)`.
3. **Канцелярские причастия вокруг терминов глоссария в текстах глав**:
   * В `ch-1`: *«пронёсся над Пиком Внешней Секты, принадлежавшим Секте Каменных Демонов»*. В `ch-5`: *«свой меч, бывший магическим артефактом»*.
   * Точная причина в коде (`[VERIFIED]`): правило `GLOSSARY_CANON_VIOLATION` ([`lib/qa-linter.ts:1056-1103`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1056-L1103)) **уже** проверяет раздельное вхождение стемов (`significantWords.every(stem => lowerRus.includes(stem))`), поэтому естественные обороты *«над Пиком Внешней Секты в обители Каменных Демонов»* и *«свой магический меч-артефакт»* проходят проверку без модификации алгоритма глоссария. Канцелярит был заложен в [`lib/seed-data.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/seed-data.ts), [`lib/llm-inference-port.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/llm-inference-port.ts) и [`data/novels_db.json`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/data/novels_db.json).
4. **Синтаксический разнобой внутри системных окон `[Ключ: Значение]`, заголовков и мер веса**:
   * В `ch-1`: `[Культивация: Очищение Ци — 3-й слой]` и `(Доступно улучшение — совместимость 85%)`.
   * В `ch-5`: заголовок `Глава 5: ...` (через двоеточие вместо точки), `35 цзиней` (вместо неизменяемого `35 цзинь`), `[Бонус к скорости: +45% к скорости передвижения]` (тавтология *«к скорости ... к скорости»*).
   * В `ch-7-1` и `ch-7-2`: абзацы разделены одиночным `\n` вместо `\n\n`.
5. **Группировка идущих подряд строк `[...]` вне `---` и неразрывные пробелы в EPUB**:
   * В [`lib/epub-archive.ts:66-100`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L66-L100) блоки внутри `---` уже оборачиваются в `<div class="system-box">`, но идущие подряд строки `[...]` без внешних `---` оборачиваются каждая в отдельный `.system-box`.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  1. Поддержать эквивалентность арабских цифр `1–9` и русских числительных прописью (`один..девять` во всех падежах) через `extractNormalizedRussianNumbers` в `NUMBER_MISMATCH`, `alignChapterParagraphs`, `mergeRepairedParagraphsByIndex` и `verifyAndRollbackStylistPass`.
  2. Сохранять компактную вёрстку системных окон `--- ... ---` (одиночный `\n` внутри блока `---`, двойной `\n\n` между абзацами) во всех функциях сборки (`joinParagraphsPreservingSystemBoxes`, `normalizeRussianBookLayout`) и синхронизировать сплиттер в `verifyAndRollbackStylistPass`.
  3. Нормализовать заголовки глав (`Глава N:` → `Глава N.`), форму `цзиней` → `цзинь` в `WEIGHT_UNITS` и внутренний формат строк `[Ключ: Значение]` (без внутренних тире и тавтологий).
  4. Сгруппировать подряд идущие строки `[...]` вне `---` в единый `<div class="system-box">` в [`lib/epub-archive.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts) и добавить типографские неразрывные пробелы `\u00A0` в XHTML с обратной очисткой в `sanitizeRawChapterText`.
  5. Вычистить все верифицированные главы (`ch-1`..`ch-3`, `ch-5`, `ch-7-1`, `ch-7-2`) в [`data/novels_db.json`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/data/novels_db.json) и синхронизировать [`lib/seed-data.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/seed-data.ts).
* **Out-of-Scope Non-Goals:**
  * Усложнение алгоритма `GLOSSARY_CANON_VIOLATION` (существующий стем-матчер уже поддерживает естественные составные формы).
  * Изменение намеренно сломанной демо-главы `ch-4` (`verified: false`).

---

## Detailed Implementation Plan

### Step 1: Поддержка русских числительных `1–9` в `extractNormalizedRussianNumbers` и нормализация `цзинь` в [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts) и [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts)

1. Экспортировать из [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts) функцию `extractNormalizedRussianNumbers(text: string): Set<string>`:
   * Извлекает все арабские числа `/(?<!\d)\d+(?:\.\d+)?(?!\d)/g`.
   * Дополнительно распознаёт словесные числительные `1–9` по словарю полных словоформ (`\b(?:один|одна|одно|одну|одного|одной|одним|одних)\b` → `'1'`, `\b(?:два|две|двух|двум|двумя|двое|двоих)\b` → `'2'`, `\b(?:три|трёх|трех|трём|трем|тремя|трое|троих)\b` → `'3'`, `\b(?:четыре|четырёх|четырех|четырём|четырем|четырьмя|четверо|четверых)\b` → `'4'`, `\b(?:пять|пяти|пятью|пятеро|пятерых)\b` → `'5'`, `\b(?:шесть|шести|шестью|шестеро|шестерых)\b` → `'6'`, `\b(?:семь|семи|семью|семеро|семерых)\b` → `'7'`, `\b(?:восемь|восьми|восемью|восьмеро|восьмерых)\b` → `'8'`, `\b(?:девять|девяти|девятью|девятеро|девятерых)\b` → `'9'`).
2. Подключить `extractNormalizedRussianNumbers` во все 4 точки проверки сохранности чисел:
   * `alignChapterParagraphs` ([`lib/qa-linter.ts:443-445`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L443-L445));
   * `runQaLinter` (`NUMBER_MISMATCH`, [`lib/qa-linter.ts:1036-1040`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1036-L1040));
   * `mergeRepairedParagraphsByIndex` ([`lib/chapter-verifier.ts:421-429`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L421-L429));
   * `verifyAndRollbackStylistPass` ([`lib/chapter-verifier.ts:501-513`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L501-L513)).
3. В [`autoRepairRussianText`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1566-L1576) внутри блока `WEIGHT_UNITS` добавить правило:
   * `/(\d+)\s+цзиней\b/gi` → `$1 цзинь` (а также отмечать `\d+\s+цзиней\b` в детекторе `WEIGHT_UNITS` на строках `814-830`).

### Step 2: Компактная вёрстка системных окон `joinParagraphsPreservingSystemBoxes` и `normalizeRussianBookLayout`

1. Экспортировать из [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts):
   * `joinParagraphsPreservingSystemBoxes(paragraphs: string[]): string`: проходит по массиву непустых строк, отслеживая флаг `inSystemBox` (переключается на строке `trimmed === '---'`). Строки внутри открытого `--- ... ---` (включая открывающий и закрывающий `---`), а также идущие подряд строки `^\[[^\]]+\]$`, склеиваются через одиночный `\n`; все остальные абзацы разделяются через `\n\n`.
   * `normalizeRussianChapterTitle(title: string): string`: заменяет `^(Глава\s+\d+(?:\.\d+)?)\s*:\s*` на `$1. ` и убирает финальную точку в конце заголовка.
   * `normalizeRussianBookLayout(text: string): string`:
     * делит текст на непустые строки `.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)`;
     * для каждой системной строки `^\[[^\]]+\]$`:
       * заменяет тире внутри круглых скобок `/\(([^()]+?)\s+—\s+([^()]+?)\)/g` → `($1, $2)`;
       * заменяет разделительное тире после двоеточия `/^\[([^:]+:\s*[^(\]\n]+?)\s+—\s+([^()\]\n]+)\]$/` → `[$1 ($2)]`;
       * устраняет повтор ключа `/\[Бонус к скорости:\s*([+–-]?\d+%?)\s+к\s+скорости\s+передвижения\]/gi` → `[Бонус к скорости: $1 (передвижение)]`;
     * собирает результат через `joinParagraphsPreservingSystemBoxes`.
2. В [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts) и [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts):
   * В `verifyAndRollbackStylistPass` ([`lib/chapter-verifier.ts:476`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L476)) заменить `.split(/\n\n+/)` на `.split('\n').map(l => l.trim()).filter(Boolean)`.
   * В `mergeRepairedParagraphsByIndex` (`lib/chapter-verifier.ts:435`), `applyMechanicalGate` (`lib/chapter-verifier.ts:599`) и `surgicalRepairDriftedParagraphs` (`lib/qa-linter.ts:2060`) заменить `.join('\n\n')` на `joinParagraphsPreservingSystemBoxes(...)`.
   * В `finalizeAndVerifyChapter` ([`lib/chapter-verifier.ts:125-135`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L125-L135)) вызывать `normalizeRussianBookLayout` **после** `surgicalRepairDriftedParagraphs` и `autoRepairRussianText` перед финальным `runQaLinter`.

### Step 3: Буферизация `.system-box` и безопасный `\u00A0` в [`lib/epub-archive.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts)

1. В `renderChapterBodyToXhtml` ([`lib/epub-archive.ts:52-115`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L52-L115)):
   * Сохранить существующий класс `<div class="system-box">` и `<p class="system-line">`.
   * Буферизовать идущие подряд строки `^\[[^\]]+\]$` даже вне `---`, выводя их в один общий `<div class="system-box">`.
   * При рендере обычных абзацев заменять `^— ` на `—\u00A0` и `(\d+)\s+(ли|цзинь|чжан|лян|му)\b` на `$1\u00A0$2`.
2. В `sanitizeRawChapterText` ([`lib/epub-archive.ts:495`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/epub-archive.ts#L495)) добавить `.replace(/\u00A0/g, ' ')`, чтобы round-trip распаковка `parseEpubArchiveToChapters` возвращала стандартные пробелы.

### Step 4: Вычитка глав в [`data/novels_db.json`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/data/novels_db.json), [`lib/seed-data.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/seed-data.ts) и [`lib/llm-inference-port.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/llm-inference-port.ts)

1. Привести верифицированные главы (`ch-1`, `ch-2`, `ch-3`, `ch-5`, `ch-7-1`, `ch-7-2`) в [`data/novels_db.json`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/data/novels_db.json) и [`lib/seed-data.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/seed-data.ts) к эталону 10/10 (естественные числительные `три духовных камня`, `две пилюли`, `девять сияющих пилюль`, компактные системные окна через `\n`, `Глава 5. ...`, `35 цзинь`, *«над Пиком Внешней Секты в обители Каменных Демонов»*, *«обрушил на врагов свой магический меч-артефакт»*).
2. Добавить unit-тесты в [`lib/audit-fixes.test.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/audit-fixes.test.ts) и прогнать `npm test`, `npx tsc --noEmit` и `npm run lint`.
