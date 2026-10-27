import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runQaLinter,
  autoRepairRussianText,
  buildRulateExportPackages,
  mergeSplitChapters,
  getDefaultRulesForGenre,
  filterGlossaryForChapter,
  generateChapterMemorySummary,
  parseBulkChaptersInput,
  alignChapterParagraphs,
  detectTautologies,
  computeWordDiff,
  previewAndApplyCanonRipple,
  surgicalRepairDriftedParagraphs,
  updateHeroStateLedgerFromChapter,
  batchLookaheadScoutChapters,
  computeChapterPipelineProgress,
  runAdditionBySubtractionScout,
  buildDelTAContextPacket,
  extractCsiCulturalNotes,
  evaluateDitingQuality,
  SlidingWindowPriorityQueue,
  buildEpub3Archive,
  COLAB_L4_MODEL_CATALOG,
  normalizeColabEndpointUrl,
  extractResilientJsonFromLlm,
  generateColabL4LaunchScript,
  XIANXIA_ANTI_CALQUE_DICTIONARY,
  AI_SLOP_PHRASES,
  repairPunctuationArtifacts,
  sanitizeRawChapterText,
  parseEpubArchiveToChapters,
  applySurgicalPatches,
  buildChaptersZipArchive,
  finalizeAndVerifyChapter,
  extractFlawedParagraphsPayload,
  mergeRepairedParagraphsByIndex,
  createPipelineLlmPort,
  FallbackChainAdapter,
  DeterministicCanonAdapter,
  AntigravityCliAdapter,
  parseAgyStreamJsonOutput,
  AGY_CLI_MODEL_CATALOG,
  buildTranslatePass1Prompts,
  buildSurgicalCriticPass2Prompts,
  buildSelfRepairPrompts,
  buildInflectedRussianForms,
  computeChapterGlossaryCoverage,
  approveScoutedTermInVault,
  autoApprovePendingTermsInVault,
  upsertCanonTermInVault,
  removeCanonTermFromVault,
  applyCanonRippleToNovel,
  autoMergeSplitChaptersInNovel,
  prepareGlossaryStopGateTerms,
  runPipelineBatchOnNovel,
  InMemoryPipelineTransportAdapter,
  InMemoryProjectStorageAdapter,
  serializeProjectBundle,
  deserializeProjectBundle,
  splitCompoundRussianTerm,
  lintGlossaryVault,
  buildSocialRegisterPromptBlock,
  computeParagraphHashAnchor,
  annotateSceneDialogueAndZeroPronouns,
  detectTranslationDegenerationAndDuplicates,
  evaluateLorebookStateMachine,
  sampleChaptersStratifiedMonteCarlo,
  parseRubyAndGikunMarkup,
  normalizeKoreanOneLineParagraphs,
  chunkChapterWithSceneAndDialogueLocks,
  deriveDefaultSpeechVector,
  buildCharacterVoicePromptBlock,
  classifyScenePacingMode,
  selectContrastiveFewShotTriplets,
  capStylisticDirectivesPerParagraph,
  buildBlindStylistPass3Prompts,
  verifyAndRollbackStylistPass,
  type StylisticSpanDirective,
  type SocialRegisterEdge,
  type LorebookEntry,
  type ProjectRepository,
  type LlmInferencePort,
  type CanonicalGlossary,
  type GlossaryTermMeta,
  type CanonVaultState,
  type ScoutedTerm,
} from './qa-linter.ts';
import type { NovelProject } from './seed-data.ts';

const sampleGlossary: CanonicalGlossary = {
  realms: {
    'Qi Refining': 'Очищение Ци',
    'Foundation Establishment': 'Учреждение Основы',
  },
  characters: {
    'Lin Xuan': 'Линь Сюань',
    'Su Qingxue': 'Су Цинсюэ',
  },
  sects_and_places: {
    'Stone Demon Sect': 'Секта Каменных Демонов',
  },
  system_and_terms: {
    'Spirit Stone': 'духовный камень',
  },
  units: {
    jin: 'цзинь',
    liang: 'лян',
  },
};

const sampleMeta: Record<string, GlossaryTermMeta> = {
  'Lin Xuan': { gender: 'M', declensionNote: 'склоняется (Линь Сюаня)' },
  'Su Qingxue': { gender: 'F', declensionNote: 'не склоняется, женский род' },
};

test('QA Linter detects all Xianxia style violations and missing numbers', () => {
  const eng =
    'Lin Xuan used 21 Spirit Stones at the 6th layer of Qi Refining to forge a Tier 1 Low Grade sword weighing 50 jin with an 80% success rate in the Stone Demon Sect.';
  const flawedRus = [
    '- Привет: — сказал Линь Сюань, не удержался от вопроса и втянул глоток холодного воздуха.',
    'Он потратил двадцать один духовный камень на шестом слое Очищения Ци.',
    'Получился духовный артефакт 1-го ранга низшего ранга весом 50 фунтов с шансом восемьдесят процентов.',
    'В Секте Каменного Демона все любили варить пилюли и думали "это чудо".',
  ].join('\n');

  const report = runQaLinter(eng, flawedRus, sampleGlossary);
  assert.equal(report.passed, false);
  assert.ok(report.errorCount >= 7, `Expected >= 7 errors, got ${report.errorCount}`);

  const ruleIds = new Set(report.issues.map((i) => i.ruleId));
  assert.ok(ruleIds.has('DIALOGUE_DASH'));
  assert.ok(ruleIds.has('MACHINE_CALQUES'));
  assert.ok(ruleIds.has('WRITTEN_NUMERALS'));
  assert.ok(ruleIds.has('WRITTEN_PERCENTS'));
  assert.ok(ruleIds.has('WEIGHT_UNITS'));
  assert.ok(ruleIds.has('ALCHEMY_CALQUES'));
  assert.ok(ruleIds.has('SECT_SINGULAR'));
  assert.ok(ruleIds.has('THOUGHT_QUOTES'));
});

test('Auto-Repair loop resolves all style violations to 100% pass (0 errors, 0 warnings)', () => {
  const eng = [
    'Lin Xuan talked to his master.',
    'He used 21 Spirit Stones at the 6th layer of Qi Refining.',
    'He forged a Tier 1 Low Grade artifact weighing 50 jin with an 80% success rate.',
    'Everyone in the Stone Demon Sect marveled.',
  ].join('\n');
  const flawedRus = [
    '- Привет: — сказал Линь Сюань, не удержался от вопроса и втянул глоток холодного воздуха.',
    'Он потратил двадцать один духовный камень на шестом слое Очищения Ци.',
    'Получился духовный артефакт 1-го яруса, точнее 1-го ранга низшего ранга весом 50 фунтов с шансом восемьдесят процентов.',
    'В Секте Каменных Демона все любили варить пилюли и думали "это чудо".',
  ].join('\n');

  const { repairedText, appliedFixes } = autoRepairRussianText(flawedRus);
  assert.ok(appliedFixes.length >= 8);

  const reportAfter = runQaLinter(eng, repairedText, sampleGlossary);
  assert.equal(
    reportAfter.errorCount,
    0,
    `Expected 0 errors after repair, but got: ${JSON.stringify(reportAfter.issues)}`
  );
  assert.equal(reportAfter.warningCount, 0);
  assert.equal(reportAfter.passed, true);
  assert.equal(reportAfter.score, 100);
});

test('Character gender control detects and repairs female character with masculine verbs (Су Цинсюэ посмотрел ... и улыбнулся)', () => {
  const eng = 'Su Qingxue looked at Lin Xuan and smiled.';
  const flawedRus = 'Су Цинсюэ посмотрел на Линь Сюаня и улыбнулся.';

  const report = runQaLinter(eng, flawedRus, sampleGlossary, {
    glossaryMeta: sampleMeta,
  });
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((i) => i.ruleId === 'CHARACTER_GENDER_MISMATCH'));

  const { repairedText } = autoRepairRussianText(flawedRus, {
    glossary: sampleGlossary,
    glossaryMeta: sampleMeta,
  });
  assert.ok(repairedText.includes('Су Цинсюэ посмотрела на Линь Сюаня и улыбнулась.'));

  const reportAfter = runQaLinter(eng, repairedText, sampleGlossary, {
    glossaryMeta: sampleMeta,
  });
  assert.equal(reportAfter.passed, true);
});

test('Configurable genre presets disable Xianxia weight rules for Dark Fantasy / LitRPG', () => {
  const eng = 'The warrior carried a sword weighing 15 pounds.';
  const rus = 'Воин нёс меч весом 15 фунтов.';

  const darkFantasyRules = getDefaultRulesForGenre('dark_fantasy');
  const report = runQaLinter(eng, rus, sampleGlossary, {
    enabledRuleIds: darkFantasyRules,
  });
  assert.equal(report.passed, true, 'Dark fantasy should not penalize "фунтов"');
});

test('Bulk chapter parser splits multi-chapter text and extracts numbers accurately', () => {
  const bulk = parseBulkChaptersInput([
    {
      content: `Chapter 8: The Hidden Array\nLin Xuan found 10 Spirit Stones.\nChapter 9: Core Formation Trial\nElder Zhao arrived at dawn.`,
    },
  ]);

  assert.equal(bulk.length, 2);
  assert.equal(bulk[0].number, 8);
  assert.equal(bulk[1].number, 9);
  assert.ok(bulk[0].engText.includes('10 Spirit Stones'));
});

test('filterGlossaryForChapter slices only terms occurring in chapter text and generateChapterMemorySummary produces concise context', () => {
  const { filteredGlossary, matchedCount } = filterGlossaryForChapter(
    'Lin Xuan refined Qi Refining pills.',
    sampleGlossary
  );
  assert.equal(matchedCount, 2);
  assert.equal(filteredGlossary.characters['Lin Xuan'], 'Линь Сюань');
  assert.equal(filteredGlossary.characters['Su Qingxue'], undefined);

  const summary = generateChapterMemorySummary(
    1,
    'Глава 1. Пробуждение',
    'Линь Сюань пробудил древнюю систему в пещере.\nОн поднял свой талант до 1-го яруса.'
  );
  assert.ok(summary.includes('В Главе 1'));
  assert.ok(summary.includes('Итог главы:'));
});

test('1:1 Paragraph Alignment and Tautology Radar detect structural drift and word repetitions', () => {
  const eng = 'Line one with 10 stones.\nLine two.\nLine three.';
  const rus = 'Первая строка с 10 камнями.';
  const alignment = alignChapterParagraphs(eng, rus);
  assert.equal(alignment.hasDrift, true);
  assert.equal(alignment.engCount, 3);
  assert.equal(alignment.rusCount, 1);

  const tautologyRus =
    'Линь Сюань мгновенно шагнул вперёд, мгновенно обнажил клинок и мгновенно нанёс удар.';
  const tautologies = detectTautologies(tautologyRus);
  assert.equal(tautologies.length, 1);
  assert.equal(tautologies[0].count, 3);
  assert.ok(tautologies[0].synonymHint.includes('миг'));
});

test('Retroactive Canon Ripple replaces old glossary term across chapters and computeWordDiff highlights changes', () => {
  const chapters = [
    {
      id: 'c1',
      number: 1,
      titleRus: 'Глава 1. Канон Теневого Шага',
      rusText: 'Он изучил Канон Теневого Шага в полночь.',
    },
    {
      id: 'c2',
      number: 2,
      titleRus: 'Глава 2. Битва',
      rusText: 'Благодаря технике Канон Теневого Шага он победил.',
    },
  ];

  const { changes, totalOccurrences } = previewAndApplyCanonRipple(
    chapters,
    'Канон Теневого Шага',
    'Писание Призрачной Поступи'
  );
  assert.equal(changes.length, 2);
  assert.equal(totalOccurrences, 3);
  assert.ok(changes[0].updatedRusText.includes('Писание Призрачной Поступи'));

  const diff = computeWordDiff('Он варил пилюли', 'Он создавал пилюли');
  assert.ok(diff.some((d) => d.type === 'removed' && d.text === 'варил'));
  assert.ok(diff.some((d) => d.type === 'added' && d.text === 'создавал'));
});

test('Rulate export strictly uses Unix LF (no CR bytes) and 2-param header format', () => {
  const packages = buildRulateExportPackages(
    'I Can Upgrade My Talent Infinitely',
    [
      {
        number: 1,
        titleRus: 'Глава 1. Пробуждение бесконечного таланта\r\n',
        contentRus: '— Наконец-то! — воскликнул Линь Сюань.\r\n---\r\n[Талант повышен на 100%]',
      },
      {
        number: 2,
        titleRus: 'Глава 2. Духовный павильон',
        contentRus: 'Он достал 15 духовных камней.',
      },
    ],
    20
  );

  assert.equal(packages.length, 1);
  const pkg = packages[0];
  assert.equal(pkg.hasCrLf, false);
  assert.equal(pkg.content.includes('\r'), false);
  assert.ok(
    pkg.content.startsWith('# [Глава 1. Пробуждение бесконечного таланта :|: 1]\n\n')
  );
  assert.ok(pkg.underTenMbLimit);
});

