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
  type CanonicalGlossary,
  type GlossaryTermMeta,
} from './qa-linter.ts';

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


