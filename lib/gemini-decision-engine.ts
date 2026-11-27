import type {
  CanonicalGlossary,
  GlossaryCategory,
  GrammaticalGender,
  LiTransProQaRubricScores,
  ScenePacingMode,
  SocialRegisterEdge,
  StylisticSpanDirective,
} from './pipeline-types.ts';
import {
  advanceGeminiModelCursor,
  formatGeminiApiError,
  getAiClientPool,
  getPreferredGeminiKeyIndex,
  isGeminiBucketCoolingDown,
  markGeminiBucketQuotaError,
  markGeminiBucketSuccess,
  pinGeminiModelCursor,
  registerGeminiKeyProject,
  waitForGeminiBucketPacing,
} from './llm-inference-port.ts';

export const GEMINI_DECISION_MODEL = 'gemini-decision-1';
const DECISIONS_API_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';
const MAX_QUESTIONS_PER_REQUEST = 850;
const PARAGRAPHS_PER_AUDIT_WINDOW = 140;

export interface DecisionNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: {
    true_description?: string;
    false_description?: string;
  };
}

export interface DecisionChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface DecisionScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type DecisionQuestion =
  | DecisionNoulQuestion
  | DecisionChoiceQuestion
  | DecisionScoreQuestion;

export interface DecisionAnswer {
  type: 'noul' | 'choice' | 'score';
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, string>;
}

export interface DecisionBatchResult {
  answers: Record<string, DecisionAnswer>;
  requestsUsed: number;
  keysUsed: string[];
  latencyMs: number;
}

export interface DecisionBatchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxQuestionsPerCall?: number;
}

function splitParagraphsClean(text: string): string[] {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function clampInputLength(text: string, maxChars = 110_000): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2) - 40;
  return `${text.slice(0, half)}\n\n[... середину длинного текста сокращено для лимита токенов ...]\n\n${text.slice(-half)}`;
}

async function callDecisionsEndpointWithPool(
  input: string,
  questions: Record<string, DecisionQuestion>,
  options?: DecisionBatchOptions
): Promise<{
  answers: Record<string, DecisionAnswer>;
  keyMasked: string;
  latencyMs: number;
}> {
  const pool = getAiClientPool();
  if (pool.length === 0) {
    throw new Error('No valid GEMINI_API_KEY found in environment');
  }

  const fetchFn = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 25_000;
  const safeInput = clampInputLength(input);
  const bodyJson = JSON.stringify({
    model: GEMINI_DECISION_MODEL,
    input: safeInput,
    questions,
  });

  const startIdx = getPreferredGeminiKeyIndex(GEMINI_DECISION_MODEL, pool.length);
  let lastErr: unknown;
  const t0 = Date.now();

  for (let rot = 0; rot < pool.length; rot++) {
    const idx = (startIdx + rot) % pool.length;
    const entry = pool[idx];
    if (isGeminiBucketCoolingDown(entry.key, GEMINI_DECISION_MODEL)) {
      continue;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await waitForGeminiBucketPacing(entry.key, GEMINI_DECISION_MODEL);
        const res = await fetchFn(DECISIONS_API_URL, {
          method: 'POST',
          headers: {
            'x-goog-api-key': entry.key,
            'Content-Type': 'application/json',
            'User-Agent': 'aistudio-build',
          },
          body: bodyJson,
          signal: AbortSignal.timeout(timeoutMs),
        });

        const rawText = await res.text();
        if (!res.ok) {
          const projMatch = rawText.match(/projects\/(\d+)/);
          if (projMatch) {
            registerGeminiKeyProject(entry.key, projMatch[1]);
          }
          const retryAfterHeader = res.headers?.get?.('retry-after') ?? null;
          const errMsg = `Decisions API HTTP ${res.status}: ${rawText.slice(0, 400)}`;
          if (
            markGeminiBucketQuotaError(
              entry.key,
              GEMINI_DECISION_MODEL,
              errMsg,
              retryAfterHeader
            )
          ) {
            advanceGeminiModelCursor(GEMINI_DECISION_MODEL, pool.length, idx);
            lastErr = new Error(errMsg);
            break;
          }
          if (res.status === 400 || res.status === 403 || res.status === 404) {
            throw formatGeminiApiError(new Error(errMsg));
          }
          lastErr = new Error(errMsg);
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 600));
          }
          continue;
        }

        const parsed = JSON.parse(rawText) as {
          answers?: Record<string, DecisionAnswer>;
        };
        if (!parsed || typeof parsed.answers !== 'object' || parsed.answers === null) {
          throw new Error('Decisions API returned empty answers payload');
        }
        pinGeminiModelCursor(GEMINI_DECISION_MODEL, idx, pool.length);
        markGeminiBucketSuccess(entry.key, GEMINI_DECISION_MODEL);
        return {
          answers: parsed.answers,
          keyMasked: entry.masked,
          latencyMs: Date.now() - t0,
        };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/User location is not supported for the API use/i.test(msg)) {
          throw formatGeminiApiError(err);
        }
        if (/HTTP 400|HTTP 403|INVALID_ARGUMENT|PERMISSION_DENIED/i.test(msg)) {
          if (markGeminiBucketQuotaError(entry.key, GEMINI_DECISION_MODEL, msg)) {
            advanceGeminiModelCursor(GEMINI_DECISION_MODEL, pool.length, idx);
            break;
          }
          throw formatGeminiApiError(err);
        }
        if (markGeminiBucketQuotaError(entry.key, GEMINI_DECISION_MODEL, msg)) {
          advanceGeminiModelCursor(GEMINI_DECISION_MODEL, pool.length, idx);
          break;
        }
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }
  }

  throw formatGeminiApiError(
    lastErr || new Error('All Gemini API keys failed or are cooling down for gemini-decision-1')
  );
}

