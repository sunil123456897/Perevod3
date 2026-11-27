import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  updateHeroStateLedgerFromChapter,
  filterScoutedTermsWithAgentS,
  runQaLinter,
  autoRepairRussianText,
  alignChapterParagraphs,
  extractNormalizedRussianNumbers,
  normalizeRussianBookLayout,
  normalizeRussianChapterTitle,
  repairPunctuationArtifacts,
  splitChapterParagraphs,
  validateColabEndpointUrl,
  DEFAULT_LLM_PROVIDER_CONFIG,
} from './qa-linter.ts';
import {
  parseDiskDatabasePayload,
  serializeDiskDatabasePayload,
} from './storage-idb.ts';
import {
  runPipelineBatchOnNovel,
  type PipelineTransportAdapter,
  type PipelineTransportTranslateRequest,
} from './pipeline-run-engine.ts';
import {
  buildTranslatePass1Prompts,
  buildBlindStylistPass3Prompts,
} from './llm-inference-port.ts';
import { selectContrastiveFewShotTriplets } from './scene-analysis.ts';
import {
  batchLookaheadScoutChapters,
  autoApprovePendingTermsInVault,
} from './canon-glossary-vault.ts';
import {
  mergeRepairedParagraphsByIndex,
  verifyAndRollbackStylistPass,
  repairSplitAndGluedParagraphs,
} from './chapter-verifier.ts';
import { verifyAndRepairChapterAsync } from './chapter-verifier-server.ts';
import {
  checkNegationPolarity,
  repairNegationPolarityWithSource,
} from './delta-diting.ts';
import type { CanonicalGlossary } from './pipeline-types.ts';
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

test('Audit Phase 8: splitChapterParagraphs index parity after system boxes, SSRF guard & versionHistory cap', async () => {
  const testGlossary: CanonicalGlossary = {
    realms: {},
    characters: { 'Han Li': 'Хань Ли' },
    sects_and_places: {},
    system_and_terms: {},
    units: {},
  };

  // 1. Multi-line system box joined with single \n, followed by narrative paragraph joined with \n\n
  const chapterWithSystemBox = [
    '---',
    '[Система активирована]',
    '[Уровень: 5]',
    '---',
    '',
    'Хань Ли шагнул вперёд и посмотрел на клинок.',
  ].join('\n');

  const paras = splitChapterParagraphs(chapterWithSystemBox);
  assert.equal(
    paras.length,
    5,
    'splitChapterParagraphs must produce 5 line-indexed elements matching verifyAndRollbackStylistPass'
  );
  assert.equal(paras[4], 'Хань Ли шагнул вперёд и посмотрел на клинок.');

  // Verify Pass 3 rollback checks index 4 against the narrative paragraph (not shifted to index 1)
  const stylistRes = verifyAndRollbackStylistPass({
    verifiedRusText: chapterWithSystemBox,
    styledParagraphs: [
      {
        index: 4,
        styledRusText: 'Хань Ли решительно шагнул вперёд и взглянул на клинок.',
      },
    ],
    glossary: testGlossary,
  });
  assert.deepEqual(
    stylistRes.acceptedParagraphIndices,
    [4],
    'Pass 3 must accept styled narrative paragraph at index 4 without system-box index shift'
  );
  assert.ok(
    stylistRes.finalRusText.includes('Хань Ли решительно шагнул вперёд и взглянул на клинок.'),
    'Styled paragraph at index 4 must be merged at the exact narrative position'
  );

  // 2. SSRF guard in validateColabEndpointUrl
  assert.equal(
    validateColabEndpointUrl('http://169.254.169.254/latest/meta-data').ok,
    false,
    'Cloud metadata link-local IP must be blocked'
  );
  assert.equal(
    validateColabEndpointUrl('file:///etc/passwd').ok,
    false,
    'Non-HTTP schemes must be blocked'
  );
  assert.equal(
    validateColabEndpointUrl('http://10.0.0.15:8080').ok,
    false,
    'RFC1918 LAN IP on arbitrary port must be blocked'
  );
  assert.equal(
    validateColabEndpointUrl('https://demo-tunnel.trycloudflare.com').ok,
    true,
    'Valid Cloudflare tunnel URL must be allowed'
  );
  assert.equal(
    validateColabEndpointUrl('http://localhost:11434').ok,
    true,
    'Local Ollama port 11434 must be allowed'
  );
});