test('mergeSplitChapters combines half-chapters cleanly with separator', () => {
  const merged = mergeSplitChapters(
    { title: 'Chapter 4.1: Trials of the Outer Sect (Part 1)', engText: 'First half.', rusText: 'Первая половина.' },
    { title: 'Chapter 4.2: Trials of the Outer Sect (Part 2)', engText: 'Second half.', rusText: 'Вторая половина.' },
    4
  );

  assert.equal(merged.number, 4);
  assert.ok(merged.engText.includes('First half.\n\n---\n\nSecond half.'));
  assert.ok(merged.rusText.includes('Первая половина.\n\n---\n\nВторая половина.'));
});

test('Glossary canon check handles Russian fleeting vowels (духовных камней) and avoids substring false-positives on short units (li, jin)', () => {
  const eng = 'Lin Xuan sat in the Stone Demon Sect with 3 Spirit Stones and 15 Spirit Stones.';
  const rus = 'Линь Сюань сидел в Секте Каменных Демонов с 3 духовными камнями и 15 духовных камней.';
  const report = runQaLinter(eng, rus, sampleGlossary);
  assert.equal(report.passed, true, `Expected 0 issues, got: ${JSON.stringify(report.issues)}`);
  assert.equal(report.errorCount, 0);
});

test('Zero-Leakage Latin & Bracket Gatekeeper and Auto-Synonym De-Tautologizer repair text automatically', () => {
  const dirtyRus =
    'Линь Сюань мгновенно активировал Tier 1 артефакт в Stone Demon Sect, мгновенно шагнул вперёд и мгновенно увидел [Очки Истока: 100';
  const { repairedText, appliedFixes } = autoRepairRussianText(dirtyRus, {
    glossary: sampleGlossary,
  });

  assert.equal(repairedText.includes('Tier 1'), false);
  assert.equal(repairedText.includes('Stone Demon Sect'), false);
  assert.ok(repairedText.endsWith('[Очки Истока: 100]'));
  assert.ok(repairedText.includes('в тот же миг'));
  assert.ok(appliedFixes.length >= 3);
});

test('surgicalRepairDriftedParagraphs repairs only flawed paragraphs and updateHeroStateLedgerFromChapter tracks cultivation & resources', () => {
  const eng = 'Lin Xuan reached the 6th layer of Qi Refining with 45 Spirit Stones.\n\n---\n\n[Origin Points: 250]';
  const rus = 'Линь Сюань достиг шестом слое Очищения Ци и потратил двадцать один камень.\n\n[Очки Истока: 250';

  const surgical = surgicalRepairDriftedParagraphs(eng, rus, sampleGlossary);
  assert.ok(surgical.surgicallyFixedIndices.length >= 1);
  assert.ok(surgical.repairedRusText.includes('6-м слое'));
  assert.ok(surgical.repairedRusText.includes('21'));
  assert.ok(surgical.repairedRusText.includes('---'));
  assert.ok(surgical.repairedRusText.includes('[Очки Истока: 250]'));

  const ledger = updateHeroStateLedgerFromChapter(undefined, 6, eng, surgical.repairedRusText, sampleGlossary);
  assert.equal(ledger.cultivationRealm, '6-й слой Очищения Ци');
  assert.ok(ledger.resources.some((r) => r.includes('250')));
});

test('batchLookaheadScoutChapters discovers and auto-promotes cross-chapter terms with >=95% confidence', () => {
  const chapters = [
    {
      number: 8,
      titleEng: 'Chapter 8',
      engText: 'Lin Xuan refined a Foundation Establishment Pill inside the Inner Sect.',
    },
    {
      number: 9,
      titleEng: 'Chapter 9',
      engText: 'Entering the Inner Sect with another Foundation Establishment Pill.',
    },
  ];
  const res = batchLookaheadScoutChapters(chapters, sampleGlossary, []);
  assert.ok(res.autoPromotedCount >= 2);
  assert.ok(res.discoveredTerms.every((t) => t.confidence >= 0.95 && t.approved_for_glossary));
});

test('computeChapterPipelineProgress calculates linear progress across all 5 pipeline stages', () => {
  const idle = computeChapterPipelineProgress(
    { scouted: false, translated: false, edited: false, verified: false },
    null
  );
  assert.equal(idle.percent, 0);
  assert.equal(idle.completedSteps, 0);
  assert.equal(idle.state, 'idle');

  const scouted = computeChapterPipelineProgress(
    { scouted: true, translated: false, edited: false, verified: false },
    null
  );
  assert.equal(scouted.percent, 20);
  assert.equal(scouted.completedSteps, 1);
  assert.equal(scouted.state, 'scouted');

  const needsQa = computeChapterPipelineProgress(
    { scouted: true, translated: true, edited: true, verified: false },
    { passed: false, errorCount: 3, warningCount: 1 }
  );
  assert.equal(needsQa.percent, 75);
  assert.equal(needsQa.state, 'qa_attention');

  const verified = computeChapterPipelineProgress(
    { scouted: true, translated: true, edited: true, verified: true },
    { passed: true, errorCount: 0, warningCount: 0 }
  );
  assert.equal(verified.percent, 100);
  assert.equal(verified.completedSteps, 5);
  assert.equal(verified.state, 'verified');

  const running = computeChapterPipelineProgress(
    { scouted: true, translated: false, edited: false, verified: false },
    null,
    3,
    true
  );
  assert.equal(running.percent, 60);
  assert.equal(running.completedSteps, 3);
  assert.equal(running.state, 'running');
});

test('Module 1: runAdditionBySubtractionScout subtracts noise while keeping canonical domain terms', () => {
  const eng =
    'Suddenly, Inside the Inner Sect, Elder Zhao gave a Foundation Establishment Pill to the Young Master.';
  const report = runAdditionBySubtractionScout(eng, 4, sampleGlossary, []);
  assert.ok(report.addedRecallCount >= report.finalCount);
  assert.ok(report.subtractedNoiseCount >= 1);
  // Ensure common sentence-initial adverbs like "Suddenly" or "Inside" are subtracted
  assert.equal(
    report.finalTerms.some((t) => t.eng.toLowerCase() === 'suddenly'),
    false
  );
  assert.ok(
    report.finalTerms.some((t) => t.eng === 'Foundation Establishment Pill')
  );
});

test('Module 2: buildDelTAContextPacket builds 4-level memory with last 3 ENG-RUS paragraphs and bilingual summary', () => {
  const prevChapter = {
    number: 1,
    titleEng: 'Chapter 1: Awakening',
    titleRus: 'Глава 1. Пробуждение',
    engText: 'Para 1 Lin Xuan.\n\nPara 2 Spirit Stone.\n\nPara 3 Qi Refining.\n\nPara 4 Breakthrough.',
    rusText: 'Абзац 1 Линь Сюань.\n\nАбзац 2 духовный камень.\n\nАбзац 3 Очищение Ци.\n\nАбзац 4 Прорыв.',
  };
  const packet = buildDelTAContextPacket(
    'Lin Xuan used a Spirit Stone in Qi Refining.',
    prevChapter,
    [prevChapter],
    sampleGlossary,
    3
  );
  assert.equal(packet.shortTermWindow.length, 3);
  assert.equal(packet.shortTermWindow[0].index, 1);
  assert.ok(packet.bilingualSummary.eng.includes('Ch.1'));
  assert.ok(packet.bilingualSummary.rus.includes('Глава 1'));
  assert.ok(packet.properNounCount >= 2);
});

test('Module 3: extractCsiCulturalNotes and evaluateDitingQuality score 6 dimensions and detect CHORUS C3 idioms', () => {
  const eng =
    'Senior Brother Chen held a 50 jin spear as his dantian glowed with 10 Spirit Stones.';
  const rus =
    'Старший брат Чэнь сжимал копьё весом 50 цзинь, пока его даньтянь сиял с 10 духовными камнями.';
  const notes = extractCsiCulturalNotes(eng, rus, sampleGlossary);
  assert.ok(notes.length >= 2);
  assert.ok(notes.some((n) => n.sourcePhrase.toLowerCase().includes('dantian')));

  const diting = evaluateDitingQuality(eng, rus, sampleGlossary);
  assert.ok(diting.overallScore >= 85);
  assert.ok(diting.idiomAccuracy >= 90);
});

test('Module 4: SlidingWindowPriorityQueue executes high-priority tasks first and tracks sliding window telemetry', async () => {
  const queue = new SlidingWindowPriorityQueue({
    concurrency: 1,
    maxRequestsPerWindow: 10,
    windowDurationMs: 60000,
  });
  const executionOrder: string[] = [];

  const p1 = queue.add(
    async () => {
      await new Promise((r) => setTimeout(r, 15));
      executionOrder.push('first-running');
      return 1;
    },
    { priority: 1 }
  );
  const pLow = queue.add(
    async () => {
      executionOrder.push('low-priority');
      return 2;
    },
    { priority: 1 }
  );
  const pHigh = queue.add(
    async () => {
      executionOrder.push('high-priority-repair');
      return 3;
    },
    { priority: 3 }
  );

  await Promise.all([p1, pLow, pHigh]);
  assert.deepEqual(executionOrder, [
    'first-running',
    'high-priority-repair',
    'low-priority',
  ]);
  const telemetry = queue.getTelemetry();
  assert.equal(telemetry.requestsInCurrentWindow, 3);
});

test('Module 5: buildEpub3Archive compiles valid EPUB 3 ZIP binary with uncompressed mimetype and OEBPS manifest', () => {
  const epub = buildEpub3Archive({
    novelTitle: 'Хроники Каменного Демона',
    author: 'Lin Xuan',
    chapters: [
      {
        number: 1,
        titleRus: 'Глава 1. Пробуждение Системы',
        contentRus: '[Система: Очки Истока +100]\n\nЛинь Сюань открыл глаза.',
      },
    ],
  });
  assert.ok(epub.filename.endsWith('.epub'));
  assert.ok(epub.byteSize > 500);
  // Check ZIP local file header magic bytes PK\x03\x04
  assert.equal(epub.bytes[0], 0x50);
  assert.equal(epub.bytes[1], 0x4b);
  assert.equal(epub.bytes[2], 0x03);
  assert.equal(epub.bytes[3], 0x04);
  // Verify "mimetype" is the first entry in the archive
  const asciiHeader = new TextDecoder().decode(epub.bytes.slice(30, 38));
  assert.equal(asciiHeader, 'mimetype');
});

test('Module 6: Colab L4 endpoint normalization, resilient JSON extraction (with <think> tags), and launch script generation', () => {
  assert.ok(COLAB_L4_MODEL_CATALOG.length >= 5);
  assert.equal(
    normalizeColabEndpointUrl('  https://abc-123.trycloudflare.com/v1/chat/completions/ '),
    'https://abc-123.trycloudflare.com'
  );
  assert.equal(
    normalizeColabEndpointUrl('my-tunnel.trycloudflare.com/api/chat'),
    'https://my-tunnel.trycloudflare.com'
  );

  const rawWithThinkAndFence = `<think>
Размышляю над переводом главы Сянься...
</think>
\`\`\`json
{
  "titleRus": "Глава 5. Канон Теневого Шага",
  "rusText": "Линь Сюань шагнул в туман.",
  "summary": "Линь Сюань изучает технику."
}
\`\`\``;
  const parsed = extractResilientJsonFromLlm(rawWithThinkAndFence, {
    titleRus: '',
    rusText: '',
    summary: '',
  });
  assert.equal(parsed.titleRus, 'Глава 5. Канон Теневого Шага');
  assert.equal(parsed.rusText, 'Линь Сюань шагнул в туман.');

  const script = generateColabL4LaunchScript('gemma4:31b', 'gemma4:26b-a4b');
  assert.ok(script.includes('OLLAMA_KV_CACHE_TYPE'));
  assert.ok(script.includes('ollama pull gemma4:31b'));
  assert.ok(script.includes('ollama pull gemma4:26b-a4b'));
});

test('Module 7a: sanitizeRawChapterText strips TL Notes, Patreon/Discord links, Rulate watermarks, and HTML while preserving System boxes', () => {
  const dirtyRaw = `<p>Lin Xuan opened his eyes.</p>
<p>[System: Talent +100%]</p>
---
TL Note: This technique comes from Daoist lore.
Editor's Note: Join our discord.gg/xianxia for early chapters!
Support us on https://patreon.com/translator
Прочитано на Rulate.ru — перевод выполнен с сайта webnovel.com
====================
<p>He took out 15 Spirit Stones &amp; smiled.</p>`;

  const res = sanitizeRawChapterText(dirtyRaw);
  assert.equal(res.removedLinesCount, 5);
  assert.ok(res.cleanedText.includes('Lin Xuan opened his eyes.'));
  assert.ok(res.cleanedText.includes('[System: Talent +100%]'));
  assert.ok(res.cleanedText.includes('---'));
  assert.ok(res.cleanedText.includes('He took out 15 Spirit Stones & smiled.'));
  assert.equal(res.cleanedText.includes('TL Note'), false);
  assert.equal(res.cleanedText.includes('patreon.com'), false);
  assert.equal(res.cleanedText.includes('Rulate.ru'), false);
});