/**
 * Executes an arbitrary typed Decisions API batch over one input document,
 * automatically chunking beyond 850 questions and rotating across all healthy project keys.
 */
export async function runGeminiDecisionBatch(
  input: string,
  questions: Record<string, DecisionQuestion>,
  options?: DecisionBatchOptions
): Promise<DecisionBatchResult> {
  const entries = Object.entries(questions);
  if (entries.length === 0) {
    return { answers: {}, requestsUsed: 0, keysUsed: [], latencyMs: 0 };
  }

  const chunkLimit = Math.min(950, Math.max(1, options?.maxQuestionsPerCall ?? MAX_QUESTIONS_PER_REQUEST));
  const combinedAnswers: Record<string, DecisionAnswer> = {};
  const keysUsedSet = new Set<string>();
  let requestsUsed = 0;
  let totalLatencyMs = 0;

  for (let i = 0; i < entries.length; i += chunkLimit) {
    const chunkObj = Object.fromEntries(entries.slice(i, i + chunkLimit));
    const res = await callDecisionsEndpointWithPool(input, chunkObj, options);
    Object.assign(combinedAnswers, res.answers);
    keysUsedSet.add(res.keyMasked);
    requestsUsed += 1;
    totalLatencyMs += res.latencyMs;
  }

  return {
    answers: combinedAnswers,
    requestsUsed,
    keysUsed: Array.from(keysUsedSet),
    latencyMs: totalLatencyMs,
  };
}

export interface ChapterPreFlightDecisionResult {
  pacingMode: ScenePacingMode;
  literaryComplexityScore: number; // 0..4
  recommendedThinkingLevel: 'high' | 'xhigh';
  narratorGender: GrammaticalGender;
  termDecisions: Record<
    string,
    {
      keep: boolean;
      keepConfidence: number;
      category: GlossaryCategory;
      gender: GrammaticalGender;
    }
  >;
  pairRegisterDecisions: Array<{
    fromCharacter: string;
    toCharacter: string;
    pronounMode: 'ты' | 'Вы';
    confidence: number;
  }>;
  requestsUsed: number;
  latencyMs: number;
}

/**
 * Pass 0 Pre-Flight Expertise via Gemini Decision 1 (1 single call per chapter):
 * Classifies scene pacing, literary complexity (adaptive HIGH vs XHIGH routing for Hydrogen),
 * narrator gender, scouted candidate terms (pruning false positives + classifying category/gender),
 * and active dialogue pair social registers (ты vs Вы).
 */
