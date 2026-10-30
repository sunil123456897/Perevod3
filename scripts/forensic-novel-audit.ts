import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  runQaLinter,
  getDefaultRulesForGenre,
  evaluateDitingQuality,
  computeStylometricMetrics,
  verifyProseQualityGate,
  verifyAndRepairChapterAsync,
  getLocalEmbedBridgeClient,
  embedTextsWithGeminiPool,
} from '../lib/qa-linter.ts';
import { parseDiskDatabasePayload } from '../lib/storage-idb.ts';

// Auto-load .env.local for CLI invocations if GEMINI_API_KEY / GOOGLE_API_KEYS are not set
const envLocalPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf-8');
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
}

const args = process.argv.slice(2);
function getArg(flag: string, fallback?: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

const novelId = getArg('--novel', 'my-step-daughters-are-the-villainesses')!;
const rangeArg = getArg('--range');
const alignArg = getArg('--align');
const showDigest = args.includes('--digest');
const showStylometry = args.includes('--stylometry');
const enforceGate = args.includes('--gate');
const testLiveRepair = args.includes('--test-live-repair');
const testChapterNum = parseInt(getArg('--chapter', '168')!, 10);
const embedMode = getArg('--embed'); // 'local' | 'gemini'
const embedThreshold = parseFloat(getArg('--embed-threshold', '0.55')!);

const dbPath = path.join(process.cwd(), 'data', 'novels_db.json');
const db = parseDiskDatabasePayload(fs.readFileSync(dbPath, 'utf-8'));
const novel = db.novels.find((n) => n.id === novelId);
if (!novel) {
  console.error(`Novel "${novelId}" not found in data/novels_db.json.`);
  process.exit(1);
}

if (alignArg) {
  const chNum = parseInt(alignArg, 10);
  const chRec = novel.chapters.find((c) => c.number === chNum);
  if (!chRec) {
    console.error(`Chapter ${chNum} not found in "${novelId}".`);
    process.exit(1);
  }
  const ep = chRec.engText.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const rp = chRec.rusText.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  console.log(
    `=== ALIGNMENT Ch ${chNum}: ${chRec.titleRus} | ENG=${ep.length} RUS=${rp.length} (diff=${rp.length - ep.length}) ===`
  );
  const maxLen = Math.max(ep.length, rp.length);
  for (let i = 0; i < maxLen; i++) {
    const e = (ep[i] || '<EMPTY>').replace(/\s+/g, ' ').slice(0, 62);
    const r = (rp[i] || '<EMPTY>').replace(/\s+/g, ' ').slice(0, 62);
    console.log(`${String(i + 1).padStart(3, '0')}: E=${e} || R=${r}`);
  }
  process.exit(0);
}

if (testLiveRepair) {
  const chRec = novel.chapters.find((c) => c.number === testChapterNum);
  if (!chRec) {
    console.error(`Chapter ${testChapterNum} not found in "${novelId}".`);
    process.exit(1);
  }

  const engParas = chRec.engText.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  const cleanRusParas = chRec.rusText.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);

  // Build corrupted copy with all 4 defect classes:
  // 1) Structural +1/-1 split + glue shift + unequal DTW alignment
  const workingEngParas = [...engParas];
  const corruptedParas = [...cleanRusParas];

  // Inject Negation Polarity Flip on paragraph #15 before shifting indices
  const negTargetIdx = Math.min(15, corruptedParas.length - 2);
  workingEngParas[negTargetIdx] = `${workingEngParas[negTargetIdx]} She did not step back.`;
  corruptedParas[negTargetIdx] = `${corruptedParas[negTargetIdx]} Она отступила.`;

  let splitIdx = 2;
  for (let i = 1; i < Math.min(12, corruptedParas.length - 5); i++) {
    const sents = corruptedParas[i]!.split(/(?<=[.!?…»])\s+(?=[А-ЯЁ«—])/).filter(Boolean);
    if (sents.length >= 2 && workingEngParas[i]!.length >= 75) {
      splitIdx = i;
      break;
    }
  }
  const glueIdx = Math.min(splitIdx + 8, corruptedParas.length - 3);
  // Glue glueIdx and glueIdx+1 first, then split splitIdx into 2 so net paragraph count stays identical (+1 - 1 = 0)!
  const gluedCombined = `${corruptedParas[glueIdx]} ${corruptedParas[glueIdx + 1]}`;
  corruptedParas.splice(glueIdx, 2, gluedCombined);
  const splitSents = corruptedParas[splitIdx]!.split(/(?<=[.!?…»])\s+(?=[А-ЯЁ«—])/).filter(Boolean);
  const midSent = Math.max(1, Math.floor(splitSents.length / 2));
  corruptedParas.splice(
    splitIdx,
    1,
    splitSents.slice(0, midSent).join(' '),
    splitSents.slice(midSent).join(' ')
  );

  // 2) Female character gender mismatch & declined indeclinable name on paragraph #10
  const genderTargetIdx = Math.min(10, corruptedParas.length - 2);
  corruptedParas[genderTargetIdx] =
    `${corruptedParas[genderTargetIdx]} Айрамы медленно качнул головой и шагнул вперёд, а Камелия удивлённо посмотрел на неё.`;

  // 3) Heavy bureaucratic nominalization hotspot on paragraph #12
  const styleTargetIdx = Math.min(12, corruptedParas.length - 1);
  corruptedParas[styleTargetIdx] =
    `Осуществление перемещения подразделения производилось с обеспечением выполнения предписания командования. ` +
    `Выполнение задержания нарушителя сопровождалось составлением описания происшествия и принятием решения. ` +
    corruptedParas[styleTargetIdx];

  const benchmarkEngText = workingEngParas.join('\n\n');
  const corruptedRusText = corruptedParas.join('\n\n');
  const rules = novel.enabledRuleIds || getDefaultRulesForGenre(novel.genrePreset);

  verifyAndRepairChapterAsync(
    {
      chapterNumber: chRec.number,
      titleEng: chRec.titleEng,
      titleRus: chRec.titleRus,
      engText: benchmarkEngText,
      candidateRusText: corruptedRusText,
      glossary: novel.glossary,
      glossaryMeta: novel.glossaryMeta,
      enabledRuleIds: rules,
    },
    { enableNeuralAudit: true, neuralThreshold: 0.65 }
  )
    .then((res) => {
      console.log(
        `=== LIVE 4-DEFECT SELF-REPAIR BENCHMARK (Ch ${chRec.number}: ${chRec.titleRus}) ===`
      );
      console.log(
        `Embedding Engine: ${res.afterNeuralAudit?.embeddingEngine} (${res.afterNeuralAudit?.device?.toUpperCase()}, latency=${res.afterNeuralAudit?.latencyMs}ms)`
      );
      console.log(
        `BEFORE GATE: ${res.beforeGateReport.passed ? 'PASS' : 'FAIL'} (failed=${res.beforeGateReport.failedChecks.length}/${res.beforeGateReport.checks.length}, DITING=${res.beforeGateReport.overallScore}, Rhythm=${res.beforeGateReport.literaryRhythm}, lowCosPairs=${res.beforeNeuralAudit?.lowSimilarityCount})`
      );
      console.log(
        `AFTER  GATE: ${res.afterGateReport.passed ? 'PASS' : 'FAIL'} (failed=${res.afterGateReport.failedChecks.length}/${res.afterGateReport.checks.length}, DITING=${res.afterGateReport.overallScore}, Rhythm=${res.afterGateReport.literaryRhythm}, lowCosPairs=${res.afterNeuralAudit?.lowSimilarityCount})`
      );
      console.log(`=== SCORECARD (BEFORE -> AFTER) ===`);
      for (const row of res.scorecard) {
        const bStatus = row.passedBefore ? 'PASS' : 'FAIL';
        const aStatus = row.passedAfter ? 'PASS' : 'FAIL';
        console.log(
          `[${bStatus} -> ${aStatus}] ${row.id.padEnd(22)} | ${String(row.before).padEnd(8)} -> ${String(row.after).padEnd(8)} (expected ${row.expected})`
        );
      }
      console.log(`=== APPLIED SELF-REPAIR ACTIONS (${res.appliedFixes.length}) ===`);
      for (const fix of res.appliedFixes) {
        console.log(`  - ${fix}`);
      }
      if (res.beforeGateReport.passed || !res.afterGateReport.passed) {
        console.error('BENCHMARK FAILED: Expected BEFORE=FAIL and AFTER=PASS.');
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[test-live-repair] Error:', err);
      process.exit(1);
    });
} else {

let startCh = 1;
let endCh = novel.chapters.length;
if (rangeArg) {
  const m = rangeArg.match(/^(\d+)-(\d+)$/);
  if (m) {
    startCh = parseInt(m[1], 10);
    endCh = parseInt(m[2], 10);
  }
}

const rules = novel.enabledRuleIds || getDefaultRulesForGenre(novel.genrePreset);
const FEM_NAMES_INDECLINABLE = ['Айрам', 'Эстер', 'Фейт', 'Мей'];
const FEM_NAMES_ALL = [
  'Айрам',
  'Эстер',
  'Гермиона',
  'Мира',
  'Моника',
  'Калианта',
  'Камелия',
  'Луиза',
  'Астрид',
  'Ашара',
  'Элана',
  'Линнея',
  'Фейт',
  'Церера',
  'Розалина',
  'Ливия',
  'Люсида',
  'Агата',
  'Шана',
  'Рина',
];
const MALE_NAMES_ALL = [
  'Ульрих',
  'Сайлас',
  'Альберт',
  'Антониас',
  'Джулиан',
  'Маркус',
  'Итан',
  'Хендрик',
  'Брайан',
  'Фабиан',
  'Томас',
  'Эдмар',
  'Загон',
  'Мартен',
  'Теос',
  'Креон',
  'Валдрис',
];
const MASC_VERBS =
  'сказал|спросил|ответил|кивнул|вздохнул|посмотрел|подумал|решил|понял|стоял|сидел|шел|шёл|мог|хотел|знал|видел|слышал|чувствовал|улыбнулся|нахмурился|усмехнулся|замер|шагнул|обернулся|поднял|опустил|взял|открыл|закрыл|прошептал|произнес|произнёс|добавил|продолжил|возразил|заметил|бросил|выдохнул|повернулся|почувствовал|сделал|был';
const FEM_VERBS =
  'сказала|спросила|ответила|кивнула|вздохнула|посмотрела|подумала|решила|поняла|стояла|сидела|шла|могла|хотела|знала|видела|слышала|чувствовала|улыбнулась|нахмурилась|усмехнулась|замерла|шагнула|обернулась|подняла|опустила|взяла|открыла|закрыла|прошептала|произнесла|добавила|продолжила|возразила|заметила|бросила|выдохнула|повернулась|почувствовала|сделала|была';

interface DeepFinding {
  chapter: number;
  line: number;
  category: string;
  severity: 'ERROR' | 'WARNING';
  observed: string;
  expected: string;
}

const findings: DeepFinding[] = [];
const digestRows: string[] = [];
let clearCount = 0;
let findingChCount = 0;

const targetChapters = novel.chapters.filter((c) => c.number >= startCh && c.number <= endCh);

for (const chRec of targetChapters) {
  const ch = chRec.number;
  const engText = chRec.engText;
  const rusText = chRec.rusText;
  const rusLines = rusText.split('\n');
  const sha256 = crypto.createHash('sha256').update(rusText, 'utf8').digest('hex').slice(0, 12);

  let chFindingCount = 0;
  const addFinding = (
    line: number,
    category: string,
    severity: 'ERROR' | 'WARNING',
    observed: string,
    expected: string
  ) => {
    chFindingCount++;
    findings.push({ chapter: ch, line, category, severity, observed, expected });
  };

  if (/[A-Za-z]/.test(chRec.titleRus.replace(/\[.*?\]|R-18|POV/g, ''))) {
    addFinding(1, 'TITLE_LATIN', 'ERROR', chRec.titleRus, 'Русский заголовок без латиницы');
  }
  if (/^Глава\s+\d+$/i.test(chRec.titleRus.trim()) || /Калиантх/i.test(chRec.titleRus)) {
    addFinding(1, 'TITLE_DEFECT', 'ERROR', `${chRec.titleRus} (ENG: ${chRec.titleEng})`, 'Глава N. Название');
  }

  const lintRep = runQaLinter(engText, rusText, novel.glossary, {
    enabledRuleIds: rules,
    glossaryMeta: novel.glossaryMeta,
  });
  for (const iss of lintRep.issues) {
    if (iss.severity === 'error' || iss.ruleId === 'DASH_AND_COMMA_INFLATION') {
      addFinding(
        iss.line,
        `LINTER_${iss.ruleId}`,
        iss.severity === 'error' ? 'ERROR' : 'WARNING',
        iss.snippet.slice(0, 140),
        iss.suggestion.slice(0, 140)
      );
    }
  }

  rusLines.forEach((rawLine, idx) => {
    const lineNum = idx + 1;
    const line = rawLine.trim();
    if (!line) return;

    for (const femIndecl of FEM_NAMES_INDECLINABLE) {
      const reDecl = new RegExp(`(?<![а-яё])${femIndecl}(?:а|у|ом|е|ой|ы|ам|ами|ах)(?![а-яё])`, 'i');
      if (reDecl.test(line)) {
        addFinding(lineNum, 'INDECLINABLE_FEM_NAME_DECLINED', 'ERROR', line.slice(0, 140), `Не склонять «${femIndecl}»`);
      }
      const reBroadMascVerb = new RegExp(
        `(?:(?<!(?:[Вв]згляд|[Гг]олос|[Сс]вет|[Рр]от|[Оо]твет|[Ии]нтерес|[Сс]лучай|[Сс]мысл|[Тт]анец|[Сс]тоицизм|[Пп]очерк|[Вв]ид|[Оо]браз|Ульриха\\s+и|[Уу]|[Сс])\\s+)(?<![а-яё])${femIndecl}\\s+(?:не\\s+|уже\\s+|снова\\s+|тут\\s+же\\s+|тоже\\s+|даже\\s+|просто\\s+|лишь\\s+)?([а-яё]{3,}(?:лся|нул|ал|ял|ел|ил|ёл))(?![а-яё])|(?<![а-яё])(Повернулся|Обернулся|Улыбнулся|Бросился)\\s+(?:даже\\s+|и\\s+)?${femIndecl}(?![а-яё]))`
      );
      if (reBroadMascVerb.test(line)) {
        addFinding(lineNum, 'FEM_INDECL_MASC_VERB', 'ERROR', line.slice(0, 140), `Женский род для «${femIndecl}»`);
      }
    }

    for (const fem of FEM_NAMES_ALL) {
      const re1 = new RegExp(
        `(?<!(?:[Вв]згляд|[Гг]олос|[Сс]вет|[Рр]от|[Оо]твет|[Ии]нтерес|[Сс]лучай|[Сс]мысл|[Тт]анец|[Сс]тоицизм|[Пп]очерк|[Вв]ид|[Оо]браз|Ульриха\\s+и|[Уу]|[Сс])\\s+)(?<![а-яё])${fem}\\s+(?:не\\s+|уже\\s+|лишь\\s+|только\\s+|снова\\s+)?(${MASC_VERBS})(?![а-яё])`
      );
      const re2 = new RegExp(`—\\s*(${MASC_VERBS})\\s+${fem}(?![а-яё])`);
      if (re1.test(line) || re2.test(line)) {
        addFinding(lineNum, 'FEM_CHAR_MASC_VERB', 'ERROR', line.slice(0, 140), `Женский род для «${fem}»`);
      }
    }

    for (const male of MALE_NAMES_ALL) {
      const re1 = new RegExp(`(?<![а-яё])${male}\\s+(?:не\\s+|уже\\s+|лишь\\s+|только\\s+|снова\\s+)?(${FEM_VERBS})(?![а-яё])`);
      const re2 = new RegExp(`—\\s*(${FEM_VERBS})\\s+${male}(?![а-яё])`);
      if (re1.test(line) || re2.test(line)) {
        addFinding(lineNum, 'MALE_CHAR_FEM_VERB', 'ERROR', line.slice(0, 140), `Мужской род для «${male}»`);
      }
    }

    if (!line.startsWith('—') && !/:\s*—/.test(line) && /[а-яё],\s*—\s+[А-ЯЁ]/.test(line)) {
      addFinding(lineNum, 'NARRATIVE_COMMA_DASH_STITCH', 'ERROR', line.slice(0, 140), 'Разделить абзац или «...»');
    }
    if (/Вальдрис/i.test(line)) {
      addFinding(lineNum, 'SPELLING_DRIFT_VALDRIS', 'ERROR', line.slice(0, 140), 'Канон: Валдрис');
    }
    if (/([А-ЯЁа-яё])—([а-яё])/.test(line)) {
      addFinding(lineNum, 'STUTTER_EM_DASH', 'ERROR', line.slice(0, 140), 'Дефис при заикании');
    }
    if (
      /(?<![а-яё])я\s+(?:не\s+|уже\s+|бы\s+|просто\s+|лишь\s+|только\s+|сама\s+)?[а-яё]+(?:ла|лась)(?![а-яё])/i.test(
        line
      ) &&
      /—\s*(?:сказал|ответил|произнес|произнёс|добавил|продолжил|прошептал|возразил|признался|спросил|отозвался)\s+(?:он|Ульрих|Сайлас|Альберт|Антониас|Джулиан|Маркус|Итан|Хендрик|Брайан|Фабиан|Томас|Валдрис)/i.test(
        line
      )
    ) {
      addFinding(lineNum, '1P_GENDER_MISMATCH', 'ERROR', line.slice(0, 140), 'Мужской род 1-го лица');
    }
  });

  const engParas = engText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
  const rusParas = rusText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;

  const gate = verifyProseQualityGate(engText, rusText, novel.glossary, {
    glossaryMeta: novel.glossaryMeta,
    enabledRuleIds: rules,
  });
  const stylo = gate.stylometry;
  const diting = gate.diting;
  if (enforceGate && !gate.passed) {
    for (const fc of gate.failedChecks) {
      addFinding(
        1,
        `PROSE_GATE_${fc.id}`,
        'ERROR',
        `${fc.label}: ${fc.observed}`,
        `Порог гейта: ${fc.expected}`
      );
    }
  }

  if (chFindingCount === 0) clearCount++;
  else findingChCount++;

  const styloTag =
    showStylometry || enforceGate
      ? ` | GATE=${gate.passed ? 'PASS' : 'FAIL'} DITING=${diting.overallScore} Rhythm=${diting.literaryRhythm} MATTR=${stylo.mattr100.toFixed(3)} CV=${stylo.burstinessCv.toFixed(2)} H1=${stylo.openerEntropy.toFixed(2)} Nom=${stylo.nominalizationPer100Words.toFixed(2)}% Dash=${stylo.internalDashPer100Words.toFixed(2)}% Exp=${stylo.wordExpansionRatio.toFixed(2)}`
      : '';

  digestRows.push(
    `Ch ${String(ch).padStart(3, '0')} | ${chFindingCount === 0 ? 'CLEAR  ' : `FIND(${chFindingCount})`} | paras: ${engParas}->${rusParas} (diff=${rusParas - engParas})${styloTag} | sha256=${sha256} | ${chRec.titleRus}`
  );
}

console.log(
  `=== FORENSIC NOVEL AUDIT (${novelId}: Ch ${startCh}..${endCh}, total=${targetChapters.length}) ===`
);
console.log(`CLEAR: ${clearCount} | FINDING CHAPTERS: ${findingChCount} | TOTAL FINDINGS: ${findings.length}`);
for (const f of findings) {
  console.log(`[Ch ${f.chapter} L${f.line}] [${f.severity}] ${f.category}: ${f.observed} => ${f.expected}`);
}
if (showDigest || showStylometry || enforceGate) {
  console.log(`=== DIGEST ===`);
  for (const row of digestRows) console.log(row);
}

async function runEmbeddingVerification() {
  if (!embedMode) return;
  const chaptersPayload = targetChapters.map((ch) => ({
    number: ch.number,
    engParagraphs: ch.engText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    rusParagraphs: ch.rusText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
  }));

  if (embedMode === 'local') {
    const tmpFile = path.join(os.tmpdir(), `embed_audit_${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify({ chapters: chaptersPayload }), 'utf-8');
    try {
      const bridgePath = path.join(process.cwd(), 'scripts', 'local-embed-bridge.py');
      const stdout = execFileSync(
        'python',
        [bridgePath, '--input', tmpFile, '--threshold', String(embedThreshold)],
        { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
      );
      const parsed = JSON.parse(stdout.trim());
      console.log(
        `=== NEURAL EMBEDDING AUDIT (Local ${parsed.model} on ${parsed.device.toUpperCase()}, threshold=${parsed.threshold}) ===`
      );
      for (const chRes of parsed.chapters) {
        console.log(
          `Ch ${String(chRes.chapter).padStart(3, '0')} | pairs=${chRes.pairs} | meanCos=${chRes.meanCosine.toFixed(4)} | minCos=${chRes.minCosine.toFixed(4)} | lowPairs(<${embedThreshold})=${chRes.lowSimilarityCount}`
        );
        for (const lp of chRes.lowPairs || []) {
          console.log(
            `  [LowCos #${lp.index} cos=${lp.cosine}] E="${lp.eng}" || R="${lp.rus}"`
          );
        }
      }
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  } else if (embedMode === 'gemini') {
    console.log(`=== NEURAL EMBEDDING AUDIT (Cloud API gemini-embedding-2, threshold=${embedThreshold}) ===`);
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] || 0), 0);
    const norm = (a: number[]) => Math.sqrt(dot(a, a)) || 1;
    const cos = (a: number[], b: number[]) => dot(a, b) / (norm(a) * norm(b));

    for (const ch of chaptersPayload) {
      const pairCount = Math.min(ch.engParagraphs.length, ch.rusParagraphs.length);
      if (pairCount === 0) continue;
      const engSlice = ch.engParagraphs.slice(0, pairCount);
      const rusSlice = ch.rusParagraphs.slice(0, pairCount);
      const [engRes, rusRes] = await Promise.all([
        embedTextsWithGeminiPool(engSlice),
        embedTextsWithGeminiPool(rusSlice),
      ]);
      const scores = engSlice.map((_, i) => cos(engRes.embeddings[i], rusRes.embeddings[i]));
      const meanCos = scores.reduce((a, b) => a + b, 0) / scores.length;
      const minCos = Math.min(...scores);
      const lowPairs = scores
        .map((s, idx) => ({ idx: idx + 1, score: s, e: engSlice[idx], r: rusSlice[idx] }))
        .filter((x) => !(x.e.length < 18 && x.r.length < 18) && x.score < embedThreshold);
      console.log(
        `Ch ${String(ch.number).padStart(3, '0')} | pairs=${pairCount} | meanCos=${meanCos.toFixed(4)} | minCos=${minCos.toFixed(4)} | lowPairs=${lowPairs.length} | apiRequests=${engRes.requestsUsed + rusRes.requestsUsed}`
      );
    }
  }
}

runEmbeddingVerification()
  .then(() => {
    if (enforceGate && findings.length > 0) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('[embed-audit] Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