test('Module 7b: parseEpubArchiveToChapters unpacks EPUB 3 binary archive into clean chapters with metadata', () => {
  const epub = buildEpub3Archive({
    novelTitle: 'Chronicles of the Stone Demon',
    titleEng: 'Chronicles of the Stone Demon',
    author: 'Azure Peak',
    chapters: [
      {
        number: 1,
        titleRus: 'Chapter 1: Awakening of the Cauldron',
        contentRus: 'Lin Xuan refined 3 Spirit Stones inside the Stone Demon Sect.\n\n[Origin Points: 100]',
      },
      {
        number: 2,
        titleRus: 'Chapter 2: Entering the Crimson Pavilion',
        contentRus: 'Elder Zhao inspected the 1st Tier pill with solemn eyes.',
      },
    ],
  });

  const unpacked = parseEpubArchiveToChapters(epub.bytes);
  assert.equal(unpacked.author, 'Azure Peak');
  assert.equal(unpacked.chapters.length, 2);
  assert.equal(unpacked.chapters[0].number, 1);
  assert.equal(unpacked.chapters[0].titleEng, 'Chapter 1: Awakening of the Cauldron');
  assert.ok(unpacked.chapters[0].engText.includes('Lin Xuan refined 3 Spirit Stones'));
  assert.ok(unpacked.chapters[1].engText.includes('Elder Zhao inspected'));
});

test('Module 7c: applySurgicalPatches (Perevod_Ready refine.py port) applies reverse-offset patches and blocks ambiguous or number-dropping edits', () => {
  const draftRus =
    'Линь Сюань подумал в своём сердце, что 15 духовных камней хватит. Он горько улыбнулся. Тень мелькнула. Тень мелькнула.';

  const patchResult = applySurgicalPatches(draftRus, [
    {
      find: 'подумал в своём сердце',
      replace: 'подумал про себя',
      reason: 'Устранение кальки',
      kind: 'calque',
    },
    {
      find: 'горько улыбнулся',
      replace: 'криво усмехнулся',
      reason: 'Живой оборот',
      kind: 'style',
    },
    {
      find: 'Тень мелькнула.',
      replace: 'Силуэт скользнул.',
      reason: 'Проверка защиты от неоднозначного совпадения без флага all',
      all: false,
    },
    {
      find: '15 духовных камней',
      replace: 'несколько духовных камней',
      reason: 'Попытка удалить число 15 должна быть заблокирована',
    },
  ]);

  assert.equal(patchResult.appliedCount, 2);
  assert.equal(patchResult.skippedCount, 2);
  assert.ok(patchResult.patchedText.includes('подумал про себя'));
  assert.ok(patchResult.patchedText.includes('криво усмехнулся'));
  assert.ok(patchResult.patchedText.includes('15 духовных камней'));
  assert.ok(patchResult.skippedLog.some((s) => s.status === 'ambiguous_match'));
  assert.ok(patchResult.skippedLog.some((s) => s.status === 'unsafe_number_drop'));
});

test('Module 7d: XIANXIA_ANTI_CALQUE_DICTIONARY, AI_SLOP_PHRASES, repairPunctuationArtifacts, and buildChaptersZipArchive', () => {
  assert.ok(XIANXIA_ANTI_CALQUE_DICTIONARY.length >= 20);
  assert.ok(AI_SLOP_PHRASES.length >= 12);

  const calqueSample =
    'Стоит отметить, что Линь Сюань подумал в своём сердце., и выплюнул полный рот крови!. —, Ты ищешь смерти!';
  const repaired = autoRepairRussianText(calqueSample, {
    customCalqueBlacklist: { 'проклятый старик': 'старый хрыч' },
  });
  assert.ok(repaired.repairedText.includes('подумал про себя.'));
  assert.ok(repaired.repairedText.includes('сплюнул сгусток крови!'));
  assert.ok(repaired.repairedText.includes('Ты нарываешься на смерть'));
  assert.equal(repaired.repairedText.includes('.,'), false);
  assert.equal(repaired.repairedText.includes('!.'), false);

  const zipPkg = buildChaptersZipArchive(
    'Stone Demon',
    [
      { number: 1, titleRus: 'Глава 1. Начало', contentRus: 'Текст первой главы.' },
      { number: 2, titleRus: 'Глава 2. Прорыв', contentRus: 'Текст второй главы.' },
    ],
    'txt'
  );
  assert.ok(zipPkg.filename.endsWith('_TXT.zip'));
  assert.equal(zipPkg.chapterCount, 2);
  assert.deepEqual(zipPkg.fileList, ['Chapter_0001.txt', 'Chapter_0002.txt']);
  assert.equal(zipPkg.bytes[0], 0x50);
  assert.equal(zipPkg.bytes[1], 0x4b);
});

test('Stage 1: finalizeAndVerifyChapter and paragraph-scoped self repair extract & merge', () => {
  const engText = 'Lin Xuan arrived at the Stone Demon Sect with 10 Spirit Stones.\n\nHe thought in his heart that this was dangerous.\n\n---';
  const rawRusText = 'Линь Сюань прибыл в Секту Каменных Демонов с 10 духовными камнями.\n\nОн подумал в своём сердце, что это опасно.\n\n---';

  const patches = [
    {
      find: 'Он подумал в своём сердце, что это опасно.',
      replace: 'Он подумал про себя, что это опасно.',
      reason: 'Устранение кальки',
      kind: 'calque' as const,
    },
  ];

  const result = finalizeAndVerifyChapter({
    chapterNumber: 1,
    titleEng: 'Chapter 1: The Sect',
    engText,
    candidateRusText: rawRusText,
    glossary: sampleGlossary,
    surgicalPatches: patches,
  });

  assert.ok(result.rusText.includes('подумал про себя'));
  assert.equal(result.rusText.includes('подумал в своём сердце'), false);
  assert.equal(result.flawedParagraphIndices.length, 0);
  assert.equal(result.wordCountEng > 0, true);
  assert.equal(result.wordCountRus > 0, true);
  assert.ok(result.ditingReport.overallScore >= 80);

  // Test extractFlawedParagraphsPayload
  const eng3 = 'Paragraph 1 with 100 points.\n\nParagraph 2 with 200 points.\n\nParagraph 3.';
  const rus3 = 'Абзац 1 с 100 очками.\n\nАбзац 2 без числа очков.\n\nАбзац 3.';
  const payload = extractFlawedParagraphsPayload(eng3, rus3, sampleGlossary);
  assert.equal(payload.flawedCount, 1);
  assert.equal(payload.flawedIndices[0], 1);
  assert.ok(payload.promptBlock.includes('[#p1]'));
  assert.ok(payload.promptBlock.includes('MISSING_NUMBERS: 200'));

  // Test mergeRepairedParagraphsByIndex
  const repairedLlmResponse = '[#p1]\nRUS: Абзац 2 с 200 очками.';
  const merged = mergeRepairedParagraphsByIndex(rus3, repairedLlmResponse);
  assert.equal(merged.repairedIndices.length, 1);
  assert.equal(merged.repairedIndices[0], 1);
  assert.ok(merged.mergedText.includes('Абзац 2 с 200 очками.'));
  assert.ok(merged.mergedText.includes('Абзац 1 с 100 очками.'));
  assert.ok(merged.mergedText.includes('Абзац 3.'));

  // Test number dropping safety in mergeRepairedParagraphsByIndex
  const badLlmResponse = '[#p0]\nRUS: Абзац 1 без числа.';
  const safeMerged = mergeRepairedParagraphsByIndex(rus3, badLlmResponse);
  assert.equal(safeMerged.repairedIndices.length, 0);
  assert.equal(safeMerged.droppedDueToNumbers.length, 1);
  assert.ok(safeMerged.mergedText.includes('100 очками'));

  // Test echoed LLM prompt preamble (ENG / RUS) and trailing notes stripping
  const echoedLlmResponse = '[#p1]\nENG: Paragraph 2 with 200 points.\nRUS: Абзац 2 с 200 очками.\nQA_ERRORS: WRITTEN_NUMERALS: Missing number';
  const cleanMerged = mergeRepairedParagraphsByIndex(rus3, echoedLlmResponse);
  assert.equal(cleanMerged.repairedIndices.length, 1);
  assert.equal(cleanMerged.mergedText.includes('ENG:'), false);
  assert.equal(cleanMerged.mergedText.includes('QA_ERRORS:'), false);
  assert.ok(cleanMerged.mergedText.includes('Абзац 2 с 200 очками.'));
});

test('Stage 2: LlmInferencePort FallbackChainAdapter and prompt constructors', async () => {
  // Test mock adapter that fails
  const failingAdapter: LlmInferencePort = {
    async complete() {
      throw new Error('Server timeout 504');
    },
  };

  // Test deterministic adapter that succeeds
  const canonAdapter = new DeterministicCanonAdapter({ glossary: sampleGlossary, tone: 'classic' });

  const chain = new FallbackChainAdapter([failingAdapter, canonAdapter]);

  const response = await chain.complete({
    task: 'translate_pass1',
    systemInstruction: 'Translate to Russian',
    userPrompt: '[SOURCE CHAPTER 5: "Chapter 5"]\nUnder the moon on Myriad Beasts Mountain Lin Xuan spent 120 Origin Points',
    expectJson: true,
  });

  assert.equal(response.provider, 'deterministic');
  assert.ok(response.text.includes('Глава 5'));
  assert.ok(response.text.includes('Очков Истока'));

  // Test prompt builders
  const pass1Prompts = buildTranslatePass1Prompts({
    chapterNumber: 5,
    titleEng: 'The Trial',
    engText: 'He walked forward.',
    genreTitle: 'Сянься',
    genrePromptHint: 'Chinese Xianxia',
    toneTitle: 'Классический',
    toneInstruction: 'Литературный слог',
    styleGuideMd: 'Правило 1',
    filteredGlossary: sampleGlossary,
    matchedCount: 2,
    genderRulesList: ['Lin Xuan -> Линь Сюань (Род: M)'],
  });

  assert.ok(pass1Prompts.userPrompt.includes('[SOURCE CHAPTER 5: "The Trial"]'));
  assert.ok(pass1Prompts.systemPrompt.includes('LCD-MAS'));

  const criticPrompts = buildSurgicalCriticPass2Prompts({
    engText: 'He walked.',
    draftRusText: 'Он шагнул.',
    filteredGlossary: sampleGlossary,
    genderRulesList: [],
  });

  assert.ok(criticPrompts.systemPrompt.includes('Surgical Patching'));
  assert.ok(criticPrompts.userPrompt.includes('[DRAFT RUS (PASS 1)]'));

  // Test createPipelineLlmPort with environment fallback
  process.env.COLAB_OLLAMA_URL = 'http://localhost:11434';
  const portWithEnv = createPipelineLlmPort(
    { provider: 'colab_ollama', modelId: 'custom-model' },
    sampleGlossary,
    'classic'
  ) as FallbackChainAdapter;
  assert.ok(portWithEnv instanceof FallbackChainAdapter);
  assert.ok(portWithEnv.adapters.length >= 2);
  delete process.env.COLAB_OLLAMA_URL;
});