export async function analyzeChapterPreFlightWithDecision1(
  params: {
    chapterNumber: number;
    titleEng?: string;
    engText: string;
    genreTitle?: string;
    candidateTerms?: Array<{ eng: string; context_snippet?: string }>;
    dialoguePairs?: Array<{ fromCharacter: string; toCharacter: string; snippet?: string }>;
  },
  options?: DecisionBatchOptions
): Promise<ChapterPreFlightDecisionResult> {
  const candidates = (params.candidateTerms || []).slice(0, 50);
  const pairs = (params.dialoguePairs || []).slice(0, 15);

  const candidatesBlock =
    candidates.length > 0
      ? `\n\n[CANDIDATE TERMS FOR GLOSSARY]\n${candidates
          .map((c, idx) => `- T${idx}: "${c.eng}"${c.context_snippet ? ` | ctx: ${c.context_snippet.slice(0, 120)}` : ''}`)
          .join('\n')}`
      : '';

  const pairsBlock =
    pairs.length > 0
      ? `\n\n[DIALOGUE CHARACTER PAIRS]\n${pairs
          .map(
            (p, idx) =>
              `- P${idx}: ${p.fromCharacter} addressing ${p.toCharacter}${p.snippet ? ` | snippet: ${p.snippet.slice(0, 120)}` : ''}`
          )
          .join('\n')}`
      : '';

  const inputDoc = `[CHAPTER ${params.chapterNumber}${params.titleEng ? `: ${params.titleEng}` : ''}]${
    params.genreTitle ? `\nGenre: ${params.genreTitle}` : ''
  }\n\n[SOURCE TEXT]\n${params.engText}${candidatesBlock}${pairsBlock}`;

  const questions: Record<string, DecisionQuestion> = {
    scene_pacing: {
      type: 'choice',
      instructions:
        'Classify the dominant narrative pacing mode of this source chapter for Russian literary prose adaptation.',
      criteria: {
        combat_action:
          'Fast-paced battle, swordplay, chases, ambushes, physical clashes, or urgent danger.',
        comedy_banter:
          'Witty banter, comedic misunderstanding, sarcasm, teasing, or lighthearted farce.',
        cultivation_epiphany:
          'Meditation, cultivation breakthrough, alchemy/crafting, system progression, or lore exposition.',
        romance_psychology:
          'Intimate emotional tension, subtle vulnerability, affection, interior reflection, or quiet longing.',
        solemn_pathos:
          'Grand ceremonial rhetoric, ancient oaths, grief, ominous declarations, or weighty sect politics.',
      },
    },
    literary_complexity: {
      type: 'score',
      instructions:
        'Rate how difficult this chapter is to translate into natural literary Russian without losing nuance.',
      criteria: [
        'Very simple literal narration and clear speakers with minimal idioms.',
        'Standard genre narration with minor proper nouns or straightforward dialogue.',
        'Moderate complexity: noticeable idioms, emotional subtext, or shifting dialogue speakers.',
        'High complexity: dense cultivation poetry, double meanings, omitted subjects/pronouns, or sharp character voices.',
        'Extreme difficulty: intricate wordplay, overlapping multi-speaker banter, archaic oaths, or crucial subtext traps.',
      ],
    },
    narrator_pov_gender: {
      type: 'choice',
      instructions:
        'Determine the grammatical gender of the first-person narrator ("I") if clearly established by context; otherwise select unclear/third-person.',
      criteria: {
        f_female: 'First-person narrator explicitly refers to self as female (e.g., daughter, sister, girl, woman, wife).',
        m_male: 'First-person narrator explicitly refers to self as male (e.g., son, brother, boy, man, husband).',
        n_unclear_or_third: 'Third-person narration or first-person gender cannot be proven from this chapter.',
      },
    },
  };

  candidates.forEach((c, idx) => {
    questions[`term_${idx}_keep`] = {
      type: 'noul',
      instructions: `Is T${idx} ("${c.eng}") a specific named entity, character, location, sect, realm, rank, skill, spell, or artifact worth locking in a canon glossary (not an ordinary English word or generic phrase)?`,
      criteria: {
        true_description: 'Genuine proper noun, character name, technique, artifact, location, sect, realm, or special system/cultivation term.',
        false_description: 'Ordinary English phrase, common noun, generic interjection, verb, or false positive capitalization.',
      },
    };
    questions[`term_${idx}_cat`] = {
      type: 'choice',
      instructions: `Select the best canon glossary category for T${idx} ("${c.eng}").`,
      criteria: {
        characters: 'Named person, spirit, beast, monster individual, or personal title.',
        realms: 'Cultivation stage, power rank, tier, or magical realm/world.',
        sects_and_places: 'Sect, clan, city, pavilion, mountain, dungeon, or building.',
        system_and_terms: 'Martial technique, spell, pill, artifact, array, material, or system concept.',
        units: 'Measurement unit, currency, weight, or time unit.',
      },
    };
    questions[`term_${idx}_gen`] = {
      type: 'choice',
      instructions: `For T${idx} ("${c.eng}"), what Russian grammatical gender or character sex is explicitly evidenced in [SOURCE TEXT]? Never guess male without evidence.`,
      criteria: {
        f_female: 'Explicitly female character (she/her/lady/sister/wife/daughter) or feminine Russian noun.',
        m_male: 'Explicitly male character (he/him/lord/brother/husband/son).',
        n_neuter: 'Neuter inanimate artifact, concept, or abstract state.',
        pl_plural: 'Plural group, twin entities, or plural noun.',
        z_unknown: 'Inanimate or character gender not established in this text.',
      },
    };
  });

  pairs.forEach((p, idx) => {
    questions[`pair_${idx}_reg`] = {
      type: 'choice',
      instructions: `When ${p.fromCharacter} speaks to ${p.toCharacter} in this scene, should Russian translation use informal "ты" or formal/respectful "Вы"?`,
      criteria: {
        ty_informal: 'Peers, close family, friends, lovers, hostiles, or superior addressing subordinate.',
        vy_formal: 'Respectful subordinate to elder/master/royalty, polite strangers, or formal courtly distance.',
      },
    };
  });

  const res = await runGeminiDecisionBatch(inputDoc, questions, options);
  const rawPacing = res.answers.scene_pacing?.choice;
  const pacingMode: ScenePacingMode =
    rawPacing === 'combat_action' ||
    rawPacing === 'comedy_banter' ||
    rawPacing === 'cultivation_epiphany' ||
    rawPacing === 'romance_psychology' ||
    rawPacing === 'solemn_pathos'
      ? rawPacing
      : 'cultivation_epiphany';

  const complexityScore = Number(res.answers.literary_complexity?.score ?? 1.5);
  const recommendedThinkingLevel: 'high' | 'xhigh' = complexityScore >= 2.35 ? 'xhigh' : 'high';

  const rawPov = res.answers.narrator_pov_gender?.choice;
  const narratorGender: GrammaticalGender =
    rawPov === 'f_female' ? 'F' : rawPov === 'm_male' ? 'M' : 'UNKNOWN';

  const termDecisions: ChapterPreFlightDecisionResult['termDecisions'] = {};
  candidates.forEach((c, idx) => {
    const keepAns = res.answers[`term_${idx}_keep`];
    const catAns = res.answers[`term_${idx}_cat`];
    const genAns = res.answers[`term_${idx}_gen`];
    const keepProb = Number(keepAns?.noul ?? 0.5);

    const catRaw = catAns?.choice;
    const category: GlossaryCategory =
      catRaw === 'characters' ||
      catRaw === 'realms' ||
      catRaw === 'sects_and_places' ||
      catRaw === 'units'
        ? catRaw
        : 'system_and_terms';

    const genRaw = genAns?.choice;
    const gender: GrammaticalGender =
      genRaw === 'f_female'
        ? 'F'
        : genRaw === 'm_male'
          ? 'M'
          : genRaw === 'n_neuter'
            ? 'N'
            : genRaw === 'pl_plural'
              ? 'PL'
              : 'UNKNOWN';

    termDecisions[c.eng] = {
      keep: keepProb >= 0.58,
      keepConfidence: keepProb,
      category,
      gender,
    };
  });

  const pairRegisterDecisions: ChapterPreFlightDecisionResult['pairRegisterDecisions'] = [];
  pairs.forEach((p, idx) => {
    const ans = res.answers[`pair_${idx}_reg`];
    pairRegisterDecisions.push({
      fromCharacter: p.fromCharacter,
      toCharacter: p.toCharacter,
      pronounMode: ans?.choice === 'vy_formal' ? 'Вы' : 'ты',
      confidence: Number(ans?.confidence ?? 0.5),
    });
  });

  return {
    pacingMode,
    literaryComplexityScore: Number(complexityScore.toFixed(2)),
    recommendedThinkingLevel,
    narratorGender,
    termDecisions,
    pairRegisterDecisions,
    requestsUsed: res.requestsUsed,
    latencyMs: res.latencyMs,
  };
}

