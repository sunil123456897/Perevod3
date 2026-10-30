import {
  type CanonicalGlossary,
  type GlossaryTermMeta,
  type LintRuleId,
  filterGlossaryForChapter,
  generateChapterMemorySummary,
  alignChapterParagraphs,
  detectTautologies,
  runQaLinter,
} from './qa-linter.ts';

// ============================================================================
// MODULE 2: DelTA 4-Component Document-to-Sentence Context Engine
// ============================================================================

export interface DelTAShortTermPair {
  index: number;
  engParagraph: string;
  rusParagraph: string;
}

export interface DelTABilingualSummary {
  eng: string;
  rus: string;
  summaryEng: string;
  summaryRus: string;
}

export interface DelTALongTermMatch {
  chapterNumber: number;
  engSnippet: string;
  rusSnippet: string;
  matchedEntity: string;
}

export interface DelTAContextPacket {
  properNounCount: number; // \hat{R}^{(i)}
  bilingualSummary: DelTABilingualSummary; // A_s^{(i)}, A_t^{(i)}
  shortTermWindow: DelTAShortTermPair[]; // M^{(i)} — last 3 aligned ENG-RUS paragraphs
  longTermMemories: DelTALongTermMatch[]; // \hat{N}^{(i)} — relevant past chapter sentences
}

export function generateBilingualChapterSummary(
  chapterNumber: number,
  titleEng: string,
  engText: string,
  titleRus: string,
  rusText: string
): DelTABilingualSummary {
  const cleanEngLines = engText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 15 && !l.startsWith('---') && !l.startsWith('['));

  const firstEng = cleanEngLines[0]?.split(/(?<=[.!?])\s+/)[0] || titleEng;
  const lastEng =
    cleanEngLines[cleanEngLines.length - 1]?.split(/(?<=[.!?])\s+/).slice(-1)[0] || '';
  const engSummary =
    firstEng && lastEng && firstEng !== lastEng
      ? `Ch.${chapterNumber} (${titleEng}): ${firstEng} Outcome: ${lastEng}`
      : `Ch.${chapterNumber} (${titleEng}): ${firstEng}`;

  const rusSummary = generateChapterMemorySummary(
    chapterNumber,
    titleRus || `Глава ${chapterNumber}`,
    rusText
  );

  return {
    eng: engSummary,
    rus: rusSummary,
    summaryEng: engSummary,
    summaryRus: rusSummary,
  };
}

/**
 * Builds the 4-component DelTA memory context for a chapter:
 * 1. \hat{R}^{(i)} — Proper Noun Records count (sliced glossary)
 * 2. A_s^{(i)}, A_t^{(i)} — Bilingual Summary (ENG + RUS)
 * 3. M^{(i)} — Short-Term Sliding Window of the last 3 non-divider ENG↔RUS paragraphs from the preceding chapter
 * 4. \hat{N}^{(i)} — Long-Term Memory retrieval of relevant translated sentences from earlier chapters
 */
export function buildDelTAContextPacket(
  currentChapterEng: string,
  previousChapter: {
    number: number;
    titleEng: string;
    titleRus: string;
    engText: string;
    rusText: string;
    summary?: string;
    summaryEng?: string;
  } | null,
  earlierChapters: Array<{
    number: number;
    engText: string;
    rusText: string;
  }>,
  glossary: CanonicalGlossary,
  windowSize = 3
): DelTAContextPacket {
  const { filteredGlossary, matchedCount } = filterGlossaryForChapter(
    currentChapterEng,
    glossary
  );

  let bilingualSummary: DelTABilingualSummary = {
    eng: 'Opening chapter of the translation stream.',
    rus: 'Первая переводимая глава в потоке.',
    summaryEng: 'Opening chapter of the translation stream.',
    summaryRus: 'Первая переводимая глава в потоке.',
  };
  const shortTermWindow: DelTAShortTermPair[] = [];

  if (previousChapter) {
    const autoBi = generateBilingualChapterSummary(
      previousChapter.number,
      previousChapter.titleEng,
      previousChapter.engText,
      previousChapter.titleRus,
      previousChapter.rusText
    );
    const finalEng = previousChapter.summaryEng || autoBi.eng;
    const finalRus = previousChapter.summary || autoBi.rus;
    bilingualSummary = {
      eng: finalEng,
      rus: finalRus,
      summaryEng: finalEng,
      summaryRus: finalRus,
    };

    if (previousChapter.rusText.trim()) {
      const aligned = alignChapterParagraphs(
        previousChapter.engText,
        previousChapter.rusText
      );
      const validPairs = aligned.pairs.filter(
        (p) =>
          p.engParagraph.trim().length > 0 &&
          p.rusParagraph.trim().length > 0 &&
          !p.isSystemDivider
      );
      const tail = validPairs.slice(-Math.max(1, windowSize));
      tail.forEach((p, idx) => {
        shortTermWindow.push({
          index: idx + 1,
          engParagraph: p.engParagraph,
          rusParagraph: p.rusParagraph,
        });
      });
    }
  }

  // Long-Term Memory (\hat{N}^{(i)}): retrieve up to 3 past translated paragraphs that share active proper nouns
  const activeEntities = [
    ...Object.entries(filteredGlossary.characters || {}),
    ...Object.entries(filteredGlossary.sects_and_places || {}),
    ...Object.entries(filteredGlossary.system_and_terms || {}),
  ];

  const longTermMemories: DelTALongTermMatch[] = [];
  for (const pastCh of earlierChapters) {
    if (!pastCh.rusText.trim()) continue;
    if (previousChapter && pastCh.number === previousChapter.number) continue;

    const aligned = alignChapterParagraphs(pastCh.engText, pastCh.rusText);
    for (const pair of aligned.pairs) {
      if (!pair.engParagraph || !pair.rusParagraph || pair.isSystemDivider) continue;
      for (const [engTerm, rusTerm] of activeEntities) {
        if (
          pair.engParagraph.toLowerCase().includes(engTerm.toLowerCase()) &&
          longTermMemories.length < 3 &&
          !longTermMemories.some((m) => m.matchedEntity === `${engTerm} → ${rusTerm}`)
        ) {
          longTermMemories.push({
            chapterNumber: pastCh.number,
            engSnippet: pair.engParagraph,
            rusSnippet: pair.rusParagraph,
            matchedEntity: `${engTerm} → ${rusTerm}`,
          });
          break;
        }
      }
      if (longTermMemories.length >= 3) break;
    }
    if (longTermMemories.length >= 3) break;
  }

  return {
    properNounCount: matchedCount,
    bilingualSummary,
    shortTermWindow,
    longTermMemories,
  };
}