test('Stage 3: Morphological Canon Ripple across oblique cases and pure vault mutations', () => {
  // 1. Inflected forms generator
  const originForms = buildInflectedRussianForms('Очки Истока');
  const genPl = originForms.find((f) => f.caseLabel === 'gen_pl');
  assert.ok(genPl);
  assert.equal(genPl.form, 'Очков Истока');

  const sectForms = buildInflectedRussianForms('Секта Каменного Демона');
  const preSg = sectForms.find((f) => f.caseLabel === 'pre_sg');
  assert.ok(preSg);
  assert.equal(preSg.form, 'Секте Каменного Демона');

  // 2. Morphological Canon Ripple across chapters in oblique cases
  const chapters = [
    {
      id: 'ch-1',
      number: 1,
      titleRus: 'Глава 1: В Секте Каменного Демона',
      rusText: 'Линь Сюань потратил 100 Очков Истока, медитируя в Секте Каменного Демона.',
    },
    {
      id: 'ch-2',
      number: 2,
      titleRus: 'Глава 2: Награда',
      rusText: 'У него не осталось Очков Истока для прорыва.',
    },
  ];

  // Ripple 1: "Очки Истока" -> "Очки Изначальности" (plural genitive: Очков Истока -> Очков Изначальности)
  const res1 = previewAndApplyCanonRipple(chapters, 'Очки Истока', 'Очки Изначальности');
  assert.equal(res1.totalOccurrences, 2);
  assert.equal(res1.changes.length, 2);
  assert.ok(res1.changes[0].updatedRusText.includes('100 Очков Изначальности'));
  assert.ok(res1.changes[1].updatedRusText.includes('Очков Изначальности'));

  // Ripple 2: "Секта Каменного Демона" -> "Секта Каменных Демонов" (prepositional: в Секте Каменного Демона -> в Секте Каменных Демонов)
  const res2 = previewAndApplyCanonRipple(
    chapters.map((c, i) => ({ ...c, rusText: res1.changes[i]?.updatedRusText || c.rusText })),
    'Секта Каменного Демона',
    'Секта Каменных Демонов'
  );
  assert.equal(res2.totalOccurrences, 2); // title + body in ch-1
  assert.ok(res2.changes[0].updatedTitleRus.includes('В Секте Каменных Демонов'));
  assert.ok(res2.changes[0].updatedRusText.includes('в Секте Каменных Демонов'));

  // Ripple 3: Adjective + Noun plural genitive (духовных камней -> духовных кристаллов)
  const res3 = previewAndApplyCanonRipple(
    [{ id: 'ch-stones', number: 3, titleRus: 'Глава 3', rusText: 'У него был запас из 90 духовных камней.' }],
    'духовный камень',
    'духовный кристалл'
  );
  assert.equal(res3.totalOccurrences, 1);
  assert.ok(res3.changes[0].updatedRusText.includes('90 духовных кристаллов.'));

  // Ripple 4: Feminine noun in -я with genitive plural (Пилюль Конденсации Крови -> Пилюль Очищения Крови)
  const res4 = previewAndApplyCanonRipple(
    [{ id: 'ch-pills', number: 4, titleRus: 'Глава 4', rusText: 'Я создам партию Пилюль Конденсации Крови.' }],
    'Пилюля Конденсации Крови',
    'Пилюля Очищения Крови'
  );
  assert.equal(res4.totalOccurrences, 1);
  assert.ok(res4.changes[0].updatedRusText.includes('партию Пилюль Очищения Крови.'));

  // Ripple 5: Lowercase casing preservation (очков истока -> очков изначальности)
  const res5 = previewAndApplyCanonRipple(
    [{ id: 'ch-lower', number: 5, titleRus: 'Глава 5', rusText: 'Он потратил 100 очков истока на навык.' }],
    'Очки Истока',
    'Очки Изначальности'
  );
  assert.equal(res5.totalOccurrences, 1);
  assert.ok(res5.changes[0].updatedRusText.includes('100 очков изначальности на навык.'));

  // 3. Pure Vault State Mutations
  let vault: CanonVaultState = {
    glossary: {
      realms: { 'Foundation Establishment': 'Заложение Основ' },
      characters: { 'Lin Xuan': 'Линь Сюань' },
      sects_and_places: { 'Stone Demon Sect': 'Секта Каменного Демона' },
      system_and_terms: { 'Origin Points': 'Очки Истока' },
      units: {},
    },
    glossaryMeta: {
      'Lin Xuan': { gender: 'M' as const },
    },
    scoutedTerms: [
      {
        id: 'scout-1',
        eng: 'Blood Condensation Pill',
        rus_suggested: 'Пилюля Конденсации Крови',
        category: 'system_and_terms' as const,
        gender: 'F' as const,
        chapter_first_seen: 1,
        context_snippet: 'He took a Blood Condensation Pill',
        approved_for_glossary: false,
        confidence: 0.98,
      },
      {
        id: 'scout-2',
        eng: 'Low Conf Term',
        rus_suggested: 'Термин',
        category: 'system_and_terms' as const,
        gender: 'M' as const,
        chapter_first_seen: 1,
        context_snippet: 'Low Conf Term in snippet',
        approved_for_glossary: false,
        confidence: 0.6,
      },
    ],
  };

  // Auto-approve pending with confidence >= 0.95
  const autoApproveRes = autoApprovePendingTermsInVault(vault, 0.95);
  assert.equal(autoApproveRes.approvedCount, 1);
  assert.equal(
    autoApproveRes.updatedVault.glossary.system_and_terms['Blood Condensation Pill'],
    'Пилюля Конденсации Крови'
  );
  assert.equal(
    autoApproveRes.updatedVault.glossaryMeta['Blood Condensation Pill']?.gender,
    'F'
  );

  // Upsert canon term
  vault = upsertCanonTermInVault(autoApproveRes.updatedVault, 'realms', 'Core Formation', 'Формирование Ядра');
  assert.equal(vault.glossary.realms['Core Formation'], 'Формирование Ядра');

  // Remove canon term
  vault = removeCanonTermFromVault(vault, 'realms', 'Core Formation');
  assert.equal(vault.glossary.realms['Core Formation'], undefined);

  // Apply Canon Ripple to entire novel object
  const dummyNovel = {
    id: 'novel-1',
    chapters,
    glossary: vault.glossary,
    glossaryMeta: vault.glossaryMeta,
    scoutedTerms: vault.scoutedTerms,
  };
  const { updatedNovel, rippleReport } = applyCanonRippleToNovel(dummyNovel, 'Очки Истока', 'Очки Изначальности');
  assert.equal(rippleReport.totalOccurrences, 2);
  assert.equal(updatedNovel.glossary.system_and_terms['Origin Points'], 'Очки Изначальности');
  assert.ok(updatedNovel.chapters[0].rusText.includes('100 Очков Изначальности'));

  // 4. Terminology coverage computation
  const coverage = computeChapterGlossaryCoverage(
    {
      engText: 'Lin Xuan used Foundation Establishment and gained Origin Points',
      rusText: 'Линь Сюань использовал Заложение Основ и получил Очки Изначальности',
      translated: true,
    },
    updatedNovel.glossary,
    updatedNovel.scoutedTerms || []
  );
  assert.ok(coverage.totalDetectedTerms > 0);
  assert.ok(coverage.glossaryCoveragePct >= 50);
});

test('Stage 4: PipelineRunEngine 5-phase batch orchestrator, autoMergeSplitChapters, and stop-gate terms', async () => {
  // 1. autoMergeSplitChaptersInNovel
  const novelWithSplits: NovelProject = {
    id: 'test-novel',
    name: 'Test Novel',
    rusTitle: 'Тестовая новелла',
    author: 'Author',
    sourceLang: 'ENG',
    genrePreset: 'xianxia',
    proseTone: 'classic',
    autoApproveThreshold: 0.92,
    enabledRuleIds: ['LATIN_LEAKAGE_AND_BRACKETS'],
    styleGuideMd: '',
    contextMd: '',
    glossary: sampleGlossary,
    glossaryMeta: {},
    scoutedTerms: [],
    chapters: [
      {
        id: 'ch-1',
        number: 1,
        titleEng: 'Chapter 1',
        titleRus: 'Глава 1',
        engText: 'Lin Xuan walked to the sect.',
        rusText: 'Линь Сюань подошёл к секте.',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 6,
        wordCountRus: 5,
        lastUpdated: '2026-10-25 12:00',
      },
      {
        id: 'ch-7-1',
        number: 7,
        subPart: '7.1',
        titleEng: 'Chapter 7 Part 1',
        titleRus: 'Глава 7.1',
        engText: 'Part 1 of the battle began.',
        rusText: 'Часть 1 битвы началась.',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 6,
        wordCountRus: 4,
        lastUpdated: '2026-10-25 12:00',
      },
      {
        id: 'ch-7-2',
        number: 7,
        subPart: '7.2',
        titleEng: 'Chapter 7 Part 2',
        titleRus: 'Глава 7.2',
        engText: 'Part 2 of the battle concluded.',
        rusText: 'Часть 2 битвы завершилась.',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 6,
        wordCountRus: 4,
        lastUpdated: '2026-10-25 12:00',
      },
    ],
  };

  const mergeResult = autoMergeSplitChaptersInNovel(novelWithSplits);
  assert.equal(mergeResult.mergedCount, 1);
  assert.equal(mergeResult.updatedNovel.chapters.length, 2);
  const ch7 = mergeResult.updatedNovel.chapters.find((c) => c.number === 7);
  assert.ok(ch7);
  assert.ok(ch7.engText.includes('Part 1 of the battle began.'));
  assert.ok(ch7.engText.includes('Part 2 of the battle concluded.'));
  assert.ok(ch7.rusText.includes('Часть 1 битвы началась.'));
  assert.ok(ch7.rusText.includes('Часть 2 битвы завершилась.'));

  // 2. prepareGlossaryStopGateTerms
  const novelForStopGate: NovelProject = {
    ...novelWithSplits,
    chapters: [
      {
        id: 'ch-2',
        number: 2,
        titleEng: 'The Pill',
        titleRus: '',
        engText: 'He obtained a Foundation Establishment Pill and saw Blood Condensation Pill in the Crimson Flame Pavilion.',
        rusText: '',
        scouted: false,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: 16,
        wordCountRus: 0,
        lastUpdated: '2026-10-25 12:00',
      },
    ],
  };

  const stopGateTerms = prepareGlossaryStopGateTerms(novelForStopGate, 2, 2);
  assert.ok(stopGateTerms.length >= 1);
  const foundPill = stopGateTerms.find((t) => t.eng.includes('Foundation Establishment Pill'));
  assert.ok(foundPill);
  assert.equal(foundPill.approved_for_glossary, true);

  // 3. runPipelineBatchOnNovel with InMemoryPipelineTransportAdapter
  const progressEvents: string[] = [];
  const inMemoryTransport = new InMemoryPipelineTransportAdapter();

  const novelToTranslate: NovelProject = {
    id: 'novel-batch',
    name: 'Batch Novel',
    rusTitle: 'Пакетная новелла',
    author: 'Author',
    sourceLang: 'ENG',
    genrePreset: 'xianxia',
    proseTone: 'classic',
    autoApproveThreshold: 0.9,
    enabledRuleIds: ['LATIN_LEAKAGE_AND_BRACKETS', 'GLOSSARY_CANON_VIOLATION'],
    styleGuideMd: '',
    contextMd: '',
    glossary: sampleGlossary,
    glossaryMeta: {
      'Lin Xuan': { gender: 'M' },
    },
    heroLedger: {
      protagonistName: 'Линь Сюань',
      cultivationRealm: '5-й слой Очищения Ци',
      resources: ['Очки Истока: 50'],
      artifactsAndFlames: [],
      activeLocation: 'Секта Каменных Демонов',
      lastUpdatedChapter: 9,
    },
    scoutedTerms: [],
    chapters: [
      {
        id: 'ch-10',
        number: 10,
        titleEng: 'Chapter 10: Breakthrough',
        titleRus: '',
        engText: 'Lin Xuan absorbed 100 Origin Points and stepped into Foundation Establishment. Under the moon, Stone Demon Sect trembled.',
        rusText: '',
        scouted: false,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: 19,
        wordCountRus: 0,
        lastUpdated: '2026-10-25 12:00',
      },
    ],
  };

  const batchResult = await runPipelineBatchOnNovel({
    novel: novelToTranslate,
    startChapter: 10,
    endChapter: 10,
    mode: 'full_5_phase',
    autoCanonEnabled: true,
    twoPassCriticEnabled: true,
    transport: inMemoryTransport,
    onProgress: (event) => {
      progressEvents.push(event.type);
    },
  });

  assert.equal(batchResult.processedChaptersCount, 1);
  assert.ok(progressEvents.includes('start'));
  assert.ok(progressEvents.includes('chapter_start'));
  assert.ok(progressEvents.includes('phase_step'));
  assert.ok(progressEvents.includes('chapter_complete'));
  assert.ok(progressEvents.includes('batch_complete'));

  const translatedCh = batchResult.updatedNovel.chapters[0];
  assert.ok(translatedCh.rusText.length > 0);
  assert.ok(translatedCh.rusText.includes('Линь Сюань'));
  assert.ok(translatedCh.rusText.includes('Очков Истока') || translatedCh.rusText.includes('Очки Истока'));
  assert.ok(translatedCh.summary);
  assert.ok(translatedCh.versionHistory && translatedCh.versionHistory.length > 0);
  assert.equal(translatedCh.scouted, true);
  assert.equal(translatedCh.translated, true);

  // 4. Test runPipelineBatchOnNovel abort controller behavior
  let abortedCalled = false;
  let ch1Finished = false;
  const abortEvents: string[] = [];

  const novelWith2Chapters: NovelProject = {
    ...novelToTranslate,
    chapters: [
      {
        id: 'ch-a1',
        number: 1,
        titleEng: 'Chapter 1',
        titleRus: '',
        engText: 'Lin Xuan reached Qi Refining 1.',
        rusText: '',
        scouted: false,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: 6,
        wordCountRus: 0,
        lastUpdated: '2026-10-25 12:00',
      },
      {
        id: 'ch-a2',
        number: 2,
        titleEng: 'Chapter 2',
        titleRus: '',
        engText: 'Lin Xuan reached Qi Refining 2.',
        rusText: '',
        scouted: false,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: 6,
        wordCountRus: 0,
        lastUpdated: '2026-10-25 12:00',
      },
    ],
  };

  const abortResult = await runPipelineBatchOnNovel({
    novel: novelWith2Chapters,
    mode: 'full_5_phase',
    transport: inMemoryTransport,
    shouldAbort: () => ch1Finished,
    onProgress: (event) => {
      abortEvents.push(event.type);
      if (event.type === 'chapter_complete' && event.chapterId === 'ch-a1') {
        ch1Finished = true;
      }
      if (event.type === 'aborted') {
        abortedCalled = true;
      }
    },
  });

  assert.equal(abortResult.processedChaptersCount, 1);
  assert.equal(abortedCalled, true);
  assert.ok(abortEvents.includes('aborted'));
  // Chapter 1 was verified and preserved
  assert.equal(abortResult.updatedNovel.chapters[0].translated, true);
  // Chapter 2 was NOT processed
  assert.equal(abortResult.updatedNovel.chapters[1].translated, false);
});