export interface FlawedParagraphDiagnosis {
  paragraphIndex: number;
  faithDefectScore: number;
  genderDefectScore: number;
  calqueScore: number;
  rhythmFlatScore: number;
  reasons: string[];
}

export interface ChapterDecisionAuditResult {
  rubricScores: LiTransProQaRubricScores;
  otqsScore: number;
  flawedAccuracyParagraphs: FlawedParagraphDiagnosis[];
  stylisticDirectives: StylisticSpanDirective[];
  skipGenerativePass2: boolean;
  flaggedCount: number;
  paragraphsEvaluated: number;
  requestsUsed: number;
  latencyMs: number;
}

const STANDARD_5_LEVEL_RUBRIC = [
  'Critical failure (0/10): severe widespread errors, omissions, or unreadable machine prose.',
  'Poor (2.5/10): multiple serious mistakes, awkward calques, or broken grammar.',
  'Acceptable (5/10): readable and mostly accurate, but noticeably dry, stiff, or inconsistent.',
  'Strong literary quality (7.5/10): accurate, smooth Russian prose with only minor blemishes.',
  'Master publication grade (10/10): completely faithful, natural, expressive Russian literary prose.',
];

function computeWeightedOtqs(r: Omit<LiTransProQaRubricScores, 'otqs'>): number {
  const weighted =
    r.q1_faith * 1.4 +
    r.q2_term * 1.2 +
    r.q3_cult * 0.9 +
    r.q4_pron * 1.1 +
    r.q5_struct * 0.9 +
    r.q6_rhythm * 0.9 +
    r.q7_verbs * 0.9 +
    r.q8_voice * 1.0 +
    r.q9_atmos * 0.8 +
    r.q10_pacing * 0.9;
  return Number(Math.min(10, Math.max(0, weighted / 10)).toFixed(2));
}

