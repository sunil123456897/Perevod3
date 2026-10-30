# Goldfish Critic Review Report (Stage 6 & 7)

**Target:** `c:\Users\vanya\Desktop\автономная-студия-перевода-веб-новелл\concepts_brief.md` (`Lines 1-116`)
**Reviewer Lens:** `egm-design`

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Ложная посылка о `RUS_WORD_TO_NUMBER` — `NUMBER_MISMATCH` заблокирует пропись чисел 1–9 и провалит верификацию - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `concepts_brief.md` (`Lines 21-24, 43, 58, 69-75`), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1035-L1054), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L421-L429)
* **Discrepancy Description:** Спецификация предполагает, что `NUMBER_MISMATCH` уже умеет сопоставлять английские цифры (`3`) с русскими числительными прописью (`три`). В реальности [`lib/qa-linter.ts:1035-1054`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1035-L1054), [`alignChapterParagraphs`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L443-L445) и [`mergeRepairedParagraphsByIndex`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L421-L429) извлекают только арабские цифры (`/\d+/g`). Замена `3` на `три` в русском тексте вызовет `lint-num-missing-3` (`error`) и сбросит `verified: false`.
* **Rationale & Recommendation:** Либо реализовать общий хелпер `extractNormalizedRussianNumbers(text: string): Set<string>`, который распознаёт склонения числительных `1–9` (`один/одна/одно/одного...` -> `'1'`, `два/две/двух/двое...` -> `'2'`, ..., `девять/девяти...` -> `'9'`) и подключить его во все 3 точки (`NUMBER_MISMATCH`, `alignChapterParagraphs`, `mergeRepairedParagraphsByIndex`), либо сохранить арабские цифры в `rusText`, если в `engText` стоят арабские цифры.

### 2. Разрушение компактной вёрстки `--- ... ---` через `.join('\n\n')` в `mergeRepairedParagraphsByIndex` и `surgicalRepairDriftedParagraphs` - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `concepts_brief.md` (`Lines 25-27, 44-46, 59, 83-96`), [`lib/chapter-verifier.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts#L352-L435), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L2060)
* **Discrepancy Description:** `surgicalRepairDriftedParagraphs` (`lib/qa-linter.ts:2060`) и `mergeRepairedParagraphsByIndex` (`lib/chapter-verifier.ts:435`) склеивают массив абзацев безусловным `.join('\n\n')`. Если вызвать `normalizeRussianBookLayout` до `surgicalRepairDriftedParagraphs`, или повторно вызвать `mergeRepairedParagraphsByIndex`, компактная вёрстка внутри `--- ... ---` будет снова разорвана двойными переносами `\n\n`.
* **Rationale & Recommendation:** Использовать единую функцию сборки абзацев `joinParagraphsPreservingSystemBoxes(paragraphs: string[]): string` внутри `mergeRepairedParagraphsByIndex`, `surgicalRepairDriftedParagraphs` и `normalizeRussianBookLayout`, а сам `normalizeRussianBookLayout` вызывать также в финальной точке `finalizeAndVerifyChapter` после всех ремонтов.

### 3. Свободное окно в 4 слова в `GLOSSARY_CANON_VIOLATION` создаёт ложные пропуски и не учитывает однословные термины - Severity: 🟡 Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `concepts_brief.md` (`Lines 42, 67-68`), [`lib/qa-linter.ts`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts#L1056-L1100)
* **Discrepancy Description:** Проверка корней на расстоянии до 4 слов без привязки к синтаксической группе приведёт к ложным пропускам (False Negatives), а проверка в рамках абзаца `rP` не учитывает, что `GLOSSARY_CANON_VIOLATION` сейчас работает на уровне всего `rusText`.
* **Rationale & Recommendation:** Допускать между корнями составного термина глоссария не более 1–2 слов или дефисную спайку в пределах одного предложения (`stem1(?:\s+[\wа-яё-]+){0,2}[\s-]+stem2`), сохранив существующую логику для однословных терминов.

### 4. Смещение номеров строк `lib/qa-linter.ts` в спецификации после модульной декомпозиции - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `concepts_brief.md` (`Lines 20, 67, 95`)
* **Discrepancy Description:** После выноса модулей из `lib/qa-linter.ts` `alignChapterParagraphs` находится на строках `421-460`, `NUMBER_MISMATCH` — `1035-1054`, `GLOSSARY_CANON_VIOLATION` — `1056-1100`, `WRITTEN_NUMERALS` — `1230-1285`.
* **Rationale & Recommendation:** Обновить ссылки на строки `lib/qa-linter.ts` в спецификации.