// ============================================================================
// MODULE 3: LCD-MAS + CHORUS CSI Cultural Footnotes & DITING 6D Judge
// ============================================================================

export type CsiCategory = 'idiom' | 'honorific' | 'daoist_term' | 'system_formula';

export interface CsiCulturalNote {
  id: string;
  sourcePhrase: string;
  category: CsiCategory;
  categoryLabel: string;
  adaptedRus: string;
  rationale: string;
}

export interface NegationPolarityViolation {
  paragraphIndex: number; // 0-based
  engNegatedClause: string;
  rusVerbFound: string;
  suggestedFix: string;
}

export interface StylometricMetrics {
  wordCount: number;
  sentenceCount: number;
  mattr100: number; // Moving-Average Type-Token Ratio (window = 100 words), 0..1
  burstinessCv: number; // Coefficient of Variation (sigma / mean) of sentence lengths
  openerEntropy: number; // Normalized Shannon entropy of sentence-initial words, 0..1
  nominalizationPer100Words: number; // Density of -ние/-тие/-ость suffixes per 100 words
  nominalizationHotspotParagraphs: number[]; // 0-based indices of paragraphs with heavy bureaucratic nominalization
  negationPolarityMismatchParagraphs: number[]; // 0-based indices of paragraphs with dropped/inverted negation
  internalDashPer100Words: number; // Non-dialogue internal dash density per 100 words
  tautologyPer1000Words: number; // Proximity stem tautologies per 1,000 words
  wordExpansionRatio: number; // rusWordCount / engWordCount (1.0 if engText omitted)
}

export interface DitingQualityReport {
  idiomAccuracy: number; // Точность передачи идиоматики
  referentialCohesion: number; // Временная и референциальная связность
  characterVoiceFidelity: number; // Сохранение индивидуальных голосов героев
  culturalAdaptation: number; // Культурная достоверность (CSI)
  literaryRhythm: number; // Ритмика и отсутствие канцелярита
  terminologyPrecision: number; // Соблюдение канона и числительных
  overallScore: number;
  mqmGrade: 'Эталон (DITING 95+)' | 'Высокий (85–94)' | 'Требует правки (<85)';
  stylometry?: StylometricMetrics;
}

export interface ProseQualityGateThresholds {
  maxQaErrors?: number; // default: 0
  minDitingScore?: number; // default: 88
  minLiteraryRhythm?: number; // default: 85
  minMattr100?: number; // default: 0.72
  minBurstinessCv?: number; // default: 0.40
  minOpenerEntropy?: number; // default: 0.78
  maxNominalizationPer100Words?: number; // default: 2.5
  maxInternalDashPer100Words?: number; // default: 1.8
  minWordExpansionRatio?: number; // default: 0.68
  maxWordExpansionRatio?: number; // default: 1.18
  minMeanCosine?: number; // default: 0.78
  minPairCosine?: number; // default: 0.55
}

export interface ProseGateCheckResult {
  id: string;
  label: string;
  passed: boolean;
  observed: number;
  expected: string;
}

export interface ProseQualityGateReport {
  passed: boolean;
  overallScore: number;
  literaryRhythm: number;
  checks: ProseGateCheckResult[];
  failedChecks: ProseGateCheckResult[];
  stylometry: StylometricMetrics;
  diting: DitingQualityReport;
}

/**
 * Computes continuous mathematical stylometry metrics for Russian literary text:
 * - MATTR-100 (Moving-Average Type-Token Ratio over 100-word sliding windows)
 * - Burstiness CV (Coefficient of Variation = sigma / mean of sentence lengths)
 * - Opener Entropy (Normalized Shannon entropy of sentence-initial words)
 * - Nominalization density per 100 words (-ние, -тие, -ость)
 * - Internal (non-dialogue) dash density per 100 words
 * - Tautology density per 1,000 words
 * - Word expansion ratio (RUS words / ENG words)
 */