test('Stage 5: ProjectRepository hydration guard and unified project bundle serialization', async () => {
  const sampleProject: NovelProject = {
    id: 'repo-novel-1',
    name: 'Immortal Ascent',
    rusTitle: 'Восхождение Бессмертного',
    author: 'Author',
    sourceLang: 'ENG',
    genrePreset: 'xianxia',
    proseTone: 'classic',
    autoApproveThreshold: 0.92,
    enabledRuleIds: ['LATIN_LEAKAGE_AND_BRACKETS'],
    styleGuideMd: '',
    contextMd: '',
    glossary: sampleGlossary,
    glossaryMeta: {},
    scoutedTerms: [],
    chapters: [],
  };

  // 1. Hydration Guard prevents premature overwrite on mount
  const repo = new InMemoryProjectStorageAdapter([sampleProject], false);
  assert.equal(repo.isHydrated(), false);

  const prematureSaveResult = await repo.saveNovels([]);
  assert.equal(prematureSaveResult, 'skipped_unhydrated');
  assert.equal(repo.novels.length, 1);

  // Load hydrates repository
  const loadResult = await repo.loadNovels([]);
  assert.equal(loadResult.engine, 'in_memory');
  assert.equal(loadResult.novels.length, 1);
  assert.equal(repo.isHydrated(), true);

  // Subsequent saves succeed
  const updatedProject: NovelProject = {
    ...sampleProject,
    name: 'Immortal Ascent: Updated',
  };
  const validSaveResult = await repo.saveNovels([updatedProject]);
  assert.equal(validSaveResult, 'in_memory');
  assert.equal(repo.novels[0].name, 'Immortal Ascent: Updated');

  // 2. serializeProjectBundle & deserializeProjectBundle (v4.1 Colab format)
  const v4BundleStr = serializeProjectBundle({
    novel: updatedProject,
    llmConfig: {
      provider: 'colab_ollama',
      colabEndpointUrl: 'https://test-colab.ngrok-free.app',
      modelId: 'qwen2.5:14b',
    },
    format: 'v4.1',
  });
  assert.ok(v4BundleStr.includes('4.1-colab-drive-bundle'));

  const parsedV4 = deserializeProjectBundle(v4BundleStr);
  assert.equal(parsedV4.version, '4.1-colab-drive-bundle');
  assert.equal(parsedV4.activeProject?.id, 'repo-novel-1');
  assert.equal(parsedV4.llmConfig?.provider, 'colab_ollama');
  assert.equal(parsedV4.llmConfig?.modelId, 'qwen2.5:14b');

  // 3. serializeProjectBundle & deserializeProjectBundle (v2.5 IDB Backup format)
  const v2BundleStr = serializeProjectBundle({
    novels: [updatedProject],
    format: 'v2.5',
  });
  assert.ok(v2BundleStr.includes('2.5-idb'));

  const parsedV2 = deserializeProjectBundle(v2BundleStr);
  assert.equal(parsedV2.version, '2.5-idb');
  assert.equal(parsedV2.novels.length, 1);
  assert.equal(parsedV2.novels[0].id, 'repo-novel-1');

  // 4. Raw array and single-novel compatibility
  const rawArrayParsed = deserializeProjectBundle([updatedProject]);
  assert.equal(rawArrayParsed.novels.length, 1);

  const rawSingleParsed = deserializeProjectBundle(updatedProject);
  assert.equal(rawSingleParsed.activeProject?.id, 'repo-novel-1');
});

