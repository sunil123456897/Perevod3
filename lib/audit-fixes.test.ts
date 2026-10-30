import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseDiskDatabasePayload,
  serializeDiskDatabasePayload,
  runPipelineBatchOnNovel,
  buildTranslatePass1Prompts,
  buildBlindStylistPass3Prompts,
  selectContrastiveFewShotTriplets,
  updateHeroStateLedgerFromChapter,
  batchLookaheadScoutChapters,
  autoApprovePendingTermsInVault,
  filterScoutedTermsWithAgentS,
  runQaLinter,
  autoRepairRussianText,
  alignChapterParagraphs,
  extractNormalizedRussianNumbers,
  normalizeRussianBookLayout,
  normalizeRussianChapterTitle,
  repairPunctuationArtifacts,
  mergeRepairedParagraphsByIndex,
  verifyAndRollbackStylistPass,
  verifyAndRepairChapterAsync,
  repairSplitAndGluedParagraphs,
  checkNegationPolarity,
  repairNegationPolarityWithSource,
  DEFAULT_LLM_PROVIDER_CONFIG,
  type CanonicalGlossary,
  type PipelineTransportAdapter,
  type PipelineTransportTranslateRequest,
} from './qa-linter.ts';
import { INITIAL_NOVELS, type NovelProject } from './seed-data.ts';
import {
  DirectEngineTransportAdapter,
  loadProjectsFromDisk,
  saveProjectsToDisk,
} from '../scripts/headless-runner.ts';
import {
  parseRubyAndGikunMarkup as parseRubyDirect,
  normalizeKoreanOneLineParagraphs as normalizeKoreanDirect,
  chunkChapterWithSceneAndDialogueLocks as chunkChapterDirect,
} from './ruby-korean-parser.ts';
import {
  buildDelTAContextPacket as buildDelTADirect,
  extractCsiCulturalNotes as extractCsiDirect,
  computeStylometricMetrics,
  verifyProseQualityGate,
  evaluateDitingQuality as evaluateDitingDirect,
  SlidingWindowTaskQueue as SlidingWindowTaskQueueDirect,
} from './delta-diting.ts';
import {
  buildEpub3Archive as buildEpub3Direct,
  parseEpubArchiveToChapters as parseEpubDirect,
  sanitizeRawChapterText as sanitizeRawDirect,
  buildChaptersZipArchive as buildChaptersZipDirect,
} from './epub-archive.ts';

const testGlossary: CanonicalGlossary = {
  realms: {
    'Qi Refining': 'Очищение Ци',
    'Foundation Establishment': 'Заложение Основ',
  },
  characters: {
    'Lin Xuan': 'Линь Сюань',
    'Elder Zhao': 'старейшина Чжао',
  },
  sects_and_places: {
    'Stone Demon Sect': 'Секта Каменных Демонов',
  },
  system_and_terms: {
    'Origin Points': 'Очки Истока',
    'Black Iron Cauldron': 'Котёл Чёрного Железа',
  },
  units: {
    jin: 'цзинь',
    li: 'ли',
  },
};