test('Audit Phase 9: Unified 4-pass execution (glossary slicing & Pass 1 fallback in CLI/API) and Disk DB concurrency guard', async () => {
  const {
    readDiskDatabase,
    writeDiskDatabaseAtomic,
    DiskDatabaseConflictError,
  } = await import('./disk-db-server.ts');

  // 1. Verify DirectEngineTransportAdapter slices glossary per chapter and survives Pass 1 LLM failure
  const bloatedGlossary: CanonicalGlossary = {
    realms: {},
    characters: {
      'Lin Xuan': 'Линь Сюань',
      'Unrelated Character Alpha': 'Посторонний Персонаж Альфа',
      'Unrelated Character Beta': 'Посторонний Персонаж Бета',
    },
    sects_and_places: {
      'Distant Unmentioned Sect': 'Далёкая Неупомянутая Секта',
    },
    system_and_terms: {},
    units: {},
  };

  const capturedUserPrompts: string[] = [];
  const adapterWithMockPort = new DirectEngineTransportAdapter(
    {
      ...DEFAULT_LLM_PROVIDER_CONFIG,
      provider: 'gemini_api',
    },
    {
      enableNeuralAudit: false,
      llmPortFactory: () => ({
        async complete(req) {
          capturedUserPrompts.push(`${req.task}:::${req.userPrompt}`);
          if (req.task === 'translate_pass1') {
            return {
              text: JSON.stringify({
                titleRus: 'Глава 1. Проверка среза',
                rusText: 'Линь Сюань молча кивнул.',
                summary: 'Линь Сюань кивнул.',
                summaryEng: 'Lin Xuan nodded.',
                csiNotes: [],
              }),
              engineUsed: 'mock-pass1',
              provider: 'gemini_api',
            };
          }
          return {
            text: JSON.stringify({ patches: [], rubricScores: { otqs: 9.2 }, stylisticSpanDirectives: [] }),
            engineUsed: 'mock-pass2',
            provider: 'gemini_api',
          };
        },
      }),
    }
  );

  const txRes = await adapterWithMockPort.translateAndEdit({
    engText: 'Lin Xuan nodded silently.',
    titleEng: 'Chapter 1: Slice Check',
    chapterNumber: 1,
    glossary: bloatedGlossary,
    genrePreset: 'xianxia',
    proseTone: 'classic',
    twoPassCritic: true,
  });

  assert.equal(txRes.slicedGlossaryCount, 1, 'CLI/Server adapter must slice glossary to matched terms only');
  const pass1Prompt = capturedUserPrompts.find((p) => p.startsWith('translate_pass1:::')) || '';
  assert.ok(pass1Prompt.includes('Lin Xuan'), 'Matched character must be included in Pass 1 prompt');
  assert.ok(
    !pass1Prompt.includes('Unrelated Character Alpha') &&
      !pass1Prompt.includes('Distant Unmentioned Sect'),
    'Unmentioned glossary terms must be pruned from Pass 1 prompt'
  );

  // Verify Pass 1 network crash triggers deterministic fallback instead of throwing unhandled error
  const crashingAdapter = new DirectEngineTransportAdapter(
    DEFAULT_LLM_PROVIDER_CONFIG,
    {
      enableNeuralAudit: false,
      llmPortFactory: () => ({
        async complete() {
          throw new Error('Simulated Pass 1 upstream outage');
        },
      }),
    }
  );
  const fallbackRes = await crashingAdapter.translateAndEdit({
    engText: 'Lin Xuan nodded.',
    titleEng: 'Chapter 2',
    chapterNumber: 2,
    glossary: bloatedGlossary,
    twoPassCritic: false,
  });
  assert.ok(fallbackRes.rusText.length > 0, 'Pass 1 failure must recover via deterministic fallback');

  // 2. Verify concurrent atomic writes and Optimistic Concurrency Control (409 guard)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-db-occ-'));
  const dbFilePath = path.join(tmpDir, 'novels_db.json');
  try {
    const novelA = { ...INITIAL_NOVELS[0], name: 'Write A' };
    const novelB = { ...INITIAL_NOVELS[0], name: 'Write B' };

    // Parallel writes to the same DB path must serialize cleanly without .tmp ENOENT collisions
    const [w1, w2] = await Promise.all([
      writeDiskDatabaseAtomic([novelA], { dbFilePath }),
      writeDiskDatabaseAtomic([novelB], { dbFilePath }),
    ]);
    assert.ok(w1.updatedAt && w2.updatedAt);
    assert.notEqual(w1.updatedAt, w2.updatedAt, 'Sequentialized writes must receive distinct timestamps');

    const latestOnDisk = await readDiskDatabase(dbFilePath);
    assert.equal(latestOnDisk.novels[0]!.name, 'Write B');
    assert.equal(latestOnDisk.updatedAt, w2.updatedAt);

    // Stale browser tab attempting to save with outdated w1.updatedAt must be rejected
    await assert.rejects(
      () =>
        writeDiskDatabaseAtomic([novelA], {
          dbFilePath,
          baseUpdatedAt: w1.updatedAt,
        }),
      (err: unknown) => err instanceof DiskDatabaseConflictError
    );

    // Verify disk content was NOT overwritten by stale tab
    const afterRejected = await readDiskDatabase(dbFilePath);
    assert.equal(afterRejected.novels[0]!.name, 'Write B');

    // Fresh save with matching baseUpdatedAt succeeds
    const w3 = await writeDiskDatabaseAtomic(
      [{ ...INITIAL_NOVELS[0], name: 'Write C' }],
      { dbFilePath, baseUpdatedAt: w2.updatedAt }
    );
    const afterAccepted = await readDiskDatabase(dbFilePath);
    assert.equal(afterAccepted.novels[0]!.name, 'Write C');
    assert.equal(afterAccepted.updatedAt, w3.updatedAt);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Audit Phase 10: P0-P3 Verification (C1-C7, SQLite WAL+OCC, Morphology, DTW, SSE Broker)
// ---------------------------------------------------------------------------

test('Audit Phase 10 (C1/C2/C3): Fail-closed LLM port, quarantined isolation, Ch.412 non-hijack, and adapter leak guards', async () => {
  const {
    createPipelineLlmPort,
    deterministicLocalTranslate,
    DeterministicCanonAdapter,
    FallbackChainAdapter,
    RotatingGeminiAdapter,
    ColabOllamaAdapter,
    buildTranslatePass1Prompts,
  } = await import('./llm-inference-port.ts');
  const { ServerPipelineExecutionAdapter } = await import('./pipeline-run-engine.ts');

  // 1. Fail-closed LLM port: default createPipelineLlmPort never includes DeterministicCanonAdapter,
  // and RotatingGeminiAdapter / ColabOllamaAdapter reject cleanly instead of returning deterministic text.
  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevGoogleKey = process.env.GOOGLE_API_KEY;
  const prevGoogleKeys = process.env.GOOGLE_API_KEYS;
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEYS;
    const defaultPort = createPipelineLlmPort({
      ...DEFAULT_LLM_PROVIDER_CONFIG,
      provider: 'colab_ollama',
      colabEndpointUrl: 'http://127.0.0.1:1',
    });
    assert.ok(defaultPort instanceof FallbackChainAdapter);
    assert.equal(
      defaultPort.adapters.some((a) => a instanceof DeterministicCanonAdapter),
      false,
      'Non-deterministic provider must never auto-attach DeterministicCanonAdapter'
    );

    const noCliChain = new FallbackChainAdapter([
      new ColabOllamaAdapter({ endpointUrl: 'http://127.0.0.1:1', modelId: 'qwen' }),
      new RotatingGeminiAdapter({ model: 'gemini-3.8-flash' }),
    ]);
    await assert.rejects(
      () =>
        noCliChain.complete({
          task: 'translate_pass1',
          systemInstruction: 'sys',
          userPrompt: 'usr',
        }),
      /не найден|API|ключ|unavailable|No Gemini/i
    );
  } finally {
    if (prevGeminiKey !== undefined) process.env.GEMINI_API_KEY = prevGeminiKey;
    else delete process.env.GEMINI_API_KEY;
    if (prevGoogleKey !== undefined) process.env.GOOGLE_API_KEY = prevGoogleKey;
    else delete process.env.GOOGLE_API_KEY;
    if (prevGoogleKeys !== undefined) process.env.GOOGLE_API_KEYS = prevGoogleKeys;
    else delete process.env.GOOGLE_API_KEYS;
  }

  // 2. Demo Ch.1-6 hijack guard on chapter 412 with "Inner Sect" / "Spirit Stones"
  const nonDemo = deterministicLocalTranslate(
    'Lin Xuan stepped into the Inner Sect hall holding three Spirit Stones.',
    'Threshold of the Inner Sect',
    412,
    INITIAL_NOVELS[0].glossary,
    'classic'
  );
  assert.ok(
    !nonDemo.rusText.includes('Внешняя Секта Огненного Облака'),
    'Ch.412 must not be hijacked by Chapter 1-6 demo hardcoded template'
  );

  // 3. DeterministicCanonAdapter: quotes in titleEng & self_repair prompt isolation
  const adapter = new DeterministicCanonAdapter({ glossary: INITIAL_NOVELS[0].glossary });
  const prompts = buildTranslatePass1Prompts({
    chapterNumber: 12,
    titleEng: 'The "Iron" Secret',
    engText: 'He walked forward calmly.',
    genreTitle: 'Сянься',
    genrePromptHint: 'Классика культивации',
    toneTitle: 'Классический',
    toneInstruction: 'Живой литературный язык',
    styleGuideMd: '',
    filteredGlossary: {
      realms: {},
      characters: {},
      sects_and_places: {},
      system_and_terms: {},
      units: {},
    },
    matchedCount: 0,
    genderRulesList: [],
  });
  const pass1Out = await adapter.complete({
    task: 'translate_pass1',
    systemInstruction: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    expectJson: true,
  });
  const parsedPass1 = JSON.parse(pass1Out.text) as { titleRus: string; rusText: string };
  assert.ok(parsedPass1.rusText.length > 0);

  const repairOut = await adapter.complete({
    task: 'self_repair',
    systemInstruction: 'Repair only text.',
    userPrompt: [
      '[a1b2|#p0]',
      'ENG: He smiled.',
      'RUS: Он улыбнулся.',
      'ISSUES: minor check',
      'Canonical Glossary: {"realms":{}}',
    ].join('\n'),
  });
  assert.ok(repairOut.text.includes('Он улыбнулся.'));
  assert.ok(!repairOut.text.includes('Canonical Glossary'));
  assert.ok(!repairOut.text.includes('ENG:'));

  // 4. Outage creates quarantined chapter, preserves prior rusText, skips heroLedger, skips DelTA propagation
  const ch1Eng = 'Lin Xuan entered the courtyard cleanly.';
  const ch1Rus = 'Линь Сюань спокойно вошёл во двор.';
  const ch2Eng = 'Lin Xuan broke through to the Core Formation realm during an outage.';
  const ch2ExistingRus = 'Старый черновик второй главы должен сохраниться при сбое.';
  const ch3Eng = 'Next morning the courtyard was silent.';

  const baseNovel: NovelProject = {
    ...INITIAL_NOVELS[0],
    heroLedger: {
      protagonistName: 'Линь Сюань',
      cultivationRealm: 'Закалка Тела (1-й уровень)',
      resources: ['Нефритовая табличка'],
      artifactsAndFlames: [],
      activeLocation: 'Двор секты',
      lastUpdatedChapter: 1,
    },
    chapters: [
      {
        id: 'c10-ch1',
        number: 1,
        titleEng: 'Courtyard',
        titleRus: 'Глава 1. Двор',
        engText: ch1Eng,
        rusText: ch1Rus,
        summary: 'Линь Сюань освоился во дворе.',
        translated: true,
        scouted: true,
        edited: true,
        verified: true,
        wordCountEng: 6,
        wordCountRus: 6,
        lastUpdated: '2026-11-15T00:00:00.000Z',
      },
      {
        id: 'c10-ch2',
        number: 2,
        titleEng: 'Breakthrough Outage',
        titleRus: 'Глава 2',
        engText: ch2Eng,
        rusText: ch2ExistingRus,
        translated: false,
        scouted: false,
        edited: false,
        verified: false,
        wordCountEng: 11,
        wordCountRus: 8,
        lastUpdated: '2026-11-15T00:00:00.000Z',
      },
      {
        id: 'c10-ch3',
        number: 3,
        titleEng: 'Silent Morning',
        titleRus: '',
        engText: ch3Eng,
        rusText: '',
        translated: false,
        scouted: false,
        edited: false,
        verified: false,
        wordCountEng: 6,
        wordCountRus: 0,
        lastUpdated: '2026-11-15T00:00:00.000Z',
      },
    ],
  };

  let capturedCh3Summary = '';
  const outageAdapter = new ServerPipelineExecutionAdapter(
    { ...DEFAULT_LLM_PROVIDER_CONFIG, provider: 'colab_ollama', colabEndpointUrl: 'http://127.0.0.1:11434' },
    {
      enableNeuralAudit: false,
      llmPortFactory: () => ({
        async complete(req) {
          if (req.task === 'translate_pass1' && req.userPrompt.includes('Breakthrough Outage')) {
            throw new Error('HTTP 503 Service Unavailable');
          }
          if (req.task === 'translate_pass1' && req.userPrompt.includes('Silent Morning')) {
            const m = req.userPrompt.match(/\[PREVIOUS CHAPTER SUMMARY\]\s*([\s\S]*?)(?:\n\[|$)/i);
            capturedCh3Summary = m ? m[1] : req.userPrompt;
            return {
              text: JSON.stringify({
                titleRus: 'Глава 3. Тихое утро',
                rusText: 'На следующее утро во дворе стояла тишина.',
                summary: 'Утром двор стих.',
                summaryEng: 'Morning fell silent.',
                csiNotes: [],
              }),
              engineUsed: 'mock-ok',
              provider: 'colab_ollama',
            };
          }
          if (req.task === 'surgical_critic_pass2') {
            return {
              text: JSON.stringify({ patches: [], rubricScores: { otqs: 9.2 } }),
              engineUsed: 'mock-critic',
              provider: 'colab_ollama',
            };
          }
          if (req.task === 'blind_stylist_pass3') {
            return {
              text: JSON.stringify({ styledParagraphs: [] }),
              engineUsed: 'mock-stylist',
              provider: 'colab_ollama',
            };
          }
          return { text: '[]', engineUsed: 'mock-scout', provider: 'colab_ollama' };
        },
      }),
    }
  );

  const batchOut = await runPipelineBatchOnNovel({
    novel: baseNovel,
    targetChapterIds: ['c10-ch2', 'c10-ch3'],
    mode: 'full_5_phase',
    autoCanonEnabled: false,
    twoPassCriticEnabled: false,
    transport: outageAdapter,
  });

  const outCh2 = batchOut.updatedNovel.chapters.find((c) => c.id === 'c10-ch2')!;
  const outCh3 = batchOut.updatedNovel.chapters.find((c) => c.id === 'c10-ch3')!;
  assert.equal(outCh2.status, 'quarantined');
  assert.equal(outCh2.rusText, ch2ExistingRus, 'Quarantined failure must preserve pre-existing rusText');
  assert.equal(outCh2.verified, false);
  assert.equal(
    batchOut.updatedNovel.heroLedger?.cultivationRealm,
    'Закалка Тела (1-й уровень)',
    'Quarantined Ch.2 breakthrough must not pollute heroLedger cultivationRealm'
  );
  assert.equal(batchOut.updatedNovel.heroLedger?.lastUpdatedChapter, 3);
  assert.equal(outCh3.translated, true);
  assert.ok(
    !capturedCh3Summary.includes('Старый черновик второй главы'),
    'Quarantined Ch.2 must be excluded from Ch.3 DelTA context'
  );
});

test('Audit Phase 10 (C4): Live dynamic DelTA propagation from chapter 1 to chapter 2 inside one batch', async () => {
  let ch2SawPrevSummary = '';
  const capturingTransport: PipelineTransportAdapter = {
    async scout() {
      return { engine: 'mock-scout', discoveredTerms: [] };
    },
    async translateAndEdit(req: PipelineTransportTranslateRequest) {
      if (req.chapterNumber === 1) {
        return {
          engine: 'mock-t',
          titleRus: 'Глава 1. Осколок',
          rusText: 'Линь Сюань поднял сияющий Осколок Рассвета на краю обрыва.',
          summary: 'Линь Сюань нашёл Осколок Рассвета.',
          summaryEng: 'Lin Xuan found the Dawn Shard.',
          csiNotes: [],
          verified: true,
          wordCountEng: 10,
          wordCountRus: 9,
        };
      }
      ch2SawPrevSummary = req.previousChapterSummary || '';
      return {
        engine: 'mock-t',
        titleRus: 'Глава 2. Спуск',
        rusText: 'Держа тёплый осколок, он начал осторожный спуск со скалы.',
        summary: 'Герой спустился со скалы.',
        summaryEng: 'Hero climbed down.',
        csiNotes: [],
        verified: true,
        wordCountEng: 10,
        wordCountRus: 9,
      };
    },
  };

  const novel: NovelProject = {
    ...INITIAL_NOVELS[0],
    chapters: [
      {
        id: 'dyn-1',
        number: 1,
        titleEng: 'Shard',
        titleRus: '',
        engText: 'Lin Xuan picked up the glowing Dawn Shard at the cliff edge.',
        rusText: '',
        translated: false,
        scouted: false,
        edited: false,
        verified: false,
        wordCountEng: 11,
        wordCountRus: 0,
        lastUpdated: '2026-11-15T00:00:00.000Z',
      },
      {
        id: 'dyn-2',
        number: 2,
        titleEng: 'Descent',
        titleRus: '',
        engText: 'Holding the warm shard, he began his careful descent.',
        rusText: '',
        translated: false,
        scouted: false,
        edited: false,
        verified: false,
        wordCountEng: 10,
        wordCountRus: 0,
        lastUpdated: '2026-11-15T00:00:00.000Z',
      },
    ],
  };

  await runPipelineBatchOnNovel({
    novel,
    targetChapterIds: ['dyn-1', 'dyn-2'],
    mode: 'full_5_phase',
    autoCanonEnabled: false,
    twoPassCriticEnabled: false,
    transport: capturingTransport,
  });

  assert.ok(
    ch2SawPrevSummary.includes('Линь Сюань нашёл Осколок Рассвета'),
    `Expected live DelTA summary from Ch.1 inside Ch.2 prompt, got: "${ch2SawPrevSummary}"`
  );
});

test('Audit Phase 10 (C6): Possessive/accusative gender safety, copula dash repair, 2sg register, and safe посмотрел synonym pool', () => {
  const glossary: CanonicalGlossary = {
    realms: {},
    characters: {
      Elizabeth: 'Элизабет',
      Camellia: 'Камелия',
      Airam: 'Айрам',
    },
    sects_and_places: {},
    system_and_terms: {},
    units: {},
  };
  const glossaryMeta = {
    Elizabeth: { eng: 'Elizabeth', rus: 'Элизабет', category: 'characters' as const, gender: 'F' as const },
    Camellia: { eng: 'Camellia', rus: 'Камелия', category: 'characters' as const, gender: 'F' as const },
    Airam: { eng: 'Airam', rus: 'Айрам', category: 'characters' as const, gender: 'M' as const },
  };

  // No false positives on genitive possessor or accusative object
  const cleanPossessive = runQaLinter(
    "Elizabeth's cloak opened the door. The enemy grabbed Elizabeth by the arm.",
    'Плащ Элизабет открыл дверь.\nВраг взял Элизабет за руку.',
    glossary,
    { glossaryMeta }
  );
  assert.equal(
    cleanPossessive.issues.filter((i) => i.ruleId === 'CHARACTER_GENDER_MISMATCH').length,
    0,
    'Genitive possessor and transitive accusative object must not trigger female verb mismatch'
  );

  // Real mismatch caught on Camellia despite male Airam preceding sentence
  const mixedClause = runQaLinter(
    'Airam shook his head. Camellia looked out the window.',
    'Айрам качнул головой. Камелия посмотрел в окно.',
    glossary,
    { glossaryMeta }
  );
  const camelliaIssues = mixedClause.issues.filter((i) => i.ruleId === 'CHARACTER_GENDER_MISMATCH');
  assert.equal(camelliaIssues.length, 1);
  assert.ok(camelliaIssues[0]!.ruleTitle.includes('Камелия'));

  // Copula dash "Он — был магом." -> flagged and repaired to "Он был магом."
  const copulaLint = runQaLinter('He was a mage.', 'Он — был магом.', glossary, { glossaryMeta });
  assert.ok(copulaLint.issues.some((i) => i.ruleId === 'DASH_AND_COMMA_INFLATION'));
  const copulaFixed = autoRepairRussianText('Он — был магом.', { glossary, glossaryMeta });
  assert.ok(copulaFixed.repairedText.includes('Он был магом.'));

  // Hostile formal pronoun "Вы" + 2pl verb flagged
  const regLint = runQaLinter(
    '"Puppy, you must shut up!"',
    '— Щенок, Вы должны замолчать прямо сейчас!',
    glossary
  );
  assert.ok(regLint.issues.some((i) => i.ruleId === 'REGISTER_PRONOUN_SHIFT'));

  // Tautology repair on "посмотрел на" must never produce "окинул взглядом на"
  const repeatedLook =
    'Он посмотрел на окно. Потом он посмотрел на дверь. Затем он посмотрел на стол и снова посмотрел на стену.';
  const lookFixed = autoRepairRussianText(repeatedLook, { glossary, glossaryMeta });
  assert.ok(
    !lookFixed.repairedText.includes('окинул взглядом на'),
    `Ungrammatical colocation "окинул взглядом на" leaked into: ${lookFixed.repairedText}`
  );
});

test('Audit Phase 10 (C7): SSRF blocker (IPv4/IPv6/CGNAT), Host/CSRF request verifier & client LLM sanitizer', async () => {
  const { validateSafeColabEndpointUrl, verifyStudioApiRequest, sanitizeClientLlmConfig } =
    await import('./api-security.ts');

  assert.equal(validateSafeColabEndpointUrl('http://localhost:11434').ok, true);
  assert.equal(validateSafeColabEndpointUrl('https://abc.ngrok-free.app').ok, true);

  const blockedUrls = [
    'http://127.0.0.1:3000',
    'http://[::1]:8080',
    'http://[::ffff:169.254.169.254]/latest/meta-data',
    'http://[fd00::1]:11434',
    'http://[fe80::1]:11434',
    'http://100.64.0.1:11434',
    'http://user:pass@example.com',
  ];
  for (const url of blockedUrls) {
    assert.equal(validateSafeColabEndpointUrl(url).ok, false, `URL must be blocked: ${url}`);
  }

  const badHostReq = new Request('http://localhost:3000/api/projects', {
    method: 'POST',
    headers: { host: 'evil.example.com' },
  });
  assert.equal(verifyStudioApiRequest(badHostReq).status, 403);

  const crossSiteReq = new Request('http://localhost:3000/api/projects', {
    method: 'POST',
    headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(verifyStudioApiRequest(crossSiteReq).status, 403);

  const prevToken = process.env.STUDIO_API_TOKEN;
  try {
    process.env.STUDIO_API_TOKEN = 'test-studio-secret-token';
    const noAuthReq = new Request('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: { host: 'localhost:3000' },
    });
    assert.equal(verifyStudioApiRequest(noAuthReq).status, 401);

    const goodAuthReq = new Request('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: 'Bearer test-studio-secret-token',
      },
    });
    const authRes = verifyStudioApiRequest(goodAuthReq);
    assert.equal(authRes.ok, true);
    assert.equal(authRes.authenticatedByToken, true);
  } finally {
    if (prevToken !== undefined) process.env.STUDIO_API_TOKEN = prevToken;
    else delete process.env.STUDIO_API_TOKEN;
  }

  const sanitized = sanitizeClientLlmConfig({
    provider: 'deterministic' as unknown as 'colab_ollama',
    modelId: 'qwen3:8b; rm -rf /',
    colabEndpointUrl: 'http://169.254.169.254/latest',
  });
  assert.notEqual(sanitized.provider as string, 'deterministic');
  assert.ok(!sanitized.modelId.includes(';'));
  assert.equal(sanitized.colabEndpointUrl, '');
});

test('Audit Phase 10 (P1/P2/P3): SQLite WAL+OCC, morphology, Korean system box, Banded-DTW, stream parser, slop cooldown, JobBroker SSE', async () => {
  const { StudioSqliteDatabase, DiskDatabaseConflictError } = await import('./sqlite-db-server.ts');
  const { buildInflectedRussianForms, inferGenderFromContext } = await import('./canon-glossary-vault.ts');
  const { finalizeAndVerifyChapter } = await import('./chapter-verifier.ts');
  const { parsePass1TranslationOutput, buildPass1ContinuationPrompt } = await import('./llm-inference-port.ts');
  const { detectCrossChapterSlopCooldown } = await import('./delta-diting.ts');
  const { StudioPipelineJobBroker } = await import('./job-broker.ts');

  // 1. SQLite WAL + JSON migration + per-chapter revision OCC (with Windows handle close before rmSync)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-phase10-'));
  const jsonMirrorPath = path.join(tmpDir, 'novels_db.json');
  const sqlitePath = path.join(tmpDir, 'studio.db');
  let db: InstanceType<typeof StudioSqliteDatabase> | null = null;

  try {
    fs.writeFileSync(jsonMirrorPath, serializeDiskDatabasePayload([INITIAL_NOVELS[0]]), 'utf8');
    db = new StudioSqliteDatabase({ sqlitePath, jsonMirrorPath });
    const loaded = db.readAllNovels();
    assert.equal(loaded.novels.length, 1);
    const targetNovel = loaded.novels[0]!;
    const targetChapter = targetNovel.chapters[0]!;
    const rev0 = targetChapter.revision ?? 1;

    const patched1 = db.patchChapterAtomic(
      targetNovel.id,
      targetChapter.id,
      (ch) => ({ ...ch, rusText: 'Обновлённый абзац в SQLite.' }),
      { expectedRevision: rev0, syncJsonMirror: 'none' }
    );
    assert.equal(patched1.chapter.revision, rev0 + 1);

    assert.throws(
      () =>
        db!.patchChapterAtomic(
          targetNovel.id,
          targetChapter.id,
          (ch) => ({ ...ch, rusText: 'Конфликтная запись.' }),
          { expectedRevision: rev0, syncJsonMirror: 'none' }
        ),
      (err: unknown) => err instanceof DiskDatabaseConflictError
    );

    // 2. Job Broker + SSE subscription lifecycle on isolated tmpDb
    const brokerNovelId = targetNovel.id;
    const targetChapId = targetNovel.chapters.find((c) => c.number === 2)?.id || targetChapter.id;
    db.patchChapterAtomic(
      brokerNovelId,
      targetChapId,
      (ch) => ({
        ...ch,
        translated: false,
        verified: false,
        rusText: '',
        engText: 'Lin Xuan walked into the hall calmly.',
        titleEng: 'Quiet Hall',
      }),
      { syncJsonMirror: 'none' }
    );

    const broker = new StudioPipelineJobBroker(db);
    const startRes = broker.startJob({
      novelId: brokerNovelId,
      targetChapterIds: [targetChapId],
      mode: 'full_5_phase',
      autoCanonEnabled: false,
      twoPassCriticEnabled: false,
      llmConfig: {
        ...DEFAULT_LLM_PROVIDER_CONFIG,
        provider: 'deterministic' as unknown as 'colab_ollama',
      },
    });
    assert.equal(startRes.ok, true);
    if (startRes.ok) {
      const seenEvents: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('JobBroker SSE timeout')), 8000);
        const sub = broker.subscribe(startRes.job.id, (evt) => {
          seenEvents.push(evt.type);
          if (evt.type === 'completed' || evt.type === 'failed' || evt.type === 'cancelled') {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          }
        });
        if (
          sub.job &&
          (sub.job.status === 'completed' || sub.job.status === 'failed' || sub.job.status === 'cancelled')
        ) {
          clearTimeout(timeout);
          sub.unsubscribe();
          resolve();
        }
      });

      const finishedJob = broker.getJob(startRes.job.id);
      assert.equal(finishedJob?.status, 'completed');
      assert.ok(seenEvents.includes('chapter_done') || finishedJob?.completedChapters === 1);
    }
  } finally {
    db?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 3. Morphology + UNKNOWN gender inference
  const cauldronForms = buildInflectedRussianForms('Котёл Чёрного Железа', {
    category: 'system_and_terms',
  }).map((f) => f.form);
  assert.ok(
    cauldronForms.includes('Котла Чёрного Железа'),
    `Expected gen_sg "Котла Чёрного Железа", got: ${cauldronForms.join(', ')}`
  );

  const canonForms = buildInflectedRussianForms('Великий Канон', {
    category: 'system_and_terms',
  }).map((f) => f.form);
  assert.ok(
    canonForms.includes('Великого Канона'),
    `Expected gen_sg "Великого Канона", got: ${canonForms.join(', ')}`
  );

  const gateForms = buildInflectedRussianForms('Небесные Врата', {
    category: 'sects_and_places',
  }).map((f) => f.form);
  assert.ok(
    gateForms.includes('Небесных Врат'),
    `Expected gen_pl "Небесных Врат", got: ${gateForms.join(', ')}`
  );

  const irinaForms = buildInflectedRussianForms('Ирина', {
    category: 'characters',
    gender: 'F',
    isPersonName: true,
  }).map((f) => f.form);
  assert.ok(irinaForms.includes('Ирины'), `Expected "Ирины", got: ${irinaForms.join(', ')}`);

  assert.equal(inferGenderFromContext('Crimson Tablet', 'The ancient tablet glowed brightly.'), 'UNKNOWN');

  // 4. Korean system box preservation (inSystemBox)
  const krNorm = normalizeKoreanDirect(
    'He stood up.\nWalked over.\n\n---\n[Статус]\nУровень: 12\nСила: 40\n---\n\nAnd smiled.'
  );
  assert.equal(krNorm.groupedParagraphCount, 3);
  assert.ok(
    krNorm.normalizedText.includes('[Статус]\nУровень: 12\nСила: 40'),
    'Lines inside --- system box must preserve newlines instead of merging with spaces'
  );

  // 5. Banded-DTW without <= 10 cliff (|N - M| = 15: 15 ENG vs 30 split RUS paragraphs)
  const eng15 = Array.from(
    { length: 15 },
    (_, i) =>
      `Elder Bai walked down stone corridor ${i + 1} while holding a heavy carved jade box in silence.`
  ).join('\n');
  const rus30 = Array.from({ length: 15 }, (_, i) => [
    `Старейшина Бай спокойно шёл по каменному коридору ${i + 1}.`,
    `В руках он молча держал тяжёлую резную нефритовую шкатулку.`,
  ])
    .flat()
    .join('\n');

  const dtwRes = finalizeAndVerifyChapter({
    chapterNumber: 57,
    titleEng: 'Stone Corridor',
    engText: eng15,
    candidateRusText: rus30,
    glossary: {
      realms: {},
      characters: { 'Elder Bai': 'Старейшина Бай' },
      sects_and_places: {},
      system_and_terms: {},
      units: {},
    },
  });
  assert.equal(
    splitChapterParagraphs(dtwRes.rusText).length,
    15,
    'Banded-DTW must merge all 15 split Russian pairs when |N-M|=15 (beyond old <=10 cliff)'
  );
  assert.ok(dtwRes.appliedFixes.some((f) => /DTW|абзац|скле|разрыв/i.test(f)));

  // 6. Streamed @@P000 parser + continuation prompt
  const streamed = parsePass1TranslationOutput(
    '@@TITLE Глава 7. Закалка\n@@P000 Первый абзац.\n@@P001 Второй абзац.',
    4
  );
  assert.equal(streamed.titleRus, 'Глава 7. Закалка');
  assert.equal(streamed.paragraphs.length, 2);
  assert.equal(streamed.truncated, true);
  assert.equal(streamed.lastCompletedIndex, 1);

  const contPrompt = buildPass1ContinuationPrompt({
    chapterNumber: 7,
    titleEng: 'Tempering',
    engText: 'One.\nTwo.\nThree.\nFour.',
    alreadyTranslatedParagraphs: streamed.paragraphs,
    startParagraphIndex: streamed.lastCompletedIndex + 1,
    outputFormat: 'stream_delimited',
  });
  assert.ok(contPrompt.userPrompt.includes('#p2'));
  assert.ok(!contPrompt.userPrompt.includes('#p0]'));

  // 7. Cross-chapter slop cooldown (detects repeated cliché/4-gram, skips canonical glossary phrases)
  const slopIssues = detectCrossChapterSlopCooldown({
    currentChapterNumber: 10,
    rusText: 'Старейшина глубоко вздохнул, скрыв холодный блеск в глазах в Павильон Нефритового Лотоса Гор.',
    glossary: {
      realms: {},
      characters: {},
      sects_and_places: { 'Jade Lotus Peak Pavilion': 'Павильон Нефритового Лотоса Гор' },
      system_and_terms: {},
      units: {},
    },
    previousChapters: [
      { number: 6, rusText: 'Вечером он вошёл в Павильон Нефритового Лотоса Гор.' },
      { number: 7, rusText: 'В глазах горел холодный блеск в глазах, а затем Павильон Нефритового Лотоса Гор опустел.' },
      { number: 8, rusText: 'Даже ночью холодный блеск в глазах пугал гостей Павильон Нефритового Лотоса Гор.' },
      { number: 9, rusText: 'Утром все покинули зал.' },
    ],
  });
  assert.ok(
    slopIssues.some((s) => s.phrase.includes('холодный блеск в глазах')),
    'Expected cross-chapter cliché cooldown trigger'
  );
  assert.equal(
    slopIssues.some((s) => s.phrase.includes('павильон нефритового лотоса')),
    false,
    'Canonical glossary phrases must be exempt from cross-chapter slop cooldown'
  );
});