test('Wave 2: 4-Layer KV-Prefix Pinning and draft_pK Speculative Suffix Decoding', () => {
  const p1 = buildTranslatePass1Prompts({
    chapterNumber: 42,
    titleEng: 'Ascent to the Peak',
    engText: 'Lin Xuan stood on the peak.\nThe wind was strong.',
    genreTitle: 'Сянься',
    genrePromptHint: 'Chinese Xianxia',
    toneTitle: 'Классический',
    toneInstruction: 'Традиционный слог',
    styleGuideMd: '# Style Guide\nStrict rule: 1:1 facts.',
    filteredGlossary: sampleGlossary,
    matchedCount: 2,
    genderRulesList: ['Lin Xuan -> Линь Сюань (Род: M)'],
    heroLedger: {
      protagonistName: 'Линь Сюань',
      cultivationRealm: '7-й слой Очищения Ци',
      resources: ['Очки Истока: 500'],
      artifactsAndFlames: ['Пламя Лазурного Лотоса'],
      activeLocation: 'Пик Лазурных Облаков',
      lastUpdatedChapter: 41,
    },
    previousChapterSummary: 'Линь Сюань одолел противника.',
    previousChapterSummaryEng: 'Lin Xuan defeated his opponent.',
    lorebookBlock: '- [Lore: Blood Demon]: Ancient enemy.',
    socialEdgesBlock: '[DIRECTED SOCIAL REGISTER GRAPH]\nLin Xuan -> Elder Zhao (Вы)',
    forwardQuestionsBlock: 'Q1 (Ch.10): Where is the secret pagoda? [Status: open]',
    sceneDialogueBlock: '[SCENE DIALOGUE & REGISTER MAP]\n#p0: Lin Xuan speaking',
    useHashAnchors: true,
  });

  // Verify 4-layer structure
  assert.ok(p1.userPrompt.includes('[LAYER 0: IMMUTABLE BOOK CORE & STYLE GUIDE]'));
  assert.ok(p1.userPrompt.includes('[LAYER 1: ARC STATE LEDGER & CANON REGISTERS]'));
  assert.ok(p1.userPrompt.includes('[LAYER 2: CHAPTER STATE & VOCABULARY]'));
  assert.ok(p1.userPrompt.includes('[LAYER 3: VOLATILE TAIL & SOURCE CHAPTER]'));

  // Verify Layer 0 has NO chapter number or title (for prefix-cache hit across all 1000 chapters)
  const layer0End = p1.userPrompt.indexOf('[LAYER 1:');
  const layer0Text = p1.userPrompt.slice(0, layer0End);
  assert.equal(layer0Text.includes('Chapter 42'), false);
  assert.equal(layer0Text.includes('Ascent to the Peak'), false);

  // Verify Layer 1 contains ledger, lorebook, and social registers
  assert.ok(p1.userPrompt.includes('7-й слой Очищения Ци'));
  assert.ok(p1.userPrompt.includes('Ancient enemy'));
  assert.ok(p1.userPrompt.includes('Lin Xuan -> Elder Zhao (Вы)'));

  // Verify Layer 2 contains forward questions, dialogue map, and glossary
  assert.ok(p1.userPrompt.includes('Where is the secret pagoda?'));
  assert.ok(p1.userPrompt.includes('Lin Xuan speaking'));

  // Verify Layer 3 contains hash anchors [hash|#pK]
  assert.ok(/\[[a-z0-9]{3}\|#p0\]\s*Lin Xuan stood/i.test(p1.userPrompt));

  // Test speculative suffix decoding prompt
  const repairPrompt = buildSelfRepairPrompts({
    engText: 'He walked.',
    rusText: 'Он шел.',
    glossary: sampleGlossary,
    linterIssues: [],
    genreTitle: 'Сянься',
    toneTitle: 'Классический',
    flawedPromptBlock: '[#p0] [a7f|#p0]\nENG: He walked.\nRUS: Он шел.\n[DRAFT_PASS1_FOR_SUFFIX_LOOKUP]: Он шел.',
  });
  assert.ok(repairPrompt.userPrompt.includes('[SPECULATIVE SUFFIX DECODING RULE]'));
  assert.ok(repairPrompt.userPrompt.includes('[DRAFT_PASS1_FOR_SUFFIX_LOOKUP]'));
});

test('Wave 2: CompoundTermInflector on multi-word titles and East-Asian Anthroponym Declension', () => {
  // 1. Compound term decomposition
  const split = splitCompoundRussianTerm('«Пилюля Девяти Превращений Лазурного Дракона»');
  assert.equal(split.hasQuotes, true);
  assert.equal(split.headNoun, 'Пилюля');
  assert.equal(split.tail, 'Девяти Превращений Лазурного Дракона');

  // 2. Inflection preserves tail frozen across oblique cases
  const forms = buildInflectedRussianForms('«Пилюля Девяти Превращений Лазурного Дракона»');
  const formsByCase = new Map(forms.map((f) => [f.caseLabel, f.form]));
  assert.equal(
    formsByCase.get('gen_sg'),
    '«Пилюли Девяти Превращений Лазурного Дракона»'
  );
  assert.equal(
    formsByCase.get('dat_sg'),
    '«Пилюле Девяти Превращений Лазурного Дракона»'
  );
  assert.equal(
    formsByCase.get('ins_sg'),
    '«Пилюлей Девяти Превращений Лазурного Дракона»'
  );

  // 3. East-Asian Anthroponyms:
  // Feminine name ending in consonant/ь/vowel (Су Цинсюэ) -> strictly non-declinable
  const femForms = buildInflectedRussianForms('Су Цинсюэ');
  const femUnique = new Set(femForms.map((f) => f.form));
  assert.equal(femUnique.size, 1);
  assert.ok(femUnique.has('Су Цинсюэ'));

  // Masculine Chinese name (Линь Сюань) -> inflects ONLY the final syllable
  const mascForms = buildInflectedRussianForms('Линь Сюань');
  const mascByCase = new Map(mascForms.map((f) => [f.caseLabel, f.form]));
  assert.equal(mascByCase.get('nom_sg'), 'Линь Сюань');
  assert.equal(mascByCase.get('gen_sg'), 'Линь Сюаня');
  assert.equal(mascByCase.get('dat_sg'), 'Линь Сюаню');
  assert.equal(mascByCase.get('ins_sg'), 'Линь Сюанем');
  assert.equal(mascByCase.get('pre_sg'), 'Линь Сюане');
});

test('Wave 2: Structural Glossary Vault Linter detects 4 canon defects', () => {
  const defectiveGlossary: CanonicalGlossary = {
    realms: {
      'Foundation': 'Заложение Основ',
      'Base': 'Заложение Основ', // alias collision
      'Pill': 'Пилюля', // substring shadowing of 'Пилюля Заложения Основ'
    },
    characters: {
      'Elder Zhao': 'Старейшина Чжао', // title attached
      'Lin': 'Линь', // homonym surname
    },
    sects_and_places: {},
    system_and_terms: {
      'Foundation Pill': 'Пилюля Заложения Основ',
    },
    units: {},
  };

  const issues = lintGlossaryVault(defectiveGlossary);
  const issueTypes = new Set(issues.map((i) => i.type));

  assert.ok(issueTypes.has('alias_collision'));
  assert.ok(issueTypes.has('title_attached'));
  assert.ok(issueTypes.has('homonym_surname'));
  assert.ok(issueTypes.has('substring_shadowing'));
});

test('Wave 2: Mechanical Gate in applySurgicalPatches blocks unsafe erasure and tag imbalance', () => {
  const text = 'Линь Сюань принял [Пилюля Заложения Основ] и посмотрел на небо.';

  const testGlossary: CanonicalGlossary = {
    ...sampleGlossary,
    system_and_terms: {
      ...sampleGlossary.system_and_terms,
      'Foundation Establishment Pill': 'Пилюля Заложения Основ',
    },
  };

  // 1. Unsafe glossary erasure: replacing canon term with non-canon term
  const badCanonPatch = [
    {
      find: 'Пилюля Заложения Основ',
      replace: 'волшебная таблетка фундамента',
      reason: 'стиль',
    },
  ];
  const res1 = applySurgicalPatches(text, badCanonPatch, testGlossary);
  assert.equal(res1.appliedCount, 0);
  assert.equal(res1.skippedLog[0].status, 'unsafe_glossary_erasure');

  // 2. Unsafe tag imbalance: introduces broken square brackets
  const badTagPatch = [
    {
      find: '[Пилюля Заложения Основ]',
      replace: '[Пилюля Заложения Основ', // missing closing bracket
      reason: 'опечатка',
    },
  ];
  const res2 = applySurgicalPatches(text, badTagPatch, testGlossary);
  assert.equal(res2.appliedCount, 0);
  assert.equal(res2.skippedLog[0].status, 'unsafe_tag_imbalance');

  // 3. Legitimate patch: gets classified and records provenance
  const goodPatch = [
    {
      find: 'посмотрел на небо',
      replace: 'взглянул в небеса',
      reason: 'литературная полировка',
    },
  ];
  const res3 = applySurgicalPatches(text, goodPatch, testGlossary);
  assert.equal(res3.appliedCount, 1);
  assert.equal(res3.appliedLog[0].patchClass, 'C_calque_or_slop');
  assert.ok(res3.appliedLog[0].provenance);
  assert.ok(res3.patchedText.includes('взглянул в небеса'));
});

test('Wave 2: 3-character Base-36 Hash Anchors and Paragraph Drift Protection', () => {
  const engPara0 = 'Lin Xuan stepped into the pavilion.';
  const engPara1 = 'He gathered 150 spirit stones.';

  // Hash anchor computation
  const hash0 = computeParagraphHashAnchor(engPara0, 0);
  const hash1 = computeParagraphHashAnchor(engPara1, 1);
  assert.equal(typeof hash0, 'string');
  assert.equal(hash0.length, 3);
  assert.ok(/^[a-z0-9]{3}$/.test(hash0));
  assert.notEqual(hash0, hash1); // different paragraphs have different hashes

  // Extract payload includes hash anchors
  const engText = `${engPara0}\n\n${engPara1}`;
  const rusText = 'Линь Сюань вошёл в павильон.\n\nОн собрал камни.'; // missing 150
  const payload = extractFlawedParagraphsPayload(engText, rusText, sampleGlossary);
  assert.equal(payload.flawedCount, 1);
  assert.ok(payload.promptBlock.includes(`[${hash1}|#p1]`));

  // Merge with matching hash anchor succeeds
  const repairedMatch = `[${hash1}|#p1]\nRUS: Он собрал 150 духовных камней.`;
  const mergedOk = mergeRepairedParagraphsByIndex(rusText, repairedMatch, engText);
  assert.equal(mergedOk.repairedIndices.length, 1);
  assert.equal(mergedOk.droppedDueToHashDrift.length, 0);
  assert.ok(mergedOk.mergedText.includes('150 духовных камней'));

  // Merge with drifted hash anchor (hash mismatch) is safely rejected
  const driftedRepair = `[xyz|#p1]\nRUS: Он собрал 150 духовных камней.`;
  const mergedDrift = mergeRepairedParagraphsByIndex(rusText, driftedRepair, engText);
  assert.equal(mergedDrift.repairedIndices.length, 0);
  assert.equal(mergedDrift.droppedDueToHashDrift.length, 1);
  assert.equal(mergedDrift.droppedDueToHashDrift[0], 1);
});

test('Wave 2: Pass 0 Scene Dialogue & Zero-Pronoun Annotation and Register Shift Linter', () => {
  const engDialogue = `"Where are my 50 spirit stones?" shouted Senior Brother Chen.\n"They belong to the sect," Lin Xuan replied coldly.\nTurning around, walked away into the mist.`;

  const edges: SocialRegisterEdge[] = [
    {
      fromCharacter: 'Lin Xuan',
      toCharacter: 'Senior Brother Chen',
      valence: -0.5,
      coarseRole: 'peer',
      fineRole: 'соперник',
      pronounMode: 'ты',
      updatedAtChapter: 5,
    },
  ];

  const analysis = annotateSceneDialogueAndZeroPronouns(
    engDialogue,
    sampleGlossary,
    { 'Lin Xuan': { gender: 'M' } },
    edges
  );

  assert.ok(analysis.annotations.length >= 2);
  assert.ok(analysis.promptSummaryBlock.includes('Lin Xuan'));
  assert.ok(analysis.promptSummaryBlock.includes('Senior Brother Chen'));

  // Check REGISTER_PRONOUN_SHIFT lint rule
  const badPronounShift =
    '— Ты должен мне камни! — крикнул старший брат Чэнь.\n— Вы не имеете права их требовать, — ответил Линь Сюань.\n— Но ты же обещал!';
  const lintRes = runQaLinter(engDialogue, badPronounShift, sampleGlossary, {
    enabledRuleIds: ['REGISTER_PRONOUN_SHIFT'],
  });
  assert.ok(lintRes.issues.some((i) => i.ruleId === 'REGISTER_PRONOUN_SHIFT'));
});

test('Wave 2: DASH_AND_COMMA_INFLATION and SYNTAX_MONOTONY_AND_BURSTINESS', () => {
  // Dash and comma inflation
  const inflatedRus =
    'Линь Сюань — великий воин — шагнул вперед — сжимая меч — готовый к битве — и замер.';
  const lintDash = runQaLinter('He stepped forward.', inflatedRus, sampleGlossary, {
    enabledRuleIds: ['DASH_AND_COMMA_INFLATION'],
  });
  assert.ok(lintDash.issues.some((i) => i.ruleId === 'DASH_AND_COMMA_INFLATION'));

  // Auto-repair relaxes dash inflation
  const autoFixed = autoRepairRussianText(inflatedRus, {
    enabledRuleIds: ['DASH_AND_COMMA_INFLATION'],
  });
  const emDashCount = (autoFixed.repairedText.match(/—/g) || []).length;
  assert.ok(emDashCount < 4);

  // Syntax monotony (consecutive equal short sentences with zero burstiness)
  const monotonousRus =
    'Он встал прямо. Меч был остёр. Ветер выл тихо. Враг стоял там. День был холодным. Ночь была близка.';
  const lintMonotony = runQaLinter('English text.', monotonousRus, sampleGlossary, {
    enabledRuleIds: ['SYNTAX_MONOTONY_AND_BURSTINESS'],
  });
  assert.ok(lintMonotony.issues.some((i) => i.ruleId === 'SYNTAX_MONOTONY_AND_BURSTINESS'));
});

test('Wave 2: AI Hunter Degeneration Detection and LitRPG Brackets Immunity', () => {
  // 1. Loop degeneration (>15 repeats)
  const loopRus = 'Он взмахнул мечом. '.repeat(20);
  const degen1 = detectTranslationDegenerationAndDuplicates('He waved his sword.', loopRus);
  assert.equal(degen1.hasFatalDegeneration, true);
  assert.ok(degen1.issues.some((i) => i.type === 'cyclical_loop'));

  // 2. Adjacent paragraph duplicate
  const dupRus =
    'Линь Сюань вошёл в древний зал Павильона Багрового Пламени с мечом.\n\nЛинь Сюань вошёл в древний зал Павильона Багрового Пламени с мечом.';
  const degen2 = detectTranslationDegenerationAndDuplicates('He walked in.\n\nHe walked in.', dupRus);
  assert.ok(degen2.issues.some((i) => i.type === 'adjacent_duplicate'));

  // 3. LitRPG bracket immunity: repeated system boxes must NOT be flagged as duplicate or degeneration!
  const litRpgRus =
    'Линь Сюань открыл панель характеристик.\n---\n[Здоровье: 100/100]\n[Мана: 50/50]\n---\nПосле боя параметры восстановились:\n---\n[Здоровье: 100/100]\n[Мана: 50/50]\n---';
  const degenLit = detectTranslationDegenerationAndDuplicates(
    'He opened stats.\n---\n[HP: 100/100]\n[MP: 50/50]\n---\nAfter fight:\n---\n[HP: 100/100]\n[MP: 50/50]\n---',
    litRpgRus
  );
  assert.equal(degenLit.hasFatalDegeneration, false);
});

test('Wave 2: Lorebook State Machine and Forward-Falling Questions Index', () => {
  const lorebook: LorebookEntry[] = [
    {
      id: 'ancient-dragon-pill',
      name: 'Древняя пилюля дракона',
      keys: ['Dragon Pill', 'Лазурный Дракон'],
      content: 'Редчайшая алхимическая пилюля 3-го яруса.',
      sticky: 1, // stays active for 1 chapter after trigger
      cooldown: 3,
      delay: 2, // dormant until chapter 2
      selectiveLogic: 'AND_ANY',
    },
  ];

  // Chapter 1: Delay prevents activation
  const ch1Res = evaluateLorebookStateMachine(lorebook, 1, 'Mentioning Dragon Pill');
  assert.equal(ch1Res.activeEntries.length, 0);

  // Chapter 2: Triggers successfully and becomes sticky
  const ch2Res = evaluateLorebookStateMachine(ch1Res.updatedEntries, 2, 'Here is the Dragon Pill');
  assert.equal(ch2Res.activeEntries.length, 1);
  assert.ok(ch2Res.stateBlock.includes('Редчайшая алхимическая пилюля'));

  // Chapter 3: Without mention, sticky keeps it active!
  const ch3Res = evaluateLorebookStateMachine(ch2Res.updatedEntries, 3, 'Just walking in the forest');
  assert.equal(ch3Res.activeEntries.length, 1);

  // Chapter 4: Sticky expires -> enters cooldown
  const ch4Res = evaluateLorebookStateMachine(ch3Res.updatedEntries, 4, 'Mentioning Dragon Pill again');
  assert.equal(ch4Res.activeEntries.length, 0); // blocked by cooldown

  // Forward-Falling Questions tracking in updateHeroStateLedgerFromChapter
  const ledger = updateHeroStateLedgerFromChapter(
    undefined,
    1,
    'Who poisoned the Sect Leader?',
    'Кто отравил Главу Секты?',
    sampleGlossary
  );
  assert.ok(ledger.forwardQuestions);
  assert.ok(ledger.forwardQuestions.length >= 1);
  assert.equal(ledger.forwardQuestions[0].status, 'open');
});

test('Wave 2: Stratified Monte Carlo Proofreading Sampler (Head, Peak, Tail)', () => {
  const mockChapters = Array.from({ length: 30 }, (_, i) => ({
    id: `ch-${i + 1}`,
    number: i + 1,
    titleEng: `Chapter ${i + 1}`,
    titleRus: `Глава ${i + 1}`,
    engText: `Sample English chapter text for chapter ${i + 1}. `.repeat(i === 15 ? 50 : 10),
    rusText: `Русский перевод главы ${i + 1}. `.repeat(i === 15 ? 50 : 10),
    scouted: true,
    translated: true,
    edited: true,
    verified: i !== 15, // chapter 16 has unverified status & high complexity
    wordCountEng: i === 15 ? 500 : 100,
    wordCountRus: i === 15 ? 500 : 100,
    lastUpdated: '2026-10-25 12:00',
  }));

  const sample = sampleChaptersStratifiedMonteCarlo(mockChapters, 6);
  assert.equal(sample.length, 6);

  const sampledNumbers = sample.map((c) => c.number);
  // Head stratum (chapters 1-3)
  assert.ok(sampledNumbers.some((n) => n <= 3));
  // Peak complexity stratum (chapter 16 with highest word count & unverified)
  assert.ok(sampledNumbers.includes(16));
  // Tail stratum (chapters 25-30)
  assert.ok(sampledNumbers.some((n) => n >= 25));
});

test('Wave 2 Deep Edge Case: East-Asian Anthroponym Syllable Freezing and Last-Syllable Declension', () => {
  // 1. Zhao Feng (surname Zhao in -o is frozen, Feng in -n inflects)
  const zfForms = buildInflectedRussianForms('Чжао Фэн');
  const zfMap = new Map(zfForms.map((f) => [f.caseLabel, f.form]));
  assert.equal(zfMap.get('nom_sg'), 'Чжао Фэн');
  assert.equal(zfMap.get('gen_sg'), 'Чжао Фэна');
  assert.equal(zfMap.get('dat_sg'), 'Чжао Фэну');
  assert.equal(zfMap.get('ins_sg'), 'Чжао Фэном');
  assert.equal(zfMap.get('pre_sg'), 'Чжао Фэне');

  // 2. Han Li (final syllable -и is frozen across all cases)
  const hlForms = buildInflectedRussianForms('Хань Ли');
  const hlMap = new Map(hlForms.map((f) => [f.caseLabel, f.form]));
  assert.equal(hlMap.get('nom_sg'), 'Хань Ли');
  assert.equal(hlMap.get('gen_sg'), 'Хань Ли');
  assert.equal(hlMap.get('dat_sg'), 'Хань Ли');
  assert.equal(hlMap.get('ins_sg'), 'Хань Ли');
  assert.equal(hlMap.get('pre_sg'), 'Хань Ли');

  // 3. Single foreign name ending in -и/-у/-э/-о is indeclinable (Luffy, Naruto)
  const luffyForms = buildInflectedRussianForms('Луффи', { isPersonName: true });
  assert.ok(luffyForms.every((f) => f.form === 'Луффи'));

  // 4. Single CJK name ending in soft sign declines properly
  const chenForms = buildInflectedRussianForms('Чэнь', { isPersonName: true, gender: 'M' });
  const chenMap = new Map(chenForms.map((f) => [f.caseLabel, f.form]));
  assert.equal(chenMap.get('gen_sg'), 'Чэня');
  assert.equal(chenMap.get('dat_sg'), 'Чэню');
  assert.equal(chenMap.get('ins_sg'), 'Чэнем');
});

test('Wave 2 Deep Edge Case: Compound Terms with Multiple Adjectives', () => {
  const canon = '«Высший Истинный Канон Багрового Пламени»';
  const forms = buildInflectedRussianForms(canon);
  const map = new Map(forms.map((f) => [f.caseLabel, f.form]));

  assert.equal(map.get('nom_sg'), '«Высший Истинный Канон Багрового Пламени»');
  assert.equal(map.get('gen_sg'), '«Высшего Истинного Канона Багрового Пламени»');
  assert.equal(map.get('dat_sg'), '«Высшему Истинному Канону Багрового Пламени»');
  assert.equal(map.get('ins_sg'), '«Высшим Истинным Каноном Багрового Пламени»');
  assert.equal(map.get('pre_sg'), '«Высшем Истинном Каноне Багрового Пламени»');
});

test('Wave 2 Deep Edge Case: Mechanical Gate Blocks Quoted Terms and Oblique Canon Erasure', () => {
  const customGlossary: CanonicalGlossary = {
    realms: {},
    characters: { Chen: 'Чэнь' },
    sects_and_places: {},
    system_and_terms: { 'Foundation Pill': '«Пилюля Заложения Основ»' },
    units: {},
  };

  // 1. Quoted term erasure attempt in running unquoted text
  const resQuoted = applySurgicalPatches(
    'Пилюля Заложения Основ раскололась на куски.',
    [{ find: 'Пилюля Заложения Основ раскололась', replace: 'Она раскололась' }],
    customGlossary
  );
  assert.equal(resQuoted.appliedCount, 0);
  assert.equal(resQuoted.skippedLog[0].status, 'unsafe_glossary_erasure');

  // 2. Oblique character name erasure attempt
  const resOblique = applySurgicalPatches(
    'Чэня казнили на площади перед сектой.',
    [{ find: 'Чэня казнили', replace: 'Его казнили' }],
    customGlossary
  );
  assert.equal(resOblique.appliedCount, 0);
  assert.equal(resOblique.skippedLog[0].status, 'unsafe_glossary_erasure');
});

test('Wave 2 Deep Edge Case: Hostile Dialogue Pronoun Auto-Repair with Cyrillic Lookaround', () => {
  const badHostile = '— Щенок, Вы должны немедленно умереть!';
  const autoFixed = autoRepairRussianText(badHostile, {
    enabledRuleIds: ['REGISTER_PRONOUN_SHIFT'],
  });
  assert.ok(autoFixed.appliedFixes.length > 0);
  assert.ok(autoFixed.repairedText.includes('ты'));
  assert.ok(!autoFixed.repairedText.includes('Вы'));
});

test('Wave 2 Deep Edge Case: Dual-Anchor Parsing in mergeRepairedParagraphsByIndex', () => {
  const eng = 'Lin Xuan stepped forward.\nHe looked into the distance.';
  const rus = 'Линь Сюань шагнул вперёд.\nОн посмотрел вдаль.';
  const hash0 = computeParagraphHashAnchor('Lin Xuan stepped forward.', 0);
  const dualEchoRepair = `[#p0] [${hash0}|#p0] Линь Сюань решительно шагнул вперёд.`;

  const merged = mergeRepairedParagraphsByIndex(rus, dualEchoRepair, eng);
  assert.equal(merged.repairedIndices.length, 1);
  assert.equal(merged.skippedIndices.length, 0);
  assert.ok(merged.mergedText.includes('Линь Сюань решительно шагнул вперёд.'));
  assert.ok(!merged.mergedText.includes('[#p0]'));
});

test('Wave 2 Deep Edge Case: Substring Shadowing with Word-Boundary Awareness and Russian Support', () => {
  const testGlossary: CanonicalGlossary = {
    realms: {},
    characters: {},
    sects_and_places: {},
    system_and_terms: {
      Dan: 'Дань',
      'Dangerous Beast': 'Опасный Зверь',
      'Qi Cleansing': 'Очищение Ци',
      'Qi Cleansing Pill': 'Пилюля Очищения Ци',
    },
    units: {},
  };

  const issues = lintGlossaryVault(testGlossary);
  // "Dan" inside "Dangerous Beast" should NOT trigger because "Dan" is not a whole word in "Dangerous"
  const danClash = issues.find((i) => i.term === 'Dan' && i.details.includes('Dangerous Beast'));
  assert.equal(danClash, undefined);

  // "Qi Cleansing" inside "Qi Cleansing Pill" SHOULD trigger substring shadowing
  const qiClash = issues.find((i) => i.type === 'substring_shadowing' && i.term === 'Qi Cleansing');
  assert.ok(qiClash);
});

test('AntigravityCliAdapter routes Pass 1 to gemini-3.8-flash-high and Pass 2 Critic to gemini-4-argon-medium', async () => {
  assert.ok(AGY_CLI_MODEL_CATALOG.some((m) => m.id === 'gemini-3.8-flash-high'));
  assert.ok(AGY_CLI_MODEL_CATALOG.some((m) => m.id === 'gemini-4-argon-medium'));

  const seenCalls: Array<{ model: string; task: string }> = [];
  const adapter = new AntigravityCliAdapter({
    primaryModelId: 'gemini-3.8-flash-high',
    criticModelId: 'gemini-4-argon-medium',
    scoutModelId: 'gemini-3.8-flash-low',
    customRunner: async ({ model, task }) => {
      seenCalls.push({ model, task });
      if (task === 'surgical_critic_pass2') {
        return JSON.stringify({ patches: [] });
      }
      return JSON.stringify({ titleRus: 'Глава 1', rusText: 'Линь Сюань улыбнулся.' });
    },
  });

  // 1. Pass 1 uses gemini-3.8-flash-high
  const pass1Res = await adapter.complete({
    task: 'translate_pass1',
    systemInstruction: 'System',
    userPrompt: 'Translate chapter 1',
  });
  assert.equal(pass1Res.provider, 'antigravity_cli');
  assert.equal(pass1Res.engineUsed, 'agy-cli: gemini-3.8-flash-high');

  // 2. Pass 2 Heavy Critic uses gemini-4-argon-medium
  const criticRes = await adapter.complete({
    task: 'surgical_critic_pass2',
    systemInstruction: 'Critic System',
    userPrompt: 'Review draft',
  });
  assert.equal(criticRes.engineUsed, 'agy-cli: gemini-4-argon-medium');

  // 3. Scout uses gemini-3.8-flash-low
  const scoutRes = await adapter.complete({
    task: 'scout',
    systemInstruction: 'Scout System',
    userPrompt: 'Extract terms',
  });
  assert.equal(scoutRes.engineUsed, 'agy-cli: gemini-3.8-flash-low');
  assert.equal(seenCalls.length, 3);

  // 4. Verify NDJSON stream-json parser
  const ndjsonSample = [
    JSON.stringify({ event: 'init', conversation_id: 'conv-1' }),
    JSON.stringify({
      event: 'step_update',
      step_update: { step_type: 'agent_response', text_delta: '{"patches":[]}\n' },
    }),
    JSON.stringify({
      event: 'result',
      result: { status: 'SUCCESS', response: '{"patches":[]}\n' },
    }),
  ].join('\n');
  assert.equal(parseAgyStreamJsonOutput(ndjsonSample), '{"patches":[]}');

  // 5. Verify createPipelineLlmPort wires AntigravityCliAdapter first when provider === 'antigravity_cli'
  const port = createPipelineLlmPort({
    provider: 'antigravity_cli',
    modelId: 'gemini-3.8-flash-high',
    criticModelId: 'gemini-4-argon-medium',
  }) as FallbackChainAdapter;
  assert.ok(port.adapters[0] instanceof AntigravityCliAdapter);
});

test('Wave 3: Step 0.1 parseRubyAndGikunMarkup parses all 6 categories (reading_aid, bouten, nomenclature, litrpg_term, deictic, subtext)', () => {
  // 1. Reading aid (pure phonetic Hiragana): stripped, returns clean base
  const resAid = parseRubyAndGikunMarkup('彼は｜漢字《かんじ》を読んだ。');
  assert.equal(resAid.foundCount, 1);
  assert.equal(resAid.items[0].category, 'reading_aid');
  assert.equal(resAid.parsedText, '彼は漢字を読んだ。');

  // 2. Bouten (dots or 《《...》》)
  const resBouten1 = parseRubyAndGikunMarkup('《《絶対に》》許さない！');
  assert.equal(resBouten1.items[0].category, 'bouten');
  assert.equal(resBouten1.parsedText, '<emph text="絶対に"/>許さない！');

  const resBouten2 = parseRubyAndGikunMarkup('決戦(・・・)の時が来た。');
  assert.equal(resBouten2.items[0].category, 'bouten');
  assert.equal(resBouten2.parsedText, '<emph text="決戦"/>の時が来た。');

  // 3. Nomenclature / Chuunibyou Gikun (Kanji + Katakana)
  const resNom = parseRubyAndGikunMarkup('彼は｜聖剣《エクスカリバー》を抜いた。');
  assert.equal(resNom.items[0].category, 'nomenclature');
  assert.equal(
    resNom.parsedText,
    '彼は<gikun type="nomenclature" spoken="エクスカリバー" meaning="聖剣"/>を抜いた。'
  );

  // 4. LitRPG Game Gikun
  const resRpg = parseRubyAndGikunMarkup('<ruby><rb>職業</rb><rt>クラス</rt></ruby>');
  assert.equal(resRpg.items[0].category, 'litrpg_term');
  assert.equal(
    resRpg.parsedText,
    '<gikun type="litrpg_term" spoken="クラス" meaning="職業"/>'
  );

  // 5. Deictic / Alias Gikun (Pronoun in ruby refering to noun in base)
  const resDeictic = parseRubyAndGikunMarkup('｜病院《ここ》が奴らの根城か。｜子供達《ぼくたち》を殺す気か！');
  assert.equal(resDeictic.foundCount, 2);
  assert.equal(resDeictic.items[0].category, 'deictic');
  assert.equal(resDeictic.items[1].category, 'deictic');
  assert.ok(resDeictic.parsedText.includes('<gikun type="deictic" spoken="ここ" referent="病院"/>'));
  assert.ok(resDeictic.parsedText.includes('<gikun type="deictic" spoken="ぼくたち" referent="子供達"/>'));

  // 6. Subtext Gikun
  const resSub = parseRubyAndGikunMarkup('彼は｜本気《マジ》だった。');
  assert.equal(resSub.items[0].category, 'subtext');
  assert.equal(
    resSub.parsedText,
    '彼は<gikun type="subtext" spoken="マジ" hidden="本気"/>だった。'
  );
});

test('Wave 3: Step 0.1 normalizeKoreanOneLineParagraphs merges mobile narrative lines while keeping dialogue and frames', () => {
  const koreanRaw = [
    '그는 검을 쥐었다.',
    '손끝이 떨렸다.',
    '바람이 차가웠다.',
    '---',
    '[시스템: 레벨 10 달성]',
    '— 덤벼라, 괴물아!',
    '적들이 포위망을 좁혀왔다.',
    '물러설 곳은 없었다.',
  ].join('\n');

  const res = normalizeKoreanOneLineParagraphs(koreanRaw);
  assert.ok(res.groupedParagraphCount < res.originalLineCount);
  assert.ok(res.normalizedText.includes('그는 검을 쥐었다. 손끝이 떨렸다. 바람이 차가웠다.'));
  assert.ok(res.normalizedText.includes('---'));
  assert.ok(res.normalizedText.includes('[시스템: 레벨 10 달성]'));
  assert.ok(res.normalizedText.includes('— 덤벼라, 괴물아!'));
  assert.ok(res.normalizedText.includes('적들이 포위망을 좁혀왔다. 물러설 곳은 없었다.'));
});

test('Wave 3: SceneDialogueChunker respects Dialogue Lock, Frame Lock, and generates lookahead', () => {
  const chapter = [
    'Под бледным светом луны Линь Сюань шагнул на тропу.',
    '---',
    '[Техника: Канон Теневого Шага]',
    '[Освоение: 100%]',
    '---',
    '— Живо выкладывай духовные камни! — крикнул вожак.',
    '— А если откажусь? — спокойно ответил юноша.',
    '— Тогда твоя жизнь окончена здесь! — взревел противник.',
    '— Попробуй взять, если силёнок хватит, — усмехнулся Линь Сюань.',
    'Линь Сюань обнажил клинок. Металл сверкнул холодным блеском.',
  ].join('\n\n');

  // Small token limit forces chunking, but Dialogue Lock must NOT split between dialogue turns
  const chunks = chunkChapterWithSceneAndDialogueLocks(chapter, {
    maxTokens: 30,
    precedingContextParagraphs: 2,
    lookaheadSentences: 1,
  });

  assert.ok(chunks.length >= 2);
  // Verify that all 4 dialogue lines stay together in whichever chunk holds them
  const dialogueChunk = chunks.find((c) => c.text.includes('— Живо выкладывай'));
  assert.ok(dialogueChunk);
  assert.ok(dialogueChunk.text.includes('— А если откажусь?'));
  assert.ok(dialogueChunk.text.includes('— Тогда твоя жизнь окончена'));
  assert.ok(dialogueChunk.text.includes('— Попробуй взять'));

  // Verify lookahead generated for first chunk
  assert.ok(chunks[0].readOnlyLookahead !== undefined);
  if (chunks.length > 1) {
    assert.ok(chunks[1].readOnlyPrecedingContext.includes('READ_ONLY_PRECEDING_CONTEXT'));
  }
});

test('Wave 3: CharacterVoiceCardV3 derives S-VoCAL SpeechVector and builds prompt block', () => {
  const glossary: CanonicalGlossary = {
    realms: {},
    characters: {
      'Elder Zhao': 'Старейшина Чжао',
      'Bandit Leader': 'Вожак разбойников',
    },
    sects_and_places: {},
    system_and_terms: {},
    units: {},
  };

  const meta: Record<string, GlossaryTermMeta> = {
    'Elder Zhao': {
      gender: 'M',
      declensionNote: 'род. п.: Старейшины Чжао',
      voiceNote: 'властный архаичный тон старейшины секты',
    },
    'Bandit Leader': {
      gender: 'M',
      voiceNote: 'грубый разбойничий тон с угрозами',
    },
  };

  const elderVec = deriveDefaultSpeechVector('Старейшина Чжао', meta['Elder Zhao']);
  assert.ok(elderVec.registerLevel >= 0.7);
  assert.equal(elderVec.sentenceLengthBias, 'ornate_periodic');
  assert.ok(elderVec.forbiddenLexicon.includes('окей'));

  const banditVec = deriveDefaultSpeechVector('Вожак разбойников', meta['Bandit Leader']);
  assert.ok(banditVec.registerLevel <= -0.5);
  assert.equal(banditVec.sentenceLengthBias, 'clipped_staccato');

  const block = buildCharacterVoicePromptBlock(glossary, meta);
  assert.ok(block.includes('Старейшина Чжао'));
  assert.ok(block.includes('SpeechVector: Register: +0.8'));
  assert.ok(block.includes('Вожак разбойников'));
  assert.ok(block.includes('SpeechVector: Register: -0.7'));
});

test('Wave 3: classifyScenePacingMode and selectContrastiveFewShotTriplets select 3 dynamic few-shot triplets', () => {
  const combatText = 'Линь Сюань обнажил меч и нанёс удар клинком. Кровь брызнула на скалы в ходе атаки.';
  assert.equal(classifyScenePacingMode(combatText), 'combat_action');

  const cultText = 'Поток Ци наполнил даньтянь и меридианы, ознаменовав долгожданный прорыв на новый уровень.';
  assert.equal(classifyScenePacingMode(cultText), 'cultivation_epiphany');

  const banterText = '— С дуба рухнул, что ли? — усмехнулся он и захохотал над нелепой шуткой.';
  assert.equal(classifyScenePacingMode(banterText), 'comedy_banter');

  const triplets = selectContrastiveFewShotTriplets('combat_action', 3);
  assert.equal(triplets.length, 3);
  assert.equal(triplets[0].pacingMode, 'combat_action');
  assert.ok(triplets[0].rawSource);
  assert.ok(triplets[0].badAiDraft);
  assert.ok(triplets[0].referenceRu);
  assert.ok(triplets[0].whyExplanation);
});

test('Wave 3: buildSurgicalCriticPass2Prompts evaluates 10-Question LiTransProQA and enforces Kunilovskaya <=3 directives cap', () => {
  const prompts = buildSurgicalCriticPass2Prompts({
    engText: 'He walked forward with 50 spiritual stones.',
    draftRusText: 'Он пошёл вперёд с 50 духовными камнями.',
    filteredGlossary: {
      realms: {},
      characters: {},
      sects_and_places: {},
      system_and_terms: {},
      units: {},
    },
    genderRulesList: [],
  });

  assert.ok(prompts.systemPrompt.includes('LiTransProQA'));
  assert.ok(prompts.systemPrompt.includes('Q1_FAITH'));
  assert.ok(prompts.systemPrompt.includes('otqs'));
  assert.ok(prompts.systemPrompt.includes('stylisticSpanDirectives'));

  // Test Kunilovskaya constraint capping:
  const rawDirectives: StylisticSpanDirective[] = [
    { paragraphIndex: 0, spanQuote: 'q1', issueType: 'SVO_CALQUE', rewriteInstructionRu: 'r1' },
    { paragraphIndex: 0, spanQuote: 'q2', issueType: 'NOMINALIZATION', rewriteInstructionRu: 'r2' },
    { paragraphIndex: 0, spanQuote: 'q3', issueType: 'FLAT_DIALOGUE', rewriteInstructionRu: 'r3' },
    { paragraphIndex: 0, spanQuote: 'q4', issueType: 'PARTICIPLE_CHAIN', rewriteInstructionRu: 'r4' },
    { paragraphIndex: 1, spanQuote: 'q5', issueType: 'RHYTHM_MONOTONY', rewriteInstructionRu: 'r5' },
  ];

  const capped = capStylisticDirectivesPerParagraph(rawDirectives, 3);
  assert.equal(capped.length, 4); // 3 for paragraph 0 + 1 for paragraph 1
  assert.equal(capped.filter((d) => d.paragraphIndex === 0).length, 3);
  assert.equal(capped.filter((d) => d.paragraphIndex === 1).length, 1);
});

test('Wave 3: buildBlindStylistPass3Prompts isolates source text completely (Source Firewall) and verifyAndRollbackStylistPass guards 5 invariants', () => {
  // 1. Source Firewall Verification: prompts strictly do NOT include source text
  const stylistPrompts = buildBlindStylistPass3Prompts({
    flawedParagraphs: [
      {
        index: 0,
        verifiedRusText: 'Линь Сюань вложил 120 Очков Истока в <term>Канон Теневого Шага</term>.',
        directives: [
          {
            paragraphIndex: 0,
            spanQuote: 'вложил 120 Очков Истока',
            issueType: 'SVO_CALQUE',
            rewriteInstructionRu: 'Сделать фразу динамичнее',
          },
        ],
      },
    ],
    genreTitle: 'Сянься',
    toneTitle: 'Динамичный',
    toneInstruction: 'Короткие фразы',
    characterVoicesBlock: 'Линь Сюань: спокойный',
    pacingMode: 'cultivation_epiphany',
    contrastiveTriplets: selectContrastiveFewShotTriplets('cultivation_epiphany', 1),
  });

  assert.ok(stylistPrompts.systemPrompt.includes('Pass 3 Blind Literary Stylist'));
  assert.ok(stylistPrompts.systemPrompt.includes('БЕЗ доступа к иностранному оригиналу'));
  assert.ok(stylistPrompts.userPrompt.includes('Линь Сюань вложил 120 Очков Истока'));

  // 2. Step 4 verifyAndRollbackStylistPass (5 Invariants Guard)
  const glossary: CanonicalGlossary = {
    realms: {},
    characters: {},
    sects_and_places: {},
    system_and_terms: {
      'Shadow Step': 'Канон Теневого Шага',
    },
    units: {
      'spirit stones': 'духовные камни',
    },
  };

  const verifiedRusText = [
    'Линь Сюань вложил 120 Очков Истока в Канон Теневого Шага.', // p0
    'Старший брат Чэнь потребовал 50 духовных камней.', // p1
    'У врат секты собрались ученики.', // p2
    'Вид врагов заставил его нахмуриться.', // p3
  ].join('\n\n');

  // Case A: p0 loses number 120 -> MUST ROLLBACK
  // Case B: p1 loses glossary term "духовных камней" -> MUST ROLLBACK
  // Case C: p2 adds 4 dashes (dash inflation) -> MUST ROLLBACK
  // Case D: p3 passes all invariants with Theme-Rheme inversion -> ACCEPTED!
  const styledParagraphs = [
    {
      index: 0,
      styledRusText: 'Линь Сюань усвоил всю силу Канона Теневого Шага без остатка.', // dropped 120!
    },
    {
      index: 1,
      styledRusText: 'Старший брат Чэнь потребовал 50 золотых монет.', // lost "духовных камней"!
    },
    {
      index: 2,
      styledRusText: 'У врат секты — как оказалось — стояли — почти все — ученики.', // ΔDash = +4!
    },
    {
      index: 3,
      styledRusText: 'При виде незваных гостей юноша лишь нахмурился.', // Perfect Nora Gal rewrite!
    },
  ];

  const gateResult = verifyAndRollbackStylistPass({
    verifiedRusText,
    styledParagraphs,
    glossary,
  });

  assert.equal(gateResult.acceptedParagraphIndices.length, 1);
  assert.ok(gateResult.acceptedParagraphIndices.includes(3));
  assert.equal(gateResult.rolledBackParagraphs.length, 3);

  // Check rollback reasons
  const p0Rollback = gateResult.rolledBackParagraphs.find((r) => r.index === 0);
  assert.ok(p0Rollback?.reason.includes('Потеряно числовое значение: «120»'));
  assert.equal(p0Rollback?.restoredText, 'Линь Сюань вложил 120 Очков Истока в Канон Теневого Шага.');

  const p1Rollback = gateResult.rolledBackParagraphs.find((r) => r.index === 1);
  assert.ok(p1Rollback?.reason.includes('Утерян канонический термин глоссария'));

  const p2Rollback = gateResult.rolledBackParagraphs.find((r) => r.index === 2);
  assert.ok(p2Rollback?.reason.includes('Избыточная инфляция тире'));

  // Final text must retain original p0, p1, p2, and styled p3
  assert.ok(gateResult.finalRusText.includes('Линь Сюань вложил 120 Очков Истока'));
  assert.ok(gateResult.finalRusText.includes('50 духовных камней'));
  assert.ok(gateResult.finalRusText.includes('При виде незваных гостей юноша лишь нахмурился.'));
});

test('Wave 3: Nora Gal Table (Blocks А, Б, В) and NOMINALIZATION_AND_INANIMATE_SUBJECT auto-repair and QA lint', () => {
  const sampleWithCalques = [
    'После завершения поглощения пилюли Линь Сюань осуществил прорыв.',
    'Вид крови заставил холод пробежать по его позвоночнику.',
    'Его зрачки сузились до размеров игольного ушка.',
    'Его лицо менялось с зелёного на белое, а кишки позеленели от сожаления.',
    'Уголки его рта слегка задёргались, и он сглотнул сухую слюну.',
    'Не то чтобы я не мог понять твоих мотивов.',
    '— Хён! Хён правда пойдёшь туда один?',
  ].join('\n\n');

  // 1. QA Linter detects NOMINALIZATION_AND_INANIMATE_SUBJECT
  const lintReport = runQaLinter('English source', sampleWithCalques, {
    realms: {},
    characters: {},
    sects_and_places: {},
    system_and_terms: {},
    units: {},
  });

  const nominalIssues = lintReport.issues.filter(
    (i) => i.ruleId === 'NOMINALIZATION_AND_INANIMATE_SUBJECT'
  );
  assert.ok(nominalIssues.length >= 2);

  // 2. Auto-repair resolves the full Blocks A, B, C table
  const repaired = autoRepairRussianText(sampleWithCalques);
  assert.ok(repaired.repairedText.includes('Усвоив пилюли Линь Сюань прорвался.'));
  assert.ok(repaired.repairedText.includes('При виде крови у него по спине пробежал холодок.'));
  assert.ok(repaired.repairedText.includes('зрачки превратились в две точки'));
  assert.ok(repaired.repairedText.includes('лицо шло пятнами от бессильной ярости'));
  assert.ok(repaired.repairedText.includes('готов был локти кусать от досады'));
  assert.ok(repaired.repairedText.toLowerCase().includes('губы нервно дрогнули'));
  assert.ok(repaired.repairedText.includes('судорожно сглотнул'));
  assert.ok(repaired.repairedText.toLowerCase().includes('понять-то несложно, да только'));
  assert.ok(repaired.repairedText.includes('— Хён! Ты правда пойдёшь туда один?'));
});