test('Audit P0.1: Unified disk database parser/serializer eliminates Split-Brain between Web API and CLI Runner', () => {
  const sampleNovels = [INITIAL_NOVELS[0]];

  // 1. Legacy raw array format (previously written by headless-runner)
  const rawArrayJson = JSON.stringify(sampleNovels, null, 2);
  const parsedFromArray = parseDiskDatabasePayload(rawArrayJson);
  assert.equal(parsedFromArray.version, 'raw-array');
  assert.equal(parsedFromArray.novels.length, 1);
  assert.equal(parsedFromArray.novels[0].id, sampleNovels[0].id);

  // 2. Canonical envelope format (shared by /api/projects and headless-runner)
  const envelopeJson = serializeDiskDatabasePayload(
    sampleNovels,
    '2026-10-29T00:00:00.000Z'
  );
  const parsedFromEnvelope = parseDiskDatabasePayload(envelopeJson);
  assert.equal(parsedFromEnvelope.version, '4.1-kanon-xianxia');
  assert.equal(parsedFromEnvelope.updatedAt, '2026-10-29T00:00:00.000Z');
  assert.equal(parsedFromEnvelope.novels.length, 1);
  assert.equal(parsedFromEnvelope.novels[0].id, sampleNovels[0].id);

  // 3. Verify loadProjectsFromDisk and saveProjectsToDisk round-trip on temp file
  const tmpFile = path.join(os.tmpdir(), `novels_db_test_${Date.now()}.json`);
  try {
    // Write legacy array first -> loadProjectsFromDisk must read it
    fs.writeFileSync(tmpFile, rawArrayJson, 'utf-8');
    const loadedFromLegacy = loadProjectsFromDisk(tmpFile);
    assert.equal(loadedFromLegacy.length, 1);
    assert.equal(loadedFromLegacy[0].id, sampleNovels[0].id);

    // Save via saveProjectsToDisk -> writes 4.1-kanon-xianxia envelope
    saveProjectsToDisk(loadedFromLegacy, tmpFile);
    const savedRaw = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    assert.equal(savedRaw.version, '4.1-kanon-xianxia');
    assert.ok(Array.isArray(savedRaw.novels));
    assert.equal(savedRaw.novels.length, 1);

    // Load again via loadProjectsFromDisk -> must read envelope cleanly
    const loadedFromEnvelope = loadProjectsFromDisk(tmpFile);
    assert.equal(loadedFromEnvelope.length, 1);
    assert.equal(loadedFromEnvelope[0].id, sampleNovels[0].id);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('Audit P0.2 & P1: runPipelineBatchOnNovel forwards Wave 2 + Pass 0 sceneDialogueBlock & useHashAnchors and skips duplicate verification when alreadyVerified=true', async () => {
  let capturedTranslateReq: PipelineTransportTranslateRequest | undefined;

  const customTransport: PipelineTransportAdapter = {
    async scout() {
      return { discoveredTerms: [] };
    },
    async translateAndEdit(req) {
      capturedTranslateReq = req;
      return {
        // Deliberately include an un-repaired written numeral ("двадцать один") to prove
        // that when alreadyVerified=true is set by the transport, runPipelineBatchOnNovel
        // does NOT re-run finalizeAndVerifyChapter a second time.
        rusText: '— Ты готов? — спросил старейшина Чжао.\n\nЛинь Сюань кивнул двадцать один раз.',
        titleRus: 'Глава 1. Проверка транспорта',
        summary: 'Краткая сводка',
        summaryEng: 'Short summary',
        csiNotes: [],
        alreadyVerified: true,
        verified: true,
        appliedFixes: ['transport-verified-once'],
        lintReport: {
          passed: true,
          score: 100,
          errorCount: 0,
          warningCount: 0,
          issues: [],
          checkedNumbersCount: 1,
          glossaryMatchesCount: 2,
        },
        ditingReport: {
          idiomAccuracy: 95,
          referentialCohesion: 95,
          characterVoiceFidelity: 95,
          culturalAdaptation: 95,
          literaryRhythm: 95,
          terminologyPrecision: 95,
          overallScore: 95,
          mqmGrade: 'Эталон (DITING 95+)',
        },
        wordCountEng: 15,
        wordCountRus: 12,
      };
    },
  };

  const novelWithWave2: NovelProject & {
    lorebook?: Array<{
      id: string;
      name: string;
      keys: string[];
      content: string;
    }>;
    socialEdges?: Array<{
      fromCharacter: string;
      toCharacter: string;
      valence: number;
      coarseRole: 'hierarchical';
      fineRole: string;
      pronounMode: 'ты' | 'Вы';
      updatedAtChapter: number;
    }>;
  } = {
    ...INITIAL_NOVELS[0],
    glossary: testGlossary,
    glossaryMeta: {
      'Lin Xuan': { gender: 'M' },
      'Elder Zhao': { gender: 'M' },
    },
    lorebook: [
      {
        id: 'lore-cauldron',
        name: 'Котёл Чёрного Железа',
        keys: ['Black Iron Cauldron'],
        content: 'Древний котёл старейшины.',
      },
    ],
    socialEdges: [
      {
        fromCharacter: 'Elder Zhao',
        toCharacter: 'Lin Xuan',
        valence: 0.2,
        coarseRole: 'hierarchical',
        fineRole: 'старейшина -> ученик',
        pronounMode: 'ты',
        updatedAtChapter: 1,
      },
    ],
    heroLedger: {
      protagonistName: 'Линь Сюань',
      cultivationRealm: '3-й слой Очищения Ци',
      resources: ['Очки Истока: 100'],
      artifactsAndFlames: ['Котёл Чёрного Железа'],
      activeLocation: 'Секта Каменных Демонов',
      lastUpdatedChapter: 1,
      forwardQuestions: [
        {
          id: 'q-1',
          questionRus: 'В чём секрет Котла Чёрного Железа?',
          relatedEntities: ['Котёл Чёрного Железа'],
          createdAtChapter: 1,
          status: 'open',
        },
      ],
    },
    chapters: [
      {
        id: 'ch-test-1',
        number: 1,
        titleEng: 'Chapter 1: Test',
        titleRus: '',
        engText:
          '"Are you ready to use the Black Iron Cauldron?" Elder Zhao asked.\n\nLin Xuan nodded silently.',
        rusText: '',
        scouted: false,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: 16,
        wordCountRus: 0,
        lastUpdated: '2026-10-29 00:00',
      },
    ],
  };

  const res = await runPipelineBatchOnNovel({
    novel: novelWithWave2,
    startChapter: 1,
    endChapter: 1,
    mode: 'full_5_phase',
    transport: customTransport,
  });

  assert.ok(capturedTranslateReq, 'translateAndEdit must be called');
  assert.equal(capturedTranslateReq.useHashAnchors, true);
  assert.ok(capturedTranslateReq.lorebookBlock?.includes('Древний котёл старейшины'));
  assert.ok(capturedTranslateReq.socialEdgesBlock?.includes('Elder Zhao'));
  assert.ok(capturedTranslateReq.forwardQuestionsBlock?.includes('В чём секрет Котла Чёрного Железа?'));
  assert.ok(
    capturedTranslateReq.sceneDialogueBlock?.includes('Elder Zhao'),
    'Pass 0 sceneDialogueBlock must be computed and forwarded'
  );

  // Because alreadyVerified=true was returned by transport, finalizeAndVerifyChapter
  // was NOT executed a second time (so "двадцать один" remained untouched).
  const outChapter = res.updatedNovel.chapters[0];
  assert.ok(outChapter.rusText.includes('двадцать один'));
  assert.equal(outChapter.verified, true);
});

test('Audit P1: DirectEngineTransportAdapter.scout extracts terms via Addition-by-Subtraction instead of returning an empty stub', async () => {
  const adapter = new DirectEngineTransportAdapter({
    ...DEFAULT_LLM_PROVIDER_CONFIG,
    provider: 'deterministic' as any,
  });

  const scoutRes = await adapter.scout({
    engText:
      'Lin Xuan entered the Crimson Flame Pavilion and refined a Foundation Establishment Pill inside the Black Iron Cauldron.',
    chapterNumber: 1,
    glossary: {
      realms: {},
      characters: {},
      sects_and_places: {},
      system_and_terms: {},
      units: {},
    },
    scoutedTerms: [],
    genrePreset: 'xianxia',
  });

  assert.ok(
    scoutRes.discoveredTerms.length > 0,
    'DirectEngineTransportAdapter.scout must return discovered terms'
  );
});

test('Audit P2: Pass 1 prompt documents <gikun>/<emph> AST tags and Pass 3 prompt does not hallucinate <term> tags', () => {
  const p1 = buildTranslatePass1Prompts({
    chapterNumber: 1,
    titleEng: 'Chapter 1',
    engText: 'He drew <gikun type="nomenclature" spoken="Excalibur" meaning="Holy Sword"/>.',
    genreTitle: 'Сянься',
    genrePromptHint: 'Xianxia',
    toneTitle: 'Классический',
    toneInstruction: 'Классический стиль',
    styleGuideMd: '',
    filteredGlossary: testGlossary,
    matchedCount: 1,
    genderRulesList: [],
    useHashAnchors: true,
  });

  assert.ok(p1.systemPrompt.includes('<gikun'));
  assert.ok(p1.systemPrompt.includes('<emph'));

  const p3 = buildBlindStylistPass3Prompts({
    flawedParagraphs: [
      {
        index: 0,
        verifiedRusText: 'Линь Сюань потратил 100 Очков Истока.',
        directives: [],
      },
    ],
    genreTitle: 'Сянься',
    toneTitle: 'Классический',
    toneInstruction: 'Классический стиль',
    characterVoicesBlock: '',
    pacingMode: 'cultivation_epiphany',
    contrastiveTriplets: selectContrastiveFewShotTriplets('cultivation_epiphany', 1),
  });

  assert.equal(
    p3.systemPrompt.includes('<term>'),
    false,
    'Pass 3 systemPrompt must not ask LLM to output <term> tags that trigger LATIN_LEAKAGE_AND_BRACKETS'
  );
});

test('Audit P2: updateHeroStateLedgerFromChapter and auto-canon guards block untranslated English and Russian question stopwords', () => {
  const pollutedGlossary: CanonicalGlossary = {
    ...testGlossary,
    system_and_terms: {
      ...testGlossary.system_and_terms,
      'Low Grade': 'Low Grade',
      'Alchemy Talent': 'Alchemy Talent',
    },
  };

  const ledger = updateHeroStateLedgerFromChapter(
    {
      protagonistName: 'Линь Сюань',
      cultivationRealm: '3-й слой Очищения Ци',
      resources: [],
      artifactsAndFlames: ['Low Grade'],
      activeLocation: 'Секта Каменных Демонов',
      lastUpdatedChapter: 1,
    },
    2,
    'Lin Xuan tested his Low Grade Alchemy Talent with the Black Iron Cauldron.',
    'Неужели это предел его таланта? Что это за Котёл Чёрного Железа?',
    pollutedGlossary
  );

  // Untranslated English strings must be filtered out of artifactsAndFlames
  assert.equal(ledger.artifactsAndFlames.includes('Low Grade'), false);
  assert.equal(ledger.artifactsAndFlames.includes('Alchemy Talent'), false);
  assert.equal(ledger.artifactsAndFlames.includes('Котёл Чёрного Железа'), true);

  // Question relatedEntities must NOT contain unit "ли" (from "Неужели") or stopword "Что"
  const allRelated = (ledger.forwardQuestions || []).flatMap((q) => q.relatedEntities);
  assert.equal(allRelated.includes('ли'), false);
  assert.equal(allRelated.includes('Что'), false);
  assert.equal(allRelated.includes('Неужели'), false);

  // Auto-approve in vault must reject untranslated English rus_suggested
  const autoVault = autoApprovePendingTermsInVault(
    {
      glossary: testGlossary,
      glossaryMeta: {},
      scoutedTerms: [
        {
          id: 'untranslated-1',
          eng: 'Low Grade',
          rus_suggested: 'Low Grade',
          category: 'system_and_terms',
          gender: 'M',
          chapter_first_seen: 1,
          context_snippet: 'Low Grade pill',
          approved_for_glossary: false,
          confidence: 0.99,
        },
      ],
    },
    0.9
  );
  assert.equal(autoVault.approvedCount, 0);
  assert.equal(autoVault.updatedVault.glossary.system_and_terms['Low Grade'], undefined);

  // Lookahead scout must not mark untranslated English terms as approved_for_glossary
  const lookahead = batchLookaheadScoutChapters(
    [
      {
        number: 1,
        titleEng: 'Chapter 1',
        engText: 'Mystery Unknown English Artifact appeared twice. Mystery Unknown English Artifact glowed.',
      },
      {
        number: 2,
        titleEng: 'Chapter 2',
        engText: 'Mystery Unknown English Artifact vanished.',
      },
    ],
    testGlossary,
    []
  );
  const untranslatedApproved = lookahead.discoveredTerms.filter(
    (t) => t.approved_for_glossary && !/[а-яёА-ЯЁ]/.test(t.rus_suggested)
  );
  assert.equal(untranslatedApproved.length, 0);

  // Agent S post-filter blocks rank formulas (Tier 1 High Grade -> первый ярус), lowercase common nouns, and number drops
  const filteredAgentS = filterScoutedTermsWithAgentS([
    {
      eng: 'Tier 1 High Grade',
      rus_suggested: 'первый ярус высший ранг',
      category: 'system_and_terms',
    },
    {
      eng: 'rogue cultivators',
      rus_suggested: 'вольные совершенствующиеся',
      category: 'system_and_terms',
    },
    {
      eng: 'Perfection',
      rus_suggested: 'Совершенство',
      category: 'system_and_terms',
    },
    {
      eng: 'Shadow Step Scripture',
      rus_suggested: 'Канон Теневого Шага',
      category: 'system_and_terms',
    },
  ]);
  assert.equal(filteredAgentS.length, 1);
  assert.equal(filteredAgentS[0].eng, 'Shadow Step Scripture');
});

test('Audit Phase 2: Modular decomposition (ruby-korean-parser, delta-diting, epub-archive) works directly and via qa-linter re-exports', async () => {
  const rubyRes = parseRubyDirect('彼は｜聖剣《エクスカリバー》を抜いた。');
  assert.equal(rubyRes.foundCount, 1);
  assert.equal(rubyRes.items[0].category, 'nomenclature');

  const krRes = normalizeKoreanDirect('첫 번째 문장이다.\n두 번째 문장이다.\n"대화문이다."');
  assert.equal(krRes.groupedParagraphCount, 2);

  const chunks = chunkChapterDirect('Paragraph one.\n\nParagraph two.', { maxTokens: 500 });
  assert.equal(chunks.length, 1);

  const delta = buildDelTADirect('Lin Xuan meditated on Qi Refining.', null, [], testGlossary);
  assert.ok(delta.properNounCount >= 2);

  const csi = extractCsiDirect('Senior Brother Chen weighed 10 jin.', 'старший брат Чэнь весил 10 цзиней.', testGlossary);
  assert.ok(csi.length >= 2);

  const diting = evaluateDitingDirect('Lin Xuan smiled.', 'Линь Сюань улыбнулся.', testGlossary);
  assert.ok(diting.overallScore >= 90);

  const queue = new SlidingWindowTaskQueueDirect({ concurrency: 1, intervalCap: 5, intervalMs: 1000 });
  const qVal = await queue.add(async () => 42);
  assert.equal(qVal, 42);

  const sanitized = sanitizeRawDirect('<p>Lin Xuan smiled.</p>\nTL Note: support on patreon.com/test');
  assert.equal(sanitized.cleanedText, 'Lin Xuan smiled.');
  assert.equal(sanitized.removedLinesCount, 1);

  const epub = buildEpub3Direct({
    titleRus: 'Тестовая книга',
    titleEng: 'Test Book',
    author: 'Tester',
    chapters: [{ number: 1, titleRus: 'Глава 1', contentRus: 'Линь Сюань улыбнулся в тишине зала.' }],
  });
  const imported = parseEpubDirect(epub.bytes);
  assert.equal(imported.chapters.length, 1);

  const zip = buildChaptersZipDirect('Тест', [{ number: 1, titleRus: 'Глава 1', contentRus: 'Текст главы.' }], 'txt');
  assert.equal(zip.chapterCount, 1);
});

test('Audit Phase 3: Anti-AI Dash & Punctuation Linter and Few-Shot Hygiene', () => {
  // 1. Few-shot library must not contain medial AI dashes in combat_action or colons in romance_psychology
  const combatShots = selectContrastiveFewShotTriplets('combat_action', 5);
  for (const shot of combatShots) {
    if (shot.pacingMode === 'combat_action') {
      assert.equal(
        /\s+—\s+/.test(shot.referenceRu),
        false,
        `combat_action referenceRu must not teach medial AI dashes: ${shot.referenceRu}`
      );
    }
    if (shot.pacingMode === 'romance_psychology') {
      assert.equal(
        shot.referenceRu.includes(':'),
        false,
        `romance_psychology referenceRu must not teach artificial colons: ${shot.referenceRu}`
      );
    }
  }

  // 2. Spaced hyphen (" - ") and en-dash (" – ") inside narrative prose are flagged and repaired
  const spacedHyphenText = 'Линь Сюань шагнул в туман - сжимая меч – и замер.';
  const lintHyphen = runQaLinter('Lin Xuan stepped into the mist.', spacedHyphenText, testGlossary, {
    enabledRuleIds: ['DASH_AND_COMMA_INFLATION'],
  });
  assert.ok(lintHyphen.issues.some((i) => i.ruleId === 'DASH_AND_COMMA_INFLATION'));

  const repairedHyphen = autoRepairRussianText(spacedHyphenText, {
    enabledRuleIds: ['DASH_AND_COMMA_INFLATION'],
  });
  assert.equal(/\s+(?:-|\u2013)\s+/.test(repairedHyphen.repairedText), false);

  // 3. Trailing appositive AI dash after thought attribution ("«...», — подумал Линь Сюань ... — магический артефакт.")
  const aiThoughtTailDash =
    '«Не ту цель выбрали», — холодно подумал Линь Сюань и обрушил на врагов свой клинок — магический артефакт.';
  const lintTailDash = runQaLinter(
    '"You chose the wrong target," Lin Xuan thought coldly, striking with his Magical Artifact sword.',
    aiThoughtTailDash,
    testGlossary,
    { enabledRuleIds: ['DASH_AND_COMMA_INFLATION'] }
  );
  assert.ok(lintTailDash.issues.some((i) => i.ruleId === 'DASH_AND_COMMA_INFLATION'));

  const repairedTailDash = autoRepairRussianText(aiThoughtTailDash, {
    enabledRuleIds: ['DASH_AND_COMMA_INFLATION'],
  });
  assert.equal((repairedTailDash.repairedText.match(/\s+—\s+/g) || []).length, 1);
});

test('Audit Phase 4 (EGM v2): 10/10 Russian Prose Numerals, System Box Layout, and Verified Chapters Audit', () => {
  // 1. Written numerals 1-9 in narrative prose match English Arabic digits in NUMBER_MISMATCH & Mechanical Gates
  const nums = extractNormalizedRussianNumbers(
    'Линь Сюань смотрел на три духовных камня, принял две пилюли и изучил девять свитков.'
  );
  assert.ok(nums.has('3'));
  assert.ok(nums.has('2'));
  assert.ok(nums.has('9'));

  const proseLint = runQaLinter(
    'Lin Xuan looked at 3 Spirit Stones and consumed 2 pills.',
    'Линь Сюань смотрел на три духовных камня и принял две пилюли.',
    testGlossary
  );
  assert.equal(proseLint.errorCount, 0);
  assert.equal(proseLint.score, 100);

  // 2. Stylist rollback gate and paragraph merge preserve compact system boxes and accept written numerals 1-9
  const baseWithSysBox = [
    'Линь Сюань достал 3 духовных камня.',
    '---',
    '[Носитель: Линь Сюань]',
    '[Культивация: Очищение Ци — 3-й слой]',
    '[Бонус к скорости: +45% к скорости передвижения]',
    '---',
    'Трое врагов с клинками в 35 цзиней шагнули из тумана.',
  ].join('\n\n');

  const normalizedLayout = normalizeRussianBookLayout(baseWithSysBox);
  assert.ok(
    normalizedLayout.includes(
      '---\n[Носитель: Линь Сюань]\n[Культивация: Очищение Ци (3-й слой)]\n[Бонус к скорости: +45% (передвижение)]\n---'
    )
  );
  assert.ok(normalizedLayout.includes('35 цзинь'));
  assert.equal(
    normalizeRussianChapterTitle('Глава 5: Канон Теневого Шага.'),
    'Глава 5. Канон Теневого Шага'
  );

  const stylistCheck = verifyAndRollbackStylistPass({
    verifiedRusText: normalizedLayout,
    styledParagraphs: [
      { index: 0, styledRusText: 'Линь Сюань достал три духовных камня.' },
    ],
    glossary: testGlossary,
  });
  assert.deepEqual(stylistCheck.acceptedParagraphIndices, [0]);
  assert.equal(stylistCheck.rolledBackParagraphs.length, 0);
  assert.ok(
    stylistCheck.finalRusText.includes(
      '---\n[Носитель: Линь Сюань]\n[Культивация: Очищение Ци (3-й слой)]'
    )
  );

  // 3. Every verified chapter in data/novels_db.json must pass QA Linter with 100/100 and 0 errors/warnings
  const dbPath = path.join(process.cwd(), 'data', 'novels_db.json');
  const { novels } = parseDiskDatabasePayload(JSON.parse(fs.readFileSync(dbPath, 'utf-8')));
  const novel = novels[0];
  const verifiedChapters = novel.chapters.filter((ch) => ch.verified);
  assert.ok(verifiedChapters.length >= 6);

  for (const ch of verifiedChapters) {
    assert.equal(
      /^Глава\s+\d+(?:\.\d+)?\.\s+/.test(ch.titleRus),
      true,
      `Chapter ${ch.id} title must use period format: ${ch.titleRus}`
    );
    assert.equal(
      ch.rusText.includes('---\n\n['),
      false,
      `Chapter ${ch.id} system box must not have double-newline paragraph explosion`
    );
    const alignment = alignChapterParagraphs(ch.engText, ch.rusText);
    assert.equal(alignment.hasDrift, false, `Chapter ${ch.id} has paragraph drift`);
    for (const pair of alignment.pairs) {
      assert.deepEqual(
        pair.missingNumbers,
        [],
        `Chapter ${ch.id} paragraph #${pair.index} missing numbers: ${pair.missingNumbers.join(',')}`
      );
    }
    const lint = runQaLinter(ch.engText, ch.rusText, novel.glossary, {
      enabledRuleIds: novel.enabledRuleIds,
      glossaryMeta: novel.glossaryMeta,
    });
    assert.equal(
      lint.errorCount,
      0,
      `Chapter ${ch.id} has lint errors: ${JSON.stringify(lint.issues)}`
    );
    assert.equal(lint.score, 100, `Chapter ${ch.id} score is ${lint.score}, expected 100`);
  }
});

test('Audit Phase 5 (Retro Guardrails): Multi-line colon-dash paragraph preservation, compound Russian ellipsis (?.. / !.. / ...), and split-dialogue dash exemption', () => {
  // 1. Multi-line ":\n\n— " must never be glued into ", — " by autoRepairRussianText
  const twoParaDialogue = 'Камелия качнула головой:\n\n— Знаю, что не стоило.';
  const repairedTwoPara = autoRepairRussianText(twoParaDialogue);
  assert.equal(
    repairedTwoPara.repairedText,
    twoParaDialogue,
    'autoRepairRussianText must preserve paragraph breaks between colon lead-in and dialogue dash'
  );

  // Same-line ": —" inside a single line is still repaired to ", —"
  const inlineColonDash = '— Будет исполнено: — ответил Фабиан.';
  assert.equal(autoRepairRussianText(inlineColonDash).repairedText, '— Будет исполнено, — ответил Фабиан.');

  // 2. Compound Russian punctuation (?.. and !..) is preserved while single-dot typos (?. and !.) are repaired
  const punctSample = 'А мы принесли неприятности, да?.. Остановись!.. Что это?. Уходи!.';
  assert.equal(
    repairPunctuationArtifacts(punctSample),
    'А мы принесли неприятности, да?.. Остановись!.. Что это? Уходи!'
  );
  const lintCompound = runQaLinter('Did we cause trouble? Stop!', 'А мы принесли неприятности, да?.. Остановись!..', testGlossary);
  assert.equal(lintCompound.errorCount, 0);

  // 3. normalizeRussianChapterTitle preserves ellipsis "..." while stripping single trailing dot and normalizing separator
  assert.equal(
    normalizeRussianChapterTitle('Глава 106 Если Ульрих умрёт...'),
    'Глава 106. Если Ульрих умрёт...'
  );
  assert.equal(
    normalizeRussianChapterTitle('Глава 168 Танец с королевой Калиантой [6].'),
    'Глава 168. Танец с королевой Калиантой [6]'
  );

  // 4. Split-dialogue line with attribution dash + resumption dash + 1 copula dash is not flagged as DASH_AND_COMMA_INFLATION
  const splitDialogueWithCopula =
    '— Преданность — одно дело, — возразила она. — Но когда смерть становится неизбежной, всё меняется.';
  const splitLint = runQaLinter(
    '"Loyalty is one thing," she replied. "But when death becomes certain, everything changes."',
    splitDialogueWithCopula,
    testGlossary,
    { enabledRuleIds: ['DASH_AND_COMMA_INFLATION'] }
  );
  assert.equal(splitLint.issues.length, 0);

  // 5. Continuous stylometry distinguishes lively varied prose from monotonous nominalized prose
  const livelyProse =
    'Тишина. Сайлас медленно обнажил тяжёлый клинок, вглядываясь в густой зимний туман над старым замком. ' +
    'Почему стража молчит? Ветер рвал алые знамёна на башнях, унося последние искры догорающего костра в ночную мглу.';
  const dryProse =
    'Осуществление перемещения подразделения производилось с обеспечением выполнения предписания командования. ' +
    'Выполнение задержания нарушителя сопровождалось составлением описания происшествия и принятием решения.';
  const livelyMetrics = computeStylometricMetrics(livelyProse);
  const dryMetrics = computeStylometricMetrics(dryProse);
  assert.ok(livelyMetrics.burstinessCv > dryMetrics.burstinessCv);
  assert.ok(livelyMetrics.nominalizationPer100Words < dryMetrics.nominalizationPer100Words);

  // 6. verifyProseQualityGate acts as a deterministic + stylometric + neural PASS/FAIL verifier
  const livelyEng =
    'Silence. Silas slowly drew his heavy blade, peering into the thick winter fog above the old castle. ' +
    'Why are the guards silent? The wind tore the crimson banners on the towers, carrying the last sparks of the dying fire into the night gloom.';
  const passGate = verifyProseQualityGate(livelyEng, livelyProse, testGlossary, {
    neuralStats: { meanCosine: 0.87, minCosine: 0.76 },
  });
  assert.equal(passGate.passed, true);
  assert.equal(passGate.failedChecks.length, 0);

  const failGate = verifyProseQualityGate(livelyEng, dryProse, testGlossary, {
    neuralStats: { meanCosine: 0.62, minCosine: 0.41 },
  });
  assert.equal(failGate.passed, false);
  assert.ok(failGate.failedChecks.some((c) => c.id === 'NOMINALIZATION_CAP'));
  assert.ok(failGate.failedChecks.some((c) => c.id === 'NEURAL_MEAN_COSINE'));
});

test('Audit Phase 6 (Unified Pipeline): verifyAndRepairChapterAsync detects and auto-heals all 3 defect classes (+1/-1 split+glue shift, female gender slip, and bureaucratic nominalization)', async () => {
  const sampleEng = [
    'Silence. Heavy snow fell over the courtyard of the old northern fortress. Silas slowly drew his broadsword, peering into the thick winter fog above the stone gates.',
    'Why? The icy wind tore the crimson banners on the western tower, carrying the last sparks of the dying watchfire into the dark gloom.',
    'Airam stepped onto the stone balcony and looked down at the courtyard.',
    'The patrol moved forward strictly according to the commander’s orders. Having detained the scout, the guards immediately described the incident and decided how to proceed.',
    '"Wait!" Esther whispered, tightening her heavy wool cloak against the biting frost.',
  ].join('\n\n');

  // Inject all 3 defect classes into the candidate Russian text:
  // 1) Split paragraph #0 into 2 fragments (+1) and glue paragraphs #3 + #4 together (-1) -> net paragraph count stays 5!
  // 2) Declined indeclinable name + masculine verbs on female character ("Айрамы шагнул ... и посмотрел")
  // 3) Heavy bureaucratic nominalization in paragraph #3 ("Осуществление перемещения... Выполнение задержания...")
  const corruptedRus = [
    'Тишина. На двор старой северной крепости густо падал снег.',
    'Сайлас медленно обнажил широкий палаш, вглядываясь в густой зимний туман над каменными воротами.',
    'Почему? Ледяной ветер яростно рвал алые знамёна на западной башне, унося последние искры догорающего сторожевого костра в непроглядную ночную мглу.',
    'Айрамы шагнул на каменный балкон и посмотрел вниз на двор.',
    'Осуществление перемещения подразделения производилось с обеспечением выполнения предписания командования. Выполнение задержания нарушителя сопровождалось составлением описания происшествия и принятием решения. — Стой! — тихо прошептала Эстер, плотнее запахивая тяжёлый шерстяной плащ от колючего мороза.',
  ].join('\n\n');

  const res = await verifyAndRepairChapterAsync(
    {
      chapterNumber: 168,
      titleEng: 'Chapter 168: Winter Fortress',
      titleRus: 'Глава 168. Зимняя крепость',
      engText: sampleEng,
      candidateRusText: corruptedRus,
      glossary: {
        ...testGlossary,
        characters: { ...testGlossary.characters, Airam: 'Айрам', Esther: 'Эстер', Silas: 'Сайлас' },
      },
      glossaryMeta: {
        Airam: { gender: 'F' },
        Esther: { gender: 'F' },
        Silas: { gender: 'M' },
      },
    },
    {
      enableNeuralAudit: true,
      customNeuralEvaluator: async (chNum, engP, rusP) => {
        // When paragraph #0 is still split (rusP[0] is short), simulate shifted low cosine
        const isStillShifted = rusP[0]!.length < 65;
        return {
          chapter: chNum,
          pairs: engP.length,
          rusCount: rusP.length,
          alignmentMode: '1:1',
          meanCosine: isStillShifted ? 0.74 : 0.87,
          minCosine: isStillShifted ? 0.44 : 0.79,
          lowSimilarityCount: isStillShifted ? 3 : 0,
          lowPairs: isStillShifted
            ? [{ index: 2, matchedRusIndex: 2, cosine: 0.44, eng: engP[1]!, rus: rusP[1]! }]
            : [],
          embeddingEngine: 'mock-adapter',
          device: 'mock',
          latencyMs: 1,
        };
      },
    }
  );

  assert.equal(res.beforeGateReport.passed, false);
  assert.equal(res.afterGateReport.passed, true);
  assert.equal(res.verified, true);
  assert.ok(!res.rusText.includes('Айрамы'));
  assert.ok(res.rusText.includes('Айрам шагнула'));
  assert.ok(!res.rusText.includes('Осуществление перемещения'));
});

test('Audit Phase 7 (DTW Unequal Alignment, Negation Polarity Check & Server GPU Gate Forwarding)', async () => {
  // 1. Wagner-Fischer DTW alignment for unequal paragraph counts (|N - M| >= 2)
  const eng5 = [
    'First paragraph of the chapter describing the ancient northern citadel and its snow-covered towers.',
    'Second paragraph describing how the guards lit the watchfires along the high stone ramparts.',
    '"Halt right there!" shouted the captain of the watch.',
    'Fourth paragraph describing the cold wind howling through the iron grates of the gate.',
    '"Show your seal," demanded the sentinel, lowering his halberd.',
  ].join('\n\n');

  // Glue #1+#2 AND glue #3+#4 so rus has only 3 paragraphs instead of 5 (M = N - 2)
  const rus3Glued = [
    'Первый абзац главы, описывающий древнюю северную цитадель и её заснеженные башни.',
    'Второй абзац, описывающий, как стражники зажгли сторожевые костры вдоль высоких каменных стен. — Стой на месте! — крикнул капитан караула.',
    'Четвёртый абзац, описывающий холодный ветер, завывающий сквозь железные решётки ворот. — Предъявите печать, — потребовал часовой, опуская алебарду.',
  ].join('\n\n');

  const dtwRes = repairSplitAndGluedParagraphs(eng5, rus3Glued);
  const dtwParas = dtwRes.repairedRusText.split(/\r?\n\s*\r?\n/).filter(Boolean);
  assert.equal(dtwParas.length, 5, 'DTW aligner must restore 3 glued paragraphs back to 5 (1:1)');
  assert.ok(dtwRes.appliedFixes.some((f) => f.includes('DTW Alignment')));

  // 2. Negation Polarity Check & deterministic auto-repair
  const engNeg = 'Airam looked at the queen. She did not step back.';
  const rusDroppedNeg = 'Айрам посмотрела на королеву. Она отступила.';
  const violations = checkNegationPolarity(engNeg, rusDroppedNeg);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.rusVerbFound, 'отступила');

  const repairedNeg = repairNegationPolarityWithSource(engNeg, rusDroppedNeg);
  assert.ok(repairedNeg.repairedRusText.includes('Она не отступила.'));
  assert.equal(checkNegationPolarity(engNeg, repairedNeg.repairedRusText).length, 0);

  // 3. PipelineRunEngine forwards verification to transport.verifyAndRepair when available
  let verifyAndRepairCalled = false;
  const mockTransport: PipelineTransportAdapter = {
    async scout() {
      return { discoveredTerms: [] };
    },
    async translateAndEdit(req) {
      return {
        rusText: 'Айрам посмотрела на королеву. Она отступила.',
        titleRus: `Глава ${req.chapterNumber}. Тест`,
        alreadyVerified: false,
      };
    },
    async verifyAndRepair(req) {
      verifyAndRepairCalled = true;
      const verif = await verifyAndRepairChapterAsync(
        {
          chapterNumber: req.chapterNumber,
          titleEng: req.titleEng,
          titleRus: req.titleRus,
          engText: req.engText,
          candidateRusText: req.rusText,
          glossary: req.glossary,
          glossaryMeta: req.glossaryMeta,
        },
        { enableNeuralAudit: false }
      );
      return verif;
    },
  };

  const dummyNovel = {
    id: 'test-gpu-forward',
    name: 'Test GPU Forward',
    rusTitle: 'Тест',
    author: 'Author',
    sourceLang: 'ENG' as const,
    genrePreset: 'dark_fantasy' as const,
    proseTone: 'classic' as const,
    autoApproveThreshold: 0.9,
    enabledRuleIds: [],
    styleGuideMd: '',
    contextMd: '',
    glossary: testGlossary,
    glossaryMeta: {},
    scoutedTerms: [],
    chapters: [
      {
        id: 'ch-1',
        number: 1,
        titleEng: 'Chapter 1',
        titleRus: 'Глава 1',
        engText: engNeg,
        rusText: '',
        scouted: false,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: 9,
        wordCountRus: 0,
        lastUpdated: '',
      },
    ],
  };

  const batchOut = await runPipelineBatchOnNovel({
    novel: dummyNovel,
    startChapter: 1,
    endChapter: 1,
    transport: mockTransport,
  });

  assert.equal(verifyAndRepairCalled, true, 'runPipelineBatchOnNovel must invoke transport.verifyAndRepair');
  assert.ok(
    batchOut.updatedNovel.chapters[0]!.rusText.includes('Она не отступила.'),
    'Server verifyAndRepair must auto-heal dropped negation'
  );
});