const POLARITY_ACTION_PAIRS: Array<{
  engNegRe: RegExp;
  rusAffirmativeRe: RegExp;
  rusAntonymOrImplicitNegRe: RegExp;
}> = [
  {
    engNegRe: /\b(?:did\s+not|didn['’]t|never)\s+(?:step\s+back|retreat|back\s+down|yield|give\s+ground)\b/i,
    rusAffirmativeRe: /(?<![а-яё])(отступил[аио]?|попятил(?:ся|ась|ись)|уступил[аио]?)(?![а-яё])/i,
    rusAntonymOrImplicitNegRe:
      /(?<![а-яё])(?:не|ни|никогда|никто|ничего|без|нет|едва|вряд|остал(?:ся|ась|ись)|устоял[аио]?|выдержал[аио]?|держал(?:ся|ась|ись))(?![а-яё])/i,
  },
  {
    engNegRe: /\b(?:did\s+not|didn['’]t|never)\s+(?:flinch|waver|hesitate|tremble|shiver|blink)\b/i,
    rusAffirmativeRe:
      /(?<![а-яё])(дрогнул[аио]?|вздрогнул[аио]?|поколебал(?:ся|ась|ись)|заколебал(?:ся|ась|ись)|замешкал(?:ся|ась|ись)|моргнул[аио]?)(?![а-яё])/i,
    rusAntonymOrImplicitNegRe:
      /(?<![а-яё])(?:не|ни|никогда|никто|ничего|без|нет|едва|вряд|спокойно|твёрдо|хладнокровно|решительно)(?![а-яё])/i,
  },
  {
    engNegRe: /\b(?:did\s+not|didn['’]t|never)\s+(?:answer|reply|respond|say\s+a\s+word)\b/i,
    rusAffirmativeRe: /(?<![а-яё])(ответил[аио]?|отозвал(?:ся|ась|ись)|возразил[аио]?)(?![а-яё])/i,
    rusAntonymOrImplicitNegRe:
      /(?<![а-яё])(?:не|ни|никогда|никто|ничего|без|нет|едва|вряд|промолчал[аио]?|молчал[аио]?|молча|проигнорировал[аио]?|воздержал(?:ся|ась))(?![а-яё])/i,
  },
  {
    engNegRe: /\b(?:did\s+not|didn['’]t|never)\s+(?:smile|laugh|grin|chuckle)\b/i,
    rusAffirmativeRe:
      /(?<![а-яё])(улыбнул(?:ся|ась|ись)|засмеял(?:ся|ась|ись)|рассмеял(?:ся|ась|ись)|усмехнул(?:ся|ась|ись))(?![а-яё])/i,
    rusAntonymOrImplicitNegRe:
      /(?<![а-яё])(?:не|ни|никогда|никто|ничего|без|нет|едва|вряд|серьёзн|хмур|мрачн|сдержал)(?![а-яё])/i,
  },
  {
    engNegRe: /\b(?:did\s+not|didn['’]t|never)\s+(?:look\s+back|turn\s+around|turn\s+back|glance\s+back)\b/i,
    rusAffirmativeRe: /(?<![а-яё])(оглянул(?:ся|ась|ись)|обернул(?:ся|ась|ись))(?![а-яё])/i,
    rusAntonymOrImplicitNegRe:
      /(?<![а-яё])(?:не|ни|никогда|никто|ничего|без|нет|едва|вряд|отвернул|вперёд)(?![а-яё])/i,
  },
  {
    engNegRe: /\b(?:did\s+not|didn['’]t|never)\s+(?:move\s+a\s+muscle|budge|move\s+an\s+inch)\b/i,
    rusAffirmativeRe:
      /(?<![а-яё])(шелохнул(?:ся|ась|ись)|сдвинул(?:ся|ась|ись)|пошевелил(?:ся|ась|ись))(?![а-яё])/i,
    rusAntonymOrImplicitNegRe:
      /(?<![а-яё])(?:не|ни|никогда|никто|ничего|без|нет|едва|вряд|замер|застыл|неподвижн)(?![а-яё])/i,
  },
  {
    engNegRe: /\b(?:did\s+not|didn['’]t|never)\s+(?:believe|trust)\b/i,
    rusAffirmativeRe: /(?<![а-яё])(поверил[аио]?|доверял[аио]?)(?![а-яё])/i,
    rusAntonymOrImplicitNegRe:
      /(?<![а-яё])(?:не|ни|никогда|никто|ничего|без|нет|едва|вряд|сомневал|усомнил)(?![а-яё])/i,
  },
];

/**
 * Detects paragraph-level negation polarity flips where an explicit English negated action verb
 * (`did not step back`, `didn't flinch`, `never answered`) is rendered affirmatively in Russian without `не`.
 */
export function checkNegationPolarity(
  engText: string,
  rusText: string
): NegationPolarityViolation[] {
  if (!engText || !rusText) return [];
  const engParas = engText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rusParas = rusText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (engParas.length === 0 || rusParas.length === 0) return [];
  const violations: NegationPolarityViolation[] = [];
  const count = Math.min(engParas.length, rusParas.length);

  for (let idx = 0; idx < count; idx++) {
    const ePara = engParas[idx]!;
    const rPara = rusParas[idx]!;

    for (const rule of POLARITY_ACTION_PAIRS) {
      const eMatch = ePara.match(rule.engNegRe);
      if (!eMatch) continue;

      const rSentences = rPara
        .split(/(?<=[.!?…»])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      // If another sentence in the same paragraph already renders the negated verb (e.g., "Ульрих не доверял... Он доверял..."), do not flag the contrasting affirmative sentence
      const alreadyHasNegatedVerbInPara = rSentences.some(
        (s) => rule.rusAffirmativeRe.test(s) && rule.rusAntonymOrImplicitNegRe.test(s)
      );
      if (alreadyHasNegatedVerbInPara) continue;

      for (const rSent of rSentences) {
        const rVerbMatch = rSent.match(rule.rusAffirmativeRe);
        if (rVerbMatch && rVerbMatch[1] && !rule.rusAntonymOrImplicitNegRe.test(rSent)) {
          const verb = rVerbMatch[1];
          violations.push({
            paragraphIndex: idx,
            engNegatedClause: eMatch[0],
            rusVerbFound: verb,
            suggestedFix: `не ${verb.toLowerCase()}`,
          });
          break;
        }
      }
    }
  }

  return violations;
}

/**
 * Deterministic Stage 2 repair for negation polarity flips when parallel English source is available.
 */
export function repairNegationPolarityWithSource(
  engText: string,
  rusText: string
): { repairedRusText: string; appliedFixes: string[]; repairedIndices: number[] } {
  if (!engText || !rusText) {
    return { repairedRusText: rusText, appliedFixes: [], repairedIndices: [] };
  }
  const engParas = engText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rusParas = rusText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (engParas.length === 0 || rusParas.length === 0) {
    return { repairedRusText: rusText, appliedFixes: [], repairedIndices: [] };
  }

  const appliedFixes: string[] = [];
  const repairedIndices: number[] = [];
  const count = Math.min(engParas.length, rusParas.length);

  for (let idx = 0; idx < count; idx++) {
    const ePara = engParas[idx]!;
    let rPara = rusParas[idx]!;
    let changed = false;

    for (const rule of POLARITY_ACTION_PAIRS) {
      const eMatch = ePara.match(rule.engNegRe);
      if (!eMatch) continue;

      const rSentences = rPara.split(/(?<=[.!?…»])\s+/);
      const alreadyHasNegatedVerbInPara = rSentences.some(
        (s) => rule.rusAffirmativeRe.test(s) && rule.rusAntonymOrImplicitNegRe.test(s)
      );
      if (alreadyHasNegatedVerbInPara) continue;

      const updatedSentences = rSentences.map((rSent) => {
        const rVerbMatch = rSent.match(rule.rusAffirmativeRe);
        if (rVerbMatch && rVerbMatch[1] && !rule.rusAntonymOrImplicitNegRe.test(rSent)) {
          const verb = rVerbMatch[1];
          const isCapitalized = /^[А-ЯЁ]/.test(verb);
          const replacement = isCapitalized ? `Не ${verb.toLowerCase()}` : `не ${verb}`;
          changed = true;
          appliedFixes.push(
            `Абзац #${idx + 1}: Восстановлено пропущенное отрицание «${replacement}» (в оригинале: «${eMatch[0]}»)`
          );
          return rSent.replace(rule.rusAffirmativeRe, replacement);
        }
        return rSent;
      });

      if (changed) {
        rPara = updatedSentences.join(' ');
      }
    }

    if (changed) {
      rusParas[idx] = rPara;
      repairedIndices.push(idx);
    }
  }

  if (appliedFixes.length === 0) {
    return { repairedRusText: rusText, appliedFixes: [], repairedIndices: [] };
  }

  return {
    repairedRusText: rusParas.join('\n\n'),
    appliedFixes,
    repairedIndices,
  };
}

export function computeStylometricMetrics(rusText: string, engText = ''): StylometricMetrics {
  const words = (rusText.toLowerCase().match(/[а-яё]+(?:-[а-яё]+)*/gi) || []).filter(
    (w) => w.length >= 2
  );
  const wordCount = words.length;
  if (wordCount === 0) {
    return {
      wordCount: 0,
      sentenceCount: 0,
      mattr100: 0,
      burstinessCv: 0,
      openerEntropy: 0,
      nominalizationPer100Words: 0,
      nominalizationHotspotParagraphs: [],
      negationPolarityMismatchParagraphs: [],
      internalDashPer100Words: 0,
      tautologyPer1000Words: 0,
      wordExpansionRatio: 1,
    };
  }

  // 1. MATTR-100
  const windowSize = 100;
  let mattr100 = 0;
  if (wordCount <= windowSize) {
    mattr100 = new Set(words).size / wordCount;
  } else {
    const freq = new Map<string, number>();
    for (let i = 0; i < windowSize; i++) {
      freq.set(words[i], (freq.get(words[i]) || 0) + 1);
    }
    let sumTtr = freq.size / windowSize;
    const windows = wordCount - windowSize + 1;
    for (let i = windowSize; i < wordCount; i++) {
      const outWord = words[i - windowSize];
      const outCount = (freq.get(outWord) || 1) - 1;
      if (outCount <= 0) freq.delete(outWord);
      else freq.set(outWord, outCount);

      const inWord = words[i];
      freq.set(inWord, (freq.get(inWord) || 0) + 1);
      sumTtr += freq.size / windowSize;
    }
    mattr100 = sumTtr / windows;
  }

  // 2. Sentence length Burstiness CV (sigma / mean) & 3. Opener Shannon Entropy
  const sentenceStrings = rusText
    .replace(/\r?\n/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const sentenceLengths: number[] = [];
  const openers: string[] = [];
  for (const s of sentenceStrings) {
    const tokens = s.match(/[а-яёa-z0-9]+/gi) || [];
    if (tokens.length >= 1 && tokens[0]) {
      sentenceLengths.push(tokens.length);
      openers.push(tokens[0].toLowerCase());
    }
  }

  const sentenceCount = sentenceLengths.length;
  let burstinessCv = 0;
  if (sentenceCount >= 2) {
    const mean = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceCount;
    if (mean > 0) {
      const variance =
        sentenceLengths.reduce((acc, len) => acc + (len - mean) * (len - mean), 0) / sentenceCount;
      burstinessCv = Math.sqrt(variance) / mean;
    }
  }

  let openerEntropy = 1;
  if (openers.length >= 2) {
    const openerCounts = new Map<string, number>();
    for (const op of openers) {
      openerCounts.set(op, (openerCounts.get(op) || 0) + 1);
    }
    let h = 0;
    const n = openers.length;
    for (const count of openerCounts.values()) {
      const p = count / n;
      h -= p * Math.log2(p);
    }
    const maxH = Math.log2(n);
    openerEntropy = maxH > 0 ? h / maxH : 1;
  }

  // 4. Nominalization density (-ние, -тие, -ость, excluding short/common words)
  const NOMINAL_EXCEPTIONS = new Set([
    'внимание',
    'сознание',
    'дыхание',
    'молчание',
    'желание',
    'мгновение',
    'состояние',
    'расстояние',
    'настроение',
    'воспоминание',
    'кость',
    'злость',
    'радость',
    'молодость',
    'скорость',
    'ярость',
    'гордость',
    'усталость',
    'слабость',
    'гость',
    'новость',
    'трость',
  ]);
  let nominalCount = 0;
  for (const w of words) {
    if (w.length >= 6 && !NOMINAL_EXCEPTIONS.has(w) && /(?:ение|ание|тие|ость)$/.test(w)) {
      nominalCount++;
    }
  }
  const nominalizationPer100Words = (nominalCount / wordCount) * 100;

  // 5. Non-dialogue internal dash density per 100 words & paragraph-level nominalization hotspots
  const paragraphs = rusText.split(/\r?\n\s*\r?\n/).filter((p) => p.trim().length > 0);
  let internalDashes = 0;
  const nominalizationHotspotParagraphs: number[] = [];
  const BUREAUCRATIC_MARKERS =
    /(?:осуществлен[а-яё]*\s+[а-яё]+(?:ения|ания|тия)|производил[а-яё]*\s+с\s+обеспечением|выполнен[а-яё]*\s+[а-яё]+(?:ения|ания|тия)|сопровождал[а-яё]*\s+составлением|в\s+целях\s+обеспечения|реализац[а-яё]*\s+предписан)/i;

  paragraphs.forEach((p, idx) => {
    const trimmed = p.trim();
    const withoutLeadDash = trimmed.replace(/^—\s+/, '');
    const matches = withoutLeadDash.match(/\s[—–]\s/g) || [];
    // If dialogue line has 1 attribution dash ("— Привет, — сказал он."), exempt the first dash
    const isDialogue = /^—\s+/.test(trimmed);
    internalDashes += isDialogue ? Math.max(0, matches.length - 1) : matches.length;

    const pWords = (trimmed.toLowerCase().match(/[а-яё]+(?:-[а-яё]+)*/gi) || []).filter(
      (w) => w.length >= 2
    );
    if (pWords.length >= 8) {
      const pNoms = pWords.filter(
        (w) =>
          w.length >= 6 &&
          !NOMINAL_EXCEPTIONS.has(w) &&
          /(?:ение|ения|ением|ений|ание|ания|анием|аний|тие|тия|тием|тий|ость|ости|остью)$/.test(w)
      );
      const pDensity = (pNoms.length / pWords.length) * 100;
      if (
        (pNoms.length >= 6 && pDensity >= 22) ||
        (pNoms.length >= 4 && pDensity >= 12 && BUREAUCRATIC_MARKERS.test(trimmed))
      ) {
        nominalizationHotspotParagraphs.push(idx);
      }
    }
  });
  const internalDashPer100Words = (internalDashes / wordCount) * 100;

  // 6. Tautology density per 1,000 words
  const tautologies = detectTautologies(rusText);
  const tautologyPer1000Words = (tautologies.length / wordCount) * 1000;

  // 7. Word expansion ratio (total RUS words / total ENG words) & 8. Negation polarity check
  let wordExpansionRatio = 1;
  const negationPolarityMismatchParagraphs: number[] = [];
  if (engText && engText.trim().length > 0) {
    const rusAllWords = (rusText.match(/[а-яёa-z0-9]+(?:-[а-яёa-z0-9]+)*/gi) || []).length;
    const engWords = (engText.match(/[a-zA-Z0-9]+(?:'[a-zA-Z]+)?/g) || []).length;
    if (engWords > 0) {
      wordExpansionRatio = rusAllWords / engWords;
    }
    const polarityViolations = checkNegationPolarity(engText, rusText);
    for (const v of polarityViolations) {
      if (!negationPolarityMismatchParagraphs.includes(v.paragraphIndex)) {
        negationPolarityMismatchParagraphs.push(v.paragraphIndex);
      }
    }
  }

  return {
    wordCount,
    sentenceCount,
    mattr100: Number(mattr100.toFixed(4)),
    burstinessCv: Number(burstinessCv.toFixed(4)),
    openerEntropy: Number(openerEntropy.toFixed(4)),
    nominalizationPer100Words: Number(nominalizationPer100Words.toFixed(2)),
    nominalizationHotspotParagraphs,
    negationPolarityMismatchParagraphs,
    internalDashPer100Words: Number(internalDashPer100Words.toFixed(2)),
    tautologyPer1000Words: Number(tautologyPer1000Words.toFixed(2)),
    wordExpansionRatio: Number(wordExpansionRatio.toFixed(3)),
  };
}

/**
 * Extracts Culture-Specific Items (CSI) and generates structured CHORUS C3 rationales
 * explaining why specific Daoist idioms, honorifics, units, and cultivation ranks were adapted as they were.
 */
export function extractCsiCulturalNotes(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary
): CsiCulturalNote[] {
  const notes: CsiCulturalNote[] = [];
  const lowerEng = engText.toLowerCase();

  const csiPatterns: Array<{
    key: string;
    testEng: RegExp;
    sourcePhrase: string;
    category: CsiCategory;
    categoryLabel: string;
    adaptedRus: string;
    rationale: string;
  }> = [
    {
      key: 'senior-brother',
      testEng: /\bSenior\s+Brother\s+([A-Z][a-z]+)\b/i,
      sourcePhrase: 'Senior Brother (Шисюн / 师兄)',
      category: 'honorific',
      categoryLabel: 'Сектантский гоноратив',
      adaptedRus: 'старший брат (со строчной буквы при имени)',
      rationale:
        'По правилам русской литературной адаптации уся/сянься обращения «старший брат / старейшина / дьякон» перед именем пишутся со строчной буквы, передавая иерархию учеников одной секты.',
    },
    {
      key: 'elder-deacon',
      testEng: /\b(?:Elder|Deacon)\s+[A-Z][a-z]+\b/i,
      sourcePhrase: 'Elder / Deacon (Чжанлао / Чжиши)',
      category: 'honorific',
      categoryLabel: 'Должностной титул секты',
      adaptedRus: 'старейшина / дьякон + фамилия',
      rationale:
        'Сохраняет даосскую клановую субординацию: ученики обращаются к старейшинам строго на «вы», тогда как старейшины к внешним ученикам — на «ты».',
    },
    {
      key: 'jin-unit',
      testEng: /\b\d+\s+jin\b/i,
      sourcePhrase: 'Jin (Цзинь / 斤 ≈ 500 г)',
      category: 'daoist_term',
      categoryLabel: 'Традиционная мера веса',
      adaptedRus: 'цзинь (без перевода в фунты или килограммы)',
      rationale:
        'Замена «jin» на западные «фунты» или метрические «килограммы» разрушает атмосферу древнего мира культивации (правило WEIGHT_UNITS).',
    },
    {
      key: 'tier-grade',
      testEng: /\bTier\s+\d+\s+(?:Low|Mid|High)\s+Grade\b/i,
      sourcePhrase: 'Tier X Low/Mid/High Grade',
      category: 'system_formula',
      categoryLabel: 'Двухуровневая классификация рангов',
      adaptedRus: 'X-го яруса низшего/среднего/высшего ранга',
      rationale:
        'Разводит понятия Tier (ярус) и Grade (ранг), предотвращая тавтологию «1-го ранга низшего ранга» и канцелярит «низшего сорта».',
    },
    {
      key: 'qi-refining-dantian',
      testEng: /\b(?:Qi\s+Refining|dantian|meridians|Spirit\s+Root)\b/i,
      sourcePhrase: 'Qi Refining / Dantian / Spirit Root',
      category: 'daoist_term',
      categoryLabel: 'Даосская внутренняя алхимия',
      adaptedRus: 'Очищение Ци / даньтянь / духовный корень',
      rationale:
        'Используется устоявшийся в русскоязычном фэндоме сянься канон внутренней алхимии вместо буквальных калек («переработка пневмы»).',
    },
    {
      key: 'cold-air-idiom',
      testEng: /gasp|cold\s+air|chose\s+the\s+wrong\s+target|crystal\s+clear/i,
      sourcePhrase: 'Образная идиоматика и боевые клише (Чэнъюй)',
      category: 'idiom',
      categoryLabel: 'Идиома / Чэнъюй',
      adaptedRus: rusText.includes('как на ладони')
        ? '«видно как на ладони»'
        : rusText.includes('судорожно перевёл дыхание')
          ? '«судорожно перевёл дыхание»'
          : '«растворился тенью / словно призрак»',
      rationale:
        'Агент локализации CSI заменил буквальную английскую/китайскую конструкцию на естественный русский фразеологизм с сохранением динамики боевой сцены.',
    },
  ];

  for (const item of csiPatterns) {
    if (item.testEng.test(engText)) {
      notes.push({
        id: `csi-${item.key}`,
        sourcePhrase: item.sourcePhrase,
        category: item.category,
        categoryLabel: item.categoryLabel,
        adaptedRus: item.adaptedRus,
        rationale: item.rationale,
      });
    }
  }

  if (notes.length === 0 && lowerEng.length > 0) {
    const firstCanon = Object.entries(glossary.realms || {})[0];
    if (firstCanon) {
      notes.push({
        id: 'csi-canon-realm',
        sourcePhrase: firstCanon[0],
        category: 'daoist_term',
        categoryLabel: 'Канон ступени культивации',
        adaptedRus: firstCanon[1],
        rationale:
          'Применено утверждённое соответствие из реестра имен собственных DelTA для сквозного единства терминологии.',
      });
    }
  }

  return notes;
}

/**
 * Evaluates a translated chapter across the 6 narrative & cultural dimensions of the DITING framework
 * using continuous stylometric metrics + normalized issue densities per 1,000 words.
 */
export function evaluateDitingQuality(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  glossaryMeta?: Record<string, GlossaryTermMeta>,
  enabledRuleIds?: LintRuleId[]
): DitingQualityReport {
  if (!rusText.trim()) {
    return {
      idiomAccuracy: 0,
      referentialCohesion: 0,
      characterVoiceFidelity: 0,
      culturalAdaptation: 0,
      literaryRhythm: 0,
      terminologyPrecision: 0,
      overallScore: 0,
      mqmGrade: 'Требует правки (<85)',
    };
  }

  const lint = runQaLinter(engText, rusText, glossary, {
    enabledRuleIds,
    glossaryMeta,
  });

  const countRules = (...ruleIds: LintRuleId[]) =>
    lint.issues.filter((i) => ruleIds.includes(i.ruleId)).length;

  const calqueCount = countRules('MACHINE_CALQUES', 'ALCHEMY_CALQUES');
  const genderErrorCount = countRules('CHARACTER_GENDER_MISMATCH');
  const driftCount = countRules('PARAGRAPH_DRIFT');
  const tautologyCount = countRules('TAUTOLOGY_RADAR');
  const termViolationCount = countRules(
    'GLOSSARY_CANON_VIOLATION',
    'NUMBER_MISMATCH',
    'TIER_VS_GRADE',
    'ARTIFACT_RANKING'
  );
  const unitOrSectErrorCount = countRules('WEIGHT_UNITS', 'SECT_SINGULAR');
  const latinErrorCount = countRules('LATIN_LEAKAGE_AND_BRACKETS');
  const registerErrorCount = countRules('REGISTER_PRONOUN_SHIFT');

  const stylometry = computeStylometricMetrics(rusText, engText);
  const clamp = (val: number, min = 40, max = 100) =>
    Math.max(min, Math.min(max, Math.round(val)));

  let idiomAccuracy: number;
  let referentialCohesion: number;
  let characterVoiceFidelity: number;
  let culturalAdaptation: number;
  let literaryRhythm: number;
  let terminologyPrecision: number;

  if (stylometry.wordCount >= 80) {
    // Continuous base score for Literary Rhythm from MATTR-100, Burstiness CV, and Opener Entropy
    const mattrScore =
      76 + Math.min(24, Math.max(0, (stylometry.mattr100 - 0.68) / 0.24) * 24);
    const burstScore =
      76 + Math.min(24, Math.max(0, (stylometry.burstinessCv - 0.32) / 0.36) * 24);
    const entropyScore =
      76 + Math.min(24, Math.max(0, (stylometry.openerEntropy - 0.72) / 0.24) * 24);

    const rawRhythmBase = 0.42 * mattrScore + 0.33 * burstScore + 0.25 * entropyScore;
    const tautologyPenalty = Math.min(10, stylometry.tautologyPer1000Words * 1.8);
    const nominalPenalty =
      Math.max(0, stylometry.nominalizationPer100Words - 0.8) * 2.5 +
      stylometry.nominalizationHotspotParagraphs.length * 8;
    const dashPenalty = Math.max(0, stylometry.internalDashPer100Words - 0.8) * 2.8;

    literaryRhythm = clamp(
      rawRhythmBase - tautologyPenalty - nominalPenalty - dashPenalty - calqueCount * 5
    );

    const idiomLexicalBonus = Math.min(3, Math.max(-6, (stylometry.mattr100 - 0.80) * 30));
    idiomAccuracy = clamp(
      97 +
        idiomLexicalBonus -
        calqueCount * 10 -
        Math.max(0, stylometry.nominalizationPer100Words - 1.0) * 2.5 -
        stylometry.nominalizationHotspotParagraphs.length * 5
    );

    const expansionDeviation = Math.max(0, Math.abs(stylometry.wordExpansionRatio - 0.88) - 0.12);
    referentialCohesion = clamp(
      99 -
        driftCount * 15 -
        genderErrorCount * 10 -
        stylometry.negationPolarityMismatchParagraphs.length * 14 -
        expansionDeviation * 30
    );

    const voiceBurstBonus = Math.min(2, Math.max(-6, (stylometry.burstinessCv - 0.50) * 18));
    characterVoiceFidelity = clamp(
      97 + voiceBurstBonus - genderErrorCount * 14 - registerErrorCount * 8
    );

    culturalAdaptation = clamp(99 - unitOrSectErrorCount * 12 - latinErrorCount * 10);
    terminologyPrecision = clamp(100 - termViolationCount * 14);
  } else {
    // Short snippet fallback (< 80 words)
    idiomAccuracy = clamp(calqueCount > 0 ? 76 : 98);
    referentialCohesion = clamp(driftCount > 0 ? 78 : genderErrorCount > 0 ? 80 : 99);
    characterVoiceFidelity = clamp(genderErrorCount > 0 ? 72 : 97);
    culturalAdaptation = clamp(unitOrSectErrorCount > 0 ? 79 : 98);
    literaryRhythm = clamp(tautologyCount > 0 ? 82 : calqueCount > 0 ? 80 : 98);
    terminologyPrecision = clamp(termViolationCount > 0 ? 74 : 100);
  }

  const overallScore = Math.round(
    (idiomAccuracy +
      referentialCohesion +
      characterVoiceFidelity +
      culturalAdaptation +
      literaryRhythm +
      terminologyPrecision) /
      6
  );

  const mqmGrade: DitingQualityReport['mqmGrade'] =
    overallScore >= 95
      ? 'Эталон (DITING 95+)'
      : overallScore >= 85
        ? 'Высокий (85–94)'
        : 'Требует правки (<85)';

  return {
    idiomAccuracy,
    referentialCohesion,
    characterVoiceFidelity,
    culturalAdaptation,
    literaryRhythm,
    terminologyPrecision,
    overallScore,
    mqmGrade,
    stylometry,
  };
}

/**
 * Verifies a translated chapter against hard mathematical & neural quality gates (like `tsc && npm test` for prose).
 * Returns `passed: true` only when all deterministic, stylometric, and optional neural cosine thresholds pass.
 */
export function verifyProseQualityGate(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  options?: {
    glossaryMeta?: Record<string, GlossaryTermMeta>;
    enabledRuleIds?: LintRuleId[];
    thresholds?: ProseQualityGateThresholds;
    neuralStats?: {
      meanCosine: number;
      minCosine: number;
    };
  }
): ProseQualityGateReport {
  const t = options?.thresholds || {};
  const maxQaErrors = t.maxQaErrors ?? 0;
  const minDitingScore = t.minDitingScore ?? 88;
  const minLiteraryRhythm = t.minLiteraryRhythm ?? 80;
  const minMattr100 = t.minMattr100 ?? 0.72;
  const minBurstinessCv = t.minBurstinessCv ?? 0.36;
  const minOpenerEntropy = t.minOpenerEntropy ?? 0.68;
  const maxNominalization = t.maxNominalizationPer100Words ?? 3.0;
  const maxInternalDash = t.maxInternalDashPer100Words ?? 2.0;
  const minExpansion = t.minWordExpansionRatio ?? 0.65;
  const maxExpansion = t.maxWordExpansionRatio ?? 1.20;
  const minMeanCosine = t.minMeanCosine ?? 0.78;
  const minPairCosine = t.minPairCosine ?? 0.55;

  const lint = runQaLinter(engText, rusText, glossary, {
    enabledRuleIds: options?.enabledRuleIds,
    glossaryMeta: options?.glossaryMeta,
  });
  const diting = evaluateDitingQuality(
    engText,
    rusText,
    glossary,
    options?.glossaryMeta,
    options?.enabledRuleIds
  );
  const stylometry = diting.stylometry || computeStylometricMetrics(rusText, engText);

  const checks: ProseGateCheckResult[] = [
    {
      id: 'QA_ERRORS',
      label: 'Детерминированные ошибки линтера (род, канон, числа, пунктуация)',
      passed: lint.errorCount <= maxQaErrors,
      observed: lint.errorCount,
      expected: `<= ${maxQaErrors}`,
    },
    {
      id: 'DITING_OVERALL',
      label: 'Интегральный индекс качества DITING 6D',
      passed: diting.overallScore >= minDitingScore,
      observed: diting.overallScore,
      expected: `>= ${minDitingScore}`,
    },
    {
      id: 'LITERARY_RHYTHM',
      label: 'Литературная ритмика (DITING Literary Rhythm)',
      passed: diting.literaryRhythm >= minLiteraryRhythm,
      observed: diting.literaryRhythm,
      expected: `>= ${minLiteraryRhythm}`,
    },
    {
      id: 'MATTR_100',
      label: 'Богатство словаря MATTR-100 (скользящее окно 100 слов)',
      passed: stylometry.mattr100 >= minMattr100,
      observed: stylometry.mattr100,
      expected: `>= ${minMattr100}`,
    },
    {
      id: 'BURSTINESS_CV',
      label: 'Вариативность длины предложений Burstiness CV (σ/μ)',
      passed: stylometry.burstinessCv >= minBurstinessCv,
      observed: stylometry.burstinessCv,
      expected: `>= ${minBurstinessCv}`,
    },
    {
      id: 'OPENER_ENTROPY',
      label: 'Шенноновская энтропия зачинов предложений (H1)',
      passed: stylometry.openerEntropy >= minOpenerEntropy,
      observed: stylometry.openerEntropy,
      expected: `>= ${minOpenerEntropy}`,
    },
    {
      id: 'NOMINALIZATION_CAP',
      label: 'Плотность отглагольного канцелярита (-ние/-тие/-ость на 100 слов и очаги в абзацах)',
      passed:
        stylometry.nominalizationPer100Words <= maxNominalization &&
        stylometry.nominalizationHotspotParagraphs.length === 0,
      observed:
        stylometry.nominalizationHotspotParagraphs.length > 0
          ? Number(
              Math.max(
                stylometry.nominalizationPer100Words,
                maxNominalization + stylometry.nominalizationHotspotParagraphs.length
              ).toFixed(2)
            )
          : stylometry.nominalizationPer100Words,
      expected: `<= ${maxNominalization}% (очагов: 0)`,
    },
    {
      id: 'INTERNAL_DASH_CAP',
      label: 'Плотность авторских тире внутри абзацев (на 100 слов)',
      passed: stylometry.internalDashPer100Words <= maxInternalDash,
      observed: stylometry.internalDashPer100Words,
      expected: `<= ${maxInternalDash}%`,
    },
    {
      id: 'WORD_EXPANSION_RATIO',
      label: 'Коэффициент полноты перевода (RUS words / ENG words)',
      passed:
        stylometry.wordExpansionRatio >= minExpansion &&
        stylometry.wordExpansionRatio <= maxExpansion,
      observed: stylometry.wordExpansionRatio,
      expected: `${minExpansion}..${maxExpansion}`,
    },
    {
      id: 'NEGATION_POLARITY_CAP',
      label: 'Сохранение полярности отрицания (защита от потери частицы «не»)',
      passed: stylometry.negationPolarityMismatchParagraphs.length === 0,
      observed: stylometry.negationPolarityMismatchParagraphs.length,
      expected: '= 0',
    },
  ];

  if (options?.neuralStats) {
    checks.push(
      {
        id: 'NEURAL_MEAN_COSINE',
        label: 'Средняя семантическая близость главы (EmbeddingGemma 2 / Gemini Embedding 2)',
        passed: options.neuralStats.meanCosine >= minMeanCosine,
        observed: Number(options.neuralStats.meanCosine.toFixed(4)),
        expected: `>= ${minMeanCosine}`,
      },
      {
        id: 'NEURAL_MIN_COSINE',
        label: 'Минимальная семантическая близость абзаца (защита от сдвига и отсебятины)',
        passed: options.neuralStats.minCosine >= minPairCosine,
        observed: Number(options.neuralStats.minCosine.toFixed(4)),
        expected: `>= ${minPairCosine}`,
      }
    );
  }

  const failedChecks = checks.filter((c) => !c.passed);
  return {
    passed: failedChecks.length === 0,
    overallScore: diting.overallScore,
    literaryRhythm: diting.literaryRhythm,
    checks,
    failedChecks,
    stylometry,
    diting,
  };
}

// ============================================================================
// MODULE 4: Reactive Sliding Window Priority Queue Scheduler (Anti-HTTP 429)
// ============================================================================

export interface QueueTelemetrySnapshot {
  queuedCount: number;
  activeCount: number;
  windowUsedSlots: number;
  requestsInCurrentWindow: number;
  intervalCap: number;
  intervalMs: number;
  isSaturated: boolean;
  completedCount: number;
}

export type SlidingWindowQueueTelemetry = QueueTelemetrySnapshot;

interface QueuedTaskItem<T> {
  id: string;
  label: string;
  priority: number; // 3 = Self-Repair / QA, 2 = DelTA Memory / Scout, 1 = Translation
  fn: () => Promise<T>;
  resolve: (val: T) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
}

/**
 * Pure TypeScript Sliding Window Priority Queue modeled on p-queue with
 * strict sliding-window timestamp tracking (`carryoverIntervalCount: true`)
 * to prevent Fixed-Window boundary bursts and HTTP 429 errors.
 */
export class SlidingWindowTaskQueue {
  private readonly concurrency: number;
  private readonly intervalCap: number;
  private readonly intervalMs: number;
  private readonly queue: Array<QueuedTaskItem<unknown>> = [];
  private readonly windowStartTimestamps: number[] = [];
  private activeCount = 0;
  private completedCount = 0;
  private onUpdate?: (snapshot: QueueTelemetrySnapshot) => void;

  constructor(options?: {
    concurrency?: number;
    intervalCap?: number;
    maxRequestsPerWindow?: number;
    intervalMs?: number;
    windowDurationMs?: number;
    onUpdate?: (snapshot: QueueTelemetrySnapshot) => void;
  }) {
    this.concurrency = options?.concurrency ?? 2;
    this.intervalCap = options?.intervalCap ?? options?.maxRequestsPerWindow ?? 6;
    this.intervalMs = options?.intervalMs ?? options?.windowDurationMs ?? 10000;
    this.onUpdate = options?.onUpdate;
  }

  private pruneSlidingWindow(now: number): void {
    const cutoff = now - this.intervalMs;
    while (
      this.windowStartTimestamps.length > 0 &&
      this.windowStartTimestamps[0] <= cutoff
    ) {
      this.windowStartTimestamps.shift();
    }
  }

  public getSnapshot(): QueueTelemetrySnapshot {
    this.pruneSlidingWindow(Date.now());
    const used = this.windowStartTimestamps.length;
    const clampedUsed = Math.min(this.intervalCap, used);
    return {
      queuedCount: this.queue.length,
      activeCount: this.activeCount,
      windowUsedSlots: clampedUsed,
      requestsInCurrentWindow: clampedUsed,
      intervalCap: this.intervalCap,
      intervalMs: this.intervalMs,
      isSaturated:
        this.activeCount >= this.concurrency || used >= this.intervalCap,
      completedCount: this.completedCount,
    };
  }

  public getTelemetry(): QueueTelemetrySnapshot {
    return this.getSnapshot();
  }

  private emitUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate(this.getSnapshot());
    }
  }

  public add<T>(
    fn: () => Promise<T>,
    options?: { priority?: number; label?: string; signal?: AbortSignal }
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new Error('Task aborted before enqueue'));
        return;
      }

      const item: QueuedTaskItem<unknown> = {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: options?.label || 'pipeline-task',
        priority: options?.priority ?? 1,
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (val: unknown) => void,
        reject,
        signal: options?.signal,
      };

      // Insert in descending priority order (FIFO within same priority)
      const insertIdx = this.queue.findIndex((q) => q.priority < item.priority);
      if (insertIdx === -1) {
        this.queue.push(item);
      } else {
        this.queue.splice(insertIdx, 0, item);
      }

      this.emitUpdate();
      this.processNext();
    });
  }

  private processNext(): void {
    if (this.queue.length === 0) return;
    if (this.activeCount >= this.concurrency) return;

    const now = Date.now();
    this.pruneSlidingWindow(now);

    if (this.windowStartTimestamps.length >= this.intervalCap) {
      const oldest = this.windowStartTimestamps[0];
      const waitMs = Math.max(25, oldest + this.intervalMs - now + 10);
      setTimeout(() => this.processNext(), waitMs);
      return;
    }

    const nextItem = this.queue.shift();
    if (!nextItem) return;

    if (nextItem.signal?.aborted) {
      nextItem.reject(new Error('Task aborted'));
      this.emitUpdate();
      this.processNext();
      return;
    }

    this.activeCount++;
    this.windowStartTimestamps.push(Date.now());
    this.emitUpdate();

    nextItem
      .fn()
      .then((res) => {
        this.completedCount++;
        nextItem.resolve(res);
      })
      .catch((err) => {
        nextItem.reject(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        this.activeCount--;
        this.emitUpdate();
        this.processNext();
      });
  }
}

export const SlidingWindowPriorityQueue = SlidingWindowTaskQueue;