function buildLiTransProQaRubricQuestions(): Record<string, DecisionScoreQuestion> {
  return {
    q1_faith: {
      type: 'score',
      instructions:
        'Q1_FAITH: Rate factual fidelity, Arabic numbers, negation polarity, and zero omissions between ENG and RUS.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q2_term: {
      type: 'score',
      instructions:
        'Q2_TERM: Rate consistency with canon glossary terms and correct Russian declension/case endings.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q3_cult: {
      type: 'score',
      instructions:
        'Q3_CULT: Rate cultural and idiom adaptation (CSI, proverbs, cultivation concepts) without literal nonsense.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q4_pron: {
      type: 'score',
      instructions:
        'Q4_PRON: Rate grammatical gender agreement (M/F), speaker attribution with zero pronouns, and consistent ты/Вы social register.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q5_struct: {
      type: 'score',
      instructions:
        'Q5_STRUCT: Rate Russian Theme -> Rheme information flow and freedom from rigid English SVO word-order hypnosis.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q6_rhythm: {
      type: 'score',
      instructions:
        'Q6_RHYTHM: Rate sentence length variety (burstiness), punctuation restraint (no AI em-dash inflation), and prose cadence.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q7_verbs: {
      type: 'score',
      instructions:
        'Q7_VERBS: Rate Nora Gal verbal energy vs heavy bureaucratic nominalizations ("осуществил", "после завершения") and inanimate subjects.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q8_voice: {
      type: 'score',
      instructions:
        'Q8_VOICE: Rate character voice distinctiveness and natural Russian spoken dialogue idioms vs robotic phrasing.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q9_atmos: {
      type: 'score',
      instructions:
        'Q9_ATMOS: Rate genre tone fidelity, imagery, and lexical richness without English lexical leakage.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
    q10_pacing: {
      type: 'score',
      instructions:
        'Q10_PACING: Rate narrative momentum and emotional tension matching the scene pacing.',
      criteria: STANDARD_5_LEVEL_RUBRIC,
    },
  };
}

/**
 * Post-Pass 1 Radar & Offline Literary Auditor via Gemini Decision 1:
 * Evaluates all 10 LiTransProQA rubric dimensions plus 4 atomic diagnostics per paragraph
 * (faith/omission, gender/register, calque/nominalization, flat dialogue/rhythm) in one forward pass per 140 paragraphs.
 */
export async function auditChapterDraftWithDecision1(
  params: {
    chapterNumber?: number;
    engText: string;
    rusText: string;
    engParagraphs?: string[];
    rusParagraphs?: string[];
    glossary?: CanonicalGlossary;
    genderRulesList?: string[];
  },
  options?: DecisionBatchOptions
): Promise<ChapterDecisionAuditResult> {
  const engParas = params.engParagraphs ?? splitParagraphsClean(params.engText);
  const rusParas = params.rusParagraphs ?? splitParagraphsClean(params.rusText);
  const pairCount = Math.min(engParas.length, rusParas.length);

  if (pairCount === 0) {
    const zeroScores: LiTransProQaRubricScores = {
      q1_faith: 0,
      q2_term: 0,
      q3_cult: 0,
      q4_pron: 0,
      q5_struct: 0,
      q6_rhythm: 0,
      q7_verbs: 0,
      q8_voice: 0,
      q9_atmos: 0,
      q10_pacing: 0,
      otqs: 0,
    };
    return {
      rubricScores: zeroScores,
      otqsScore: 0,
      flawedAccuracyParagraphs: [],
      stylisticDirectives: [],
      skipGenerativePass2: false,
      flaggedCount: 0,
      paragraphsEvaluated: 0,
      requestsUsed: 0,
      latencyMs: 0,
    };
  }

  const glossaryPairs: string[] = [];
  if (params.glossary) {
    const engLower = params.engText.toLowerCase();
    const rusLower = params.rusText.toLowerCase();
    for (const bucket of Object.values(params.glossary) as Array<Record<string, string> | undefined>) {
      if (!bucket) continue;
      for (const [e, r] of Object.entries(bucket)) {
        if (engLower.includes(e.toLowerCase()) || rusLower.includes(r.toLowerCase())) {
          glossaryPairs.push(`${e} -> ${r}`);
        }
      }
    }
  }
  const canonHeader = [
    glossaryPairs.length > 0 ? `[CANON GLOSSARY]\n${glossaryPairs.slice(0, 60).join(' | ')}` : '',
    params.genderRulesList && params.genderRulesList.length > 0
      ? `[CHARACTER GENDER RULES]\n${params.genderRulesList.slice(0, 35).join('; ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const rubricAccumulator: Record<keyof Omit<LiTransProQaRubricScores, 'otqs'>, number> = {
    q1_faith: 0,
    q2_term: 0,
    q3_cult: 0,
    q4_pron: 0,
    q5_struct: 0,
    q6_rhythm: 0,
    q7_verbs: 0,
    q8_voice: 0,
    q9_atmos: 0,
    q10_pacing: 0,
  };
  let totalWeight = 0;
  let totalRequests = 0;
  let totalLatencyMs = 0;
  const flawedAccuracyParagraphs: FlawedParagraphDiagnosis[] = [];
  const stylisticDirectives: StylisticSpanDirective[] = [];

  for (let start = 0; start < pairCount; start += PARAGRAPHS_PER_AUDIT_WINDOW) {
    const end = Math.min(pairCount, start + PARAGRAPHS_PER_AUDIT_WINDOW);
    const windowLen = end - start;
    const pairedLines: string[] = [];
    const questions: Record<string, DecisionQuestion> = {};

    if (start === 0) {
      Object.assign(questions, buildLiTransProQaRubricQuestions());
    }

    for (let idx = start; idx < end; idx++) {
      const eText = engParas[idx] || '';
      const rText = rusParas[idx] || '';
      pairedLines.push(`[#p${idx}]\nENG: ${eText}\nRUS: ${rText}`);

      questions[`p${idx}_faith`] = {
        type: 'noul',
        instructions: `Does RUS in [#p${idx}] have a factual mistranslation, dropped sentence, wrong number, or flipped negation compared to ENG in [#p${idx}]?`,
        criteria: {
          true_description: 'Contains meaning distortion, omitted clause/fact, wrong number, or negated sense error.',
          false_description: 'Faithfully conveys the facts and polarity of the English paragraph (natural literary paraphrasing is acceptable).',
        },
      };
      questions[`p${idx}_gender`] = {
        type: 'noul',
        instructions: `Does RUS in [#p${idx}] violate character grammatical gender, confuse speakers, or clash in "ты/Вы" register?`,
        criteria: {
          true_description: 'Wrong masculine/feminine ending for a known character, confused speaker, or broken ты/Вы politeness register.',
          false_description: 'Grammatical gender, speaker attribution, and ты/Вы register are consistent and valid.',
        },
      };
      questions[`p${idx}_calque`] = {
        type: 'noul',
        instructions: `Does RUS in [#p${idx}] suffer from unnatural English/Chinese SVO calques, heavy nominalizations ("после завершения..."), or redundant possessives ("свою руку")?`,
        criteria: {
          true_description: 'Noticeable stiff calque syntax, bureaucratic nouns where verbs belong, or redundant possessives.',
          false_description: 'Idiomatic Russian syntax and verbal phrasing.',
        },
      };
      questions[`p${idx}_rhythm`] = {
        type: 'noul',
        instructions: `Does RUS in [#p${idx}] sound stiff, repetitive, mechanically dashed, or contain close cognate/root repetitions in adjacent clauses (e.g. "рассыпались... осыпали", "уплотнена... плотными") compared to strong Russian fiction?`,
        criteria: {
          true_description: 'Wooden AI cadence, flat robotic dialogue, repetitive sentence openings, or close cognate/root repetition in adjacent clauses.',
          false_description: 'Natural literary rhythm, expressive dialogue, and clean lexical variation without adjacent root echoes.',
        },
      };
    }

    const inputDoc = `${
      params.chapterNumber !== undefined ? `[CHAPTER ${params.chapterNumber}]\n` : ''
    }${canonHeader ? `${canonHeader}\n\n` : ''}[ALIGNED PARAGRAPHS]\n${pairedLines.join('\n\n')}`;

    const batchRes = await runGeminiDecisionBatch(inputDoc, questions, options);
    totalRequests += batchRes.requestsUsed;
    totalLatencyMs += batchRes.latencyMs;

    if (start === 0) {
      totalWeight += windowLen;
      (Object.keys(rubricAccumulator) as Array<keyof typeof rubricAccumulator>).forEach((k) => {
        const raw = Number(batchRes.answers[k]?.score ?? 3.2);
        rubricAccumulator[k] += Math.min(10, Math.max(0, raw * 2.5)) * windowLen;
      });
    }

    for (let idx = start; idx < end; idx++) {
      const faithScore = Number(batchRes.answers[`p${idx}_faith`]?.noul ?? 0.1);
      const genderScore = Number(batchRes.answers[`p${idx}_gender`]?.noul ?? 0.1);
      const calqueScore = Number(batchRes.answers[`p${idx}_calque`]?.noul ?? 0.1);
      const rhythmScore = Number(batchRes.answers[`p${idx}_rhythm`]?.noul ?? 0.1);

      const reasons: string[] = [];
      if (faithScore >= 0.62) reasons.push(`Точность/пропуск (${faithScore.toFixed(2)})`);
      if (genderScore >= 0.62) reasons.push(`Род/регистр (${genderScore.toFixed(2)})`);

      if (reasons.length > 0) {
        flawedAccuracyParagraphs.push({
          paragraphIndex: idx,
          faithDefectScore: Number(faithScore.toFixed(3)),
          genderDefectScore: Number(genderScore.toFixed(3)),
          calqueScore: Number(calqueScore.toFixed(3)),
          rhythmFlatScore: Number(rhythmScore.toFixed(3)),
          reasons,
        });
      }

      if (calqueScore >= 0.65) {
        stylisticDirectives.push({
          paragraphIndex: idx,
          spanQuote: (rusParas[idx] || '').slice(0, 72),
          issueType: calqueScore >= 0.78 ? 'NOMINALIZATION' : 'SVO_CALQUE',
          rewriteInstructionRu:
            'Устранить синтаксическую кальку и отглагольные существительные по Норе Галь, переставив смысловой акцент в конец фразы.',
        });
      }
      if (rhythmScore >= 0.65) {
        stylisticDirectives.push({
          paragraphIndex: idx,
          spanQuote: (rusParas[idx] || '').slice(0, 72),
          issueType: /[—«]/.test(rusParas[idx] || '') ? 'FLAT_DIALOGUE' : 'RHYTHM_MONOTONY',
          rewriteInstructionRu:
            'Оживить интонацию, заменить близкие однокоренные повторы в соседних фразах и выровнять темпоритм сцены без механических тире.',
        });
      }
    }
  }

  const denom = Math.max(1, totalWeight);
  const partialRubric: Omit<LiTransProQaRubricScores, 'otqs'> = {
    q1_faith: Number((rubricAccumulator.q1_faith / denom).toFixed(2)),
    q2_term: Number((rubricAccumulator.q2_term / denom).toFixed(2)),
    q3_cult: Number((rubricAccumulator.q3_cult / denom).toFixed(2)),
    q4_pron: Number((rubricAccumulator.q4_pron / denom).toFixed(2)),
    q5_struct: Number((rubricAccumulator.q5_struct / denom).toFixed(2)),
    q6_rhythm: Number((rubricAccumulator.q6_rhythm / denom).toFixed(2)),
    q7_verbs: Number((rubricAccumulator.q7_verbs / denom).toFixed(2)),
    q8_voice: Number((rubricAccumulator.q8_voice / denom).toFixed(2)),
    q9_atmos: Number((rubricAccumulator.q9_atmos / denom).toFixed(2)),
    q10_pacing: Number((rubricAccumulator.q10_pacing / denom).toFixed(2)),
  };
  const otqsScore = computeWeightedOtqs(partialRubric);
  const rubricScores: LiTransProQaRubricScores = { ...partialRubric, otqs: otqsScore };

  const skipGenerativePass2 =
    flawedAccuracyParagraphs.length === 0 &&
    rubricScores.q1_faith >= 8.0 &&
    rubricScores.q2_term >= 8.0 &&
    rubricScores.q4_pron >= 8.0;

  return {
    rubricScores,
    otqsScore,
    flawedAccuracyParagraphs,
    stylisticDirectives,
    skipGenerativePass2,
    flaggedCount: flawedAccuracyParagraphs.length + stylisticDirectives.length,
    paragraphsEvaluated: pairCount,
    requestsUsed: totalRequests,
    latencyMs: totalLatencyMs,
  };
}

export interface StylistRefereeResult {
  acceptedParagraphs: Array<{ index: number; styledRusText: string }>;
  rejectedIndices: number[];
  decisions: Array<{
    index: number;
    preservesMeaning: number;
    winner: 'a_verified_draft' | 'b_styled_rewrite';
    accepted: boolean;
  }>;
  requestsUsed: number;
  latencyMs: number;
}

/**
 * Post-Pass 3 A/B Literary Referee via Gemini Decision 1:
 * Prevents Pass 3 Blind Stylist regressions by checking each rewritten paragraph
 * against BOTH the English source (meaning fidelity) and Verified Draft A (literary superiority).
 */
export async function refereeStylistRewritesWithDecision1(
  params: {
    engParagraphs: string[];
    verifiedRusParagraphs: string[];
    styledParagraphs: Array<{ index: number; styledRusText: string }>;
  },
  options?: DecisionBatchOptions
): Promise<StylistRefereeResult> {
  const candidates = (params.styledParagraphs || []).filter(
    (s) =>
      s &&
      typeof s.index === 'number' &&
      s.index >= 0 &&
      s.index < params.verifiedRusParagraphs.length &&
      s.styledRusText.trim() &&
      s.styledRusText.trim() !== (params.verifiedRusParagraphs[s.index] || '').trim()
  );

  if (candidates.length === 0) {
    return {
      acceptedParagraphs: [],
      rejectedIndices: [],
      decisions: [],
      requestsUsed: 0,
      latencyMs: 0,
    };
  }

  const blocks: string[] = [];
  const questions: Record<string, DecisionQuestion> = {};

  candidates.forEach((cand, k) => {
    const eng = params.engParagraphs[cand.index] || '';
    const verA = params.verifiedRusParagraphs[cand.index] || '';
    const styB = cand.styledRusText;
    blocks.push(
      `[#p${cand.index}]\nENG: ${eng}\nA (Verified Draft): ${verA}\nB (Styled Rewrite): ${styB}`
    );

    questions[`ref_${k}_meaning`] = {
      type: 'noul',
      instructions: `For [#p${cand.index}], does B (Styled Rewrite) preserve all concrete facts, numbers, canon terms, negation polarity, and core meaning of ENG?`,
      criteria: {
        true_description: '100% faithful to ENG facts, numbers, terms, and emotional intent.',
        false_description: 'Drops or alters a fact, number, canon term, speaker, or adds hallucinated detail.',
      },
    };
    questions[`ref_${k}_winner`] = {
      type: 'choice',
      instructions: `For [#p${cand.index}], choose which Russian version reads like better human literary prose without AI clichés or em-dash inflation.`,
      criteria: {
        a_verified_draft: 'Version A sounds cleaner, more accurate, or more natural than Version B.',
        b_styled_rewrite: 'Version B noticeably improves flow, verbal energy, dialogue naturalness, or Theme->Rheme structure.',
      },
    };
  });

  const inputDoc = `[POST-PASS-3 LITERARY A/B REFEREE]\n\n${blocks.join('\n\n')}`;
  const res = await runGeminiDecisionBatch(inputDoc, questions, options);

  const acceptedParagraphs: Array<{ index: number; styledRusText: string }> = [];
  const rejectedIndices: number[] = [];
  const decisions: StylistRefereeResult['decisions'] = [];

  candidates.forEach((cand, k) => {
    const meaningScore = Number(res.answers[`ref_${k}_meaning`]?.noul ?? 0.5);
    const winnerRaw = res.answers[`ref_${k}_winner`]?.choice;
    const winner: 'a_verified_draft' | 'b_styled_rewrite' =
      winnerRaw === 'b_styled_rewrite' ? 'b_styled_rewrite' : 'a_verified_draft';
    const accepted = meaningScore >= 0.7 && winner === 'b_styled_rewrite';

    if (accepted) {
      acceptedParagraphs.push(cand);
    } else {
      rejectedIndices.push(cand.index);
    }
    decisions.push({
      index: cand.index,
      preservesMeaning: Number(meaningScore.toFixed(3)),
      winner,
      accepted,
    });
  });

  return {
    acceptedParagraphs,
    rejectedIndices,
    decisions,
    requestsUsed: res.requestsUsed,
    latencyMs: res.latencyMs,
  };
}

/**
 * Verifies Stage 3 repaired paragraphs against source meaning and Russian prose cleanliness.
 */
export async function auditRepairedParagraphsWithDecision1(
  params: {
    pairs: Array<{
      index: number;
      eng: string;
      beforeRus: string;
      afterRus: string;
      issueHint?: string;
    }>;
  },
  options?: DecisionBatchOptions
): Promise<{
  results: Array<{ index: number; resolved: boolean; cleanStyle: boolean; score: number }>;
  requestsUsed: number;
  latencyMs: number;
}> {
  const items = params.pairs.slice(0, 120);
  if (items.length === 0) {
    return { results: [], requestsUsed: 0, latencyMs: 0 };
  }

  const blocks: string[] = [];
  const questions: Record<string, DecisionQuestion> = {};
  items.forEach((item, k) => {
    blocks.push(
      `[#p${item.index}]${item.issueHint ? ` (Issue: ${item.issueHint})` : ''}\nENG: ${item.eng}\nBEFORE: ${item.beforeRus}\nAFTER: ${item.afterRus}`
    );
    questions[`rep_${k}_ok`] = {
      type: 'noul',
      instructions: `In [#p${item.index}], does AFTER fix the translation/grammar/style problem shown in BEFORE while staying faithful to ENG?`,
    };
    questions[`rep_${k}_style`] = {
      type: 'noul',
      instructions: `In [#p${item.index}], does AFTER read naturally in Russian without calques or AI em-dash clichés?`,
    };
  });

  const res = await runGeminiDecisionBatch(blocks.join('\n\n'), questions, options);
  const results = items.map((item, k) => {
    const okScore = Number(res.answers[`rep_${k}_ok`]?.noul ?? 0.5);
    const styleScore = Number(res.answers[`rep_${k}_style`]?.noul ?? 0.5);
    return {
      index: item.index,
      resolved: okScore >= 0.65,
      cleanStyle: styleScore >= 0.6,
      score: Number(((okScore + styleScore) / 2).toFixed(3)),
    };
  });

  return {
    results,
    requestsUsed: res.requestsUsed,
    latencyMs: res.latencyMs,
  };
}

export function buildSocialEdgesFromDecisionPreFlight(
  preFlight: ChapterPreFlightDecisionResult,
  chapterNumber: number,
  existing: SocialRegisterEdge[] = []
): SocialRegisterEdge[] {
  const merged = [...existing];
  for (const d of preFlight.pairRegisterDecisions) {
    const idx = merged.findIndex(
      (e) =>
        e.fromCharacter.toLowerCase() === d.fromCharacter.toLowerCase() &&
        e.toCharacter.toLowerCase() === d.toCharacter.toLowerCase()
    );
    if (idx === -1) {
      merged.push({
        fromCharacter: d.fromCharacter,
        toCharacter: d.toCharacter,
        valence: 0,
        coarseRole: d.pronounMode === 'Вы' ? 'hierarchical' : 'peer',
        fineRole: 'decision-1-inferred',
        pronounMode: d.pronounMode,
        updatedAtChapter: chapterNumber,
      });
    }
  }
  return merged;
}