test('Audit Phase 10 (D1/D2/D3 Hardening): Whole-book chapter OCC conflict, trailing-dot SSRF parity, DISABLE_CLIENT_AGY_CLI=1', async () => {
  const { StudioSqliteDatabase, DiskDatabaseConflictError } = await import('./sqlite-db-server.ts');
  const { validateSafeColabEndpointUrl, sanitizeClientLlmConfig } = await import('./api-security.ts');
  const { createPipelineLlmPort, FallbackChainAdapter, AntigravityCliAdapter } = await import(
    './llm-inference-port.ts'
  );
  const { StudioPipelineJobBroker } = await import('./job-broker.ts');

  // 1. D1: Concurrent PATCH during whole-book save and batch broker run must NEVER lose USER_EDIT
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-hardening-'));
  const jsonMirrorPath = path.join(tmpDir, 'novels_db.json');
  const sqlitePath = path.join(tmpDir, 'studio.db');
  let db: InstanceType<typeof StudioSqliteDatabase> | null = null;

  try {
    const baseNovel: NovelProject = {
      ...INITIAL_NOVELS[0],
      chapters: INITIAL_NOVELS[0].chapters.slice(0, 2).map((ch, idx) => ({
        ...ch,
        id: `occ-${idx + 1}`,
        number: idx + 1,
        translated: false,
        verified: false,
        rusText: '',
        engText: `Chapter ${idx + 1}: Lin Xuan meditated in the jade hall.`,
        titleEng: `Hall ${idx + 1}`,
      })),
    };
    fs.writeFileSync(jsonMirrorPath, serializeDiskDatabasePayload([baseNovel]), 'utf8');
    db = new StudioSqliteDatabase({ sqlitePath, jsonMirrorPath });

    const initialRead = db.readAllNovels();
    const staleNovelSnapshot = structuredClone(initialRead.novels[0]!);

    // User PATCHes chapter 1 -> rev 2 ("USER_EDIT")
    const userPatch = db.patchChapterAtomic(
      baseNovel.id,
      'occ-1',
      (ch) => ({ ...ch, rusText: 'USER_EDIT', translated: true, status: 'translated' }),
      { expectedRevision: 1, syncJsonMirror: 'none' }
    );
    assert.equal(userPatch.revision, 2);

    // Stale whole-book copy (ch rev 1 != db rev 2) carrying stale rusText must be rejected even with fresh baseUpdatedAt
    const latestMeta = db.readAllNovels();
    staleNovelSnapshot.chapters[0]!.rusText = 'JOB_OUTPUT_FROM_STALE_COPY';
    assert.throws(
      () =>
        db!.writeAllNovels([staleNovelSnapshot], {
          baseUpdatedAt: latestMeta.updatedAt,
          syncJsonMirror: false,
        }),
      (err: unknown) => err instanceof DiskDatabaseConflictError
    );

    // Direct whole-book update without stale rev (or matching rev) that mutates chapter must bump revision -> stale PATCH(rev 2) rejected
    const freshSnapshot = db.readAllNovels();
    freshSnapshot.novels[0]!.chapters[0]!.rusText = 'FRESH_BOOK_EDIT';
    db.writeAllNovels(freshSnapshot.novels, {
      baseUpdatedAt: freshSnapshot.updatedAt,
      syncJsonMirror: false,
    });
    const afterWholeBook = db.readAllNovels();
    assert.equal(afterWholeBook.novels[0]!.chapters[0]!.revision, 3);
    assert.throws(
      () =>
        db!.patchChapterAtomic(
          baseNovel.id,
          'occ-1',
          (ch) => ({ ...ch, rusText: 'STALE_PATCH' }),
          { expectedRevision: 2, syncJsonMirror: 'none' }
        ),
      (err: unknown) => err instanceof DiskDatabaseConflictError
    );

    // Commit batch merge preserves user edit made after chapter_complete (committed rev 3 != latest rev 4)
    const afterUserSecondPatch = db.patchChapterAtomic(
      baseNovel.id,
      'occ-1',
      (ch) => ({ ...ch, rusText: 'USER_EDIT_AFTER_CHAPTER_COMPLETE' }),
      { expectedRevision: 3, syncJsonMirror: 'none' }
    );
    assert.equal(afterUserSecondPatch.revision, 4);

    const simulatedBatchOutput: NovelProject = structuredClone(staleNovelSnapshot);
    simulatedBatchOutput.chapters[0]!.rusText = 'STALE_PROCESSED_COPY';
    simulatedBatchOutput.chapters[1]!.rusText = 'Глава 2 переведена пакетом.';
    simulatedBatchOutput.chapters[1]!.translated = true;

    db.commitBatchNovelResult({
      novelId: baseNovel.id,
      updatedNovel: simulatedBatchOutput,
      targetChapterIds: new Set(['occ-1', 'occ-2']),
      initialChapterRevisions: new Map([
        ['occ-1', 1],
        ['occ-2', 1],
      ]),
      committedChapterRevisions: new Map([['occ-1', 3]]),
      conflictedChapterIds: new Set(),
      syncJsonMirror: false,
    });

    const afterCommit = db.readAllNovels();
    assert.equal(afterCommit.novels[0]!.chapters[0]!.rusText, 'USER_EDIT_AFTER_CHAPTER_COMPLETE');
    assert.equal(afterCommit.novels[0]!.chapters[0]!.revision, 4);
    assert.equal(afterCommit.novels[0]!.chapters[1]!.rusText, 'Глава 2 переведена пакетом.');
    assert.equal(afterCommit.novels[0]!.chapters[1]!.revision, 2);

    // Also smoke-test StudioPipelineJobBroker instantiates cleanly with db override
    assert.ok(new StudioPipelineJobBroker(db));
  } finally {
    db?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 2. D2: Unified SSRF validator blocks trailing-dot FQDNs & NAT64 identically in api-security and qa-linter
  const fqdnBypassUrls = [
    'http://localhost.:6379',
    'http://foo.localhost.:80',
    'http://metadata.google.internal./computeMetadata/v1',
    'https://metadata.google.internal./computeMetadata/v1',
    'https://[64:ff9b::169.254.169.254]',
  ];
  for (const url of fqdnBypassUrls) {
    assert.equal(validateSafeColabEndpointUrl(url).ok, false, `api-security must block ${url}`);
    assert.equal(validateColabEndpointUrl(url).ok, false, `qa-linter must block ${url}`);
  }

  // 3. D3: DISABLE_CLIENT_AGY_CLI=1 blocks AntigravityCliAdapter across all client provider inputs
  const prevDisableAgy = process.env.DISABLE_CLIENT_AGY_CLI;
  try {
    process.env.DISABLE_CLIENT_AGY_CLI = '1';
    for (const rawProv of ['antigravity_cli', 'colab_ollama', 'gemini_api'] as const) {
      const sanitized = sanitizeClientLlmConfig({ provider: rawProv });
      assert.notEqual(sanitized.provider, 'antigravity_cli');
      const port = createPipelineLlmPort(sanitized) as InstanceType<typeof FallbackChainAdapter>;
      assert.equal(
        port.adapters.some((a) => a instanceof AntigravityCliAdapter),
        false,
        `DISABLE_CLIENT_AGY_CLI=1 must prevent AntigravityCliAdapter for ${rawProv}`
      );
    }
  } finally {
    if (prevDisableAgy !== undefined) process.env.DISABLE_CLIENT_AGY_CLI = prevDisableAgy;
    else delete process.env.DISABLE_CLIENT_AGY_CLI;
  }
});

test('Audit Phase 11: Selective US Proxy + Local CUDA Bridge Hardening (pool cache, Windows Python order, socks5h strip)', async () => {
  const { getAiClientPool } = await import('./llm-inference-port.ts');
  const { getOrderedPythonCandidates, buildSanitizedPythonEnv } = await import('./local-embed-client.ts');

  // 1. getAiClientPool caches identical key sets without mutating GEMINI_API_KEY / GOOGLE_API_KEY
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGeminiKeys = process.env.GEMINI_API_KEYS;
  const prevGoogleKeys = process.env.GOOGLE_API_KEYS;
  try {
    process.env.GEMINI_API_KEY = 'AIzaTestKeyPhase11AlphaAlphaAlpha';
    process.env.GOOGLE_API_KEY = 'AIzaTestKeyPhase11AlphaAlphaAlpha';
    delete process.env.GEMINI_API_KEYS;
    delete process.env.GOOGLE_API_KEYS;

    const poolA = getAiClientPool();
    const poolB = getAiClientPool();
    assert.equal(poolA.length, 1);
    assert.strictEqual(poolA[0].client, poolB[0].client);
    assert.equal(process.env.GEMINI_API_KEY, 'AIzaTestKeyPhase11AlphaAlphaAlpha');
    assert.equal(process.env.GOOGLE_API_KEY, 'AIzaTestKeyPhase11AlphaAlphaAlpha');

    process.env.GOOGLE_API_KEYS = 'AIzaTestKeyPhase11BetaBetaBetaBeta';
    const poolC = getAiClientPool();
    assert.equal(poolC.length, 2);
    assert.notStrictEqual(poolC, poolA);
  } finally {
    if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
    else delete process.env.GEMINI_API_KEY;
    if (prevGoogle !== undefined) process.env.GOOGLE_API_KEY = prevGoogle;
    else delete process.env.GOOGLE_API_KEY;
    if (prevGeminiKeys !== undefined) process.env.GEMINI_API_KEYS = prevGeminiKeys;
    else delete process.env.GEMINI_API_KEYS;
    if (prevGoogleKeys !== undefined) process.env.GOOGLE_API_KEYS = prevGoogleKeys;
    else delete process.env.GOOGLE_API_KEYS;
  }

  // 2. Python interpreter ordering avoids Windows Store python3.exe stub
  assert.deepEqual(getOrderedPythonCandidates('win32', ''), ['python', 'python3']);
  assert.deepEqual(getOrderedPythonCandidates('linux', ''), ['python3', 'python']);
  assert.deepEqual(getOrderedPythonCandidates('win32', 'C:\\Python312\\python.exe'), [
    'C:\\Python312\\python.exe',
    'python',
    'python3',
  ]);

  // 3. Python env sanitizer removes socks5h:// ALL_PROXY while preserving HTTP/HTTPS/NO_PROXY
  const cleanEnv = buildSanitizedPythonEnv({
    ALL_PROXY: 'socks5h://127.0.0.1:1081',
    all_proxy: 'SOCKS5://127.0.0.1:1081',
    HTTP_PROXY: 'http://127.0.0.1:1081',
    HTTPS_PROXY: 'http://127.0.0.1:1081',
    NO_PROXY: 'localhost,127.0.0.1,*.ru',
  });
  assert.equal(cleanEnv.ALL_PROXY, undefined);
  assert.equal(cleanEnv.all_proxy, undefined);
  assert.equal(cleanEnv.HTTP_PROXY, 'http://127.0.0.1:1081');
  assert.equal(cleanEnv.HTTPS_PROXY, 'http://127.0.0.1:1081');
  assert.equal(cleanEnv.NO_PROXY, 'localhost,127.0.0.1,*.ru');
  assert.equal(cleanEnv.HF_HUB_DISABLE_TELEMETRY, '1');
  assert.equal(cleanEnv.PYTHONIOENCODING, 'utf-8');
});

test('Audit Phase 12 (Gemini 4 Hydrogen + Decision 1 Engine + Per-Project-Model Quota Isolation)', async () => {
  const {
    getAiClientPool,
    RotatingGeminiAdapter,
    registerGeminiKeyProject,
    isGeminiBucketCoolingDown,
    markGeminiBucketQuotaError,
    resetGeminiPoolStateForTests,
  } = await import('./llm-inference-port.ts');
  const {
    runGeminiDecisionBatch,
    analyzeChapterPreFlightWithDecision1,
    auditChapterDraftWithDecision1,
    refereeStylistRewritesWithDecision1,
  } = await import('./gemini-decision-engine.ts');
  const { sanitizeClientLlmConfig } = await import('./api-security.ts');

  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGeminiKeys = process.env.GEMINI_API_KEYS;
  const prevGoogleKeys = process.env.GOOGLE_API_KEYS;

  try {
    resetGeminiPoolStateForTests();
    process.env.GEMINI_API_KEY = 'AIzaTestPhase12KeyAlpha000001';
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEYS;
    process.env.GOOGLE_API_KEYS = 'AIzaTestPhase12KeyBeta000002,AIzaTestPhase12KeyGamma000003';

    // 1. Per-(project, model) quota isolation & shared projectNumber buckets
    registerGeminiKeyProject('AIzaTestPhase12KeyAlpha000001', '111000111');
    registerGeminiKeyProject('AIzaTestPhase12KeyBeta000002', '111000111'); // same GCP project
    registerGeminiKeyProject('AIzaTestPhase12KeyGamma000003', '222000222'); // distinct GCP project

    markGeminiBucketQuotaError(
      'AIzaTestPhase12KeyAlpha000001',
      'gemini-4-hydrogen',
      '429 RESOURCE_EXHAUSTED PerDay'
    );
    assert.equal(isGeminiBucketCoolingDown('AIzaTestPhase12KeyAlpha000001', 'gemini-4-hydrogen'), true);
    assert.equal(
      isGeminiBucketCoolingDown('AIzaTestPhase12KeyBeta000002', 'gemini-4-hydrogen'),
      true,
      'Two keys sharing one GCP project must share Hydrogen quota cooldown'
    );
    assert.equal(
      isGeminiBucketCoolingDown('AIzaTestPhase12KeyAlpha000001', 'gemini-3.8-flash'),
      false,
      'Hydrogen cooldown must not block gemini-3.8-flash on the same key'
    );
    assert.equal(
      isGeminiBucketCoolingDown('AIzaTestPhase12KeyAlpha000001', 'gemini-decision-1'),
      false,
      'Hydrogen cooldown must not block gemini-decision-1 on the same key'
    );
    assert.equal(
      isGeminiBucketCoolingDown('AIzaTestPhase12KeyGamma000003', 'gemini-4-hydrogen'),
      false,
      'Independent GCP project must stay available'
    );

    // 2. RotatingGeminiAdapter: ThinkingConfig, skip explicit caches on gemini-4-*, and tier overflow
    resetGeminiPoolStateForTests();
    process.env.GOOGLE_API_KEYS = '';
    const pool = getAiClientPool();
    assert.equal(pool.length, 1);
    const savedClient = pool[0]!.client;
    const seenCalls: Array<{ model: string; thinkingLevel?: string }> = [];
    const cacheModelsCreated: string[] = [];

    try {
      pool[0]!.client = {
        caches: {
          create: async (args: { model: string }) => {
            cacheModelsCreated.push(args.model);
            return { name: `cached-${args.model}` };
          },
        },
        models: {
          generateContent: async (args: {
            model: string;
            config?: { thinkingConfig?: { thinkingLevel?: string } };
          }) => {
            seenCalls.push({
              model: args.model,
              thinkingLevel: args.config?.thinkingConfig?.thinkingLevel,
            });
            if (args.model === 'gemini-4-hydrogen') {
              throw new Error('429 RESOURCE_EXHAUSTED PerDay for gemini-4-hydrogen');
            }
            return { text: 'Перевод выполнен через резервный уровень.' };
          },
        },
      } as unknown as typeof savedClient;

      const adapter = new RotatingGeminiAdapter({ model: 'gemini-4-hydrogen' });
      const res = await adapter.complete({
        task: 'translate_pass1',
        geminiModel: 'gemini-4-hydrogen',
        thinkingLevel: 'xhigh',
        cacheKey: 'arc-test-cache',
        systemInstruction: 'S'.repeat(4500),
        userPrompt: 'Lin Xuan stepped forward.',
      });

      assert.equal(
        cacheModelsCreated.includes('gemini-4-hydrogen'),
        false,
        'gemini-4-* must skip explicit caches.create'
      );
      assert.equal(seenCalls[0]?.model, 'gemini-4-hydrogen');
      assert.equal(seenCalls[0]?.thinkingLevel, 'XHIGH');
      assert.equal(seenCalls[1]?.model, 'gemini-3.8-flash');
      assert.equal(
        seenCalls[1]?.thinkingLevel,
        'HIGH',
        'XHIGH must clamp cleanly to HIGH when overflowing onto gemini-3.8-flash'
      );
      assert.equal(res.engineUsed, 'gemini-3.8-flash');
      assert.equal(res.provider, 'gemini_api');
    } finally {
      pool[0]!.client = savedClient;
    }

    // 3. Decision-1 Engine batching, Pre-Flight, 10-Rubric Radar, and Stylist A/B Referee
    resetGeminiPoolStateForTests();
    let chunkCalls = 0;
    const batchMockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      chunkCalls += 1;
      const body = JSON.parse(String(init?.body || '{}')) as {
        questions: Record<string, { type: string }>;
      };
      const answers: Record<string, unknown> = {};
      Object.keys(body.questions).forEach((k) => {
        answers[k] = { type: 'noul', noul: 0.9, confidence: 0.9 };
      });
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;

    const batchOut = await runGeminiDecisionBatch(
      'Sample input',
      {
        q1: { type: 'noul', instructions: '1' },
        q2: { type: 'noul', instructions: '2' },
        q3: { type: 'noul', instructions: '3' },
        q4: { type: 'noul', instructions: '4' },
        q5: { type: 'noul', instructions: '5' },
      },
      { fetchImpl: batchMockFetch, maxQuestionsPerCall: 2 }
    );
    assert.equal(chunkCalls, 3);
    assert.equal(Object.keys(batchOut.answers).length, 5);

    const preFlightMockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        questions: Record<string, { type: string }>;
      };
      const answers: Record<string, unknown> = {
        scene_pacing: { type: 'choice', choice: 'romance_psychology', confidence: 0.91 },
        literary_complexity: { type: 'score', score: 3.1, confidence: 0.88 },
        narrator_pov_gender: { type: 'choice', choice: 'f_female', confidence: 0.94 },
        term_0_keep: { type: 'noul', noul: 0.93, confidence: 0.93 },
        term_0_cat: { type: 'choice', choice: 'characters', confidence: 0.95 },
        term_0_gen: { type: 'choice', choice: 'f_female', confidence: 0.92 },
        term_1_keep: { type: 'noul', noul: 0.12, confidence: 0.88 },
        term_1_cat: { type: 'choice', choice: 'system_and_terms', confidence: 0.8 },
        term_1_gen: { type: 'choice', choice: 'z_unknown', confidence: 0.9 },
        pair_0_reg: { type: 'choice', choice: 'vy_formal', confidence: 0.89 },
      };
      // Ensure keys match request keys
      const filtered: Record<string, unknown> = {};
      for (const k of Object.keys(body.questions)) {
        filtered[k] = answers[k] || { type: 'noul', noul: 0.5, confidence: 0.5 };
      }
      return new Response(JSON.stringify({ answers: filtered }), { status: 200 });
    }) as typeof fetch;

    const preRes = await analyzeChapterPreFlightWithDecision1(
      {
        chapterNumber: 12,
        engText: 'Lady Su spoke softly.',
        candidateTerms: [
          { eng: 'Lady Su', context_snippet: 'Lady Su spoke' },
          { eng: 'Spoke Softly', context_snippet: 'Lady Su spoke softly' },
        ],
        dialoguePairs: [{ fromCharacter: 'Disciple', toCharacter: 'Elder' }],
      },
      { fetchImpl: preFlightMockFetch }
    );
    assert.equal(preRes.pacingMode, 'romance_psychology');
    assert.equal(preRes.recommendedThinkingLevel, 'xhigh');
    assert.equal(preRes.narratorGender, 'F');
    assert.equal(preRes.termDecisions['Lady Su']?.keep, true);
    assert.equal(preRes.termDecisions['Lady Su']?.gender, 'F');
    assert.equal(preRes.termDecisions['Spoke Softly']?.keep, false);
    assert.equal(preRes.pairRegisterDecisions[0]?.pronounMode, 'Вы');

    const auditMockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        questions: Record<string, { type: string }>;
      };
      const answers: Record<string, unknown> = {};
      for (const k of Object.keys(body.questions)) {
        if (k.startsWith('q')) {
          answers[k] = { type: 'score', score: 3.6, confidence: 0.9 }; // 9.0 / 10
        } else if (k === 'p0_calque') {
          answers[k] = { type: 'noul', noul: 0.82, confidence: 0.82 };
        } else {
          answers[k] = { type: 'noul', noul: 0.08, confidence: 0.92 };
        }
      }
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;

    const auditRes = await auditChapterDraftWithDecision1(
      {
        chapterNumber: 12,
        engText: 'Paragraph one.\n\nParagraph two.',
        rusText: 'Абзац первый с завершением дела.\n\nВторой живой абзац.',
      },
      { fetchImpl: auditMockFetch }
    );
    assert.equal(auditRes.skipGenerativePass2, true);
    assert.equal(auditRes.otqsScore, 9);
    assert.equal(auditRes.flawedAccuracyParagraphs.length, 0);
    assert.equal(auditRes.stylisticDirectives.length, 1);
    assert.equal(auditRes.stylisticDirectives[0]?.paragraphIndex, 0);

    const refereeMockFetch = (async () =>
      new Response(
        JSON.stringify({
          answers: {
            ref_0_meaning: { type: 'noul', noul: 0.94, confidence: 0.94 },
            ref_0_winner: { type: 'choice', choice: 'b_styled_rewrite', confidence: 0.9 },
            ref_1_meaning: { type: 'noul', noul: 0.42, confidence: 0.85 },
            ref_1_winner: { type: 'choice', choice: 'b_styled_rewrite', confidence: 0.8 },
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const refereeOut = await refereeStylistRewritesWithDecision1(
      {
        engParagraphs: ['Eng zero.', 'Eng one.'],
        verifiedRusParagraphs: ['Версия А ноль.', 'Версия А один.'],
        styledParagraphs: [
          { index: 0, styledRusText: 'Живая версия Б ноль.' },
          { index: 1, styledRusText: 'Галлюцинация Б один.' },
        ],
      },
      { fetchImpl: refereeMockFetch }
    );
    assert.equal(refereeOut.acceptedParagraphs.length, 1);
    assert.equal(refereeOut.acceptedParagraphs[0]?.index, 0);
    assert.deepEqual(refereeOut.rejectedIndices, [1]);

    // 4. sanitizeClientLlmConfig: clean defaults & validation for gemini_api
    const sanitizedGemini = sanitizeClientLlmConfig({
      provider: 'gemini_api',
      modelId: 'gemma4:26b-a4b',
      thinkingLevel: 'xhigh',
      useDecisionEngine: true,
    });
    assert.equal(sanitizedGemini.provider, 'gemini_api');
    assert.equal(sanitizedGemini.modelId, 'gemini-4-hydrogen');
    assert.equal(sanitizedGemini.criticModelId, 'gemini-3.8-flash');
    assert.equal(sanitizedGemini.scoutModelId, 'gemini-3.1-flash-lite');
    assert.equal(sanitizedGemini.thinkingLevel, 'xhigh');
    assert.equal(sanitizedGemini.useDecisionEngine, true);

    // 5. auditChapterDraftWithDecision1: case-insensitive glossary matching & cognate/root echo radar
    let capturedAuditInput = '';
    let capturedRhythmPrompt = '';
    const canonEchoMockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        input?: string;
        questions: Record<string, { type: string; instructions?: string }>;
      };
      capturedAuditInput = body.input || '';
      capturedRhythmPrompt = body.questions.p0_rhythm?.instructions || '';
      const answers: Record<string, unknown> = {};
      for (const k of Object.keys(body.questions)) {
        if (k.startsWith('q')) {
          answers[k] = { type: 'score', score: 3.4, confidence: 0.9 };
        } else if (k === 'p0_rhythm') {
          answers[k] = { type: 'noul', noul: 0.78, confidence: 0.78 };
        } else {
          answers[k] = { type: 'noul', noul: 0.05, confidence: 0.95 };
        }
      }
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;

    const echoRes = await auditChapterDraftWithDecision1(
      {
        chapterNumber: 199,
        engText: "He knew that ulrich's mana core was damaged.",
        rusText: 'Он знал, что ядро маны Ульриха повреждено, и осколки рассыпались и осыпали землю.',
        glossary: {
          realms: {},
          characters: {},
          sects_and_places: {},
          system_and_terms: { 'Mana Core': 'мана-ядро' },
          units: {},
        },
      },
      { fetchImpl: canonEchoMockFetch }
    );
    assert.ok(
      capturedAuditInput.includes('Mana Core -> мана-ядро'),
      'Case-insensitive glossary lookup must inject Mana Core -> мана-ядро even for lowercase ENG text'
    );
    assert.ok(
      capturedRhythmPrompt.includes('cognate/root repetition'),
      'p0_rhythm prompt must instruct Decision-1 to flag adjacent cognate/root echoes'
    );
    assert.ok(
      echoRes.stylisticDirectives[0]?.rewriteInstructionRu.includes('однокоренные повторы'),
      'RHYTHM directive must instruct Pass 3 Stylist to replace adjacent cognate/root repetitions'
    );

    // 6. finalizeAndVerifyChapter enforces chapter-level INTERNAL_DASH_CAP (<= 2.0%) while preserving split-dialogue dashes
    const { finalizeAndVerifyChapter } = await import('./chapter-verifier.ts');
    const dashHeavyEng = [
      'Rosaline entered the spacious salon, and soft morning light fell across the long wooden tables.',
      'Tall silk curtains hung beside the tall arched windows, while neatly rolled ribbons waited in woven baskets.',
      'Several young assistants stood ready near the mirrors, holding white measuring tapes in quiet anticipation.',
      'Airam examined a silver clasp near the pedestal and carefully traced its cool engraved rim.',
      'Her sisters stayed closer to the doorway, watching how calm and composed the head seamstress looked.',
      'Heavy velvet drapes framed the distant alcove where unfinished royal dresses shimmered gently in the sunlight.',
      '"Please take a seat," she said calmly. "Today we have much important work to finish before dusk."',
      'Sunlight illuminated every delicate pearl thread laid out across the bright satin cushions.',
      'A gentle breeze carried the clean scent of cedar chests from the adjoining storage room.',
      'Nobody spoke first as footsteps echoed faintly beyond the closed oak double doors.',
      'After a brief pause, the senior apprentice stepped forward with three leather-bound sketchbooks.',
      'Everything in the quiet atelier promised long hours of precise work and patient fitting.',
    ].join('\n');
    const splitDialogueLine =
      '— Пожалуйста, садитесь, — спокойно сказала она. — Сегодня у нас много важной работы.';
    const dashHeavyRus = [
      'Розалина вошла в просторный зал — мягкий утренний свет падал на длинные столы.',
      'Высокие шёлковые занавеси висели у стрельчатых окон — плетёные корзины уже наполнили тугими рулонами лент.',
      'Несколько юных помощниц замерли подле высоких зеркал — каждая бережно прижимала белую мерную ленту.',
      'Айрам осмотрела серебряную застёжку на подставке — прохладный гравированный обод блеснул под ладонью.',
      'Младшие сёстры остались чуть ближе к порогу — спокойная осанка старшей мастерицы вызывала невольное уважение.',
      'Тяжёлый бархат скрывал дальнюю нишу — там дожидались примерки недошитые придворные платья.',
      splitDialogueLine,
      'Солнце зажигало крошечные искры на тонких жемчужных нитях, разложенных поверх светлых атласных подушек.',
      'Лёгкий сквозняк доносил сухой хвойный аромат кедровых сундуков из соседней кладовой комнаты.',
      'Никто не нарушал тишину, пока за закрытыми дубовыми створками не стихли отдалённые торопливые шаги.',
      'После короткой паузы старшая ученица вышла вперёд, держа под мышкой три толстых кожаных альбома с эскизами.',
      'Каждая мелочь в светлом тихом ателье предвещала долгие часы кропотливой и точной работы.',
    ].join('\n');
    const preDashStylo = computeStylometricMetrics(dashHeavyRus, dashHeavyEng);
    assert.ok(
      preDashStylo.internalDashPer100Words > 2.0,
      `Expected synthetic draft internalDashPer100Words > 2.0%, got ${preDashStylo.internalDashPer100Words}`
    );
    const dashBudgetRes = finalizeAndVerifyChapter({
      chapterNumber: 57,
      titleEng: 'Quiet Atelier',
      engText: dashHeavyEng,
      candidateRusText: dashHeavyRus,
      glossary: { realms: {}, characters: {}, sects_and_places: {}, system_and_terms: {}, units: {} },
    });
    const dashGateCheck = dashBudgetRes.proseGateReport?.checks.find(
      (c) => c.id === 'INTERNAL_DASH_CAP'
    );
    assert.equal(
      dashGateCheck?.passed,
      true,
      `Expected INTERNAL_DASH_CAP <= 2.0% after chapter budget repair, got ${dashGateCheck?.observed}%`
    );
    assert.ok(
      dashBudgetRes.rusText.includes(splitDialogueLine),
      'Split dialogue attribution and resumption dashes must stay completely intact'
    );
    assert.equal(dashBudgetRes.lintReport.errorCount, 0);
  } finally {
    resetGeminiPoolStateForTests();
    if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
    else delete process.env.GEMINI_API_KEY;
    if (prevGoogle !== undefined) process.env.GOOGLE_API_KEY = prevGoogle;
    else delete process.env.GOOGLE_API_KEY;
    if (prevGeminiKeys !== undefined) process.env.GEMINI_API_KEYS = prevGeminiKeys;
    else delete process.env.GEMINI_API_KEYS;
    if (prevGoogleKeys !== undefined) process.env.GOOGLE_API_KEYS = prevGoogleKeys;
    else delete process.env.GOOGLE_API_KEYS;
  }
});

test('Audit Phase 13 (Hardening): Zero-Cycle DAG, Client/Server Boundary, HMAC Cookie Auth, GOOGLE_API_KEYS Pool, SQLite Mirror & Lease, degradedWarnings', async () => {
  const {
    STUDIO_SESSION_COOKIE_NAME,
    createStudioSessionCookieValue,
    verifyStudioApiRequest,
  } = await import('./api-security.ts');
  const {
    getAiClientPool,
    resetGeminiPoolStateForTests,
  } = await import('./llm-inference-port.ts');
  const {
    StudioSqliteDatabase,
    getStudioSqliteDb,
    closeStudioSqliteDb,
    writeSqliteDatabaseAtomicAsync,
    isProcessPidAlive,
  } = await import('./sqlite-db-server.ts');
  const { StudioPipelineJobBroker } = await import('./job-broker.ts');
  const {
    runPipelineBatchOnNovel: runBrowserSafeBatch,
    InMemoryPipelineTransportAdapter,
  } = await import('./pipeline-batch-runner.ts');
  const { joinParagraphsPreservingSystemBoxes } = await import('./qa-linter.ts');

  // 1. Static Zero-Cycle DAG check across non-test lib/*.ts + Zero Server Imports in components/**
  const libDir = path.resolve(process.cwd(), 'lib');
  const libFiles = fs
    .readdirSync(libDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const libSet = new Set(libFiles);
  const adj = new Map<string, string[]>();

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const isTypeOnlyClause = (clause: string): boolean => {
    const trimmed = clause.trim();
    if (/^type\b/.test(trimmed)) return true;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return inner.length > 0 && inner.every((s) => /^type\s+/.test(s));
    }
    return false;
  };

  for (const file of libFiles) {
    const raw = stripComments(fs.readFileSync(path.join(libDir, file), 'utf8'));
    const deps: string[] = [];
    const stmtRe = /^(?:import|export)\s+([\s\S]*?)\s+from\s+['"](\.\/[^'"]+\.ts)['"]\s*;?/gm;
    let m: RegExpExecArray | null;
    while ((m = stmtRe.exec(raw)) !== null) {
      if (!isTypeOnlyClause(m[1]!) && libSet.has(m[2]!.slice(2))) {
        deps.push(m[2]!.slice(2));
      }
    }
    adj.set(file, Array.from(new Set(deps)));
  }

  const visitState = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const dfs = (node: string) => {
    visitState.set(node, 1);
    stack.push(node);
    for (const next of adj.get(node) || []) {
      const st = visitState.get(next) || 0;
      if (st === 1) {
        cycles.push(stack.slice(stack.indexOf(next)).concat(next));
      } else if (st === 0) {
        dfs(next);
      }
    }
    stack.pop();
    visitState.set(node, 2);
  };
  for (const f of libFiles) {
    if (!visitState.get(f)) dfs(f);
  }
  assert.equal(
    cycles.length,
    0,
    `Expected 0 runtime cycles in lib/, found: ${cycles.map((c) => c.join(' -> ')).join('; ')}`
  );

  const forbiddenServerModules = [
    'llm-inference-port',
    'pipeline-run-engine',
    'gemini-decision-engine',
    'local-embed-client',
    'chapter-verifier-server',
    'sqlite-db-server',
    'job-broker',
    'disk-db-server',
    '@google/genai',
    'node:sqlite',
  ];
  const collectTsFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collectTsFiles(full));
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
    }
    return out;
  };
  const componentFiles = collectTsFiles(path.resolve(process.cwd(), 'components'));
  const clientServerViolations: string[] = [];
  for (const compFile of componentFiles) {
    const code = stripComments(fs.readFileSync(compFile, 'utf8'));
    const importSpecRe = /(?:from|import)\s*\(?['"]([^'"]+)['"]\)?/g;
    let im: RegExpExecArray | null;
    while ((im = importSpecRe.exec(code)) !== null) {
      const spec = im[1]!;
      if (forbiddenServerModules.some((srv) => spec.includes(srv))) {
        clientServerViolations.push(`${path.basename(compFile)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(
    clientServerViolations,
    [],
    `Client components must not import server-only modules: ${clientServerViolations.join(', ')}`
  );

  // 2. HMAC Session Cookie Auth (`studio_session`) alongside Bearer & X-Studio-Token
  const prevStudioToken = process.env.STUDIO_API_TOKEN;
  try {
    const secret = 'phase13-hmac-cookie-token';
    process.env.STUDIO_API_TOKEN = secret;
    const validCookie = createStudioSessionCookieValue(secret);

    assert.equal(
      verifyStudioApiRequest(
        new Request('http://localhost:3000/api/projects', {
          method: 'GET',
          headers: { host: 'localhost:3000' },
        }),
        { requireMutationOrigin: false }
      ).status,
      401
    );

    const cookieAuthRes = verifyStudioApiRequest(
      new Request('http://localhost:3000/api/projects', {
        method: 'GET',
        headers: {
          host: 'localhost:3000',
          cookie: `${STUDIO_SESSION_COOKIE_NAME}=${validCookie}`,
        },
      }),
      { requireMutationOrigin: false }
    );
    assert.equal(cookieAuthRes.ok, true);
    assert.equal(cookieAuthRes.authenticatedByToken, true);

    assert.equal(
      verifyStudioApiRequest(
        new Request('http://localhost:3000/api/projects', {
          method: 'GET',
          headers: {
            host: 'localhost:3000',
            cookie: `${STUDIO_SESSION_COOKIE_NAME}=forged-cookie-value`,
          },
        }),
        { requireMutationOrigin: false }
      ).status,
      401
    );

    assert.equal(
      verifyStudioApiRequest(
        new Request('http://localhost:3000/api/projects', {
          method: 'POST',
          headers: { host: 'localhost:3000', authorization: `Bearer ${secret}` },
        })
      ).authenticatedByToken,
      true
    );
    assert.equal(
      verifyStudioApiRequest(
        new Request('http://localhost:3000/api/projects', {
          method: 'POST',
          headers: { host: 'localhost:3000', 'x-studio-token': secret },
        })
      ).authenticatedByToken,
      true
    );
  } finally {
    if (prevStudioToken !== undefined) process.env.STUDIO_API_TOKEN = prevStudioToken;
    else delete process.env.STUDIO_API_TOKEN;
  }

  // 3. GOOGLE_API_KEYS alone populates getAiClientPool() with exact count
  const prevGem = process.env.GEMINI_API_KEY;
  const prevGoo = process.env.GOOGLE_API_KEY;
  const prevGemKeys = process.env.GEMINI_API_KEYS;
  const prevGooKeys = process.env.GOOGLE_API_KEYS;
  try {
    resetGeminiPoolStateForTests();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEYS;
    process.env.GOOGLE_API_KEYS = 'AIzaTestPoolOnlyKey1111111,AIzaTestPoolOnlyKey2222222';
    const pool = getAiClientPool();
    assert.equal(pool.length, 2);
  } finally {
    resetGeminiPoolStateForTests();
    if (prevGem !== undefined) process.env.GEMINI_API_KEY = prevGem;
    else delete process.env.GEMINI_API_KEY;
    if (prevGoo !== undefined) process.env.GOOGLE_API_KEY = prevGoo;
    else delete process.env.GOOGLE_API_KEY;
    if (prevGemKeys !== undefined) process.env.GEMINI_API_KEYS = prevGemKeys;
    else delete process.env.GEMINI_API_KEYS;
    if (prevGooKeys !== undefined) process.env.GOOGLE_API_KEYS = prevGooKeys;
    else delete process.env.GOOGLE_API_KEYS;
  }

  // 4. SQLite getChapterById, serialized concurrent async JSON mirror, and close() debounced flush
  const tmpMirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-mirror-p13-'));
  const mirrorSqlitePath = path.join(tmpMirrorDir, 'studio.db');
  const mirrorJsonPath = path.join(tmpMirrorDir, 'novels_db.json');
  try {
    const baseNovel: NovelProject = {
      ...INITIAL_NOVELS[0],
      chapters: INITIAL_NOVELS[0].chapters.slice(0, 2).map((c) => ({ ...c })),
    };
    fs.writeFileSync(mirrorJsonPath, serializeDiskDatabasePayload([baseNovel]), 'utf8');
    const sqliteInst = getStudioSqliteDb({
      sqlitePath: mirrorSqlitePath,
      jsonMirrorPath: mirrorJsonPath,
    });
    const targetChap = baseNovel.chapters[0]!;
    const fetchedChap = sqliteInst.getChapterById(baseNovel.id, targetChap.id);
    assert.ok(fetchedChap);
    assert.equal(fetchedChap.chapter.id, targetChap.id);
    assert.ok(typeof fetchedChap.updatedAt === 'string' && fetchedChap.updatedAt.length > 0);

    const v1: NovelProject = { ...baseNovel, name: 'Concurrent V1' };
    const v2: NovelProject = { ...baseNovel, name: 'Concurrent V2' };
    await Promise.all([
      writeSqliteDatabaseAtomicAsync([v1], {
        sqlitePath: mirrorSqlitePath,
        jsonMirrorPath: mirrorJsonPath,
      }),
      writeSqliteDatabaseAtomicAsync([v2], {
        sqlitePath: mirrorSqlitePath,
        jsonMirrorPath: mirrorJsonPath,
      }),
    ]);

    const diskAfterConcurrent = parseDiskDatabasePayload(
      JSON.parse(fs.readFileSync(mirrorJsonPath, 'utf8'))
    );
    assert.equal(sqliteInst.readAllNovels().novels[0]!.name, 'Concurrent V2');
    assert.equal(diskAfterConcurrent.novels[0]!.name, 'Concurrent V2');

    sqliteInst.patchChapterAtomic(
      baseNovel.id,
      targetChap.id,
      (ch) => ({ ...ch, rusText: 'FLUSHED_ON_CLOSE' }),
      { syncJsonMirror: 'debounced' }
    );
    closeStudioSqliteDb(mirrorSqlitePath);

    const diskAfterClose = parseDiskDatabasePayload(
      JSON.parse(fs.readFileSync(mirrorJsonPath, 'utf8'))
    );
    assert.equal(
      diskAfterClose.novels[0]!.chapters.find((c) => c.id === targetChap.id)?.rusText,
      'FLUSHED_ON_CLOSE'
    );
  } finally {
    closeStudioSqliteDb(mirrorSqlitePath);
    fs.rmSync(tmpMirrorDir, { recursive: true, force: true });
  }

  // 5. Same-PID orphan recovery (Docker PID 1 restart) & Cross-process pipeline_jobs lease (live child PID -> 409; exited child -> failed)
  const { spawn } = await import('node:child_process');
  const tmpLeaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-lease-p13-'));
  const leaseSqlitePath = path.join(tmpLeaseDir, 'studio.db');
  const leaseJsonPath = path.join(tmpLeaseDir, 'novels_db.json');
  let leaseDb: InstanceType<typeof StudioSqliteDatabase> | null = null;
  let childProc: ReturnType<typeof spawn> | null = null;
  try {
    const leaseNovel: NovelProject = {
      ...INITIAL_NOVELS[0],
      chapters: [
        {
          ...INITIAL_NOVELS[0].chapters[0]!,
          id: 'lease-ch-1',
          number: 1,
          translated: false,
          verified: false,
          rusText: '',
        },
      ],
    };
    fs.writeFileSync(leaseJsonPath, serializeDiskDatabasePayload([leaseNovel]), 'utf8');
    leaseDb = new StudioSqliteDatabase({
      sqlitePath: leaseSqlitePath,
      jsonMirrorPath: leaseJsonPath,
    });
    const nowIso = new Date().toISOString();

    // 5a. Orphaned row left by an unclean container/PID-1 restart (ownerPid === process.pid, not in activeRuns) must reconcile instead of deadlocking
    leaseDb.upsertPipelineJob({
      id: 'same-pid-orphan-job',
      novelId: leaseNovel.id,
      mode: 'full_5_phase',
      status: 'running',
      startChapter: 1,
      endChapter: 1,
      progressPct: 10,
      currentChapter: 1,
      completedChapters: 0,
      totalChapters: 1,
      quarantinedChapters: 0,
      ownerPid: process.pid,
      statsJson: null,
      errorText: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    assert.equal(
      leaseDb.findActiveJobForNovel(leaseNovel.id, {
        reconcileSamePidOrphans: true,
        activeSamePidJobIds: new Set(),
      }),
      null,
      'Orphaned row matching process.pid (e.g. Docker PID 1 restart) must reconcile instead of self-deadlocking'
    );
    assert.equal(leaseDb.getPipelineJob('same-pid-orphan-job')?.status, 'failed');

    // 5b. Distinct live child process owns active job -> startJob() must block with 409
    childProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const extPid = childProc.pid!;
    assert.ok(extPid > 0 && extPid !== process.pid && isProcessPidAlive(extPid));

    leaseDb.upsertPipelineJob({
      id: 'live-ext-job',
      novelId: leaseNovel.id,
      mode: 'full_5_phase',
      status: 'running',
      startChapter: 1,
      endChapter: 1,
      progressPct: 10,
      currentChapter: 1,
      completedChapters: 0,
      totalChapters: 1,
      quarantinedChapters: 0,
      ownerPid: extPid,
      statsJson: null,
      errorText: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const broker = new StudioPipelineJobBroker(leaseDb);
    const conflictStart = broker.startJob({
      novelId: leaseNovel.id,
      llmConfig: DEFAULT_LLM_PROVIDER_CONFIG,
    });
    assert.equal(conflictStart.ok, false);
    if (!conflictStart.ok) {
      assert.equal(conflictStart.status, 409);
    }

    // 5c. After external child exits cleanly/crashes, findActiveJobForNovel reconciles to 'failed' and releases the lock
    await new Promise<void>((resolve) => {
      childProc!.once('exit', () => resolve());
      childProc!.kill();
    });
    childProc = null;

    assert.equal(leaseDb.findActiveJobForNovel(leaseNovel.id), null);
    assert.equal(leaseDb.getPipelineJob('live-ext-job')?.status, 'failed');

    let deadPid = 999999;
    while (isProcessPidAlive(deadPid)) deadPid += 1;
    leaseDb.upsertPipelineJob({
      id: 'dead-ext-job',
      novelId: leaseNovel.id,
      mode: 'full_5_phase',
      status: 'running',
      startChapter: 1,
      endChapter: 1,
      progressPct: 25,
      currentChapter: 1,
      completedChapters: 0,
      totalChapters: 1,
      quarantinedChapters: 0,
      ownerPid: deadPid,
      statsJson: null,
      errorText: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    assert.equal(leaseDb.findActiveJobForNovel(leaseNovel.id), null);
    assert.equal(leaseDb.getPipelineJob('dead-ext-job')?.status, 'failed');
  } finally {
    if (childProc && !childProc.killed) {
      try {
        childProc.kill();
      } catch {
        // Ignore cleanup kill error
      }
    }
    leaseDb?.close();
    fs.rmSync(tmpLeaseDir, { recursive: true, force: true });
  }

  // 6. degradedWarnings propagation in runPipelineBatchOnNovel & system box preservation
  const degLogs: Array<{ tag: string; message: string; level: string }> = [];
  const degTransport = new InMemoryPipelineTransportAdapter({
    mockScoutHandler: async () => ({ engine: 'mock-scout', discoveredTerms: [] }),
    mockTranslateHandler: async () => ({
      engine: 'mock-degraded',
      titleRus: 'Глава 1. Испытание',
      rusText: 'Линь Сюань спокойно вошёл в каменный павильон ранним утром.',
      summary: 'Герой вошёл в павильон.',
      summaryEng: 'Hero entered the pavilion.',
      csiNotes: [],
      degradedWarnings: ['Pass 3 stylist skipped (timeout)'],
    }),
  });
  const degNovel: NovelProject = {
    ...INITIAL_NOVELS[0],
    chapters: [
      {
        ...INITIAL_NOVELS[0].chapters[0]!,
        id: 'deg-ch-1',
        number: 1,
        titleEng: 'The Trial',
        titleRus: '',
        engText: 'Lin Xuan walked into the stone pavilion calmly early in the morning.',
        rusText: '',
        translated: false,
        scouted: false,
        edited: false,
        verified: false,
      },
    ],
  };

  const degOut = await runBrowserSafeBatch({
    novel: degNovel,
    targetChapterIds: ['deg-ch-1'],
    mode: 'full_5_phase',
    autoCanonEnabled: false,
    twoPassCriticEnabled: true,
    transport: degTransport,
    onProgress: (ev) => {
      if (ev.type === 'log') {
        degLogs.push({ tag: ev.tag, message: ev.message, level: ev.level });
      }
    },
  });
  assert.deepEqual(degOut.updatedNovel.chapters[0]?.degradedWarnings, [
    'Pass 3 stylist skipped (timeout)',
  ]);
  assert.ok(
    degLogs.some(
      (l) =>
        l.tag === 'ДЕГРАДАЦИЯ' &&
        l.level === 'warn' &&
        l.message.includes('Pass 3 stylist skipped (timeout)')
    ),
    'Expected ДЕГРАДАЦИЯ warn log event'
  );

  assert.equal(
    joinParagraphsPreservingSystemBoxes([
      'Intro',
      '---',
      '[Системное уведомление]',
      'Уровень: 5',
      '---',
      'Outro',
    ]),
    'Intro\n\n---\n[Системное уведомление]\nУровень: 5\n---\n\nOutro'
  );
});

test('Audit Phase 14: Split Pass 2 Critic / Pass 3 Stylist, economical Self-Repair routing, gemini_api default & opt-in agy fallback', async () => {
  const { sanitizeClientLlmConfig } = await import('./api-security.ts');
  const {
    createPipelineLlmPort,
    FallbackChainAdapter,
    AntigravityCliAdapter,
  } = await import('./llm-inference-port.ts');
  const { ServerPipelineExecutionAdapter } = await import('./pipeline-run-engine.ts');

  // 1. DEFAULT_LLM_PROVIDER_CONFIG uses ready cloud preset and preserves Decision 1 unit-test isolation (undefined)
  assert.equal(DEFAULT_LLM_PROVIDER_CONFIG.provider, 'gemini_api');
  assert.equal(DEFAULT_LLM_PROVIDER_CONFIG.modelId, 'gemini-4-hydrogen');
  assert.equal(DEFAULT_LLM_PROVIDER_CONFIG.criticModelId, 'gemini-3.8-flash');
  assert.equal(DEFAULT_LLM_PROVIDER_CONFIG.stylistModelId, 'gemini-3.8-flash');
  assert.equal(DEFAULT_LLM_PROVIDER_CONFIG.scoutModelId, 'gemini-3.1-flash-lite');
  assert.equal(DEFAULT_LLM_PROVIDER_CONFIG.thinkingLevel, 'auto_xhigh');
  assert.equal(DEFAULT_LLM_PROVIDER_CONFIG.useDecisionEngine, undefined);

  // 2. sanitizeClientLlmConfig blocks agy by default, blocks agy-only models on gemini_api, preserves gemma stylist, and honors opt-in ENABLE_CLIENT_AGY_CLI=1
  const prevEnableAgy = process.env.ENABLE_CLIENT_AGY_CLI;
  const prevDisableAgy = process.env.DISABLE_CLIENT_AGY_CLI;
  const prevStudioToken = process.env.STUDIO_API_TOKEN;
  const prevImplicitAgy = process.env.ALLOW_IMPLICIT_AGY_FALLBACK;
  try {
    delete process.env.ENABLE_CLIENT_AGY_CLI;
    delete process.env.DISABLE_CLIENT_AGY_CLI;
    delete process.env.STUDIO_API_TOKEN;
    delete process.env.ALLOW_IMPLICIT_AGY_FALLBACK;

    const sanitizedApiBlocked = sanitizeClientLlmConfig({
      provider: 'gemini_api',
      criticModelId: 'gemini-4-argon-medium',
      stylistModelId: 'claude-sonnet-5-5-high',
    });
    assert.equal(sanitizedApiBlocked.criticModelId, 'gemini-3.8-flash');
    assert.equal(sanitizedApiBlocked.stylistModelId, 'gemini-3.8-flash');

    const sanitizedApiGemma = sanitizeClientLlmConfig({
      provider: 'gemini_api',
      stylistModelId: 'gemma-4-31b-it',
    });
    assert.equal(sanitizedApiGemma.stylistModelId, 'gemma-4-31b-it');

    const sanitizedAgyDefaultBlocked = sanitizeClientLlmConfig({
      provider: 'antigravity_cli',
    });
    assert.equal(sanitizedAgyDefaultBlocked.provider, 'gemini_api');

    const blockedAgyPort = createPipelineLlmPort({
      ...DEFAULT_LLM_PROVIDER_CONFIG,
      provider: 'antigravity_cli',
    }) as InstanceType<typeof FallbackChainAdapter>;
    assert.equal(
      blockedAgyPort.adapters.some((a) => a instanceof AntigravityCliAdapter),
      false,
      'antigravity_cli must not attach AntigravityCliAdapter when ENABLE_CLIENT_AGY_CLI !== "1"'
    );

    process.env.ENABLE_CLIENT_AGY_CLI = '1';
    const sanitizedAgyOptIn = sanitizeClientLlmConfig({
      provider: 'antigravity_cli',
    });
    assert.equal(sanitizedAgyOptIn.provider, 'antigravity_cli');
    assert.equal(sanitizedAgyOptIn.stylistModelId, 'claude-sonnet-5-5-high');
    delete process.env.ENABLE_CLIENT_AGY_CLI;

    const sanitizedEmpty = sanitizeClientLlmConfig({
      provider: '' as unknown as 'gemini_api',
    });
    assert.equal(sanitizedEmpty.provider, 'gemini_api');

    // 3. AntigravityCliAdapter routes Pass 2 -> Argon, Pass 3 -> Claude Stylist, Self-Repair -> Primary
    const agyAdapter = new AntigravityCliAdapter();
    assert.equal(agyAdapter.resolveModelForTask('surgical_critic_pass2'), 'gemini-4-argon-medium');
    assert.equal(agyAdapter.resolveModelForTask('blind_stylist_pass3'), 'claude-sonnet-5-5-high');
    assert.equal(agyAdapter.resolveModelForTask('self_repair'), 'gemini-3.8-flash-high');

    // 4. createPipelineLlmPort does not attach AntigravityCliAdapter implicitly without ALLOW_IMPLICIT_AGY_FALLBACK=1
    const cloudPort = createPipelineLlmPort({
      ...DEFAULT_LLM_PROVIDER_CONFIG,
      provider: 'gemini_api',
    }) as InstanceType<typeof FallbackChainAdapter>;
    assert.equal(
      cloudPort.adapters.some((a) => a instanceof AntigravityCliAdapter),
      false,
      'Non-agy provider must not implicitly fall back to AntigravityCliAdapter'
    );
  } finally {
    if (prevEnableAgy !== undefined) process.env.ENABLE_CLIENT_AGY_CLI = prevEnableAgy;
    else delete process.env.ENABLE_CLIENT_AGY_CLI;
    if (prevDisableAgy !== undefined) process.env.DISABLE_CLIENT_AGY_CLI = prevDisableAgy;
    else delete process.env.DISABLE_CLIENT_AGY_CLI;
    if (prevStudioToken !== undefined) process.env.STUDIO_API_TOKEN = prevStudioToken;
    else delete process.env.STUDIO_API_TOKEN;
    if (prevImplicitAgy !== undefined) process.env.ALLOW_IMPLICIT_AGY_FALLBACK = prevImplicitAgy;
    else delete process.env.ALLOW_IMPLICIT_AGY_FALLBACK;
  }

  // 5. ServerPipelineExecutionAdapter separates Pass 2, Pass 3 Stylist & Stage 3 Self-Repair (no xhigh/Hydrogen burn)
  const recordedCalls: Array<{
    task: string;
    geminiModel?: string;
    thinkingLevel?: string;
  }> = [];

  const splitConfig = {
    ...DEFAULT_LLM_PROVIDER_CONFIG,
    provider: 'gemini_api' as const,
    modelId: 'gemini-4-hydrogen',
    criticModelId: 'gemini-3.8-flash',
    stylistModelId: 'gemma-4-31b-it',
    thinkingLevel: 'xhigh' as const,
  };

  const executionAdapter = new ServerPipelineExecutionAdapter(splitConfig, {
    enableNeuralAudit: false,
    llmPortFactory: () => ({
      async complete(req) {
        recordedCalls.push({
          task: req.task,
          geminiModel: req.geminiModel,
          thinkingLevel: req.thinkingLevel,
        });
        if (req.task === 'translate_pass1') {
          return {
            text: JSON.stringify({
              titleRus: 'Глава 1. Сделка',
              rusText: 'Линь Сюань спокойно заплатил духовными камнями за пилюлю.',
              summary: 'Линь Сюань купил пилюлю.',
              summaryEng: 'Lin Xuan bought a pill.',
              csiNotes: [],
            }),
            engineUsed: 'mock-hydrogen',
            provider: 'gemini_api',
          };
        }
        if (req.task === 'surgical_critic_pass2') {
          return {
            text: JSON.stringify({
              patches: [],
              rubricScores: { otqs: 8.2 },
              stylisticSpanDirectives: [
                {
                  paragraphIndex: 0,
                  span: 'заплатил духовными камнями',
                  issue: 'ритм',
                  directiveRus: 'Сделать фразу живее',
                },
              ],
            }),
            engineUsed: 'mock-flash',
            provider: 'gemini_api',
          };
        }
        if (req.task === 'blind_stylist_pass3') {
          return {
            text: JSON.stringify({
              styledParagraphs: [],
            }),
            engineUsed: 'mock-gemma-stylist',
            provider: 'gemini_api',
          };
        }
        if (req.task === 'self_repair') {
          return {
            text: '[#p0]\nЛинь Сюань спокойно отдал 750 духовных камней за пилюлю.',
            engineUsed: 'mock-flash-repair',
            provider: 'gemini_api',
          };
        }
        return { text: '[]', engineUsed: 'mock-scout', provider: 'gemini_api' };
      },
    }),
  });

  const translateResult = await executionAdapter.translateAndEdit({
    engText: 'Lin Xuan calmly paid 750 spirit stones for the pill.',
    titleEng: 'Chapter 1: The Deal',
    chapterNumber: 1,
    glossary: testGlossary,
    genrePreset: 'xianxia',
    proseTone: 'classic',
    twoPassCritic: true,
    llmConfig: splitConfig,
  });

  const pass1Call = recordedCalls.find((c) => c.task === 'translate_pass1');
  const pass2Call = recordedCalls.find((c) => c.task === 'surgical_critic_pass2');
  const pass3Call = recordedCalls.find((c) => c.task === 'blind_stylist_pass3');
  const repairCallFromTranslate = recordedCalls.find((c) => c.task === 'self_repair');

  assert.equal(pass1Call?.geminiModel, 'gemini-4-hydrogen');
  assert.equal(pass1Call?.thinkingLevel, 'xhigh');
  assert.equal(pass2Call?.geminiModel, 'gemini-3.8-flash');
  assert.equal(pass3Call?.geminiModel, 'gemma-4-31b-it');
  assert.ok(repairCallFromTranslate, 'Stage 3 self_repair must trigger on missing number 750');
  assert.equal(repairCallFromTranslate?.geminiModel, 'gemini-3.8-flash');
  assert.notEqual(repairCallFromTranslate?.thinkingLevel, 'xhigh');
  assert.ok(translateResult.rusText.includes('750'));

  recordedCalls.length = 0;
  await executionAdapter.verifyAndRepair({
    chapterNumber: 1,
    titleEng: 'Chapter 1: The Deal',
    titleRus: 'Глава 1. Сделка',
    engText: 'Lin Xuan calmly paid 750 spirit stones for the pill.',
    rusText: 'Линь Сюань спокойно заплатил духовными камнями за пилюлю.',
    glossary: testGlossary,
    genrePreset: 'xianxia',
    proseTone: 'classic',
    llmConfig: splitConfig,
  });

  const repairCallFromVerify = recordedCalls.find((c) => c.task === 'self_repair');
  assert.ok(repairCallFromVerify, 'verifyAndRepair must trigger Stage 3 self_repair on missing number 750');
  assert.equal(repairCallFromVerify?.geminiModel, 'gemini-3.8-flash');
  assert.notEqual(repairCallFromVerify?.thinkingLevel, 'xhigh');
});

test('Audit Phase 15: Sticky Gemini project affinity, RPM pacing reservation, Retry-After / PT midnight cooldown & GEMINI_MAX_ACTIVE_KEYS', async () => {
  const {
    resetGeminiPoolStateForTests,
    getPreferredGeminiKeyIndex,
    pinGeminiModelCursor,
    advanceGeminiModelCursor,
    waitForGeminiBucketPacing,
    computeGeminiBucketWaitMs,
    parseGeminiRetryDelayMs,
    computeMsUntilNextPtMidnight,
    markGeminiBucketQuotaError,
    isGeminiBucketCoolingDown,
    getAiClientPool,
  } = await import('./llm-inference-port.ts');

  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGeminiKeys = process.env.GEMINI_API_KEYS;
  const prevGoogleKeys = process.env.GOOGLE_API_KEYS;
  const prevMaxKeys = process.env.GEMINI_MAX_ACTIVE_KEYS;
  const prevPoolStrategy = process.env.GEMINI_POOL_STRATEGY;

  try {
    resetGeminiPoolStateForTests();
    delete process.env.GEMINI_POOL_STRATEGY;

    // 1. Sticky project cursor stays pinned until cooldown/advance
    assert.equal(getPreferredGeminiKeyIndex('gemini-4-hydrogen', 3), 0);
    assert.equal(getPreferredGeminiKeyIndex('gemini-4-hydrogen', 3), 0);
    assert.equal(advanceGeminiModelCursor('gemini-4-hydrogen', 3, 0), 1);
    assert.equal(getPreferredGeminiKeyIndex('gemini-4-hydrogen', 3), 1);
    pinGeminiModelCursor('gemini-4-hydrogen', 2, 3);
    assert.equal(getPreferredGeminiKeyIndex('gemini-4-hydrogen', 3), 2);

    // 2. RPM pacing reservation isolates per (project, model) bucket without sleeping on AIzaTest*
    const testKey = 'AIzaTestPhase15Key000000001';
    const fixedNow = Date.now();
    const firstWait = await waitForGeminiBucketPacing(testKey, 'gemini-4-hydrogen', fixedNow);
    assert.equal(firstWait, 0);
    const pendingHydrogenWait = computeGeminiBucketWaitMs(testKey, 'gemini-4-hydrogen', fixedNow);
    assert.ok(
      pendingHydrogenWait >= 12_000,
      `Expected >=12000ms pacing interval for 5 RPM Hydrogen, got ${pendingHydrogenWait}ms`
    );
    assert.equal(
      computeGeminiBucketWaitMs(testKey, 'gemini-3.8-flash', fixedNow),
      0,
      'Hydrogen RPM pacing must not delay gemini-3.8-flash on the same key'
    );

    // 3. parseGeminiRetryDelayMs parses JSON retryDelay, prose delay, and Retry-After header
    assert.equal(parseGeminiRetryDelayMs('{"error":{"details":[{"retryDelay":"34s"}]}}'), 35_000);
    assert.equal(parseGeminiRetryDelayMs('429 RESOURCE_EXHAUSTED Please retry in 12.5s.'), 13_500);
    assert.equal(parseGeminiRetryDelayMs('HTTP 429', '20'), 21_000);

    // 4. computeMsUntilNextPtMidnight returns value within [5m, 24h+10m]
    const ptMs = computeMsUntilNextPtMidnight(fixedNow);
    assert.ok(
      ptMs >= 5 * 60_000 && ptMs <= 24 * 3600_000 + 10 * 60_000,
      `Expected PT midnight cooldown within [300000, 87000000], got ${ptMs}`
    );

    // 5. Permanent block detection ('free tier is not available') & server Retry-After cooldown
    const blockedKey = 'AIzaTestPhase15Blocked00002';
    assert.equal(
      markGeminiBucketQuotaError(
        blockedKey,
        'gemini-4-hydrogen',
        '403 PERMISSION_DENIED: The Gemini API free tier is not available for this project.'
      ),
      true
    );
    assert.equal(isGeminiBucketCoolingDown(blockedKey, 'gemini-4-hydrogen'), true);
    assert.equal(isGeminiBucketCoolingDown(blockedKey, 'gemini-3.8-flash'), true);
    assert.equal(isGeminiBucketCoolingDown(blockedKey, 'gemini-decision-1'), true);

    const retryKey = 'AIzaTestPhase15Retry000003';
    assert.equal(
      markGeminiBucketQuotaError(
        retryKey,
        'gemini-3.8-flash',
        '429 RESOURCE_EXHAUSTED {"retryDelay": "40s"}'
      ),
      true
    );
    assert.equal(
      isGeminiBucketCoolingDown(retryKey, 'gemini-3.8-flash', Date.now() + 35_000),
      true,
      'Server-advised 40s retryDelay must hold cooldown past 35s'
    );

    // 6. GEMINI_MAX_ACTIVE_KEYS caps active client pool and restores cleanly when unset
    process.env.GEMINI_API_KEY = 'AIzaTestPhase15PoolA0000001';
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEYS;
    process.env.GOOGLE_API_KEYS = 'AIzaTestPhase15PoolB0000002,AIzaTestPhase15PoolC0000003';

    process.env.GEMINI_MAX_ACTIVE_KEYS = '2';
    const cappedPool = getAiClientPool();
    assert.equal(cappedPool.length, 2);

    delete process.env.GEMINI_MAX_ACTIVE_KEYS;
    const fullPool = getAiClientPool();
    assert.equal(fullPool.length, 3);
  } finally {
    resetGeminiPoolStateForTests();
    if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
    else delete process.env.GEMINI_API_KEY;
    if (prevGoogle !== undefined) process.env.GOOGLE_API_KEY = prevGoogle;
    else delete process.env.GOOGLE_API_KEY;
    if (prevGeminiKeys !== undefined) process.env.GEMINI_API_KEYS = prevGeminiKeys;
    else delete process.env.GEMINI_API_KEYS;
    if (prevGoogleKeys !== undefined) process.env.GOOGLE_API_KEYS = prevGoogleKeys;
    else delete process.env.GOOGLE_API_KEYS;
    if (prevMaxKeys !== undefined) process.env.GEMINI_MAX_ACTIVE_KEYS = prevMaxKeys;
    else delete process.env.GEMINI_MAX_ACTIVE_KEYS;
    if (prevPoolStrategy !== undefined) process.env.GEMINI_POOL_STRATEGY = prevPoolStrategy;
    else delete process.env.GEMINI_POOL_STRATEGY;
  }
});
