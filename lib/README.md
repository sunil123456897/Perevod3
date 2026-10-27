# Core Translation Engine & Verification (`lib`)

## Overview
Ядро конвейера автономного литературного перевода веб-новелл (JP/CN/KR/EN → RU). Модуль реализует 4-проходный конвейер с Брандмауэром Оригинала (`MELT Source Firewall`), AST-препроцессором японской фуриганы (`RubyGikunParser`), нормализатором корейских строк, 20 детерминированными правилами русского QA-линтера, квантитативным речевым вектором `S-VoCAL`, многомодельным портом инференса (Gemini Flash/Argon + Colab L4 Ollama) и поабзацным шлюзом отката по инвариантам $G_{surf}$.

## Interface
- [`runQaLinter(engText, rusText, glossary, options)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts): Проверка 20 детерминированных правил русского слога, рода персонажей, чисел и канона.
- [`autoRepairRussianText(engText, rusText, glossary, options)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts): Детерминированный авто-ремонт пунктуации, латиницы, тавтологий и соматизмов.
- [`parseRubyAndGikunMarkup(text)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts): AST-классификация и трансформация 6 категорий японской фуриганы (`reading_aid`, `bouten`, `nomenclature`, `litrpg_term`, `deictic`, `subtext`).
- [`normalizeKoreanOneLineParagraphs(text)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts): Склейка рваных мобильных однострочников в связные абзацы с защитой рамок `[...]` и реплик `— ...`.
- [`chunkChapterWithSceneAndDialogueLocks(text, maxTokens)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/qa-linter.ts): Сценарная нарезка с Dialogue Lock, Frame Lock и контекстным буфером `READ_ONLY_LOOKAHEAD`.
- [`classifyScenePacingMode(text)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/llm-inference-port.ts): Детекция темпоритма сцены (`combat_action`, `cultivation_epiphany`, `comedy_banter`, `solemn_pathos`, `romance_psychology`).
- [`buildBlindStylistPass3Prompts(chapterNumber, titleEng, rusDraft, ...)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/llm-inference-port.ts): Генерация 100% русскоязычного промпта для Pass 3 без доступа к иностранному оригиналу $x_s$.
- [`verifyAndRollbackStylistPass(candidateRus, baselineRus, glossary, ...)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts): Поабзацный контроль 5 инвариантов $G_{surf}$ с мгновенным изолированным откатом абзаца.
- [`finalizeAndVerifyChapter(input)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/chapter-verifier.ts): 7-шаговый финальный компилятор релизного текста главы.
- [`previewAndApplyCanonRipple(novel, termEng, newRus)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/canon-glossary-vault.ts): Каскадное обновление термина по всем 6 падежам во всех главах.
- [`runPipelineBatchOnNovel(options)`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/pipeline-run-engine.ts): Пакетный 5-фазный движок перевода с контролем таймаутов и скользящим окном.
- [`loadNovelsFromStorage()`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/storage-idb.ts) / [`saveNovelsToStorage()`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/lib/storage-idb.ts): Персистентность проектов в IndexedDB с защитой от гонки гидратации.

## Invariants
- **Source Firewall**: В промпт `Pass 3 (Blind Literary Stylist)` запрещено передавать текст оригинала $x_s$ в любом виде.
- **Инварианты $G_{surf}$**: Любой абзац `#pK`, в котором стилист потерял числа, уронил канонический термин глоссария, нарушил баланс кавычек/скобок или изменил длину более чем на $\pm 45\%$, автоматически откатывается к выверенному тексту $y'[\text{\#pK}]$.
- **Чистый TypeScript**: В рантайме браузера и Node.js запрещены тяжёлые бинарные зависимости (Python/PyTorch); все лингвистические парсеры и детерминированные линтеры выполняются локально на JS/TS.
- **Детерминированность склонений**: Заморозка слогов CJK-имён на гласные (`Хань Ли` — несклоняемый) и склонение замыкающих слогов на согласные (`Чжао Фэн` $\to$ `Чжао Фэна`).

## Side Effects
- Вызовы внешних API языковых моделей (Google Gemini API или Colab L4 Ollama HTTP эндпоинт).
- Запись снапшотов версий и обновлённых глав в IndexedDB (`xianxia_pipeline_studio_v3`).

## Verification
- Run: `node --test lib/qa-linter.test.ts` (55 unit & integration тестов)
- Run: `npx tsc --noEmit`
