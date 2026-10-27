/**
 * Pure TypeScript implementation of the Universal Web-Novel & Xianxia Deterministic QA Linter,
 * Configurable Rule Profiles, Character Gender & Voice/Politeness Validator, Rolling Chapter Memory,
 * 1:1 Paragraph Alignment & Drift Detector, Proximity Tautology Radar, Retroactive Canon Ripple Engine,
 * Word-Level Inline Diff, Bulk Chapter Parser, Rulate LF Exporter, and Split-Chapter Merger.
 * Self-contained module testable via `node --test`.
 */

import { type SocialRegisterEdge, buildInflectedRussianForms } from './canon-glossary-vault.ts';

export type GlossaryCategory =
  | 'realms'
  | 'characters'
  | 'sects_and_places'
  | 'system_and_terms'
  | 'units';

export type GrammaticalGender = 'M' | 'F' | 'N' | 'PL';

export interface CharacterSpeechVector {
  registerLevel: number; // [-1.0 (грубый просторечный) .. +1.0 (высокий архаичный)]
  sentenceLengthBias: 'clipped_staccato' | 'balanced_conversational' | 'ornate_periodic';
  ellipsisRate: 'low' | 'medium' | 'high';
  inversionTendency: 'low' | 'medium' | 'high';
  preferredParticles: string[]; // e.g. ["же", "-то", "ну", "ведь", "что ли"]
  forbiddenLexicon: string[];   // e.g. ["окей", "круто", "проблема", "информация"]
  catchphrasesOrTics?: string[];
  contrastiveDialogueSamples?: Array<{
    context: string;
    badNeutralAi: string;
    canonicalVoiceRu: string;
  }>;
}

export interface GlossaryTermMeta {
  gender?: GrammaticalGender;
  declensionNote?: string; // e.g., "не склоняется" or "род. п.: Су Цинсюэ"
  voiceNote?: string; // e.g., "к ученикам на «ты», архаично-властный тон; к нему все на «вы»"
  speechVector?: CharacterSpeechVector;
}

export interface CanonicalGlossary {
  realms: Record<string, string>;
  characters: Record<string, string>;
  sects_and_places: Record<string, string>;
  system_and_terms: Record<string, string>;
  units: Record<string, string>;
}

export interface ScoutedTerm {
  id: string;
  eng: string;
  rus_suggested: string;
  category: GlossaryCategory;
  gender?: GrammaticalGender;
  chapter_first_seen: number;
  context_snippet: string;
  approved_for_glossary: boolean;
  confidence: number;
}

export type GenrePreset =
  | 'xianxia'
  | 'litrpg'
  | 'korean_murim'
  | 'japanese_ln'
  | 'dark_fantasy';

export type ProseTone = 'classic' | 'dynamic' | 'grim' | 'light';

export type LintSeverity = 'error' | 'warning';

export type LintRuleId =
  | 'TIER_VS_GRADE'
  | 'ARTIFACT_RANKING'
  | 'WRITTEN_NUMERALS'
  | 'WRITTEN_PERCENTS'
  | 'DIALOGUE_DASH'
  | 'THOUGHT_QUOTES'
  | 'WEIGHT_UNITS'
  | 'ALCHEMY_CALQUES'
  | 'SECT_SINGULAR'
  | 'MACHINE_CALQUES'
  | 'NUMBER_MISMATCH'
  | 'GLOSSARY_CANON_VIOLATION'
  | 'CHARACTER_GENDER_MISMATCH'
  | 'PARAGRAPH_DRIFT'
  | 'TAUTOLOGY_RADAR'
  | 'LATIN_LEAKAGE_AND_BRACKETS'
  | 'DASH_AND_COMMA_INFLATION'
  | 'SYNTAX_MONOTONY_AND_BURSTINESS'
  | 'REGISTER_PRONOUN_SHIFT'
  | 'NOMINALIZATION_AND_INANIMATE_SUBJECT';

export interface LintRuleDefinition {
  id: LintRuleId;
  title: string;
  description: string;
  defaultGenres: GenrePreset[];
}

export const ALL_LINT_RULES: LintRuleDefinition[] = [
  {
    id: 'NUMBER_MISMATCH',
    title: 'Сверка всех чисел с оригиналом (ENG = RUS)',
    description: 'Проверяет, что ни одно числовое значение, уровень или бонус не потеряны при переводе.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'GLOSSARY_CANON_VIOLATION',
    title: 'Контроль канона глоссария (Уровень 2)',
    description: 'Проверяет наличие утверждённого перевода термина при его появлении в оригинале.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'CHARACTER_GENDER_MISMATCH',
    title: 'Контроль грамматического рода персонажей (М / Ж)',
    description: 'Выявляет ошибки согласования глаголов прошедшего времени с полом персонажа (напр., «Су Цинсюэ сказал»).',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'PARAGRAPH_DRIFT',
    title: 'Синхронность абзацев и системных рамок (1:1 Alignment)',
    description: 'Ловит пропуск или склейку абзацев и системных разделителей [---] между ENG и RUS.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'TAUTOLOGY_RADAR',
    title: 'Радар и авто-синонимайзер тавтологий',
    description: 'Выявляет и автоматически заменяет синонимами повторы одного и того же корня внутри абзаца.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'LATIN_LEAKAGE_AND_BRACKETS',
    title: 'Сторож утечки латиницы и незакрытых рамок [ ] / « »',
    description: 'Блокирует и автоматически допереводит забытые английские слова и закрывает оборванные скобки системных окон.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'DIALOGUE_DASH',
    title: 'Оформление прямой речи (длинное тире «— »)',
    description: 'Запрещает дефисы в начале реплик и двоеточия перед тире внутри диалогов.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'THOUGHT_QUOTES',
    title: 'Кавычки-ёлочки «...» для мыслей и техник',
    description: 'Заменяет прямые кавычки "..." и звёздочки *...* на канонические «...».',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'MACHINE_CALQUES',
    title: 'Запрет машинных калек и канцелярита',
    description: 'Искореняет конструкции «не удержался от вопроса», «втянул глоток холодного воздуха».',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'WRITTEN_NUMERALS',
    title: 'Числительные цифрами (21, 6-м слое, 1-го яруса)',
    description: 'Переводит числительные прописью для камней, слоёв и рангов в арабские цифры.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim'],
  },
  {
    id: 'WRITTEN_PERCENTS',
    title: 'Проценты строго со знаком % (80%)',
    description: 'Заменяет слова «процентов/процента» на компактный знак %.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln'],
  },
  {
    id: 'TIER_VS_GRADE',
    title: 'Иерархия Tier = Ярус, Grade = Ранг',
    description: 'Запрещает тавтологию «1-го ранга низшего ранга» и «ранг низшего сорта».',
    defaultGenres: ['xianxia', 'litrpg'],
  },
  {
    id: 'ARTIFACT_RANKING',
    title: 'Артефакты 1-го яруса = Магический артефакт',
    description: 'Разделяет Магические артефакты (1-й ярус) и Духовные артефакты (со 2-го яруса).',
    defaultGenres: ['xianxia'],
  },
  {
    id: 'WEIGHT_UNITS',
    title: 'Традиционные меры веса (цзинь, лян)',
    description: 'Заменяет западные фунты и килограммы на канонические китайские меры.',
    defaultGenres: ['xianxia'],
  },
  {
    id: 'ALCHEMY_CALQUES',
    title: 'Канон алхимии («создание пилюль», не «варка»)',
    description: 'Заменяет «варить пилюли / выплавка пилюль» на «создание / изготовление пилюль».',
    defaultGenres: ['xianxia'],
  },
  {
    id: 'SECT_SINGULAR',
    title: 'Названия сект и гильдий во множественном числе',
    description: 'Исправляет кальки вида «Секта Каменного Демона» на «Секта Каменных Демонов».',
    defaultGenres: ['xianxia', 'korean_murim'],
  },
  {
    id: 'DASH_AND_COMMA_INFLATION',
    title: 'Инфляция тире и искусственные связки (Dash & Comma Inflation)',
    description: 'Выявляет избыточную плотность не-диалоговых тире (ΔDash ≥ 3 на абзац) и искусственные тире-связки (« — это », « — был »).',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'SYNTAX_MONOTONY_AND_BURSTINESS',
    title: 'Синтаксическая монотонность и однообразие длин (Syntax Monotony)',
    description: 'Выявляет повтор одинакового POS-паттерна в начале предложений (≥3 подряд) и аномально низкую вариацию длины предложений (CV < 0.35 при ≥5 предложениях).',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'REGISTER_PRONOUN_SHIFT',
    title: 'Нарушение речевого регистра (ты ↔ Вы)',
    description: 'Выявляет паразитные формы «Вы/Вас/Вам/-те» в диалогах с регистром «ты» (и наоборот) согласно социальному графу.',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
  {
    id: 'NOMINALIZATION_AND_INANIMATE_SUBJECT',
    title: 'Отглагольные существительные и неодушевлённые подлежащие (Нора Галь)',
    description: 'Выявляет канцеляритные цепочки существительных («после завершения поглощения», «осуществил атаку») и неодушевлённые подлежащие («вид заставил пробежать»).',
    defaultGenres: ['xianxia', 'litrpg', 'korean_murim', 'japanese_ln', 'dark_fantasy'],
  },
];

export function getDefaultRulesForGenre(genre: GenrePreset): LintRuleId[] {
  return ALL_LINT_RULES.filter((r) => r.defaultGenres.includes(genre)).map((r) => r.id);
}

export const GENRE_PRESET_LABELS: Record<
  GenrePreset,
  { title: string; subtitle: string; promptHint: string }
> = {
  xianxia: {
    title: 'Сянься / Уся (Культивация)',
    subtitle: 'Ярусы и ранги, цзинь/лян, даосские термины, секты во мн.ч.',
    promptHint:
      'Chinese Xianxia/Wuxia cultivation novel. Enforce Tier=ярус, Grade=ранг, jin=цзинь, liang=лян, elevated immortal terminology.',
  },
  litrpg: {
    title: 'ЛитРПГ / РеалРПГ (Система)',
    subtitle: 'Системные логи [---], точность статов, процентов и уровней',
    promptHint:
      'LitRPG / Progression Fantasy. Keep system boxes crisp inside --- dividers, preserve all stat numbers, percentages, cooldowns, and skill names.',
  },
  korean_murim: {
    title: 'Корея: Охотники / Мурим',
    subtitle: 'Ранги S–F, гильдии, подземелья, кланы боевых искусств',
    promptHint:
      'Korean Hunter / Dungeon / Murim web-novel. Preserve hunter ranks (S-rank, A-rank), guild names, and dynamic martial combat.',
  },
  japanese_ln: {
    title: 'Японское ранобэ (Исекай / Фэнтези)',
    subtitle: 'Живые диалоги, внутренняя ирония, бережная передача титулов',
    promptHint:
      'Japanese Light Novel (Ranobe). Keep natural expressive dialogue, light inner monologues in «...», and accurate fantasy terminology.',
  },
  dark_fantasy: {
    title: 'Тёмное фэнтези',
    subtitle: 'Строгий архаичный слог, без азиатских мер веса и современного сленга',
    promptHint:
      'Grimdark / Dark Fantasy novel. Use atmospheric, grounded Russian literary prose without modern slang or bureaucratic calques.',
  },
};

export const PROSE_TONE_LABELS: Record<
  ProseTone,
  { title: string; instruction: string }
> = {
  classic: {
    title: 'Классический эпический',
    instruction:
      'Плавный, богатый русский литературный язык в традициях классического фэнтези и возвышенного сянься.',
  },
  dynamic: {
    title: 'Динамичный боевой',
    instruction:
      'Энергичный ритм, короткие рубленые фразы в боевых сценах, минимум причастных оборотов, высокий темп.',
  },
  grim: {
    title: 'Мрачный реализм',
    instruction:
      'Суровый, сдержанный и весомый тон, акцент на атмосфере опасности и хладнокровии персонажей.',
  },
  light: {
    title: 'Лёгкий ироничный',
    instruction:
      'Живой разговорный слог, естественная самоирония во внутренних монологах героя, лёгкость чтения.',
  },
};

export interface LintIssue {
  id: string;
  ruleId: LintRuleId;
  ruleTitle: string;
  severity: LintSeverity;
  line: number;
  snippet: string;
  suggestion: string;
  explanation: string;
}

export interface LintReport {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  score: number;
  issues: LintIssue[];
  checkedNumbersCount: number;
  glossaryMatchesCount: number;
}

export interface LinterOptions {
  enabledRuleIds?: LintRuleId[];
  glossaryMeta?: Record<string, GlossaryTermMeta>;
  socialEdges?: SocialRegisterEdge[];
  dialogueRegisters?: Array<{ lineIndex?: number; speaker?: string; pronounMode: 'ты' | 'Вы' }>;
}

const WRITTEN_NUMERAL_PATTERNS: Array<{ regex: RegExp; replacement: string; label: string }> = [
  {
    regex: /(?<![а-яёa-z0-9])двадцать\s+один(?![а-яёa-z0-9])/gi,
    replacement: '21',
    label: 'двадцать один → 21',
  },
  {
    regex: /(?<![а-яёa-z0-9])двадцати\s+одного(?![а-яёa-z0-9])/gi,
    replacement: '21',
    label: 'двадцати одного → 21',
  },
  {
    regex: /(?<![а-яёa-z0-9])тридцать\s+пять(?![а-яёa-z0-9])/gi,
    replacement: '35',
    label: 'тридцать пять → 35',
  },
  {
    regex: /(?<![а-яёa-z0-9])шестом\s+слое(?![а-яёa-z0-9])/gi,
    replacement: '6-м слое',
    label: 'шестом слое → 6-м слое',
  },
  {
    regex: /(?<![а-яёa-z0-9])седьмом\s+слое(?![а-яёa-z0-9])/gi,
    replacement: '7-м слое',
    label: 'седьмом слое → 7-м слое',
  },
  {
    regex: /(?<![а-яёa-z0-9])девятом\s+слое(?![а-яёa-z0-9])/gi,
    replacement: '9-м слое',
    label: 'девятом слое → 9-м слое',
  },
  {
    regex: /(?<![а-яёa-z0-9])первого\s+яруса(?![а-яёa-z0-9])/gi,
    replacement: '1-го яруса',
    label: 'первого яруса → 1-го яруса',
  },
  {
    regex: /(?<![а-яёa-z0-9])второго\s+яруса(?![а-яёa-z0-9])/gi,
    replacement: '2-го яруса',
    label: 'второго яруса → 2-го яруса',
  },
  {
    regex: /(?<![а-яёa-z0-9])третьего\s+яруса(?![а-яёa-z0-9])/gi,
    replacement: '3-го яруса',
    label: 'третьего яруса → 3-го яруса',
  },
];

const COMMON_PAST_VERBS =
  'сказал|подумал|ответил|спросил|воскликнул|прошептал|пробормотал|посмотрел|взглянул|шагнул|улыбнулся|нахмурился|кивнул|почувствовал|ощутил|решил|понял|заметил';

const RUSSIAN_STOP_STEMS = new Set([
  'котор',
  'тольк',
  'через',
  'между',
  'перед',
  'после',
  'когда',
  'чтобы',
  'будто',
  'словн',
  'очень',
  'снова',
  'потом',
  'здесь',
  'почти',
  'всего',
]);

const TAUTOLOGY_SYNONYM_HINTS: Record<string, string> = {
  мгновен: 'в тот же миг, молниеносно, в одночасье',
  быстр: 'стремительно, проворно, мигом',
  сказа: 'произнёс, промолвил, заметил, бросил',
  посмотр: 'окинул взглядом, воззрился, перевёл взор',
  холодн: 'ледяной, студёный, бесстрастный',
  огромн: 'исполинский, колоссальный, массивный',
  сил: 'мощь, напор, могущество',
};

/**
 * 1:1 Paragraph Alignment Pair for side-by-side paragraph editing
 */
export interface AlignedParagraphPair {
  index: number;
  engParagraph: string;
  rusParagraph: string;
  isSystemDivider: boolean;
  isSystemProperty: boolean;
  isDrifted: boolean;
  missingNumbers: string[];
}

export function alignChapterParagraphs(
  engText: string,
  rusText: string
): {
  pairs: AlignedParagraphPair[];
  engCount: number;
  rusCount: number;
  hasDrift: boolean;
} {
  const engLines = engText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const rusLines = rusText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const maxLen = Math.max(engLines.length, rusLines.length);
  const pairs: AlignedParagraphPair[] = [];

  for (let i = 0; i < maxLen; i++) {
    const engP = engLines[i] || '';
    const rusP = rusLines[i] || '';
    const isSystemDivider = engP === '---' || rusP === '---';
    const isSystemProperty =
      (engP.startsWith('[') && engP.endsWith(']')) ||
      (rusP.startsWith('[') && rusP.endsWith(']'));

    const engNums = Array.from(new Set(engP.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []));
    const rusNums = new Set(rusP.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []);
    const missingNumbers = rusP ? engNums.filter((n) => !rusNums.has(n)) : [];

    const isDrifted =
      (Boolean(engP) && !rusP && rusLines.length > 0) ||
      (!engP && Boolean(rusP)) ||
      (engP === '---' && rusP !== '---' && Boolean(rusP));

    pairs.push({
      index: i,
      engParagraph: engP,
      rusParagraph: rusP,
      isSystemDivider,
      isSystemProperty,
      isDrifted,
      missingNumbers,
    });
  }

  return {
    pairs,
    engCount: engLines.length,
    rusCount: rusLines.length,
    hasDrift: rusLines.length > 0 && engLines.length !== rusLines.length,
  };
}

/**
 * Proximity Tautology Radar: detects repeated non-trivial word stems (3+ occurrences within a single paragraph)
 */
export interface TautologyHit {
  line: number;
  wordSample: string;
  stem: string;
  count: number;
  synonymHint: string;
  snippet: string;
}

export function detectTautologies(rusText: string): TautologyHit[] {
  const hits: TautologyHit[] = [];
  const lines = rusText.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('---') || line.startsWith('[')) return;

    const words = line.match(/[а-яёА-ЯЁ]{5,}/g) || [];
    if (words.length < 5) return;

    const stemCounts = new Map<string, { count: number; sample: string }>();
    for (const w of words) {
      const lower = w.toLowerCase().replace(/ё/g, 'е');
      const stem = lower.slice(0, Math.min(6, Math.max(5, lower.length - 2)));
      if (RUSSIAN_STOP_STEMS.has(stem.slice(0, 5))) continue;

      const cur = stemCounts.get(stem) || { count: 0, sample: w };
      cur.count += 1;
      stemCounts.set(stem, cur);
    }

    stemCounts.forEach(({ count, sample }, stem) => {
      if (count >= 3) {
        let hint = 'Замените повтор местоимением («он/она/тот») или контекстным синонимом';
        for (const [prefix, syn] of Object.entries(TAUTOLOGY_SYNONYM_HINTS)) {
          if (stem.startsWith(prefix) || prefix.startsWith(stem)) {
            hint = `Синонимы: ${syn}`;
            break;
          }
        }
        hits.push({
          line: idx + 1,
          wordSample: sample,
          stem,
          count,
          synonymHint: hint,
          snippet: line,
        });
      }
    });
  });

  return hits;
}

/**
 * Word-level Inline Diff for comparing Before vs After Russian text
 */
export interface WordDiffToken {
  type: 'same' | 'added' | 'removed';
  text: string;
}

export function computeWordDiff(oldText: string, newText: string): WordDiffToken[] {
  const oldTokens = oldText.trim().split(/(\s+)/).filter(Boolean);
  const newTokens = newText.trim().split(/(\s+)/).filter(Boolean);

  // Fast sliding window diff for chapter-sized texts
  const result: WordDiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < oldTokens.length || j < newTokens.length) {
    if (i < oldTokens.length && j < newTokens.length && oldTokens[i] === newTokens[j]) {
      result.push({ type: 'same', text: oldTokens[i] });
      i++;
      j++;
      continue;
    }

    // Look ahead up to 8 tokens for resync
    let foundOld = -1;
    let foundNew = -1;
    for (let look = 1; look <= 8; look++) {
      if (i + look < oldTokens.length && oldTokens[i + look] === newTokens[j]) {
        foundOld = i + look;
        break;
      }
      if (j + look < newTokens.length && oldTokens[i] === newTokens[j + look]) {
        foundNew = j + look;
        break;
      }
    }

    if (foundOld !== -1) {
      while (i < foundOld) {
        result.push({ type: 'removed', text: oldTokens[i++] });
      }
    } else if (foundNew !== -1) {
      while (j < foundNew) {
        result.push({ type: 'added', text: newTokens[j++] });
      }
    } else {
      if (i < oldTokens.length) {
        result.push({ type: 'removed', text: oldTokens[i++] });
      }
      if (j < newTokens.length) {
        result.push({ type: 'added', text: newTokens[j++] });
      }
    }
  }

  return result;
}

export {
  previewAndApplyCanonRipple,
  type CanonRippleChapterChange,
} from './canon-glossary-vault.ts';

/**
 * Filters a full CanonicalGlossary down to ONLY the terms that appear in `engText`.
 */
export function filterGlossaryForChapter(
  engText: string,
  glossary: CanonicalGlossary
): { filteredGlossary: CanonicalGlossary; matchedCount: number } {
  const filteredGlossary: CanonicalGlossary = {
    realms: {},
    characters: {},
    sects_and_places: {},
    system_and_terms: {},
    units: {},
  };
  let matchedCount = 0;

  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    Object.entries(glossary[cat] || {}).forEach(([eng, rus]) => {
      const escaped = eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}s?\\b`, 'i').test(engText)) {
        filteredGlossary[cat][eng] = rus;
        matchedCount++;
      }
    });
  });

  return { filteredGlossary, matchedCount };
}

/**
 * Generates a concise Rolling Chapter Memory summary (2–3 sentences) from a chapter's text
 * so the next chapter's translation prompt knows what just happened.
 */
export function generateChapterMemorySummary(
  chapterNumber: number,
  titleRus: string,
  rusText: string
): string {
  const cleanLines = rusText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 15 && !l.startsWith('---') && !l.startsWith('['));

  if (cleanLines.length === 0) {
    return `Глава ${chapterNumber} (${titleRus}): события главы завершены.`;
  }

  const firstSentence = cleanLines[0].split(/(?<=[.!?])\s+/)[0] || cleanLines[0];
  const lastLine = cleanLines[cleanLines.length - 1];
  const lastSentence = lastLine.split(/(?<=[.!?])\s+/).slice(-1)[0] || lastLine;

  if (firstSentence === lastSentence) {
    return `В Главе ${chapterNumber} («${titleRus}»): ${firstSentence}`;
  }
  return `В Главе ${chapterNumber} («${titleRus}»): ${firstSentence} Итог главы: ${lastSentence}`;
}

/**
 * Runs the configurable deterministic style, accuracy, gender, paragraph drift & tautology rules.
 */
export function runQaLinter(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  options?: LinterOptions
): LintReport {
  const activeRules = new Set<LintRuleId>(
    options?.enabledRuleIds || ALL_LINT_RULES.map((r) => r.id)
  );
  const glossaryMeta = options?.glossaryMeta || {};

  const issues: LintIssue[] = [];
  const lines = rusText.split(/\r?\n/);

  const femaleCharacters: string[] = [];
  Object.entries(glossary.characters || {}).forEach(([eng, rus]) => {
    const meta = glossaryMeta[eng];
    if (meta?.gender === 'F') {
      femaleCharacters.push(rus);
    }
  });

  lines.forEach((rawLine, idx) => {
    const lineNum = idx + 1;
    const line = rawLine.trim();
    if (!line) return;

    // 1. TIER_VS_GRADE
    if (
      activeRules.has('TIER_VS_GRADE') &&
      /(?:\d+-го\s+ранга\s+(?:низшего|среднего|высшего)\s+ранга|ранг[ауеом]?\s+(?:низшего|среднего|высшего)\s+сорта)/i.test(
        line
      )
    ) {
      issues.push({
        id: `lint-${lineNum}-tier`,
        ruleId: 'TIER_VS_GRADE',
        ruleTitle: 'Ярус vs Ранг (Tier / Grade)',
        severity: 'error',
        line: lineNum,
        snippet: line,
        suggestion: line
          .replace(/(\d+-го)\s+ранга\s+(низшего|среднего|высшего)\s+ранга/gi, '$1 яруса $2 ранга')
          .replace(/ранг([ауеом]?)\s+(низшего|среднего|высшего)\s+сорта/gi, 'ярус$1 $2 ранга'),
        explanation:
          'Канон: Tier = Ярус, Grade = Ранг (например, «1-го яруса низшего ранга»). Запрещено «ранг низшего сорта».',
      });
    }

    // 2. ARTIFACT_RANKING
    if (
      activeRules.has('ARTIFACT_RANKING') &&
      /духовн(?:ый|ого|ому|ым|ом|ые|ых)\s+артефакт[а-яё]*\s+1-го\s+яруса/i.test(line)
    ) {
      issues.push({
        id: `lint-${lineNum}-artifact`,
        ruleId: 'ARTIFACT_RANKING',
        ruleTitle: 'Классификация артефактов (1-й ярус = Магический)',
        severity: 'error',
        line: lineNum,
        snippet: line,
        suggestion: line.replace(
          /духовн(ый|ого|ому|ым|ом|ые|ых)(\s+артефакт[а-яё]*\s+1-го\s+яруса)/gi,
          'магическ$1$2'
        ),
        explanation:
          'Артефакты 1-го яруса именуются «Магический артефакт» (Magical Artifact), а «Духовный артефакт» — строго со 2-го яруса.',
      });
    }

    // 3. WRITTEN_NUMERALS
    if (activeRules.has('WRITTEN_NUMERALS')) {
      for (const pat of WRITTEN_NUMERAL_PATTERNS) {
        pat.regex.lastIndex = 0;
        if (pat.regex.test(line)) {
          pat.regex.lastIndex = 0;
          issues.push({
            id: `lint-${lineNum}-num-${pat.label}`,
            ruleId: 'WRITTEN_NUMERALS',
            ruleTitle: 'Числительные прописью вместо цифр',
            severity: 'error',
            line: lineNum,
            snippet: line,
            suggestion: line.replace(pat.regex, pat.replacement),
            explanation: `Все количественные и порядковые числительные для камней, слоёв и ярусов пишутся арабскими цифрами (${pat.label}).`,
          });
        }
      }
    }

    // 4. WRITTEN_PERCENTS
    if (
      activeRules.has('WRITTEN_PERCENTS') &&
      /(?:\d+|[а-яё]+)\s+процент(?:ов|а|)(?![а-яё])/i.test(line)
    ) {
      issues.push({
        id: `lint-${lineNum}-percent`,
        ruleId: 'WRITTEN_PERCENTS',
        ruleTitle: 'Проценты словом вместо знака %',
        severity: 'error',
        line: lineNum,
        snippet: line,
        suggestion: line
          .replace(/восемьдесят\s+процентов/gi, '80%')
          .replace(/пятьдесят\s+процентов/gi, '50%')
          .replace(/тридцать\s+процентов/gi, '30%')
          .replace(/(\d+)\s+процент(?:ов|а|)(?![а-яё])/gi, '$1%'),
        explanation: 'Проценты указываются строго цифрой со знаком % (например, «80%», «на 30%»).',
      });
    }

    // 5. DIALOGUE_DASH
    if (
      activeRules.has('DIALOGUE_DASH') &&
      (/^(?:-\s+|\u2013\s+)/.test(line) || /:\s*—/.test(line))
    ) {
      issues.push({
        id: `lint-${lineNum}-dash`,
        ruleId: 'DIALOGUE_DASH',
        ruleTitle: 'Оформление прямой речи (тире)',
        severity: 'error',
        line: lineNum,
        snippet: line,
        suggestion: line.replace(/^(?:-\s+|\u2013\s+)/, '— ').replace(/:\s*—/g, ', —'),
        explanation:
          'Прямая речь начинается строго с длинного тире и пробела «— », без двоеточий перед тире внутри реплик.',
      });
    }

    // 6. THOUGHT_QUOTES
    if (
      activeRules.has('THOUGHT_QUOTES') &&
      (/"[^"]+"/.test(line) || /\*[а-яёА-ЯЁ\s,!?.]{4,}\*/.test(line))
    ) {
      issues.push({
        id: `lint-${lineNum}-quotes`,
        ruleId: 'THOUGHT_QUOTES',
        ruleTitle: 'Кавычки мыслей и названий («ёлочки»)',
        severity: 'warning',
        line: lineNum,
        snippet: line,
        suggestion: line
          .replace(/"([^"]+)"/g, '«$1»')
          .replace(/\*([а-яёА-ЯЁ\s,!?.]{4,})\*/g, '«$1»'),
        explanation:
          'Мысли персонажа и названия техник оформляются строго в кавычки-ёлочки «...».',
      });
    }

    // 7. WEIGHT_UNITS
    if (
      activeRules.has('WEIGHT_UNITS') &&
      /(?<![а-яёa-z])(?:фунт(?:ов|а|ы|е|ам)?|килограмм(?:ов|а|ы|е)?)(?![а-яёa-z])/i.test(line)
    ) {
      issues.push({
        id: `lint-${lineNum}-weight`,
        ruleId: 'WEIGHT_UNITS',
        ruleTitle: 'Западные/метрические меры веса',
        severity: 'error',
        line: lineNum,
        snippet: line,
        suggestion: line
          .replace(/(?<![а-яёa-z])фунт(?:ов|а|ы|е|ам)?(?![а-яёa-z])/gi, 'цзинь')
          .replace(/(?<![а-яёa-z])килограмм(?:ов|а|ы|е)?(?![а-яёa-z])/gi, 'цзинь'),
        explanation:
          'В мире сянься используются традиционные меры веса: «цзинь» (jin) и «лян» (liang).',
      });
    }

    // 8. ALCHEMY_CALQUES
    if (
      activeRules.has('ALCHEMY_CALQUES') &&
      /(?:варить\s+пилюл[ию]|варк[аи]\s+пилюль|выплавк[аи]\s+пилюль)/i.test(line)
    ) {
      issues.push({
        id: `lint-${lineNum}-alchemy`,
        ruleId: 'ALCHEMY_CALQUES',
        ruleTitle: 'Алхимический канцелярит («варить/выплавлять пилюли»)',
        severity: 'error',
        line: lineNum,
        snippet: line,
        suggestion: line
          .replace(/варить\s+пилюл([ию])/gi, 'создавать пилюл$1')
          .replace(/варк([аи])\s+пилюль/gi, 'изготовлени$1 пилюль')
          .replace(/выплавк([аи])\s+пилюль/gi, 'создани$1 пилюль'),
        explanation:
          'Канон алхимии: «создание / изготовление пилюль» и «алхимический котёл» (не «варить пилюли»).',
      });
    }

    // 9. SECT_SINGULAR
    if (
      activeRules.has('SECT_SINGULAR') &&
      /Сект[аыеуой]\s+(?:Каменного\s+Демона|Черного\s+Дракона|Лазурного\s+Облака)/i.test(line)
    ) {
      issues.push({
        id: `lint-${lineNum}-sect`,
        ruleId: 'SECT_SINGULAR',
        ruleTitle: 'Единственное число в названии секты',
        severity: 'warning',
        line: lineNum,
        snippet: line,
        suggestion: line
          .replace(/Сект([аыеуой])\s+Каменного\s+Демона/gi, 'Сект$1 Каменных Демонов')
          .replace(/Сект([аыеуой])\s+Черного\s+Дракона/gi, 'Сект$1 Чёрных Драконов')
          .replace(/Сект([аыеуой])\s+Лазурного\s+Облака/gi, 'Сект$1 Лазурных Облаков'),
        explanation:
          'Названия сект с исчисляемыми существительными переводятся во множественном числе («Секта Каменных Демонов»).',
      });
    }

    // 10. MACHINE_CALQUES (25+ Xianxia/LitRPG Calques + Perevod_Ready AI_SLOP + Punctuation Stitch)
    if (activeRules.has('MACHINE_CALQUES')) {
      for (const entry of XIANXIA_ANTI_CALQUE_DICTIONARY) {
        entry.pattern.lastIndex = 0;
        if (entry.pattern.test(line)) {
          entry.pattern.lastIndex = 0;
          issues.push({
            id: `lint-${lineNum}-calque-${entry.id}`,
            ruleId: 'MACHINE_CALQUES',
            ruleTitle: `Машинная калька / штамп (${entry.label})`,
            severity: 'error',
            line: lineNum,
            snippet: line,
            suggestion: line.replace(entry.pattern, entry.replace),
            explanation: entry.explanation,
          });
          break;
        }
      }

      for (const slop of AI_SLOP_PHRASES) {
        if (line.toLowerCase().includes(slop.phrase)) {
          issues.push({
            id: `lint-${lineNum}-slop-${slop.phrase}`,
            ruleId: 'MACHINE_CALQUES',
            ruleTitle: `Канцелярит / ИИ-штамп («${slop.phrase}»)`,
            severity: 'warning',
            line: lineNum,
            snippet: line,
            suggestion: slop.replacement
              ? line.replace(new RegExp(slop.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), slop.replacement)
              : 'Удалите вводный канцелярит или замените живым действием.',
            explanation: 'Портировано из Perevod_Ready (AI_SLOP_PHRASES): эссеистические штампы разрушают художественную прозу.',
          });
          break;
        }
      }

      if (/(?:\.,|,\.|!\.|\?\.|,,|\.\.,|^\s*—,)/.test(line)) {
        issues.push({
          id: `lint-${lineNum}-punct-stitch`,
          ruleId: 'MACHINE_CALQUES',
          ruleTitle: 'Артефакт склейки пунктуации (., / ,. / !. / —,)',
          severity: 'error',
          line: lineNum,
          snippet: line,
          suggestion: repairPunctuationArtifacts(line),
          explanation: 'Портировано из Perevod_Ready (_PUNCT_ARTIFACT_PATTERNS): двойные знаки препинания при склейке предложений.',
        });
      }
    }

    // 13. CHARACTER_GENDER_MISMATCH
    if (activeRules.has('CHARACTER_GENDER_MISMATCH')) {
      for (const femName of femaleCharacters) {
        const escapedName = femName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const femPattern = new RegExp(
          `(${escapedName}\\s+(?:\\S+\\s+)?)(${COMMON_PAST_VERBS})(?![а-яё])`,
          'i'
        );
        const revFemPattern = new RegExp(
          `(?<![а-яё])(${COMMON_PAST_VERBS})(\\s+${escapedName})`,
          'i'
        );
        if (femPattern.test(line) || revFemPattern.test(line)) {
          const fixedLine = line
            .replace(femPattern, (_, prefix, verb: string) => {
              const femVerb = verb.endsWith('ся')
                ? `${verb.slice(0, -2)}ась`
                : `${verb}а`;
              return `${prefix}${femVerb}`;
            })
            .replace(revFemPattern, (_, verb: string, suffix) => {
              const femVerb = verb.endsWith('ся')
                ? `${verb.slice(0, -2)}ась`
                : `${verb}а`;
              return `${femVerb}${suffix}`;
            });
          issues.push({
            id: `lint-${lineNum}-gender-${femName}`,
            ruleId: 'CHARACTER_GENDER_MISMATCH',
            ruleTitle: `Нарушение женского рода персонажа («${femName}»)`,
            severity: 'error',
            line: lineNum,
            snippet: line,
            suggestion: fixedLine,
            explanation: `Персонаж «${femName}» имеет женский род (Ж) в глоссарии, но глагол стоит в мужском роде.`,
          });
        }
      }
    }
  });

  // 14. PARAGRAPH_DRIFT (1:1 Alignment & System Box Dividers)
  if (activeRules.has('PARAGRAPH_DRIFT') && rusText.trim()) {
    const alignment = alignChapterParagraphs(engText, rusText);
    if (Math.abs(alignment.engCount - alignment.rusCount) >= 2) {
      issues.push({
        id: 'lint-paragraph-drift',
        ruleId: 'PARAGRAPH_DRIFT',
        ruleTitle: `Рассинхрон абзацев (ENG: ${alignment.engCount}, RUS: ${alignment.rusCount})`,
        severity: 'warning',
        line: 1,
        snippet: `В оригинале ${alignment.engCount} абзацев, а в переводе ${alignment.rusCount}.`,
        suggestion:
          'Откройте режим «Сетка абзацев 1:1» в редакторе, чтобы проверить склеенные или пропущенные абзацы.',
        explanation:
          'Строгое соответствие структуры абзацев и системных разделителей [---] упрощает вычитку и исключает пропуски предложений.',
      });
    }
  }

  // 15. TAUTOLOGY_RADAR (Proximity Word Repetition)
  if (activeRules.has('TAUTOLOGY_RADAR') && rusText.trim()) {
    const tautologies = detectTautologies(rusText);
    for (const hit of tautologies) {
      issues.push({
        id: `lint-${hit.line}-tautology-${hit.stem}`,
        ruleId: 'TAUTOLOGY_RADAR',
        ruleTitle: `Лексический повтор («${hit.wordSample}» ×${hit.count} в абзаце)`,
        severity: 'warning',
        line: hit.line,
        snippet: hit.snippet,
        suggestion: hit.synonymHint,
        explanation:
          'Повторение однокоренных слов 3 и более раз внутри одного абзаца снижает художественное качество текста.',
      });
    }
  }

  // 16. LATIN_LEAKAGE_AND_BRACKETS (Zero-Leakage Gatekeeper)
  if (activeRules.has('LATIN_LEAKAGE_AND_BRACKETS') && rusText.trim()) {
    const allowedRpgTokens = new Set(['HP', 'MP', 'EXP', 'XP', 'VIP', 'NPC', 'DPS', 'PVP', 'PVE', 'SSS', 'SS']);
    const rusLines = rusText.split(/\r?\n/);
    rusLines.forEach((line, idx) => {
      const latinMatches = (line.match(/[a-zA-Z]{3,}/g) || []).filter(
        (w) => !allowedRpgTokens.has(w.toUpperCase())
      );
      if (latinMatches.length > 0) {
        issues.push({
          id: `lint-${idx + 1}-latin-leakage`,
          ruleId: 'LATIN_LEAKAGE_AND_BRACKETS',
          ruleTitle: `Утечка непереведённой латиницы (${latinMatches.slice(0, 3).join(', ')})`,
          severity: 'error',
          line: idx + 1,
          snippet: line,
          suggestion: 'Запустить Авто-ремонт QA для автоматического доперевода латинских фрагментов по канону.',
          explanation: 'В чистовом русском тексте не должно оставаться непереведённых английских слов или пиньиня.',
        });
      }

      const openSq = (line.match(/\[/g) || []).length;
      const closeSq = (line.match(/\]/g) || []).length;
      const openGui = (line.match(/«/g) || []).length;
      const closeGui = (line.match(/»/g) || []).length;
      if (openSq !== closeSq || openGui !== closeGui) {
        issues.push({
          id: `lint-${idx + 1}-unbalanced-brackets`,
          ruleId: 'LATIN_LEAKAGE_AND_BRACKETS',
          ruleTitle: 'Незакрытая системная скобка [ ] или кавычка « »',
          severity: 'error',
          line: idx + 1,
          snippet: line,
          suggestion: 'Сбалансируйте открывающие и закрывающие скобки/кавычки в строке.',
          explanation: 'Оборванные рамки системных уведомлений нарушают вёрстку при публикации.',
        });
      }
    });
  }

  // 11. NUMBER_MISMATCH
  const engNumbers = Array.from(new Set(engText.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []));
  const rusNumbers = new Set(rusText.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []);
  if (activeRules.has('NUMBER_MISMATCH')) {
    for (const num of engNumbers) {
      if (!rusNumbers.has(num)) {
        issues.push({
          id: `lint-num-missing-${num}`,
          ruleId: 'NUMBER_MISMATCH',
          ruleTitle: `Потеря числового значения (${num})`,
          severity: 'error',
          line: 1,
          snippet: `В оригинале присутствует число «${num}», отсутствующее в русском тексте.`,
          suggestion: `Проверьте и восстановите точное числовое значение ${num} (или переведите числительное из прописи в цифру).`,
          explanation:
            'Инвариант точности: все числовые характеристики, уровни, количества камней и проценты из ENG обязаны совпадать в RUS.',
        });
      }
    }
  }

  // 12. GLOSSARY_CANON_VIOLATION
  const allGlossaryEntries: Array<{ eng: string; rus: string; category: GlossaryCategory }> = [];
  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    const bucket = glossary[cat] || {};
    Object.entries(bucket).forEach(([eng, rus]) => {
      allGlossaryEntries.push({ eng, rus, category: cat });
    });
  });

  let glossaryMatchesCount = 0;
  const lowerRus = rusText.toLowerCase().replace(/ё/g, 'е');

  for (const entry of allGlossaryEntries) {
    if (entry.eng.length < 2) continue;
    const escapedEng = entry.eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const engWordRegex = new RegExp(`\\b${escapedEng}s?\\b`, 'i');
    if (engWordRegex.test(engText)) {
      const significantWords = entry.rus
        .toLowerCase()
        .replace(/ё/g, 'е')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .map((w) => {
          if (w.startsWith('камен')) return 'кам';
          if (w.startsWith('корен')) return 'кор';
          return w.slice(0, Math.min(4, Math.max(2, w.length - 2)));
        });

      const matched =
        significantWords.length === 0 ||
        significantWords.every((stem) => lowerRus.includes(stem));

      if (matched) {
        glossaryMatchesCount++;
      } else if (activeRules.has('GLOSSARY_CANON_VIOLATION')) {
        issues.push({
          id: `lint-glossary-${entry.eng}`,
          ruleId: 'GLOSSARY_CANON_VIOLATION',
          ruleTitle: `Отклонение от канона глоссария: ${entry.eng}`,
          severity: 'error',
          line: 1,
          snippet: `Термин «${entry.eng}» найден в ENG, но в RUS не обнаружен канон «${entry.rus}».`,
          suggestion: `Замените перевод термина «${entry.eng}» на утверждённый канон «${entry.rus}».`,
          explanation: `Уровень 2 (GLOSSARY.json): нарушение канонического термина в категории ${entry.category}.`,
        });
      }
    }
  }

  // 17. DASH_AND_COMMA_INFLATION
  if (activeRules.has('DASH_AND_COMMA_INFLATION') && rusText.trim()) {
    const alignment = alignChapterParagraphs(engText, rusText);
    alignment.pairs.forEach((pair) => {
      const pRus = pair.rusParagraph.trim();
      const pEng = pair.engParagraph.trim();
      if (!pRus) return;
      const isDialogue = pRus.startsWith('—') || pRus.startsWith('"') || pRus.startsWith('«');
      const copulaMatch = pRus.match(
        /\s+(?:—|–)\s+(?:это|был|была|было|были|являлся|являлась|являлись|представлял)\b/i
      );
      if (copulaMatch) {
        issues.push({
          id: `lint-${pair.index + 1}-copula-dash`,
          ruleId: 'DASH_AND_COMMA_INFLATION',
          ruleTitle: 'Искусственная тире-связка (« — это / был»)',
          severity: 'warning',
          line: pair.index + 1,
          snippet: pRus,
          suggestion: 'Замените искусственное тире перед глагольной связкой на естественную пунктуацию.',
          explanation:
            'В русском литературном языке тире перед связками «был», «являлся» обычно является калькой или слопом.',
        });
      }

      if (!isDialogue && pEng) {
        const rusDashes = (pRus.match(/—|–/g) || []).length;
        const engDashes = (pEng.match(/—|–|--/g) || []).length;
        if (rusDashes - engDashes >= 3) {
          issues.push({
            id: `lint-${pair.index + 1}-dash-inflation`,
            ruleId: 'DASH_AND_COMMA_INFLATION',
            ruleTitle: `Избыточная инфляция тире (ΔDash = +${rusDashes - engDashes})`,
            severity: 'warning',
            line: pair.index + 1,
            snippet: pRus,
            suggestion: 'Сократите избыточные вводные тире внутри повествовательных абзацев.',
            explanation:
              'Инфляция тире на 3 и более знака по сравнению с оригиналом указывает на механический слоп генератора.',
          });
        }
      }
    });
  }

  // 18. SYNTAX_MONOTONY_AND_BURSTINESS
  if (activeRules.has('SYNTAX_MONOTONY_AND_BURSTINESS') && rusText.trim()) {
    const rusParagraphs = rusText
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    rusParagraphs.forEach((p, pIdx) => {
      const sentences = p
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (sentences.length >= 3) {
        const openers = sentences.map((s) => {
          const firstWord = (s.match(/^[«"'\-—]?\s*([а-яёА-ЯЁa-zA-Z]+)/) || [])[1] || '';
          return firstWord.toLowerCase();
        });

        const isGerund = (w: string) =>
          /(?:вши|вшись|[а-яёА-ЯЁ](?:в|я))$/i.test(w) && w.length >= 4;
        for (let i = 0; i <= openers.length - 3; i++) {
          if (isGerund(openers[i]) && isGerund(openers[i + 1]) && isGerund(openers[i + 2])) {
            issues.push({
              id: `lint-p${pIdx + 1}-monotony-gerunds`,
              ruleId: 'SYNTAX_MONOTONY_AND_BURSTINESS',
              ruleTitle: 'Синтаксическая монотонность: подряд идущие деепричастия',
              severity: 'warning',
              line: pIdx + 1,
              snippet: sentences.slice(i, i + 3).join(' '),
              suggestion: 'Разбавьте деепричастные обороты простыми глагольными предложениями.',
              explanation:
                'Три предложения подряд, начинающиеся с деепричастий (-в/-вшись/-я), создают неестественный ритм.',
            });
            break;
          }
        }

        const pronouns = new Set(['он', 'она', 'оно', 'они', 'его', 'ее', 'её', 'это', 'тот']);
        for (let i = 0; i <= openers.length - 3; i++) {
          if (
            pronouns.has(openers[i]) &&
            openers[i] === openers[i + 1] &&
            openers[i] === openers[i + 2]
          ) {
            issues.push({
              id: `lint-p${pIdx + 1}-monotony-pronouns`,
              ruleId: 'SYNTAX_MONOTONY_AND_BURSTINESS',
              ruleTitle: `Синтаксическая монотонность: повтор «${openers[i]}» в начале предложений`,
              severity: 'warning',
              line: pIdx + 1,
              snippet: sentences.slice(i, i + 3).join(' '),
              suggestion:
                'Замените повторяющиеся местоимения в начале предложений на имя персонажа или перифраз.',
              explanation:
                'Повторение одного и того же местоимения в начале 3 и более предложений подряд обедняет синтаксис.',
            });
            break;
          }
        }
      }

      if (sentences.length >= 5) {
        const lengths = sentences.map((s) => s.length);
        const mean = lengths.reduce((acc, l) => acc + l, 0) / lengths.length;
        if (mean > 0) {
          const variance =
            lengths.reduce((acc, l) => acc + Math.pow(l - mean, 2), 0) / lengths.length;
          const stdDev = Math.sqrt(variance);
          const cv = stdDev / mean;
          if (cv < 0.35) {
            issues.push({
              id: `lint-p${pIdx + 1}-low-burstiness`,
              ruleId: 'SYNTAX_MONOTONY_AND_BURSTINESS',
              ruleTitle: `Низкая вариация длины предложений (CV = ${cv.toFixed(2)} < 0.35)`,
              severity: 'warning',
              line: pIdx + 1,
              snippet: p.slice(0, 100) + '...',
              suggestion:
                'Чередуйте короткие динамичные фразы и развёрнутые сложносочинённые конструкции.',
              explanation:
                'Аномально одинаковая длина предложений (коэффициент вариации < 0.35) характерна для монотонного машинного вывода.',
            });
          }
        }
      }
    });
  }

  // 19. REGISTER_PRONOUN_SHIFT
  if (activeRules.has('REGISTER_PRONOUN_SHIFT') && rusText.trim()) {
    const rusLines = rusText.split(/\r?\n/);
    rusLines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!line) return;
      const isDialogue = line.startsWith('—') || line.startsWith('"') || line.startsWith('«');
      if (!isDialogue) return;

      let expectedMode: 'ты' | 'Вы' | undefined;
      if (options?.dialogueRegisters) {
        const match = options.dialogueRegisters.find((dr) => dr.lineIndex === idx);
        if (match) expectedMode = match.pronounMode;
      }

      const hasHostileMarker = /выродок|собака|умри|щенок|ублюдок|тварь/i.test(line);
      if (hasHostileMarker) {
        expectedMode = 'ты';
      }

      if (expectedMode === 'ты') {
        const formalMatches = line.match(
          /(?<![а-яёА-ЯЁa-zA-Z0-9])(?:Вы|Вас|Вам|Вами|Ваш|Вашего|Вашему|Вашим|Вашем|(?:скажи|послушай|посмотри|уйди|возьми|прости|отдай|прекрати|погоди|стой)те)(?![а-яёА-ЯЁa-zA-Z0-9])/g
        );
        if (formalMatches && formalMatches.length > 0) {
          issues.push({
            id: `lint-${idx + 1}-register-shift-ty`,
            ruleId: 'REGISTER_PRONOUN_SHIFT',
            ruleTitle: `Сбой речевого регистра: «${formalMatches[0]}» в контексте обращения на «ты»`,
            severity: 'warning',
            line: idx + 1,
            snippet: line,
            suggestion: 'Замените форму «Вы»/-те на местоимение «ты» («тебя», «тебе», «твой») или форму на «ты».',
            explanation:
              'Враждебный или неформальный диалог требует единого регистра обращения на «ты».',
          });
        }
      } else if (expectedMode === 'Вы') {
        const informalMatches = line.match(
          /(?<![а-яёА-ЯЁa-zA-Z0-9])(?:ты|тебя|тебе|тобой|тобою|твой|твоего|твоему|твоим|твоем)(?![а-яёА-ЯЁa-zA-Z0-9])/gi
        );
        if (informalMatches && informalMatches.length > 0) {
          issues.push({
            id: `lint-${idx + 1}-register-shift-vy`,
            ruleId: 'REGISTER_PRONOUN_SHIFT',
            ruleTitle: `Сбой речевого регистра: «${informalMatches[0]}» в контексте вежливого обращения на «Вы»`,
            severity: 'warning',
            line: idx + 1,
            snippet: line,
            suggestion: 'Замените форму «ты» на вежливое обращение «Вы».',
            explanation:
              'Иерархический или официальный диалог требует выдержанного регистра обращения на «Вы».',
          });
        }
      }
    });

    // Check dialogue pronoun oscillation between adjacent dialogue lines and mixed registers
    const dialogueModes: Array<{ lineIndex: number; mode: 'ты' | 'Вы' }> = [];
    rusLines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!line) return;
      const isDialogue = line.startsWith('—') || line.startsWith('"') || line.startsWith('«');
      if (!isDialogue) return;
      const hasTy = /(?<![а-яёА-ЯЁa-zA-Z0-9])(?:ты|тебя|тебе|тобой|тобою|твой|твоего|твоему|твоим|твоем)(?![а-яёА-ЯЁa-zA-Z0-9])/i.test(line);
      const hasVy = /(?<![а-яёА-ЯЁa-zA-Z0-9])(?:Вы|Вас|Вам|Вами|Ваш|Вашего|Вашему|Вашим|Вашем)(?![а-яёА-ЯЁa-zA-Z0-9])/.test(line);
      if (hasTy && hasVy) {
        issues.push({
          id: `lint-${idx + 1}-register-shift-mixed`,
          ruleId: 'REGISTER_PRONOUN_SHIFT',
          ruleTitle: 'Сбой речевого регистра: смешение «ты» и «Вы» в одной реплике',
          severity: 'warning',
          line: idx + 1,
          snippet: line,
          suggestion: 'Приведите реплику к единому регистру обращения (либо только «ты», либо только «Вы»).',
          explanation:
            'Одновременное использование форм «ты» и «Вы» в одной реплике является грубым стилистическим сбоем.',
        });
      } else if (hasTy) {
        dialogueModes.push({ lineIndex: idx, mode: 'ты' });
      } else if (hasVy) {
        dialogueModes.push({ lineIndex: idx, mode: 'Вы' });
      }
    });

    if (dialogueModes.length >= 2) {
      for (let m = 1; m < dialogueModes.length; m++) {
        const prev = dialogueModes[m - 1];
        const curr = dialogueModes[m];
        if (prev.mode !== curr.mode && Math.abs(curr.lineIndex - prev.lineIndex) <= 2) {
          const prevReg = options?.dialogueRegisters?.find((dr) => dr.lineIndex === prev.lineIndex);
          const currReg = options?.dialogueRegisters?.find((dr) => dr.lineIndex === curr.lineIndex);
          if (prevReg?.pronounMode === prev.mode && currReg?.pronounMode === curr.mode) {
            continue;
          }
          issues.push({
            id: `lint-${curr.lineIndex + 1}-register-shift-oscillation`,
            ruleId: 'REGISTER_PRONOUN_SHIFT',
            ruleTitle: `Сбой речевого регистра: внезапный переход с «${prev.mode}» на «${curr.mode}» в диалоге`,
            severity: 'warning',
            line: curr.lineIndex + 1,
            snippet: rusLines[curr.lineIndex].trim(),
            suggestion: `Согласуйте речевой регистр: если начато обращение на «${prev.mode}», сохраняйте его в пределах сцены.`,
            explanation:
              'Необоснованное переключение регистра (ты ↔ Вы) между репликами в одном непрерывном диалоге нарушает стилистическую целостность.',
          });
        }
      }
    }
  }

  // 20. NOMINALIZATION_AND_INANIMATE_SUBJECT (Nora Gal verbalization & animate subjects)
  if (activeRules.has('NOMINALIZATION_AND_INANIMATE_SUBJECT') && rusText.trim()) {
    const rusLines = rusText.split(/\r?\n/);
    rusLines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!line) return;

      const nominalMatch = line.match(
        /(?<![а-яёА-ЯЁa-zA-Z0-9])(?:после завершения (?:поглощения|культивации|прорыва)|осуществил (?:прорыв|атаку|уклонение)|предпринял попытку|принял решение)(?![а-яёА-ЯЁa-zA-Z0-9])/i
      );
      if (nominalMatch) {
        issues.push({
          id: `lint-${idx + 1}-nominalization`,
          ruleId: 'NOMINALIZATION_AND_INANIMATE_SUBJECT',
          ruleTitle: `Канцелярская номинализация («${nominalMatch[0]}»)`,
          severity: 'warning',
          line: idx + 1,
          snippet: line,
          suggestion: 'Замените отглагольное существительное на глагол или деепричастие (закон Норы Галь).',
          explanation:
            'Канцелярские связки вроде «осуществил прорыв» или «после завершения» высушивают литературную прозу.',
        });
      }

      const inanimateMatch = line.match(
        /(?<![а-яёА-ЯЁa-zA-Z0-9])вид\s+([^.\n]+?)\s+заставил\s+холод\s+пробежать\s+по\s+(?:его\s+)?позвоночнику(?![а-яёА-ЯЁa-zA-Z0-9])/i
      );
      if (inanimateMatch) {
        issues.push({
          id: `lint-${idx + 1}-inanimate-subject`,
          ruleId: 'NOMINALIZATION_AND_INANIMATE_SUBJECT',
          ruleTitle: 'Неодушевлённое подлежащее-актант («вид заставил...»)',
          severity: 'warning',
          line: idx + 1,
          snippet: line,
          suggestion: 'Перестройте фразу на одушевлённую конструкцию: «при виде ... по спине пробежал холодок».',
          explanation:
            'Английская конструкция "the sight of X made a chill run down his spine" в русском языке требует живого подлежащего.',
        });
      }
    });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const penalty = errorCount * 15 + warningCount * 5;
  const score = Math.max(0, 100 - penalty);

  return {
    passed: errorCount === 0 && warningCount === 0,
    errorCount,
    warningCount,
    score,
    issues,
    checkedNumbersCount: engNumbers.length,
    glossaryMatchesCount,
  };
}

/**
 * Deterministic Auto-Repair Engine (Phase 4 Self-Repair Loop).
 */
export function autoRepairRussianText(
  rusText: string,
  options?: {
    glossary?: CanonicalGlossary;
    glossaryMeta?: Record<string, GlossaryTermMeta>;
    enabledRuleIds?: LintRuleId[];
    customCalqueBlacklist?: Record<string, string>;
  }
): {
  repairedText: string;
  appliedFixes: string[];
} {
  const activeRules = new Set<LintRuleId>(
    options?.enabledRuleIds || ALL_LINT_RULES.map((r) => r.id)
  );
  const appliedFixes: string[] = [];
  let text = rusText.replace(/\r\n/g, '\n');

  const rules: Array<{ ruleId: LintRuleId; pattern: RegExp; replace: string; desc: string }> = [
    {
      ruleId: 'TIER_VS_GRADE',
      pattern: /(\d+-го)\s+ранга\s+(низшего|среднего|высшего)\s+ранга/gi,
      replace: '$1 яруса $2 ранга',
      desc: 'Исправлена иерархия: ранга → яруса ... ранга',
    },
    {
      ruleId: 'TIER_VS_GRADE',
      pattern: /ранг([ауеом]?)\s+(низшего|среднего|высшего)\s+сорта/gi,
      replace: 'ярус$1 $2 ранга',
      desc: 'Устранён штамп «ранг ... сорта» → «ярус ... ранга»',
    },
    {
      ruleId: 'ARTIFACT_RANKING',
      pattern: /духовн(ый|ого|ому|ым|ом|ые|ых)(\s+артефакт[а-яё]*\s+1-го\s+яруса)/gi,
      replace: 'магическ$1$2',
      desc: 'Артефакт 1-го яруса приведён к канону «Магический артефакт»',
    },
    {
      ruleId: 'WRITTEN_NUMERALS',
      pattern: /(?<![а-яёa-z0-9])двадцать\s+один(?![а-яёa-z0-9])/gi,
      replace: '21',
      desc: 'Числительное «двадцать один» переведено в цифру «21»',
    },
    {
      ruleId: 'WRITTEN_NUMERALS',
      pattern: /(?<![а-яёa-z0-9])двадцати\s+одного(?![а-яёa-z0-9])/gi,
      replace: '21',
      desc: 'Числительное «двадцати одного» переведено в цифру «21»',
    },
    {
      ruleId: 'WRITTEN_PERCENTS',
      pattern: /(?<![а-яёa-z0-9])восемьдесят\s+процентов(?![а-яёa-z0-9])/gi,
      replace: '80%',
      desc: 'Заменено «восемьдесят процентов» → «80%»',
    },
    {
      ruleId: 'WRITTEN_PERCENTS',
      pattern: /(?<![а-яёa-z0-9])пятьдесят\s+процентов(?![а-яёa-z0-9])/gi,
      replace: '50%',
      desc: 'Заменено «пятьдесят процентов» → «50%»',
    },
    {
      ruleId: 'WRITTEN_PERCENTS',
      pattern: /(?<![а-яёa-z0-9])тридцать\s+процентов(?![а-яёa-z0-9])/gi,
      replace: '30%',
      desc: 'Заменено «тридцать процентов» → «30%»',
    },
    {
      ruleId: 'WRITTEN_PERCENTS',
      pattern: /(\d+)\s+процент(?:ов|а|)(?![а-яё])/gi,
      replace: '$1%',
      desc: 'Слово «процентов» заменено на знак «%»',
    },
    {
      ruleId: 'WRITTEN_NUMERALS',
      pattern: /(?<![а-яёa-z0-9])шестом\s+слое(?![а-яёa-z0-9])/gi,
      replace: '6-м слое',
      desc: '«шестом слое» → «6-м слое»',
    },
    {
      ruleId: 'WRITTEN_NUMERALS',
      pattern: /(?<![а-яёa-z0-9])седьмом\s+слое(?![а-яёa-z0-9])/gi,
      replace: '7-м слое',
      desc: '«седьмом слое» → «7-м слое»',
    },
    {
      ruleId: 'WRITTEN_NUMERALS',
      pattern: /(?<![а-яёa-z0-9])девятом\s+слое(?![а-яёa-z0-9])/gi,
      replace: '9-м слое',
      desc: '«девятом слое» → «9-м слое»',
    },
    {
      ruleId: 'WRITTEN_NUMERALS',
      pattern: /(?<![а-яёa-z0-9])первого\s+яруса(?![а-яёa-z0-9])/gi,
      replace: '1-го яруса',
      desc: '«первого яруса» → «1-го яруса»',
    },
    {
      ruleId: 'WRITTEN_NUMERALS',
      pattern: /(?<![а-яёa-z0-9])второго\s+яруса(?![а-яёa-z0-9])/gi,
      replace: '2-го яруса',
      desc: '«второго яруса» → «2-го яруса»',
    },
    {
      ruleId: 'DIALOGUE_DASH',
      pattern: /^(\s*)(?:-\s+|\u2013\s+)/gm,
      replace: '$1— ',
      desc: 'Короткий дефис в начале реплики заменён на длинное тире «— »',
    },
    {
      ruleId: 'DIALOGUE_DASH',
      pattern: /:\s*—/g,
      replace: ', —',
      desc: 'Убрано двоеточие перед тире внутри реплики',
    },
    {
      ruleId: 'THOUGHT_QUOTES',
      pattern: /"([^"\n]+)"/g,
      replace: '«$1»',
      desc: 'Прямые кавычки заменены на кавычки-ёлочки «...»',
    },
    {
      ruleId: 'THOUGHT_QUOTES',
      pattern: /\*([а-яёА-ЯЁ\s,!?.]{4,})\*/g,
      replace: '«$1»',
      desc: 'Звёздочки мыслей заменены на кавычки-ёлочки «...»',
    },
    {
      ruleId: 'WEIGHT_UNITS',
      pattern: /(?<![а-яёa-z])фунт(?:ов|а|ы|е|ам)?(?![а-яёa-z])/gi,
      replace: 'цзинь',
      desc: 'Мера веса «фунт» заменена на канонический «цзинь»',
    },
    {
      ruleId: 'WEIGHT_UNITS',
      pattern: /(?<![а-яёa-z])килограмм(?:ов|а|ы|е)?(?![а-яёa-z])/gi,
      replace: 'цзинь',
      desc: 'Мера веса «килограмм» заменена на канонический «цзинь»',
    },
    {
      ruleId: 'ALCHEMY_CALQUES',
      pattern: /варить\s+пилюл([ию])/gi,
      replace: 'создавать пилюл$1',
      desc: 'Исправлено «варить пилюли» → «создавать пилюли»',
    },
    {
      ruleId: 'ALCHEMY_CALQUES',
      pattern: /варк([аи])\s+пилюль/gi,
      replace: 'изготовлени$1 пилюль',
      desc: 'Исправлено «варка пилюль» → «изготовление пилюль»',
    },
    {
      ruleId: 'ALCHEMY_CALQUES',
      pattern: /выплавк([аи])\s+пилюль/gi,
      replace: 'создани$1 пилюль',
      desc: 'Исправлено «выплавка пилюль» → «создание пилюль»',
    },
    {
      ruleId: 'SECT_SINGULAR',
      pattern: /Сект([аыеуой])\s+Каменного\s+Демона/gi,
      replace: 'Сект$1 Каменных Демонов',
      desc: 'Название секты переведено во множественное число («Секта Каменных Демонов»)',
    },
    {
      ruleId: 'MACHINE_CALQUES',
      pattern: /не\s+удержался\s+от\s+вопроса/gi,
      replace: 'невольно поинтересовался',
      desc: 'Калька «не удержался от вопроса» заменена на «невольно поинтересовался»',
    },
    {
      ruleId: 'MACHINE_CALQUES',
      pattern: /не\s+удержался\s+от\s+того,\s+чтобы\s+не\s+/gi,
      replace: 'не сдержался и ',
      desc: 'Калька «не удержался от того, чтобы не» заменена на «не сдержался и»',
    },
    {
      ruleId: 'MACHINE_CALQUES',
      pattern: /не\s+удержался\s+от\s+того,\s+чтобы\s+/gi,
      replace: 'не сдержался и ',
      desc: 'Калька «не удержался от того, чтобы» заменена на «не сдержался и»',
    },
    {
      ruleId: 'MACHINE_CALQUES',
      pattern: /втянул\s+глоток\s+холодного\s+воздуха/gi,
      replace: 'судорожно перевёл дыхание',
      desc: 'Штамп «втянул глоток холодного воздуха» заменён на «судорожно перевёл дыхание»',
    },
    {
      ruleId: 'DASH_AND_COMMA_INFLATION',
      pattern: /\s+(?:—|–)\s+(это|был|была|было|были|являлся|являлась|являлись|представлял)\b/gi,
      replace: ' $1',
      desc: 'Устранена искусственная тире-связка перед глаголом',
    },
  ];

  for (const rule of rules) {
    if (!activeRules.has(rule.ruleId)) continue;
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      rule.pattern.lastIndex = 0;
      text = text.replace(rule.pattern, rule.replace);
      appliedFixes.push(rule.desc);
    }
  }

  if (activeRules.has('REGISTER_PRONOUN_SHIFT')) {
    const lines = text.split('\n');
    let fixedShift = false;
    const hostileRe = /выродок|собака|умри|щенок|ублюдок|тварь/i;
    const shiftLines = lines.map((line) => {
      const isDialogue = /^\s*—\s+/.test(line) || /^\s*["«]/.test(line);
      if (isDialogue && hostileRe.test(line)) {
        let l = line;
        const orig = l;
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])Вы(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'ты');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])вы(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'ты');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])Вас(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тебя');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])вас(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тебя');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])Вам(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тебе');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])вам(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тебе');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])Вами(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тобой');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])вами(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тобой');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])Ваш(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твой');
        l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])ваш(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твой');
        if (l !== orig) {
          fixedShift = true;
          return l;
        }
      }
      return line;
    });
    if (fixedShift) {
      text = shiftLines.join('\n');
      appliedFixes.push('Скорректирован речевой регистр: формы «Вы» заменены на «ты» во враждебной реплике');
    }
  }

  if (activeRules.has('DASH_AND_COMMA_INFLATION')) {
    const lines = text.split('\n');
    let relaxedDashes = false;
    const fixedLines = lines.map((line) => {
      const isDialogue = /^\s*—\s+/.test(line);
      const medialDashes = (isDialogue ? line.slice(2) : line).match(/\s+—\s+/g) || [];
      if (medialDashes.length >= 3) {
        relaxedDashes = true;
        let count = 0;
        return line.replace(/(\s+)—(\s+)/g, (m, b, a) => {
          count++;
          return count > 2 ? `,${a}` : m;
        });
      }
      return line;
    });
    if (relaxedDashes) {
      text = fixedLines.join('\n');
      appliedFixes.push('Устранена инфляция тире: избыточные тире в предложении заменены на запятые');
    }
  }

  // Extended Anti-Calque Dictionary + Perevod_Ready AI_SLOP + Punctuation Stitch Repair
  if (activeRules.has('MACHINE_CALQUES')) {
    for (const entry of XIANXIA_ANTI_CALQUE_DICTIONARY) {
      entry.pattern.lastIndex = 0;
      if (entry.pattern.test(text)) {
        entry.pattern.lastIndex = 0;
        text = text.replace(entry.pattern, (match, ...args) => {
          // Use standard string replace on the single match so $1 capture groups resolve properly
          const singleRe = new RegExp(entry.pattern.source, entry.pattern.flags.replace('g', ''));
          const replaced = match.replace(singleRe, entry.replace);
          const isUpperFirst =
            match.length > 0 &&
            match[0] === match[0].toUpperCase() &&
            match[0] !== match[0].toLowerCase();
          if (isUpperFirst && replaced.length > 0) {
            return replaced.charAt(0).toUpperCase() + replaced.slice(1);
          }
          return replaced;
        });
        if (!appliedFixes.includes(entry.desc)) {
          appliedFixes.push(entry.desc);
        }
      }
    }

    for (const slop of AI_SLOP_PHRASES) {
      if (slop.replacement !== undefined && text.toLowerCase().includes(slop.phrase)) {
        const escaped = slop.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`${escaped},?\\s*`, 'gi');
        if (re.test(text)) {
          text = text.replace(re, slop.replacement);
          appliedFixes.push(`Удалён ИИ-штамп «${slop.phrase}» (Perevod_Ready AI_SLOP)`);
        }
      }
    }

    const stitchedBefore = text;
    text = repairPunctuationArtifacts(text);
    if (text !== stitchedBefore) {
      appliedFixes.push('Исправлены артефакты склейки пунктуации (., / ,. / !. / —,)');
    }

    if (options?.customCalqueBlacklist) {
      for (const [badPhrase, goodPhrase] of Object.entries(options.customCalqueBlacklist)) {
        const cleanBad = badPhrase.trim();
        if (!cleanBad) continue;
        const escaped = cleanBad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'gi');
        if (re.test(text)) {
          text = text.replace(re, goodPhrase);
          appliedFixes.push(`Чёрный список проекта: «${cleanBad}» → «${goodPhrase}»`);
        }
      }
    }
  }

  // Character gender auto-repair
  if (
    activeRules.has('CHARACTER_GENDER_MISMATCH') &&
    options?.glossary?.characters &&
    options?.glossaryMeta
  ) {
    Object.entries(options.glossary.characters).forEach(([eng, rus]) => {
      if (options.glossaryMeta?.[eng]?.gender === 'F') {
        const escapedName = rus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const femPattern = new RegExp(
          `(${escapedName}\\s+(?:\\S+\\s+)?)(${COMMON_PAST_VERBS})(?![а-яё])`,
          'gi'
        );
        const revFemPattern = new RegExp(
          `(?<![а-яё])(${COMMON_PAST_VERBS})(\\s+${escapedName})`,
          'gi'
        );
        if (femPattern.test(text) || revFemPattern.test(text)) {
          text = text
            .replace(femPattern, (_, prefix, verb: string) => {
              const femVerb = verb.endsWith('ся')
                ? `${verb.slice(0, -2)}ась`
                : `${verb}а`;
              return `${prefix}${femVerb}`;
            })
            .replace(revFemPattern, (_, verb: string, suffix) => {
              const femVerb = verb.endsWith('ся')
                ? `${verb.slice(0, -2)}ась`
                : `${verb}а`;
              return `${femVerb}${suffix}`;
            })
            .replace(
              new RegExp(
                `(${escapedName}[^.\\n]*?\\s+и\\s+)(${COMMON_PAST_VERBS})(?![а-яё])`,
                'gi'
              ),
              (_, prefix, verb2: string) => {
                const femVerb2 = verb2.endsWith('ся')
                  ? `${verb2.slice(0, -2)}ась`
                  : `${verb2}а`;
                return `${prefix}${femVerb2}`;
              }
            );
          appliedFixes.push(`Согласован женский род глаголов для персонажа «${rus}»`);
        }
      }
    });
  }

  // Zero-Leakage Latin & Unclosed Bracket Auto-Repair
  if (activeRules.has('LATIN_LEAKAGE_AND_BRACKETS')) {
    let latinFixed = false;
    if (options?.glossary) {
      const pairs: Array<[string, string]> = [];
      (Object.keys(options.glossary) as GlossaryCategory[]).forEach((cat) => {
        Object.entries(options.glossary?.[cat] || {}).forEach(([eng, rus]) => {
          pairs.push([eng, rus]);
        });
      });
      pairs.sort((a, b) => b[0].length - a[0].length);
      for (const [eng, rus] of pairs) {
        if (eng.length < 2) continue;
        const escaped = eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${escaped}s?\\b`, 'gi');
        if (re.test(text)) {
          text = text.replace(re, rus);
          latinFixed = true;
        }
      }
    }

    const commonLeakageMap: Array<[RegExp, string]> = [
      [/\bTier\s+(\d+)\b/gi, '$1-го яруса'],
      [/\bLow\s+Grade\b/gi, 'низшего ранга'],
      [/\bMid(?:dle)?\s+Grade\b/gi, 'среднего ранга'],
      [/\bHigh\s+Grade\b/gi, 'высшего ранга'],
      [/\bPeak\s+Grade\b/gi, 'пикового ранга'],
    ];
    for (const [re, rep] of commonLeakageMap) {
      if (re.test(text)) {
        text = text.replace(re, rep);
        latinFixed = true;
      }
    }
    if (latinFixed) {
      appliedFixes.push('Допереведены оставшиеся англоязычные термины (Zero-Leakage Guard)');
    }

    // Balance unclosed [ ] or « » per line
    let bracketFixed = false;
    text = text
      .split('\n')
      .map((line) => {
        let updated = line;
        const openSq = (updated.match(/\[/g) || []).length;
        const closeSq = (updated.match(/\]/g) || []).length;
        if (openSq > closeSq) {
          updated = `${updated}${']'.repeat(openSq - closeSq)}`;
          bracketFixed = true;
        }
        const openGui = (updated.match(/«/g) || []).length;
        const closeGui = (updated.match(/»/g) || []).length;
        if (openGui > closeGui) {
          updated = `${updated}${'»'.repeat(openGui - closeGui)}`;
          bracketFixed = true;
        }
        return updated;
      })
      .join('\n');
    if (bracketFixed) {
      appliedFixes.push('Автоматически закрыты оборванные скобки [ ] / кавычки « »');
    }
  }

  // Auto-Synonym De-Tautologizer (replaces 2nd and 3rd+ repetitions within the same paragraph)
  if (activeRules.has('TAUTOLOGY_RADAR')) {
    const synonymPool: Array<{ regex: RegExp; replacements: string[] }> = [
      {
        regex: /(?<![а-яё])мгновенно(?![а-яё])/gi,
        replacements: ['в тот же миг', 'молниеносно', 'в одночасье'],
      },
      {
        regex: /(?<![а-яё])быстро(?![а-яё])/gi,
        replacements: ['стремительно', 'проворно', 'мигом'],
      },
      {
        regex: /(?<![а-яё])сказал(?![а-яё])/gi,
        replacements: ['произнёс', 'промолвил', 'заметил'],
      },
      {
        regex: /(?<![а-яё])посмотрел(?![а-яё])/gi,
        replacements: ['окинул взглядом', 'воззрился', 'перевёл взор'],
      },
      {
        regex: /(?<![а-яё])огромный(?![а-яё])/gi,
        replacements: ['исполинский', 'колоссальный', 'массивный'],
      },
    ];

    let tautologyRepairedCount = 0;
    const paragraphs = text.split('\n');
    const deTautologized = paragraphs.map((p) => {
      let updatedP = p;
      for (const rule of synonymPool) {
        const matches = updatedP.match(rule.regex);
        if (matches && matches.length >= 3) {
          let occ = 0;
          updatedP = updatedP.replace(rule.regex, (m) => {
            occ++;
            if (occ === 1) return m;
            tautologyRepairedCount++;
            const syn = rule.replacements[(occ - 2) % rule.replacements.length];
            const isUpper = m[0] === m[0].toUpperCase();
            return isUpper ? syn.charAt(0).toUpperCase() + syn.slice(1) : syn;
          });
        }
      }
      return updatedP;
    });

    if (tautologyRepairedCount > 0) {
      text = deTautologized.join('\n');
      appliedFixes.push(
        `Авто-синонимайзер устранил лексические повторы (${tautologyRepairedCount} замен)`
      );
    }
  }

  return { repairedText: text, appliedFixes };
}

/**
 * Surgical Paragraph Auto-Repair:
 * Pinpoints ONLY paragraphs with missing numbers, drift, or local QA violations,
 * and repairs them without touching already-verified paragraphs.
 */
export function surgicalRepairDriftedParagraphs(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  glossaryMeta?: Record<string, GlossaryTermMeta>,
  enabledRuleIds?: LintRuleId[]
): {
  repairedRusText: string;
  surgicallyFixedIndices: number[];
  details: string[];
} {
  const alignment = alignChapterParagraphs(engText, rusText);
  const surgicallyFixedIndices: number[] = [];
  const details: string[] = [];

  const repairedParagraphs: string[] = [];

  for (const pair of alignment.pairs) {
    let workingRusP = pair.rusParagraph;

    // If ENG is a system divider '---' and RUS lost it, restore '---' and repair the shifted paragraph
    if (pair.engParagraph === '---' && workingRusP !== '---') {
      repairedParagraphs.push('---');
      if (workingRusP.trim()) {
        const { repairedText } = autoRepairRussianText(workingRusP, {
          glossary,
          glossaryMeta,
          enabledRuleIds,
        });
        repairedParagraphs.push(repairedText);
      }
      surgicallyFixedIndices.push(pair.index + 1);
      details.push(`Абзац #${pair.index + 1}: восстановлен системный разделитель ---`);
      continue;
    }

    if (!workingRusP.trim() && pair.engParagraph.trim()) {
      // Untranslated paragraph fallback: apply glossary + rank conversion
      let fallbackP = pair.engParagraph;
      const { repairedText } = autoRepairRussianText(fallbackP, {
        glossary,
        glossaryMeta,
        enabledRuleIds,
      });
      fallbackP = repairedText;
      repairedParagraphs.push(fallbackP);
      surgicallyFixedIndices.push(pair.index + 1);
      details.push(`Абзац #${pair.index + 1}: восстановлен пропущенный абзац`);
      continue;
    }

    // Run targeted auto-repair on this paragraph if it has issues or missing numbers
    const paraLint = runQaLinter(pair.engParagraph, workingRusP, glossary, {
      enabledRuleIds,
      glossaryMeta,
    });
    if (!paraLint.passed || pair.missingNumbers.length > 0) {
      const { repairedText, appliedFixes } = autoRepairRussianText(workingRusP, {
        glossary,
        glossaryMeta,
        enabledRuleIds,
      });
      if (repairedText !== workingRusP) {
        workingRusP = repairedText;
        surgicallyFixedIndices.push(pair.index + 1);
        details.push(
          `Абзац #${pair.index + 1}: ${appliedFixes.slice(0, 2).join('; ') || 'исправлен точечно'}`
        );
      }
    }

    if (workingRusP.trim()) {
      repairedParagraphs.push(workingRusP);
    }
  }

  return {
    repairedRusText: repairedParagraphs.join('\n\n'),
    surgicallyFixedIndices,
    details,
  };
}

export interface DegenerationIssue {
  type:
    | 'character_or_word_loop'
    | 'adjacent_tfidf_duplicate'
    | 'truncated_punctuation'
    | 'length_ratio_anomaly'
    | 'cyclical_loop'
    | 'adjacent_duplicate';
  paragraphIndex: number;
  details: string;
  snippet: string;
  severity: 'error' | 'warning';
  suggestedFix?: string;
}

/**
 * AI Hunter: Detects cyclical token degeneration (>15 repeats),
 * adjacent paragraph TF-IDF duplicates (cosine similarity >= 0.82),
 * ensures strict immunity for LitRPG bracketed lines [...] and --- dividers (LinguaGacha #641),
 * and catches truncated punctuation and length ratio anomalies.
 */
export function detectTranslationDegenerationAndDuplicates(
  engText: string,
  rusText: string
): {
  issues: DegenerationIssue[];
  hasFatalDegeneration: boolean;
  repairedText: string;
} {
  const issues: DegenerationIssue[] = [];
  const rusParagraphs = (rusText || '').replace(/\r\n/g, '\n').split('\n');
  const engParagraphs = (engText || '').replace(/\r\n/g, '\n').split('\n');

  let hasFatal = false;
  const repaired: string[] = [];

  const isLitRpgOrDivider = (p: string) => {
    const trimmed = p.trim();
    return (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      trimmed === '---' ||
      /^[-—_*=]{3,}$/.test(trimmed)
    );
  };

  const tokenizeForTfidf = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^\w\sа-яёА-ЯЁ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
  };

  const computeCosine = (tokensA: string[], tokensB: string[]): number => {
    if (tokensA.length === 0 || tokensB.length === 0) return 0;
    const freqA = new Map<string, number>();
    const freqB = new Map<string, number>();
    tokensA.forEach((t) => freqA.set(t, (freqA.get(t) || 0) + 1));
    tokensB.forEach((t) => freqB.set(t, (freqB.get(t) || 0) + 1));

    let dot = 0;
    let normA = 0;
    let normB = 0;
    freqA.forEach((v) => {
      normA += v * v;
    });
    freqB.forEach((v) => {
      normB += v * v;
    });
    freqA.forEach((countA, token) => {
      const countB = freqB.get(token) || 0;
      dot += countA * countB;
    });
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  for (let i = 0; i < rusParagraphs.length; i++) {
    let p = rusParagraphs[i];
    const trimmed = p.trim();
    if (!trimmed) {
      repaired.push(p);
      continue;
    }

    // A. Cyclical token loops: > 15 repeats of any character (excluding normal dividers like '---')
    const charLoopMatch = trimmed.match(/(.)\1{15,}/);
    const isDividerLine = /^[-—_*=]{3,10}$/.test(trimmed);
    if (charLoopMatch && !isDividerLine) {
      hasFatal = true;
      issues.push({
        type: 'cyclical_loop',
        paragraphIndex: i,
        severity: 'error',
        details: `Залипание сэмплера: более 15 повторов подряд символа «${charLoopMatch[1]}»`,
        snippet: trimmed.slice(0, 80),
        suggestedFix: 'Удалить зацикленные символы и перезапустить генерацию абзаца.',
      });
      p = p.replace(/(.)\1{15,}/g, '$1$1$1');
    }

    // Word/phrase loop: repeated phrase >= 4 times (e.g. "Он взмахнул мечом. ")
    const phraseLoopMatch = trimmed.match(/(.{3,50}?)\1{3,}/);
    if (phraseLoopMatch) {
      hasFatal = true;
      issues.push({
        type: 'cyclical_loop',
        paragraphIndex: i,
        severity: 'error',
        details: `Циклическая дегенерация: многократный повтор фразы «${phraseLoopMatch[1].trim()}»`,
        snippet: trimmed.slice(0, 100),
        suggestedFix: 'Схлопнуть циклический повтор.',
      });
      p = p.replace(/(.{3,50}?)\1{3,}/g, '$1');
    }

    // B. Adjacent paragraph TF-IDF duplicate check with LitRPG immunity
    if (i > 0 && repaired.length > 0) {
      let prev = '';
      for (let r = repaired.length - 1; r >= 0; r--) {
        if (repaired[r].trim()) {
          prev = repaired[r].trim();
          break;
        }
      }
      if (prev && !isLitRpgOrDivider(trimmed) && !isLitRpgOrDivider(prev)) {
        const tokensPrev = tokenizeForTfidf(prev);
        const tokensCurr = tokenizeForTfidf(trimmed);
        if (tokensPrev.length >= 6 && tokensCurr.length >= 6) {
          const sim = computeCosine(tokensPrev, tokensCurr);
          if (sim >= 0.82) {
            hasFatal = true;
            issues.push({
              type: 'adjacent_duplicate',
              paragraphIndex: i,
              severity: 'error',
              details: `Склеенный дубликат соседнего абзаца (TF-IDF сходство = ${(sim * 100).toFixed(1)}% >= 82%)`,
              snippet: trimmed.slice(0, 100),
              suggestedFix: 'Удалить дублирующий абзац.',
            });
            // Omit duplicate in repaired text
            continue;
          }
        }
      }
    }

    // C. Truncated punctuation check vs aligned ENG paragraph
    if (i < engParagraphs.length) {
      const engP = engParagraphs[i].trim();
      if (
        /[.!?]["'»]?$/.test(engP) &&
        !/[.!?…»"—]$/.test(trimmed) &&
        /[,;:—\-a-zA-Zа-яёА-ЯЁ0-9]$/.test(trimmed)
      ) {
        issues.push({
          type: 'truncated_punctuation',
          paragraphIndex: i,
          severity: 'warning',
          details:
            'Оборванная пунктуация: абзац оригинала завершён точкой/знаком, а перевод обрывается без финала.',
          snippet: trimmed.slice(-60),
          suggestedFix: 'Добавить финальную точку.',
        });
        p = `${p}.`;
      }

      // D. Length ratio anomaly
      if (engP.length >= 50) {
        const ratio = trimmed.length / engP.length;
        if (ratio < 0.2 || ratio > 4.0) {
          issues.push({
            type: 'length_ratio_anomaly',
            paragraphIndex: i,
            severity: 'warning',
            details: `Аномальный коэффициент длины абзаца (${(ratio * 100).toFixed(0)}% от оригинала): возможен пропуск или галлюцинация.`,
            snippet: trimmed.slice(0, 80),
          });
        }
      }
    }

    repaired.push(p);
  }

  return {
    issues,
    hasFatalDegeneration: hasFatal,
    repairedText: repaired.join('\n'),
  };
}

export interface ForwardFallingQuestion {
  id: string;
  questionRus: string;
  relatedEntities: string[];
  createdAtChapter: number;
  resolvedAtChapter?: number;
  status: 'open' | 'resolved' | 'abandoned';
  resolutionNote?: string;
}

/**
 * Live Hero & World State Ledger (Auto-State Tracker across 50-500 chapters)
 * with Forward-Falling Questions Index (Q_n Chekhov's guns).
 */
export interface HeroStateLedger {
  protagonistName: string;
  cultivationRealm: string;
  resources: string[];
  artifactsAndFlames: string[];
  activeLocation: string;
  lastUpdatedChapter: number;
  forwardQuestions?: ForwardFallingQuestion[];
}

export function updateHeroStateLedgerFromChapter(
  currentLedger: HeroStateLedger | undefined,
  chapterNumber: number,
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary
): HeroStateLedger {
  const base: HeroStateLedger = currentLedger
    ? {
        ...currentLedger,
        resources: Array.isArray(currentLedger.resources) ? [...currentLedger.resources] : [],
        artifactsAndFlames: Array.isArray(currentLedger.artifactsAndFlames)
          ? [...currentLedger.artifactsAndFlames]
          : [],
        forwardQuestions: Array.isArray(currentLedger.forwardQuestions)
          ? [...currentLedger.forwardQuestions]
          : [],
      }
    : {
        protagonistName: Object.values(glossary.characters)[0] || 'Линь Сюань',
        cultivationRealm: '3-й слой Очищения Ци',
        resources: ['Очки Истока: 100'],
        artifactsAndFlames: [],
        activeLocation: Object.values(glossary.sects_and_places)[0] || 'Секта Каменных Демонов',
        lastUpdatedChapter: 1,
        forwardQuestions: [],
      };

  const combinedRus = rusText || '';

  // Detect cultivation layer updates (e.g., "6-м слое Очищения Ци", "7-й слой Очищения Ци", "Заложение Основ")
  const layerMatch = combinedRus.match(/(\d+)-(?:й|го|м)\s+сло[еяюй]\s+Очищения\s+Ци/i);
  if (layerMatch) {
    base.cultivationRealm = `${layerMatch[1]}-й слой Очищения Ци`;
  } else if (/Заложени[еяю]\s+Основ/i.test(combinedRus)) {
    base.cultivationRealm = 'Заложение Основ';
  } else {
    const engLayer = engText.match(/(\d+)(?:st|nd|rd|th)\s+layer\s+of\s+Qi\s+Refining/i);
    if (engLayer) {
      base.cultivationRealm = `${engLayer[1]}-й слой Очищения Ци`;
    }
  }

  // Detect Origin Points / Spirit Stones
  const originMatch =
    combinedRus.match(/Очк(?:и|ов)\s+Истока[:\s]+(\d+)/i) ||
    engText.match(/(\d+)\s+Origin\s+Points/i);
  if (originMatch) {
    const val = `Очки Истока: ${originMatch[1]}`;
    base.resources = [
      val,
      ...base.resources.filter((r) => !r.toLowerCase().includes('очки истока')),
    ];
  }

  const stonesMatch =
    combinedRus.match(/(\d+)\s+духовн(?:ых|ый|ые)\s+камн/i) ||
    engText.match(/(\d+)\s+Spirit\s+Stones/i);
  if (stonesMatch) {
    const val = `Духовные камни (в обороте): ${stonesMatch[1]}`;
    base.resources = [
      ...base.resources.filter((r) => !r.toLowerCase().includes('духовные камни')),
      val,
    ];
  }

  // Detect acquired artifacts & flames from glossary.system_and_terms
  Object.entries(glossary.system_and_terms || {}).forEach(([eng, rus]) => {
    if (eng === 'Origin Points' || eng === 'Spirit Stones' || eng === 'Spiritual Root') return;
    const escapedEng = eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      new RegExp(`\\b${escapedEng}\\b`, 'i').test(engText) ||
      combinedRus.toLowerCase().includes(rus.toLowerCase().slice(0, 6))
    ) {
      if (!base.artifactsAndFlames.includes(rus)) {
        base.artifactsAndFlames.push(rus);
      }
    }
  });

  // Detect active location from glossary.sects_and_places
  Object.entries(glossary.sects_and_places || {}).forEach(([eng, rus]) => {
    const escapedEng = eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escapedEng}\\b`, 'i').test(engText)) {
      base.activeLocation = rus;
    }
  });

  // Forward-Falling Questions (Q_n Chekhov's guns): automatically record and resolve plot hooks
  const forwardQuestions = base.forwardQuestions || [];
  if (
    base.artifactsAndFlames.includes('Котёл Чёрного Железа') &&
    !forwardQuestions.some((q) => q.relatedEntities.includes('Котёл Чёрного Железа'))
  ) {
    forwardQuestions.push({
      id: 'q-iron-cauldron',
      questionRus: 'Какова тайна Котла Чёрного Железа и как он повлияет на создание пилюль?',
      relatedEntities: ['Котёл Чёрного Железа'],
      createdAtChapter: chapterNumber,
      status: 'open',
    });
  }

  if (
    base.artifactsAndFlames.includes('Пламя Лазурного Лотоса') &&
    !forwardQuestions.some((q) => q.relatedEntities.includes('Пламя Лазурного Лотоса'))
  ) {
    forwardQuestions.push({
      id: 'q-azure-flame',
      questionRus: 'Сможет ли Линь Сюань подчинить Пламя Лазурного Лотоса без вреда для меридианов?',
      relatedEntities: ['Пламя Лазурного Лотоса'],
      createdAtChapter: chapterNumber,
      status: 'open',
    });
  }

  // Extract unresolved dramatic questions / Chekhov's guns directly from narrative questions:
  const rawQuestions = combinedRus.match(/[^.!?\n]+(?:\?|!\?|\?!)/g);
  if (rawQuestions) {
    for (const qText of rawQuestions) {
      const cleanQ = qText.trim().replace(/^[-—«"\s]+/, '').replace(/["»\s]+$/, '');
      if (cleanQ.length >= 8 && !forwardQuestions.some((q) => q.questionRus === cleanQ)) {
        const relatedEntities: string[] = [];
        (Object.keys(glossary || {}) as GlossaryCategory[]).forEach((cat) => {
          Object.values(glossary?.[cat] || {}).forEach((entity) => {
            if (cleanQ.toLowerCase().includes(entity.toLowerCase())) {
              relatedEntities.push(entity);
            }
          });
        });
        if (relatedEntities.length === 0) {
          const firstCap = (cleanQ.match(/[А-ЯЁ][а-яё]+/g) || []).slice(0, 2);
          if (firstCap.length > 0) relatedEntities.push(firstCap.join(' '));
        }
        forwardQuestions.push({
          id: `q-auto-${chapterNumber}-${forwardQuestions.length + 1}`,
          questionRus: cleanQ,
          relatedEntities,
          createdAtChapter: chapterNumber,
          status: 'open',
        });
      }
    }
  }

  // Resolve questions if chapter text achieves resolution
  if (base.cultivationRealm.includes('Заложение Основ') || combinedRus.includes('Пилюли Заложения Основ')) {
    const q = forwardQuestions.find(
      (item) => item.id === 'q-foundation-pill' || item.questionRus.includes('Заложения Основ')
    );
    if (q && q.status === 'open') {
      q.status = 'resolved';
      q.resolvedAtChapter = chapterNumber;
      q.resolutionNote = `Успешно разрешено в главе ${chapterNumber}`;
    }
  }

  base.forwardQuestions = forwardQuestions;
  base.lastUpdatedChapter = Math.max(base.lastUpdatedChapter, chapterNumber);
  return base;
}

export interface LorebookEntry {
  id: string;
  name?: string;
  keys: string[];
  secondaryKeys?: string[];
  selectiveLogic?: 'AND_ANY' | 'AND_ALL' | 'NOT_ANY' | 'NOT_ALL';
  content: string;
  category?: 'character' | 'faction' | 'artifact' | 'realm' | 'rule';
  priority?: number;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  recursiveScanning?: boolean;
  lastActivatedChapter?: number;
  remainingSticky?: number;
  remainingCooldown?: number;
  isActive?: boolean;
}

function matchLorebookKey(key: string, text: string): boolean {
  if (!key || !text) return false;
  const trimmed = key.trim();
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    try {
      const lastSlash = trimmed.lastIndexOf('/');
      const pattern = trimmed.slice(1, lastSlash);
      const flags = trimmed.slice(lastSlash + 1) || 'i';
      return new RegExp(pattern, flags).test(text);
    } catch {
      // fallback to substring
    }
  }
  return text.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * Deterministic Lorebook State Machine with SillyTavern World Info semantics:
 * Supports sticky retention, cooldown timers, chapter delay, recursive scanning (1-step cascade),
 * and boolean secondary key logic (AND_ANY, AND_ALL, NOT_ANY, NOT_ALL).
 */
export function evaluateLorebookStateMachine(
  entries: LorebookEntry[],
  chapterNumber: number,
  chapterText: string
): {
  activeEntries: LorebookEntry[];
  stateBlock: string;
  updatedEntries: LorebookEntry[];
} {
  const activeEntries: LorebookEntry[] = [];
  const updatedEntries: LorebookEntry[] = [];

  for (const entry of entries) {
    const e: LorebookEntry = { ...entry };

    // 1. Chapter Delay: do not activate before delay
    if (e.delay && chapterNumber < e.delay) {
      e.isActive = false;
      updatedEntries.push(e);
      continue;
    }

    // 2. Cooldown timer
    if (e.remainingCooldown && e.remainingCooldown > 0) {
      e.remainingCooldown--;
      e.isActive = false;
      updatedEntries.push(e);
      continue;
    }

    // 3. Sticky timer
    if (e.remainingSticky && e.remainingSticky > 0) {
      e.remainingSticky--;
      e.isActive = true;
      activeEntries.push(e);
      if (e.remainingSticky === 0 && e.cooldown && e.cooldown > 0) {
        e.remainingCooldown = e.cooldown;
      }
      updatedEntries.push(e);
      continue;
    }

    // 4. Test trigger keys against chapterText
    const primaryMatched = e.keys.some((k) => matchLorebookKey(k, chapterText));
    let isTriggered = false;

    if (primaryMatched) {
      if (!e.secondaryKeys || e.secondaryKeys.length === 0) {
        isTriggered = true;
      } else {
        const secMatches = e.secondaryKeys.map((k) => matchLorebookKey(k, chapterText));
        switch (e.selectiveLogic) {
          case 'AND_ALL':
            isTriggered = secMatches.every(Boolean);
            break;
          case 'NOT_ANY':
            isTriggered = !secMatches.some(Boolean);
            break;
          case 'NOT_ALL':
            isTriggered = !secMatches.every(Boolean);
            break;
          case 'AND_ANY':
          default:
            isTriggered = secMatches.some(Boolean);
            break;
        }
      }
    }

    if (isTriggered) {
      e.isActive = true;
      e.lastActivatedChapter = chapterNumber;
      if (e.sticky && e.sticky > 0) {
        e.remainingSticky = e.sticky;
      }
      activeEntries.push(e);
    } else {
      e.isActive = false;
    }

    updatedEntries.push(e);
  }

  // 5. Recursive scanning (1-step cascade)
  const newlyActive = [...activeEntries];
  for (const act of newlyActive) {
    if (act.recursiveScanning) {
      for (const candidate of updatedEntries) {
        if (!candidate.isActive) {
          const matched = candidate.keys.some((k) => matchLorebookKey(k, act.content));
          if (matched) {
            candidate.isActive = true;
            candidate.lastActivatedChapter = chapterNumber;
            if (candidate.sticky && candidate.sticky > 0) {
              candidate.remainingSticky = candidate.sticky;
            }
            activeEntries.push(candidate);
          }
        }
      }
    }
  }

  // Sort by priority descending
  activeEntries.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const stateBlock =
    activeEntries.length > 0
      ? `[ACTIVE LOREBOOK ENTRIES (World Info State)]\n` +
        activeEntries
          .map((e) => `- ${e.name} (${e.category || 'lore'}): ${e.content}`)
          .join('\n')
      : '';

  return { activeEntries, stateBlock, updatedEntries };
}

export type MonteCarloSampleResult<
  T = { number: number; engText: string; rusText?: string; titleEng?: string }
> = T[] & {
  sampledChapterNumbers: number[];
  strata: {
    exposition: number[];
    middle: number[];
    climax: number[];
  };
  rationale: string;
};

/**
 * Stratified Monte Carlo proofreading sampler:
 * Divides a novel into 3 strata (exposition, middle, climax) and samples chapters
 * with priority given to chapters with high dialogue density and terminology frequency.
 */
export function sampleChaptersStratifiedMonteCarlo<
  T extends { number: number; engText: string; rusText?: string; titleEng?: string }
>(
  chapters: T[],
  sampleFraction = 0.1,
  seed = 42
): MonteCarloSampleResult<T> {
  if (!chapters || chapters.length === 0) {
    const empty: T[] = [];
    return Object.assign(empty, {
      sampledChapterNumbers: [],
      strata: { exposition: [], middle: [], climax: [] },
      rationale: 'No chapters provided for sampling.',
    });
  }

  const sorted = [...chapters].sort((a, b) => a.number - b.number);
  const totalCount = sorted.length;
  const targetCount =
    sampleFraction >= 1
      ? Math.max(1, Math.min(totalCount, Math.round(sampleFraction)))
      : Math.max(1, Math.min(totalCount, Math.round(totalCount * sampleFraction)));

  const expEnd = Math.max(1, Math.floor(totalCount * 0.2));
  const midEnd = Math.max(expEnd + 1, Math.floor(totalCount * 0.8));

  const exposition = sorted.slice(0, expEnd);
  const middle = sorted.slice(expEnd, midEnd);
  const climax = sorted.slice(midEnd);

  const scoreChapter = (ch: { engText: string; rusText?: string }) => {
    const text = ch.rusText || ch.engText || '';
    const lines = text.split('\n').filter(Boolean);
    const dialogueLines = lines.filter(
      (l) =>
        l.trim().startsWith('—') ||
        l.trim().startsWith('"') ||
        l.trim().startsWith('«')
    ).length;
    const dialogueDensity = lines.length > 0 ? dialogueLines / lines.length : 0;
    const capitalizedWords = (text.match(/[А-ЯЁA-Z][а-яёa-z]+/g) || []).length;
    const wordCount = (text.match(/\S+/g) || []).length;
    const termDensity = wordCount > 0 ? capitalizedWords / wordCount : 0;
    return dialogueDensity * 0.6 + termDensity * 0.4 + Math.min(0.2, wordCount / 5000);
  };

  const expTarget = Math.max(1, Math.round(targetCount * 0.3));
  const climTarget = Math.max(1, Math.round(targetCount * 0.3));
  const midTarget = Math.max(0, targetCount - expTarget - climTarget);

  const pickTop = (stratum: typeof sorted, count: number) => {
    return [...stratum]
      .sort((a, b) => scoreChapter(b) - scoreChapter(a))
      .slice(0, Math.min(stratum.length, count))
      .map((c) => c.number);
  };

  const expSample = pickTop(exposition, expTarget);
  const midSample = pickTop(middle, midTarget);
  const climSample = pickTop(climax, climTarget);

  const sampledChapterNumbers = Array.from(
    new Set([...expSample, ...midSample, ...climSample])
  ).sort((a, b) => a - b);

  const chapterMap = new Map(sorted.map((c) => [c.number, c]));
  const sampledChapters = sampledChapterNumbers
    .map((num) => chapterMap.get(num)!)
    .filter(Boolean);

  return Object.assign(sampledChapters, {
    sampledChapterNumbers,
    strata: {
      exposition: expSample,
      middle: midSample,
      climax: climSample,
    },
    rationale: `Выбрано ${sampledChapterNumbers.length} глав методом стратифицированного Монте-Карло с приоритетом высокой плотности диалогов и терминологии (seed: ${seed}).`,
  });
}

export {
  batchLookaheadScoutChapters,
} from './canon-glossary-vault.ts';

/**
 * Parses bulk multi-chapter text or multiple file contents into discrete chapters
 */
export function parseBulkChaptersInput(
  items: Array<{ filename?: string; content: string }>,
  startingNumberFallback = 1
): Array<{ number: number; titleEng: string; engText: string }> {
  const parsed: Array<{ number: number; titleEng: string; engText: string }> = [];
  let nextFallback = startingNumberFallback;

  for (const item of items) {
    const raw = item.content.replace(/\r\n/g, '\n').trim();
    if (!raw) continue;

    const multiSplit = raw.split(/(?=^Chapter\s+\d+(?:\.\d+)?\b)/im).map((s) => s.trim()).filter(Boolean);

    if (multiSplit.length > 1) {
      for (const block of multiSplit) {
        const lines = block.split('\n');
        const firstLine = lines[0].trim();
        const m = firstLine.match(/^Chapter\s+(\d+)/i);
        const chNum = m ? Number(m[1]) : nextFallback++;
        if (m) nextFallback = chNum + 1;
        const body = lines.slice(1).join('\n').trim() || firstLine;
        parsed.push({
          number: chNum,
          titleEng: firstLine.startsWith('Chapter') ? firstLine : `Chapter ${chNum}: ${firstLine}`,
          engText: body,
        });
      }
    } else {
      const lines = raw.split('\n');
      const firstLine = lines[0].trim();
      const mLine = firstLine.match(/^Chapter\s+(\d+)/i);
      const mFile = item.filename?.match(/(\d+)/);
      const chNum = mLine
        ? Number(mLine[1])
        : mFile
        ? Number(mFile[1])
        : nextFallback++;
      nextFallback = Math.max(nextFallback, chNum + 1);

      const hasHeaderLine = /^Chapter\s+\d+/i.test(firstLine);
      const titleEng = hasHeaderLine
        ? firstLine
        : item.filename
        ? `Chapter ${chNum}: ${item.filename.replace(/\.(txt|md)$/i, '')}`
        : `Chapter ${chNum}`;
      const engText = hasHeaderLine && lines.length > 1 ? lines.slice(1).join('\n').trim() : raw;

      parsed.push({
        number: chNum,
        titleEng,
        engText,
      });
    }
  }

  return parsed.sort((a, b) => a.number - b.number);
}

export interface ExportChapterInput {
  number: number;
  titleRus: string;
  contentRus: string;
}

export interface RulateExportPackage {
  filename: string;
  chapterRange: string;
  chapterCount: number;
  content: string;
  byteSize: number;
  hasCrLf: boolean;
  underTenMbLimit: boolean;
}

export function buildRulateExportPackages(
  novelTitle: string,
  chapters: ExportChapterInput[],
  maxChaptersPerBatch = 20
): RulateExportPackage[] {
  const sorted = [...chapters].sort((a, b) => a.number - b.number);
  const batches: RulateExportPackage[] = [];
  const safeBatchSize = Math.min(20, Math.max(1, maxChaptersPerBatch));

  for (let i = 0; i < sorted.length; i += safeBatchSize) {
    const slice = sorted.slice(i, i + safeBatchSize);
    if (slice.length === 0) continue;

    const blocks = slice.map((ch) => {
      const cleanTitle = ch.titleRus
        .replace(/^Глава\s+\d+\.?\s*/i, '')
        .replace(/\r/g, '')
        .trim();
      const cleanBody = ch.contentRus
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();

      return `# [Глава ${ch.number}. ${cleanTitle} :|: ${ch.number}]\n\n${cleanBody}\n`;
    });

    const fullContent = blocks.join('\n');
    const firstNum = slice[0].number;
    const lastNum = slice[slice.length - 1].number;
    const slug = novelTitle
      .replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, '_')
      .replace(/^_|_$/g, '');

    const byteSize = new TextEncoder().encode(fullContent).length;
    const hasCrLf = fullContent.includes('\r');

    batches.push({
      filename: `${slug}_Glavy_${firstNum}_${lastNum}_Rulate.md`,
      chapterRange: `Главы ${firstNum}–${lastNum}`,
      chapterCount: slice.length,
      content: fullContent,
      byteSize,
      hasCrLf,
      underTenMbLimit: byteSize < 10 * 1024 * 1024,
    });
  }

  return batches;
}

export function mergeSplitChapters(
  partA: { title: string; engText: string; rusText?: string },
  partB: { title: string; engText: string; rusText?: string },
  targetChapterNumber: number,
  mergedTitle?: string
): {
  number: number;
  titleEng: string;
  engText: string;
  rusText: string;
} {
  const cleanTitleA = partA.title
    .replace(/(?:\s*\(Part\s*\d+\)|\s*-\s*Part\s*\d+|\.\d+)/gi, '')
    .trim();
  const finalTitle = mergedTitle?.trim() || cleanTitleA || `Chapter ${targetChapterNumber}`;
  const engCombined = `${partA.engText.replace(/\r\n/g, '\n').trim()}\n\n---\n\n${partB.engText.replace(/\r\n/g, '\n').trim()}`;
  const rusCombined =
    partA.rusText || partB.rusText
      ? `${(partA.rusText || '').replace(/\r\n/g, '\n').trim()}\n\n---\n\n${(partB.rusText || '').replace(/\r\n/g, '\n').trim()}`
      : '';

  return {
    number: targetChapterNumber,
    titleEng: finalTitle,
    engText: engCombined,
    rusText: rusCombined,
  };
}

export interface ChapterPipelineProgressInfo {
  percent: number;
  completedSteps: number;
  totalSteps: 5;
  state: 'idle' | 'scouted' | 'running' | 'qa_attention' | 'verified';
  tooltip: string;
}

export function computeChapterPipelineProgress(
  chapter: {
    scouted: boolean;
    translated: boolean;
    edited: boolean;
    verified: boolean;
  },
  qaReport: { passed: boolean; errorCount: number; warningCount: number } | null,
  activePhaseStep = 0,
  isCurrentRunningChapter = false
): ChapterPipelineProgressInfo {
  if (isCurrentRunningChapter && activePhaseStep > 0) {
    const step = Math.min(5, Math.max(1, activePhaseStep));
    const pct = step * 20;
    return {
      percent: pct,
      completedSteps: step,
      totalSteps: 5,
      state: 'running',
      tooltip: `Выполняется фаза ${step}/5 (${pct}%)`,
    };
  }

  if (!chapter.translated) {
    if (chapter.scouted) {
      return {
        percent: 20,
        completedSteps: 1,
        totalSteps: 5,
        state: 'scouted',
        tooltip: 'Фаза 1/5 (20%): Термины просканированы, ожидает перевода',
      };
    }
    return {
      percent: 0,
      completedSteps: 0,
      totalSteps: 5,
      state: 'idle',
      tooltip: 'Фаза 0/5 (0%): Ожидает запуска конвейера',
    };
  }

  if (qaReport?.passed) {
    return {
      percent: 100,
      completedSteps: 5,
      totalSteps: 5,
      state: 'verified',
      tooltip: 'Фаза 5/5 (100%): Переведено, отредактировано и верифицировано QA (0 ошибок)',
    };
  }

  const completedSteps = chapter.edited ? 3 : 2;
  const issueCount = (qaReport?.errorCount || 0) + (qaReport?.warningCount || 0);
  const percent = chapter.edited ? 75 : 50;

  return {
    percent,
    completedSteps,
    totalSteps: 5,
    state: 'qa_attention',
    tooltip: `Фаза ${completedSteps}/5 (${percent}%): Требуется авто-ремонт QA (замечаний: ${issueCount})`,
  };
}

// ============================================================================
// MODULE 1: TransAgents "Addition-by-Subtraction" Two-Agent Pre-Scout Filter
// ============================================================================

const SUBTRACTION_NOISE_WORDS = new Set([
  'The',
  'Inside',
  'Under',
  'Three',
  'Returning',
  'Suddenly',
  'Whoever',
  'Remarkable',
  'Stepping',
  'Having',
  'Cold',
  'At',
  'For',
  'Without',
  'Could',
  'Each',
  'Even',
  'Can',
  'Hand',
  'You',
  'His',
  'Her',
  'Their',
  'This',
  'That',
  'When',
  'While',
  'After',
  'Before',
  'Chapter',
  'Part',
  'Host',
  'Cultivation',
  'Technique',
  'Mastery',
  'Speed',
  'Bonus',
  'Skill',
  'Critical',
  'Damage',
]);

export interface AdditionBySubtractionScoutResult {
  discoveredTerms: Array<{
    eng: string;
    rus_suggested: string;
    category: GlossaryCategory;
    gender: GrammaticalGender;
    context_snippet: string;
    confidence: number;
  }>;
  finalTerms: Array<{
    eng: string;
    rus_suggested: string;
    category: GlossaryCategory;
    gender: GrammaticalGender;
    context_snippet: string;
    confidence: number;
  }>;
  finalCount: number;
  addedRecallCount: number;
  subtractedNoiseCount: number;
  subtractedSamples: string[];
}

/**
 * Implements the TransAgents "Addition-by-Subtraction" (Сложение через вычитание)
 * pre-translation terminology extraction protocol:
 * - Agent A (Junior Editor / Addition): Scans with maximum Recall for all capitalized phrases & domain entities.
 * - Agent S (Senior Editor / Subtraction): Filters out sentence-initial verbs/adverbs, generic system labels, and noise.
 */
export function runAdditionBySubtractionScout(
  engText: string,
  chapterNumber: number,
  glossary: CanonicalGlossary,
  existingScouted: ScoutedTerm[] = []
): AdditionBySubtractionScoutResult {
  const knownAll = new Set<string>();
  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    Object.keys(glossary[cat] || {}).forEach((k) => knownAll.add(k.toLowerCase()));
  });
  existingScouted.forEach((t) => knownAll.add(t.eng.toLowerCase()));

  // Agent A (Addition): High-recall extraction of multi-word and single-word capitalized candidates
  const multiWordMatches = engText.match(/\b[A-Z][a-zA-Z-]*(?:\s+[A-Z][a-zA-Z-]*){0,3}\b/g) || [];
  const rawPool = Array.from(new Set(multiWordMatches.map((m) => m.trim())));

  const subtractedSamples: string[] = [];
  const cleanCandidates: string[] = [];

  // Agent S (Subtraction): Precision pruning of common English starters, system labels, and already-known canon
  for (const candidate of rawPool) {
    if (knownAll.has(candidate.toLowerCase())) {
      continue;
    }
    const words = candidate.split(/\s+/);
    const firstWord = words[0];

    if (
      words.length === 1 &&
      (SUBTRACTION_NOISE_WORDS.has(firstWord) || candidate.length < 4)
    ) {
      subtractedSamples.push(candidate);
      continue;
    }

    if (SUBTRACTION_NOISE_WORDS.has(firstWord) && words.length > 1) {
      const stripped = words.slice(1).join(' ');
      if (stripped.split(/\s+/).length >= 2 && !knownAll.has(stripped.toLowerCase())) {
        subtractedSamples.push(firstWord);
        cleanCandidates.push(stripped);
      } else {
        subtractedSamples.push(candidate);
      }
      continue;
    }

    if (/^Chapter\s*\d*/i.test(candidate) || /^Tier\s*\d*/i.test(candidate)) {
      subtractedSamples.push(candidate);
      continue;
    }

    // Single words that are not proper names/terms get pruned by Agent S
    if (
      words.length === 1 &&
      !/^(?:Dantian|Qi|Jin|Liang|Li|Zhang)$/i.test(candidate)
    ) {
      subtractedSamples.push(candidate);
      continue;
    }

    cleanCandidates.push(candidate);
  }

  const uniqueClean = Array.from(new Set(cleanCandidates));
  const discoveredTerms: AdditionBySubtractionScoutResult['discoveredTerms'] = [];

  const canonicalDictionaryHints: Record<
    string,
    { rus: string; cat: GlossaryCategory; gender: GrammaticalGender; conf: number }
  > = {
    'Nine-Leaf Spirit Grass': {
      rus: 'Девятилистная Духовная Трава',
      cat: 'system_and_terms',
      gender: 'F',
      conf: 0.97,
    },
    'Foundation Establishment Pill': {
      rus: 'Пилюля Заложения Основ',
      cat: 'system_and_terms',
      gender: 'F',
      conf: 0.97,
    },
    'Shadow Step Scripture': {
      rus: 'Канон Теневого Шага',
      cat: 'system_and_terms',
      gender: 'M',
      conf: 0.96,
    },
    'Azure Lotus Fire': {
      rus: 'Пламя Лазурного Лотоса',
      cat: 'system_and_terms',
      gender: 'N',
      conf: 0.96,
    },
    'Black Iron Cauldron': {
      rus: 'Котёл Чёрного Железа',
      cat: 'system_and_terms',
      gender: 'M',
      conf: 0.95,
    },
    'Senior Brother Chen': {
      rus: 'старший брат Чэнь',
      cat: 'characters',
      gender: 'M',
      conf: 0.94,
    },
    'Inner Sect': {
      rus: 'Внутренняя Секта',
      cat: 'sects_and_places',
      gender: 'F',
      conf: 0.95,
    },
    'Secret Realm': {
      rus: 'Тайное Царство',
      cat: 'sects_and_places',
      gender: 'N',
      conf: 0.95,
    },
  };

  for (const phrase of uniqueClean) {
    if (knownAll.has(phrase.toLowerCase())) continue;

    const dictHit = canonicalDictionaryHints[phrase];
    let rusSuggested = dictHit?.rus || phrase;
    let category: GlossaryCategory = dictHit?.cat || 'system_and_terms';
    let gender: GrammaticalGender = dictHit?.gender || 'M';
    const confidence = dictHit?.conf || 0.93;

    if (!dictHit) {
      if (/Sister|Lady|Queen|Empress|Goddess/i.test(phrase)) {
        category = 'characters';
        gender = 'F';
      } else if (/Brother|Elder|Deacon|Lord|Master/i.test(phrase)) {
        category = 'characters';
        gender = 'M';
        rusSuggested = phrase
          .replace(/Senior Brother/i, 'старший брат')
          .replace(/Junior Brother/i, 'младший брат')
          .replace(/Elder/i, 'старейшина')
          .replace(/Deacon/i, 'дьякон');
      } else if (/Sect|Guild|Tower|Mountain|Pavilion|Realm|Peak|Valley/i.test(phrase)) {
        category = 'sects_and_places';
        gender = /Pavilion|Peak/i.test(phrase)
          ? 'M'
          : /Realm/i.test(phrase)
            ? 'N'
            : 'F';
      } else if (/Grass|Pill|Rune|Technique|Scripture/i.test(phrase)) {
        gender = /Scripture/i.test(phrase) ? 'M' : 'F';
      }
    }

    discoveredTerms.push({
      eng: phrase,
      rus_suggested: rusSuggested,
      category,
      gender,
      context_snippet: `Глава ${chapterNumber} (TransAgents A−S): «${phrase}»`,
      confidence,
    });
  }

  const finalTerms = discoveredTerms.slice(0, 6);
  return {
    discoveredTerms: finalTerms,
    finalTerms,
    finalCount: finalTerms.length,
    addedRecallCount: rawPool.length,
    subtractedNoiseCount: subtractedSamples.length,
    subtractedSamples: Array.from(new Set(subtractedSamples)).slice(0, 8),
  };
}

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

export interface DitingQualityReport {
  idiomAccuracy: number; // Точность передачи идиоматики
  referentialCohesion: number; // Временная и референциальная связность
  characterVoiceFidelity: number; // Сохранение индивидуальных голосов героев
  culturalAdaptation: number; // Культурная достоверность (CSI)
  literaryRhythm: number; // Ритмика и отсутствие канцелярита
  terminologyPrecision: number; // Соблюдение канона и числительных
  overallScore: number;
  mqmGrade: 'Эталон (DITING 95+)' | 'Высокий (85–94)' | 'Требует правки (<85)';
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
 * Evaluates a translated chapter across the 6 narrative & cultural dimensions of the DITING framework.
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

  const hasCalque = lint.issues.some(
    (i) => i.ruleId === 'MACHINE_CALQUES' || i.ruleId === 'ALCHEMY_CALQUES'
  );
  const hasGenderError = lint.issues.some((i) => i.ruleId === 'CHARACTER_GENDER_MISMATCH');
  const hasDrift = lint.issues.some((i) => i.ruleId === 'PARAGRAPH_DRIFT');
  const hasTautology = lint.issues.some((i) => i.ruleId === 'TAUTOLOGY_RADAR');
  const hasTermViolation = lint.issues.some(
    (i) =>
      i.ruleId === 'GLOSSARY_CANON_VIOLATION' ||
      i.ruleId === 'NUMBER_MISMATCH' ||
      i.ruleId === 'TIER_VS_GRADE' ||
      i.ruleId === 'ARTIFACT_RANKING'
  );
  const hasUnitOrSectError = lint.issues.some(
    (i) => i.ruleId === 'WEIGHT_UNITS' || i.ruleId === 'SECT_SINGULAR'
  );

  const idiomAccuracy = hasCalque ? 76 : 98;
  const referentialCohesion = hasDrift ? 78 : hasGenderError ? 80 : 99;
  const characterVoiceFidelity = hasGenderError ? 72 : 97;
  const culturalAdaptation = hasUnitOrSectError ? 79 : 98;
  const literaryRhythm = hasTautology ? 82 : hasCalque ? 80 : 97;
  const terminologyPrecision = hasTermViolation ? 74 : 100;

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

// ============================================================================
// MODULE 5: Pure TypeScript EPUB 3 Book Compiler (Zero External Dependencies)
// ============================================================================

export interface Epub3ChapterInput {
  number: number;
  titleRus: string;
  titleEng?: string;
  contentRus: string;
  summary?: string;
  summaryRus?: string;
  csiNotes?: CsiCulturalNote[];
}

export interface Epub3BuildOptions {
  bookId?: string;
  titleRus?: string;
  titleEng?: string;
  novelTitle?: string;
  author: string;
  translator?: string;
  genreTitle?: string;
  genreLabel?: string;
  heroLedger?: HeroStateLedger;
  synopsisRus?: string;
  includeCsiFootnotes?: boolean;
  chapters: Epub3ChapterInput[];
}

export interface Epub3ArchivePackage {
  filename: string;
  bytes: Uint8Array;
  byteSize: number;
  chapterCount: number;
  totalWords: number;
  tocPreview: Array<{ number: number; titleRus: string; words: number; csiCount: number }>;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderChapterBodyToXhtml(
  rusText: string,
  csiNotes: CsiCulturalNote[] = [],
  includeCsiFootnotes = true
): string {
  const lines = rusText.replace(/\r\n/g, '\n').split('\n');
  const htmlBlocks: string[] = [];
  let inSystemBox = false;
  let systemLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed === '---') {
      if (inSystemBox) {
        if (systemLines.length > 0) {
          htmlBlocks.push(
            `<div class="system-box">\n${systemLines
              .map((sl) => `  <p class="system-line">${escapeXml(sl)}</p>`)
              .join('\n')}\n</div>`
          );
          systemLines = [];
        }
        inSystemBox = false;
      } else {
        inSystemBox = true;
      }
      continue;
    }

    if (inSystemBox) {
      systemLines.push(trimmed);
    } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      htmlBlocks.push(
        `<div class="system-box"><p class="system-line">${escapeXml(trimmed)}</p></div>`
      );
    } else {
      htmlBlocks.push(`<p>${escapeXml(trimmed)}</p>`);
    }
  }

  if (systemLines.length > 0) {
    htmlBlocks.push(
      `<div class="system-box">\n${systemLines
        .map((sl) => `  <p class="system-line">${escapeXml(sl)}</p>`)
        .join('\n')}\n</div>`
    );
  }

  if (includeCsiFootnotes && csiNotes.length > 0) {
    const noteItems = csiNotes
      .map(
        (n) =>
          `<div class="csi-item"><p><strong>${escapeXml(n.sourcePhrase)}</strong> → <em>${escapeXml(n.adaptedRus)}</em> (${escapeXml(n.categoryLabel)})</p><p class="csi-rationale">${escapeXml(n.rationale)}</p></div>`
      )
      .join('\n');
    htmlBlocks.push(
      `<aside class="csi-notes"><h3>Примечания переводчика и локализатора (CSI)</h3>\n${noteItems}\n</aside>`
    );
  }

  return htmlBlocks.join('\n');
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Packs an array of `{ path, content }` into an uncompressed ZIP archive (`Uint8Array`)
 * compliant with EPUB 3 Open Container Format (OCF), where `mimetype` is the first entry at offset 0.
 */
function createStoredZipArchive(
  files: Array<{ path: string; data: Uint8Array }>
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const dataBytes = file.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // compression method: 0 (STORE)
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x5421, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length 0 (critical for EPUB `mimetype`)
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central directory header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of localParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(eocd, cursor);
  return out;
}

/**
 * Compiles translated chapters into a complete, standards-compliant EPUB 3 archive (`.epub`).
 */
export function buildEpub3Archive(options: Epub3BuildOptions): Epub3ArchivePackage {
  const encoder = new TextEncoder();
  const sorted = [...options.chapters].sort((a, b) => a.number - b.number);
  const includeCsi = options.includeCsiFootnotes ?? true;
  const titleRus = options.titleRus || options.novelTitle || 'Веб-новелла';
  const titleEng = options.titleEng || options.novelTitle || 'Web Novel';
  const bookId = options.bookId || `kanon-epub-${Date.now()}`;
  const genreTitle = options.genreTitle || options.genreLabel || 'Сянься / ЛитРПГ';

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const stylesCss = `body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.7;
  margin: 5%;
  color: #111827;
}
h1, h2, h3 {
  font-family: "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.6em;
}
p {
  margin: 0 0 0.9em 0;
  text-indent: 1.2em;
  text-align: justify;
}
.system-box {
  margin: 1.25em 0;
  padding: 0.9em 1.2em;
  border: 1px solid #d97706;
  background-color: #fffbeb;
  border-radius: 6px;
  font-family: "Courier New", monospace;
}
.system-line {
  text-indent: 0;
  margin: 0.25em 0;
  font-size: 0.92em;
  color: #92400e;
}
.csi-notes {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid #e5e7eb;
  font-size: 0.88em;
}
.csi-item {
  margin-bottom: 0.75em;
}
.csi-rationale {
  text-indent: 0;
  color: #4b5563;
}`;

  const heroPassportHtml = options.heroLedger
    ? `<div class="system-box">
      <p class="system-line"><strong>[Паспорт состояния героя — Гл. ${options.heroLedger.lastUpdatedChapter}]</strong></p>
      <p class="system-line">Протагонист: ${escapeXml(options.heroLedger.protagonistName)}</p>
      <p class="system-line">Ступень культивации: ${escapeXml(options.heroLedger.cultivationRealm)}</p>
      <p class="system-line">Ресурсы: ${escapeXml(options.heroLedger.resources.join(' · '))}</p>
      <p class="system-line">Локация: ${escapeXml(options.heroLedger.activeLocation)}</p>
    </div>`
    : '';

  const titlePageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru" lang="ru">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(titleRus)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section>
    <h1>${escapeXml(titleRus)}</h1>
    <p style="text-indent:0;"><strong>Оригинальное название:</strong> ${escapeXml(titleEng)}</p>
    <p style="text-indent:0;"><strong>Автор:</strong> ${escapeXml(options.author)}</p>
    ${options.translator ? `<p style="text-indent:0;"><strong>Перевод:</strong> ${escapeXml(options.translator)}</p>` : ''}
    <p style="text-indent:0;"><strong>Жанровый канон:</strong> ${escapeXml(genreTitle)}</p>
    ${heroPassportHtml}
    ${
      options.synopsisRus
        ? `<div class="system-box"><p class="system-line">${escapeXml(options.synopsisRus)}</p></div>`
        : ''
    }
  </section>
</body>
</html>`;

  const chapterFiles: Array<{
    id: string;
    href: string;
    number: number;
    titleRus: string;
    words: number;
    csiCount: number;
    xhtml: string;
  }> = [];

  let totalWords = 0;

  sorted.forEach((ch, idx) => {
    const fileId = `chap-${idx + 1}`;
    const href = `chapter-${idx + 1}.xhtml`;
    const heading = ch.titleRus.trim() || `Глава ${ch.number}`;
    const words = ch.contentRus.trim() ? ch.contentRus.trim().split(/\s+/).length : 0;
    totalWords += words;
    const csiList = ch.csiNotes || [];

    const bodyHtml = renderChapterBodyToXhtml(ch.contentRus, csiList, includeCsi);
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru" lang="ru">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(heading)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section>
    <h2>${escapeXml(heading)}</h2>
    ${bodyHtml}
  </section>
</body>
</html>`;

    chapterFiles.push({
      id: fileId,
      href,
      number: ch.number,
      titleRus: heading,
      words,
      csiCount: csiList.length,
      xhtml,
    });
  });

  const navItems = [
    `<li><a href="titlepage.xhtml">Титульный лист</a></li>`,
    ...chapterFiles.map(
      (cf) => `<li><a href="${cf.href}">${escapeXml(cf.titleRus)}</a></li>`
    ),
  ].join('\n        ');

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru" lang="ru">
<head>
  <meta charset="UTF-8"/>
  <title>Оглавление — ${escapeXml(titleRus)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Оглавление</h1>
    <ol>
        ${navItems}
    </ol>
  </nav>
</body>
</html>`;

  const manifestItems = [
    `<item id="css" href="styles.css" media-type="text/css"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapterFiles.map(
      (cf) =>
        `<item id="${cf.id}" href="${cf.href}" media-type="application/xhtml+xml"/>`
    ),
  ].join('\n    ');

  const spineItems = [
    `<itemref idref="titlepage"/>`,
    ...chapterFiles.map((cf) => `<itemref idref="${cf.id}"/>`),
  ].join('\n    ');

  const modifiedIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ru">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(titleRus)}</dc:title>
    <dc:creator>${escapeXml(options.author)}</dc:creator>
    <dc:language>ru</dc:language>
    <meta property="dcterms:modified">${modifiedIso}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;

  const archiveEntries: Array<{ path: string; data: Uint8Array }> = [
    { path: 'mimetype', data: encoder.encode('application/epub+zip') },
    { path: 'META-INF/container.xml', data: encoder.encode(containerXml) },
    { path: 'OEBPS/styles.css', data: encoder.encode(stylesCss) },
    { path: 'OEBPS/nav.xhtml', data: encoder.encode(navXhtml) },
    { path: 'OEBPS/titlepage.xhtml', data: encoder.encode(titlePageXhtml) },
    ...chapterFiles.map((cf) => ({
      path: `OEBPS/${cf.href}`,
      data: encoder.encode(cf.xhtml),
    })),
    { path: 'OEBPS/content.opf', data: encoder.encode(contentOpf) },
  ];

  const bytes = createStoredZipArchive(archiveEntries);
  const firstNum = sorted[0]?.number ?? 1;
  const lastNum = sorted[sorted.length - 1]?.number ?? 1;
  const slug = titleEng
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return {
    filename: `${slug || 'Novel'}_Ch_${firstNum}_${lastNum}_EPUB3.epub`,
    bytes,
    byteSize: bytes.byteLength,
    chapterCount: sorted.length,
    totalWords,
    tocPreview: chapterFiles.map((cf) => ({
      number: cf.number,
      titleRus: cf.titleRus,
      words: cf.words,
      csiCount: cf.csiCount,
    })),
  };
}

// ============================================================================
// MODULE 6: GOOGLE COLAB L4 (24GB VRAM) & MULTI-MODEL PROVIDER ADAPTER
// ============================================================================

export type LlmProviderType = 'colab_ollama' | 'gemini_api' | 'antigravity_cli';

export interface LlmProviderConfig {
  provider: LlmProviderType;
  colabEndpointUrl?: string;
  modelId: string;
  scoutModelId?: string;
  criticModelId?: string;
  temperature?: number;
  numCtx?: number;
}

export interface AgyCliModelSpec {
  id: string;
  title: string;
  role: 'primary' | 'critic' | 'scout';
  roleBadge: string;
  descriptionRus: string;
}

export const AGY_CLI_MODEL_CATALOG: AgyCliModelSpec[] = [
  {
    id: 'gemini-3.8-flash-high',
    title: 'Gemini 3.8 Flash (High)',
    role: 'primary',
    roleBadge: 'Основной перевод (Pass 1) и Self-Repair',
    descriptionRus:
      'Быстрая рабочая лошадка для основного черновика главы (Pass 1) и точечного ремонта абзацев с глубоким размышлением.',
  },
  {
    id: 'gemini-3.8-flash-medium',
    title: 'Gemini 3.8 Flash (Medium)',
    role: 'primary',
    roleBadge: 'Быстрый потоковый перевод',
    descriptionRus:
      'Сбалансированный режим Flash для скоростного пакетного прогона больших томов.',
  },
  {
    id: 'gemini-3.8-flash-low',
    title: 'Gemini 3.8 Flash (Low)',
    role: 'scout',
    roleBadge: 'Мгновенный пре-скаут терминов (Pass 0)',
    descriptionRus:
      'Минимальная задержка для извлечения новых имён, техник и локаций по протоколу TransAgents.',
  },
  {
    id: 'gemini-4-argon-medium',
    title: 'Gemini 4 Argon (Medium)',
    role: 'critic',
    roleBadge: 'Тяжёлый финальный судья (Pass 2 Хирург)',
    descriptionRus:
      'Флагманский рассуждающий движок для финальной сверки оригинала с переводом и генерации точечных патчей (A/B/C/D).',
  },
  {
    id: 'gemini-4-argon-high',
    title: 'Gemini 4 Argon (High)',
    role: 'critic',
    roleBadge: 'Максимальная глубина ревью (Pass 2)',
    descriptionRus:
      'Максимальный бюджет мышления Argon для самых сложных диалоговых сцен с опущенными местоимениями и даосской поэзией.',
  },
  {
    id: 'claude-sonnet-5-5-high',
    title: 'Claude Sonnet 5.5 (High)',
    role: 'critic',
    roleBadge: 'Альтернативный литературный стилист',
    descriptionRus:
      'Доступен через подписку agy CLI: живая русская фразеология и тонкая передача интонаций персонажей.',
  },
  {
    id: 'claude-opus-5-5-medium',
    title: 'Claude Opus 5.5 (Medium)',
    role: 'critic',
    roleBadge: 'Тяжёлый арбитр художественного слога',
    descriptionRus:
      'Флагманская модель в подписке agy CLI для финальной литературной вычитки.',
  },
];

export interface ColabL4ModelSpec {
  id: string;
  ollamaTag: string;
  title: string;
  family: 'Gemma 4' | 'TranslateGemma' | 'Qwen 3' | 'Mistral' | 'Gemma 3';
  architecture: string;
  vramGb: string;
  speedOnL4: string;
  contextWindow: string;
  roleBadge: string;
  strengthsRus: string;
  caveatsRus: string;
  recommendedFor: ('xianxia' | 'litrpg' | 'dark_fantasy' | 'wuxia' | 'urban')[];
}

export const COLAB_L4_MODEL_CATALOG: ColabL4ModelSpec[] = [
  {
    id: 'gemma4:31b',
    ollamaTag: 'gemma4:31b',
    title: 'Gemma 4 31B Dense (Q4_K_M / QAT)',
    family: 'Gemma 4',
    architecture: 'Dense · 30.7B параметров',
    vramGb: '~18.5–20 ГБ из 24 ГБ',
    speedOnL4: '~24–30 ток/с',
    contextWindow: '256K',
    roleBadge: 'Лучший литературный слог',
    strengthsRus:
      'Фаворит сообщества (r/LocalLLaMA) для художественной прозы на русском: живые диалоги, естественная интонация без канцелярита и глубокое удержание контекста.',
    caveatsRus:
      'Занимает почти всю память L4 — обязательно включать квантизацию KV-кэша (OLLAMA_KV_CACHE_TYPE=q8_0).',
    recommendedFor: ['xianxia', 'wuxia', 'dark_fantasy', 'urban'],
  },
  {
    id: 'gemma4:26b-a4b',
    ollamaTag: 'gemma4:26b-a4b',
    title: 'Gemma 4 26B A4B MoE (Q4_K_M)',
    family: 'Gemma 4',
    architecture: 'MoE · 26.1B всего / ~4B активных',
    vramGb: '~14.5–16 ГБ из 24 ГБ',
    speedOnL4: '~65–90 ток/с',
    contextWindow: '256K',
    roleBadge: 'Чемпион скорости на L4',
    strengthsRus:
      'Активирует всего ~4B параметров на каждый токен при словарном запасе 26B. Переводит главы в 3 раза быстрее плотных моделей без перегрузок 503.',
    caveatsRus:
      'На сложных архаичных метафорах может чуть уступать плотной 31B, что компенсируется нашим 3-ролевым промптом LCD-MAS.',
    recommendedFor: ['litrpg', 'xianxia', 'urban'],
  },
  {
    id: 'translategemma:27b',
    ollamaTag: 'translategemma:27b',
    title: 'TranslateGemma 27B IT (WMT24++ / AutoMQM)',
    family: 'TranslateGemma',
    architecture: 'Dense · 27B (RL MetricX-QE + AutoMQM)',
    vramGb: '~15.5–17 ГБ из 24 ГБ',
    speedOnL4: '~30–35 ток/с',
    contextWindow: '128K',
    roleBadge: 'Спецмодель перевода Google',
    strengthsRus:
      'Специализированная модель Google 2026 года, дообученная с RL-наградами MetricX-QE и AutoMQM на 55 языках (включая русский). Минимум отсебятины и потерь предложений.',
    caveatsRus:
      'Сфокусирована на точном переводе, поэтому для JSON-ответов (scout/translate_and_edit) использует наш парсер с защитой от обёрток.',
    recommendedFor: ['xianxia', 'litrpg', 'wuxia'],
  },
  {
    id: 'qwen3:32b',
    ollamaTag: 'qwen3:32b',
    title: 'Qwen 3 32B (Q4_K_M)',
    family: 'Qwen 3',
    architecture: 'Dense · 32.8B параметров',
    vramGb: '~19.5–21 ГБ из 24 ГБ',
    speedOnL4: '~22–27 ток/с',
    contextWindow: '128K',
    roleBadge: 'Эталон канона и JSON-схем',
    strengthsRus:
      'Глубже всех понимает азиатский контекст (сянься, даосские идиомы, китайские имена и ранги), безупречно соблюдает падежи и строгую JSON-схему ответа.',
    caveatsRus:
      'Без стилистической роли норовит писать суховато; при включённом режиме размышлений (<think>) наш адаптер автоматически срезает черновик мыслей.',
    recommendedFor: ['xianxia', 'wuxia', 'litrpg'],
  },
  {
    id: 'mistral-small3.1:24b',
    ollamaTag: 'mistral-small3.1:24b',
    title: 'Mistral Small 3.1 24B Instruct (Q4_K_M)',
    family: 'Mistral',
    architecture: 'Dense · 24B параметров',
    vramGb: '~14–15.5 ГБ из 24 ГБ',
    speedOnL4: '~35–42 ток/с',
    contextWindow: '128K',
    roleBadge: 'Дарк-фэнтези без цензуры',
    strengthsRus:
      'Любимец авторов ролевой и художественной прозы: отлично передаёт резкие диалоги, боевые сцены и мрачную атмосферу без ложных отказов safety-фильтра.',
    caveatsRus:
      'Базовый словарный запас русских архаизмов чуть скромнее, чем у Gemma 4 31B и Qwen 3 32B.',
    recommendedFor: ['dark_fantasy', 'litrpg', 'urban'],
  },
];

export const DEFAULT_LLM_PROVIDER_CONFIG: LlmProviderConfig = {
  provider: 'colab_ollama',
  colabEndpointUrl: '',
  modelId: 'gemma4:26b-a4b',
  scoutModelId: 'gemini-3.8-flash-low',
  criticModelId: 'gemini-4-argon-medium',
  temperature: 0.3,
  numCtx: 16384,
};

/**
 * Normalizes a user-provided Colab Cloudflare Tunnel / Ngrok / Localhost URL
 * into a clean base origin (removing trailing slashes, `/v1/chat/completions`, `/api/chat`, etc.).
 */
export function normalizeColabEndpointUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProto
    .replace(/\/+(?:v1\/chat\/completions|v1\/models|v1|api\/chat|api\/generate|api\/tags)\/?$/i, '')
    .replace(/\/+$/, '');
}

/**
 * Extracts structured JSON from open-weight LLM outputs (Gemma 4, Qwen 3, Mistral),
 * stripping `<think>...</think>` reasoning blocks and markdown code fences.
 */
export function extractResilientJsonFromLlm<T>(rawOutput: string, fallback: T): T {
  if (!rawOutput || typeof rawOutput !== 'string') return fallback;

  // 1. Strip reasoning blocks (<think>...</think> or <|thought|>...<|/thought|>)
  let cleaned = rawOutput
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|thought\|>[\s\S]*?<\|\/thought\|>/gi, '')
    .trim();

  // 2. Strip markdown ```json ... ``` fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }

  // 3. Try direct parse first
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 4. Locate outermost JSON object {...} or array [...]
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');

    const isArrayTarget = Array.isArray(fallback);
    if (isArrayTarget && firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as T;
      } catch {
        // continue
      }
    }

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // continue
      }
    }

    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as T;
      } catch {
        // continue
      }
    }
  }

  return fallback;
}

/**
 * Generates a 1-click Google Colab (NVIDIA L4 24GB VRAM) startup script that:
 * 1. Installs Ollama & Cloudflared
 * 2. Tunes L4 VRAM flags (Flash Attention + Q8_0 KV Cache + 16K/32K context)
 * 3. Pulls the chosen Gemma 4 / Qwen 3 / TranslateGemma model
 * 4. Prints the public HTTPS tunnel URL for pasting into Канон Сянься
 */
export function generateColabL4LaunchScript(
  primaryModel = 'gemma4:26b-a4b',
  alsoPullSecondary?: string,
  backend: 'ollama' | 'vllm' = 'ollama'
): string {
  const cleanPrimary = primaryModel.trim() || 'gemma4:26b-a4b';
  const secondaryLine =
    alsoPullSecondary && alsoPullSecondary !== cleanPrimary
      ? `\n!ollama pull ${alsoPullSecondary}`
      : '';

  if (backend === 'vllm') {
    return `# === КАНОН СЯНЬСЯ: ВЫДЕЛЕННЫЙ СЕРВЕР vLLM NEXT-GEN НА GOOGLE COLAB L4 (24 ГБ VRAM) ===
# Запустите эту ячейку в Google Colab (Среда выполнения -> Сменить среду -> GPU L4)

import subprocess, time, re, os

print("1/4 Установка vLLM и Cloudflare Tunnel...")
!pip install -q vllm==0.8.*
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared

print("2/4 Запуск сервера vLLM Next-Gen L4 (FP8 KV + Prefix Caching + Speculative N-gram)...")
# Профиль флагов vLLM под NVIDIA L4 (24 ГБ VRAM):
# --enable-prefix-caching --enable-chunked-prefill --kv-cache-dtype fp8 --max-num-batched-tokens 8192
# --speculative-config '{"method": "ngram", "num_speculative_tokens": 5, "prompt_lookup_max": 4}'
vllm_cmd = [
    "python3", "-m", "vllm.entrypoints.openai.api_server",
    "--model", "${cleanPrimary}",
    "--port", "11434",
    "--host", "0.0.0.0",
    "--enable-prefix-caching",
    "--enable-chunked-prefill",
    "--kv-cache-dtype", "fp8",
    "--max-num-batched-tokens", "8192",
    "--speculative-config", '{"method": "ngram", "num_speculative_tokens": 5, "prompt_lookup_max": 4}'
]
vllm_proc = subprocess.Popen(vllm_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(10)

print("3/4 Открытие защищённого HTTPS-туннеля Cloudflare...")
tunnel_proc = subprocess.Popen(
    ["/usr/local/bin/cloudflared", "tunnel", "--url", "http://localhost:11434", "--no-autoupdate"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

public_url = None
for _ in range(60):
    line = tunnel_proc.stdout.readline()
    if not line:
        time.sleep(0.5)
        continue
    match = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", line)
    if match:
        public_url = match.group(0)
        break

print("\\n" + "="*72)
print("✅ СЕРВЕР vLLM L4 ГОТОВ! Скопируйте этот URL в «Канон Сянься»:")
print(f"🔗 {public_url}")
print(f"🧠 Активная модель: ${cleanPrimary}")
print("="*72)
`;
  }

  return `# === КАНОН СЯНЬСЯ: ВЫДЕЛЕННЫЙ СЕРВЕР ПЕРЕВОДА НА GOOGLE COLAB L4 (24 ГБ VRAM) ===
# Запустите эту ячейку в Google Colab (Среда выполнения -> Сменить среду -> GPU L4)
# Альтернативный запуск vLLM Next-Gen L4 (FP8 KV + Prefix Caching + Speculative N-gram):
# python3 -m vllm.entrypoints.openai.api_server --model ${cleanPrimary} --enable-prefix-caching --enable-chunked-prefill --kv-cache-dtype fp8 --max-num-batched-tokens 8192 --speculative-config '{"method": "ngram", "num_speculative_tokens": 5, "prompt_lookup_max": 4}'

import subprocess, time, re, os

print("1/4 Установка Ollama и Cloudflare Tunnel...")
!sudo apt-get update -qq && sudo apt-get install -y -qq zstd pciutils lshw
!curl -fsSL https://ollama.com/install.sh | sh
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared

# Оптимизация под NVIDIA L4 (24 GB VRAM): Flash Attention + сжатие KV-кэша q8_0 + CORS
os.environ["OLLAMA_HOST"] = "0.0.0.0:11434"
os.environ["OLLAMA_ORIGINS"] = "*"
os.environ["OLLAMA_FLASH_ATTENTION"] = "1"
os.environ["OLLAMA_KV_CACHE_TYPE"] = "q8_0"
os.environ["OLLAMA_NUM_PARALLEL"] = "2"
os.environ["OLLAMA_KEEP_ALIVE"] = "24h"

print("2/4 Запуск сервера Ollama на GPU L4...")
ollama_proc = subprocess.Popen(
    ["ollama", "serve"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)
time.sleep(5)

print("3/4 Загрузка модели ${cleanPrimary} в видеопамять L4...")
!ollama pull ${cleanPrimary}${secondaryLine}

print("4/4 Открытие защищённого HTTPS-туннеля Cloudflare...")
tunnel_proc = subprocess.Popen(
    ["/usr/local/bin/cloudflared", "tunnel", "--url", "http://localhost:11434", "--no-autoupdate"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

public_url = None
for _ in range(60):
    line = tunnel_proc.stdout.readline()
    if not line:
        time.sleep(0.5)
        continue
    match = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", line)
    if match:
        public_url = match.group(0)
        break

print("\\n" + "="*72)
print("✅ СЕРВЕР COLAB L4 ГОТОВ! Скопируйте этот URL в «Канон Сянься»:")
print(f"🔗 {public_url}")
print(f"🧠 Активная модель: ${cleanPrimary}")
print("="*72)
`;
}

// ============================================================================
// MODULE 7: PRODUCTION WORKFLOW UPGRADES (Q6–Q12 & PEREVOD_READY PORT)
// 1. 25+ Xianxia/LitRPG Anti-Calque Dictionary + Perevod_Ready AI_SLOP_PHRASES
// 2. Punctuation Stitch Repair (_PUNCT_ARTIFACT_PATTERNS from Perevod_Ready)
// 3. Raw Chapter Sanitizer (TL Note / Patreon / Discord / Rulate / HTML stripper)
// 4. Pure-TS EPUB (.epub) Archive Reader & Chapter Unpacker
// 5. Pass 2 Surgical Patch Engine (Perevod_Ready refine.py protocol)
// 6. Per-Chapter ZIP Archive Builder (Ranobelib / Boosty / Author.Today)
// ============================================================================

export interface AntiCalqueEntry {
  id: string;
  label: string;
  pattern: RegExp;
  replace: string;
  desc: string;
  explanation: string;
}

export const XIANXIA_ANTI_CALQUE_DICTIONARY: AntiCalqueEntry[] = [
  {
    id: 'cant_help_question',
    label: 'не удержался от вопроса → невольно поинтересовался',
    pattern: /не\s+удержался\s+от\s+вопроса/gi,
    replace: 'невольно поинтересовался',
    desc: 'Калька «не удержался от вопроса» → «невольно поинтересовался»',
    explanation: 'Калька с англ. "couldn\'t help but ask". В живой русской речи: «невольно поинтересовался / спросил».',
  },
  {
    id: 'cant_help_but_not',
    label: 'не удержался от того, чтобы не → не сдержался и',
    pattern: /не\s+удержался\s+от\s+того,\s+чтобы\s+не\s+/gi,
    replace: 'не сдержался и ',
    desc: 'Калька «не удержался от того, чтобы не» → «не сдержался и»',
    explanation: 'Тяжеловесная калька с "couldn\'t help but". Заменяется на «не сдержался и» или «невольно».',
  },
  {
    id: 'cant_help_but',
    label: 'не удержался от того, чтобы → не сдержался и',
    pattern: /не\s+удержался\s+от\s+того,\s+чтобы\s+/gi,
    replace: 'не сдержался и ',
    desc: 'Калька «не удержался от того, чтобы» → «не сдержался и»',
    explanation: 'Калька с "couldn\'t help but". Заменяется на «не сдержался и».',
  },
  {
    id: 'sucked_cold_air',
    label: 'втянул глоток холодного воздуха → судорожно перевёл дыхание',
    pattern: /втянул[аи]?\s+(?:глоток|полные\s+лёгкие)\s+холодного\s+воздуха/gi,
    replace: 'судорожно перевёл дыхание',
    desc: 'Штамп «втянул глоток холодного воздуха» → «судорожно перевёл дыхание»',
    explanation: 'Китайско-английский штамп "sucked in a breath of cold air" (倒吸一口凉气). По-русски: «судорожно перевёл дыхание / ахнул».',
  },
  {
    id: 'in_his_heart',
    label: 'в своём сердце (подумал/сказал) → про себя / в душе',
    pattern: /(подумал[аи]?|сказал[аи]?|произнёс|прошептал[аи]?|выругался|усмехнулся)\s+в\s+сво[её]м\s+сердце/gi,
    replace: '$1 про себя',
    desc: 'Калька «в своём сердце» → «про себя»',
    explanation: 'Калька с "said/thought in his heart" (心中暗道). По-русски: «про себя» или «мысленно».',
  },
  {
    id: 'deep_in_his_heart',
    label: 'глубоко внутри своего сердца → в глубине души',
    pattern: /глубоко\s+внутри\s+своего\s+сердца/gi,
    replace: 'в глубине души',
    desc: 'Калька «глубоко внутри своего сердца» → «в глубине души»',
    explanation: 'Калька с "deep inside his heart". В русской идиоматике: «в глубине души».',
  },
  {
    id: 'bitterly_smiled',
    label: 'горько улыбнулся → криво усмехнулся',
    pattern: /горько\s+улыбнул(ся|ась|ись)/gi,
    replace: 'криво усмехнул$1',
    desc: 'Калька «горько улыбнулся» → «криво усмехнулся»',
    explanation: 'Калька с "smiled bitterly" (苦笑). Естественный русский эквивалент: «криво усмехнулся / грустно усмехнулся».',
  },
  {
    id: 'mouthful_of_blood',
    label: 'выплюнул полный рот крови → сплюнул сгусток крови',
    pattern: /выплюнул\s+полный\s+рот\s+крови/gi,
    replace: 'сплюнул сгусток крови',
    desc: 'Калька «выплюнул полный рот крови» → «сплюнул сгусток крови»',
    explanation: 'Буквальный перевод "spat out a mouthful of blood" (吐出一口鲜血). По-русски: «сплюнул сгусток крови / захлебнулся кровью».',
  },
  {
    id: 'courting_death',
    label: 'ты ищешь смерти → ты нарываешься на смерть',
    pattern: /ты\s+ищешь\s+смерти/gi,
    replace: 'ты нарываешься на смерть',
    desc: 'Штамп «ты ищешь смерти» → «ты нарываешься на смерть»',
    explanation: 'Классическая идиома сянься "You are courting death!" (找死). Живой перевод: «Ты нарываешься на смерть! / Жить надоело?!».',
  },
  {
    id: 'laugh_or_cry',
    label: 'не знал, смеяться ему или плакать → не знал, то ли смеяться, то ли плакать',
    pattern: /не\s+знал,\s+смеяться\s+(?:ему\s+)?или\s+плакать/gi,
    replace: 'не знал, то ли смеяться, то ли плакать',
    desc: 'Калька «не знал, смеяться ему или плакать» → «не знал, то ли смеяться, то ли плакать»',
    explanation: 'Китайская идиома 哭笑不得 ("didn\'t know whether to laugh or cry"). Русский оборот: «не знал, то ли смеяться, то ли плакать».',
  },
  {
    id: 'inwardly_sighed',
    label: 'внутренне вздохнул → мысленно вздохнул',
    pattern: /внутренне\s+вздохнул([аи]?)/gi,
    replace: 'мысленно вздохнул$1',
    desc: 'Калька «внутренне вздохнул» → «мысленно вздохнул»',
    explanation: 'Калька с "inwardly sighed". По-русски: «мысленно вздохнул / про себя вздохнул».',
  },
  {
    id: 'squinted_his_eyes',
    label: 'прищурил свои глаза → прищурился',
    pattern: /прищурил\s+свои\s+глаза/gi,
    replace: 'прищурился',
    desc: 'Притяжательная калька «прищурил свои глаза» → «прищурился»',
    explanation: 'Английские притяжательные местоимения со своими частями тела ("squinted his eyes") в русском языке избыточны.',
  },
  {
    id: 'shook_his_head',
    label: 'покачал своей головой → покачал головой',
    pattern: /покачал([аи]?)\s+своей\s+головой/gi,
    replace: 'покачал$1 головой',
    desc: 'Притяжательная калька «покачал своей головой» → «покачал головой»',
    explanation: 'Избыточное местоимение «своей» с частями тела ("shook his head").',
  },
  {
    id: 'frowned_his_brows',
    label: 'нахмурил свои брови → нахмурился',
    pattern: /нахмурил\s+свои\s+брови/gi,
    replace: 'нахмурился',
    desc: 'Притяжательная калька «нахмурил свои брови» → «нахмурился»',
    explanation: 'Калька с "furrowed his brows". По-русски: «нахмурился / нахмурил брови».',
  },
  {
    id: 'clenched_his_fists',
    label: 'сжал свои кулаки → сжал кулаки',
    pattern: /сжал([аи]?)\s+свои\s+кулаки/gi,
    replace: 'сжал$1 кулаки',
    desc: 'Притяжательная калька «сжал свои кулаки» → «сжал кулаки»',
    explanation: 'Избыточное притяжательное местоимение "clenched his fists".',
  },
  {
    id: 'black_as_pot_bottom',
    label: 'лицо почернело как дно котла → помрачнел темнее тучи',
    pattern: /его\s+лицо\s+почернело,?\s+как\s+дно\s+(?:горшка|котла)/gi,
    replace: 'он помрачнел темнее тучи',
    desc: 'Китайская калька «лицо почернело как дно котла» → «помрачнел темнее тучи»',
    explanation: 'Буквальный перевод идиомы 脸色黑如锅底. Естественный русский образ: «помрачнел темнее тучи».',
  },
  {
    id: 'mount_tai',
    label: 'имел глаза, но не видел гору Тай → смотрел в упор и не признал величия',
    pattern: /имел[аи]?\s+глаза,\s+но\s+не\s+(?:видел[аи]?|узнал[аи]?)\s+гору\s+Тай/gi,
    replace: 'смотрел в упор, но не распознал истинного величия',
    desc: 'Идиома «имел глаза, но не видел гору Тай» адаптирована литературно',
    explanation: 'Идиома 有眼不识泰山. Без адаптации звучит комично в русском тексте.',
  },
  {
    id: 'give_face',
    label: 'не дал ему лица → проявил к нему неуважение',
    pattern: /не\s+дал\s+ему\s+лица/gi,
    replace: 'открыто проявил к нему неуважение',
    desc: 'Калька «не дал ему лица» → «открыто проявил к нему неуважение»',
    explanation: 'Калька с китайского 给面子 ("give face"). По-русски: «уважить / оказать честь / проявить уважение».',
  },
  {
    id: 'heaven_and_earth_diff',
    label: 'разница между ними была как небо и земля → их разделяла пропасть как между небом и землёй',
    pattern: /разница\s+между\s+ними\s+была\s+как\s+небо\s+и\s+земля/gi,
    replace: 'их разделяла пропасть, как между небом и землёй',
    desc: 'Стилистическая правка оборота «небо и земля»',
    explanation: 'Исправление грамматической сочетаемости в русском предложении.',
  },
  {
    id: 'traces_of_smile',
    label: 'след улыбки появился в уголке его рта → уголки его губ тронула лёгкая усмешка',
    pattern: /след\s+улыбки\s+появился\s+в\s+уголк[еах]\s+его\s+рта/gi,
    replace: 'уголки его губ тронула лёгкая усмешка',
    desc: 'Калька «след улыбки появился в уголке его рта» → «уголки его губ тронула лёгкая усмешка»',
    explanation: 'Калька с "a trace of a smile appeared at the corner of his mouth".',
  },
  {
    id: 'cold_light_flashed',
    label: 'холодный свет мелькнул в его глазах → в его взгляде блеснул холод',
    pattern: /холодный\s+свет\s+мелькнул\s+в\s+его\s+глазах/gi,
    replace: 'в его взгляде блеснул стальной холод',
    desc: 'Калька «холодный свет мелькнул в его глазах» → «в его взгляде блеснул стальной холод»',
    explanation: 'Калька с "a cold light flashed in his eyes" (眼中闪过一道寒芒).',
  },
  // Блок А (Нора Галь: отглагольные существительные и неодушевлённые подлежащие)
  {
    id: 'nominalization_absorption',
    label: 'после завершения поглощения → усвоив',
    pattern: /после\s+завершения\s+поглощения/gi,
    replace: 'усвоив',
    desc: 'Канцелярит «после завершения поглощения» → «усвоив» (Нора Галь)',
    explanation: 'Замена отглагольного существительного на деепричастие совершенного вида.',
  },
  {
    id: 'nominalization_cultivation',
    label: 'после завершения культивации → завершив медитацию',
    pattern: /после\s+завершения\s+культивации/gi,
    replace: 'завершив медитацию',
    desc: 'Канцелярит «после завершения культивации» → «завершив медитацию»',
    explanation: 'Устранение двойной номинализации.',
  },
  {
    id: 'nominalization_breakthrough',
    label: 'после завершения прорыва → прорвавшись',
    pattern: /после\s+завершения\s+прорыва/gi,
    replace: 'прорвавшись',
    desc: 'Канцелярит «после завершения прорыва» → «прорвавшись»',
    explanation: 'Замена тяжеловесной связки на деепричастие.',
  },
  {
    id: 'nominalization_action_breakthrough',
    label: 'осуществил прорыв → прорвался',
    pattern: /осуществил\s+прорыв/gi,
    replace: 'прорвался',
    desc: 'Канцелярит «осуществил прорыв» → «прорвался»',
    explanation: 'Замена расщеплённого сказуемого на прямой глагол действия.',
  },
  {
    id: 'nominalization_action_attack',
    label: 'осуществил атаку → атаковал',
    pattern: /осуществил\s+атаку/gi,
    replace: 'атаковал',
    desc: 'Канцелярит «осуществил атаку» → «атаковал»',
    explanation: 'Замена расщеплённого сказуемого на глагол.',
  },
  {
    id: 'nominalization_action_evasion',
    label: 'осуществил уклонение → уклонился',
    pattern: /осуществил\s+уклонение/gi,
    replace: 'уклонился',
    desc: 'Канцелярит «осуществил уклонение» → «уклонился»',
    explanation: 'Замена расщеплённого сказуемого на глагол.',
  },
  {
    id: 'nominalization_action_decision',
    label: 'принял решение → решил',
    pattern: /принял\s+решение/gi,
    replace: 'решил',
    desc: 'Канцелярит «принял решение» → «решил»',
    explanation: 'Вербализация по Норе Галь: «принял решение» → «решил».',
  },
  {
    id: 'nominalization_action_attempt',
    label: 'предпринял попытку → попытался',
    pattern: /предпринял\s+попытку/gi,
    replace: 'попытался',
    desc: 'Канцелярит «предпринял попытку» → «попытался»',
    explanation: 'Вербализация: «предпринял попытку» → «попытался».',
  },
  {
    id: 'inanimate_subject_chill',
    label: 'вид крови заставил холод пробежать → при виде крови по спине пробежал холодок',
    pattern: /вид\s+крови\s+заставил\s+холод\s+пробежать\s+по\s+(?:его\s+)?позвоночнику/gi,
    replace: 'при виде крови у него по спине пробежал холодок',
    desc: 'Неодушевлённое подлежащее заменено на естественную одушевлённую конструкцию',
    explanation: 'Калька с "the sight of blood made a chill run down his spine".',
  },
  // Блок Б (Китайские соматизмы и чэнъюи)
  {
    id: 'somatism_pinpoint_pupils',
    label: 'зрачки сузились до размеров игольного ушка → зрачки превратились в две точки',
    pattern: /зрачки\s+сузились\s+до\s+(?:размеров?\s+)?(?:игольного\s+ушка|булавки)/gi,
    replace: 'зрачки превратились в две точки',
    desc: 'Калька «зрачки сузились до игольного ушка» → «зрачки превратились в две точки»',
    explanation: 'Калька с китайского 瞳孔缩小如针尖 ("pupils shrank to needles").',
  },
  {
    id: 'somatism_green_white_face',
    label: 'лицо менялось с зелёного на белое → лицо шло пятнами от бессильной ярости',
    pattern: /лицо\s+(?:стало|было)\s+то\s+зелёным,\s+то\s+белым|лицо\s+менялось\s+с\s+зелёного\s+на\s+белое/gi,
    replace: 'лицо шло пятнами от бессильной ярости',
    desc: 'Калька «лицо то зелёное, то белое» → «лицо шло пятнами от бессильной ярости»',
    explanation: 'Буквальный перевод идиомы 脸色青一阵白一阵.',
  },
  {
    id: 'somatism_green_intestines',
    label: 'кишки позеленели от сожаления → готов был локти кусать от досады',
    pattern: /кишки\s+позеленели\s+от\s+сожаления/gi,
    replace: 'готов был локти кусать от досады',
    desc: 'Калька «кишки позеленели от сожаления» → «готов был локти кусать от досады»',
    explanation: 'Китайская идиома 悔得肠子都青了 ("regretted until intestines turned green").',
  },
  {
    id: 'somatism_twitching_mouth',
    label: 'уголки рта задёргались → губы нервно дрогнули',
    pattern: /уголки\s+(?:его\s+|её\s+)?рта\s+(?:слегка\s+)?задёргались/gi,
    replace: 'губы нервно дрогнули',
    desc: 'Калька «уголки рта задёргались» → «губы нервно дрогнули»',
    explanation: 'Калька с 嘴角抽搐 ("corner of the mouth twitched").',
  },
  {
    id: 'somatism_black_lines_forehead',
    label: 'чёрные линии на лбу → мрачно нахмурился',
    pattern: /(?:три\s+)?чёрные\s+линии\s+(?:появились\s+)?на\s+лбу|лицо\s+покрылось\s+чёрными\s+линиями/gi,
    replace: 'он мрачно нахмурился',
    desc: 'Аниме-штамп «чёрные линии на лбу» переведён в литературный жест',
    explanation: 'Манга-символ (black lines/sweatdrop) не должен переводиться буквально в прозе.',
  },
  {
    id: 'somatism_swallow_saliva',
    label: 'проглотил сухую слюну → судорожно сглотнул',
    pattern: /проглотил\s+полный\s+рот\s+слюны|сглотнул\s+сухую\s+слюну/gi,
    replace: 'судорожно сглотнул',
    desc: 'Калька «сглотнул сухую слюну» → «судорожно сглотнул»',
    explanation: 'Калька с 咽了一口唾沫 / swallowed a mouthful of saliva.',
  },
  // Блок В (Японские и корейские кальки)
  {
    id: 'jp_double_negative',
    label: 'не то чтобы я не мог понять → понять-то несложно, да только',
    pattern: /не\s+то\s+чтобы\s+я\s+не\s+(?:мог\s+понять|понимал)/gi,
    replace: 'понять-то несложно, да только',
    desc: 'Японское двойное отрицание (...わけではない) адаптировано в русскую речь',
    explanation: 'В русском литературном диалоге конструкция с двойным отрицанием звучит деревянно.',
  },
  {
    id: 'korean_honorific_repetition',
    label: 'Хён! Хён... → Хён! Ты...',
    pattern: /(?<![а-яёa-z0-9])(Хён|Оппа|Сонбэ|Нонна|Унни)!\s+\1,\s+/gi,
    replace: '$1! Ты, ',
    desc: 'Устранён механический корейский повтор титула вместо местоимения «ты»',
    explanation: 'В корейском обращение повторяется из-за отсутствия местоимения второго лица, в русском — естественен переход на «ты».',
  },
  {
    id: 'korean_honorific_repetition_spaced',
    label: 'Хён! Хён правда... → Хён! Ты правда...',
    pattern: /(?<![а-яёa-z0-9])(Хён|Оппа|Сонбэ|Нонна|Унни)!\s+\1\s+/gi,
    replace: '$1! Ты ',
    desc: 'Устранён механический корейский повтор титула в начале предложения',
    explanation: 'Замена второго титула на местоимение «ты».',
  },
];

export const AI_SLOP_PHRASES: Array<{ phrase: string; replacement?: string }> = [
  { phrase: 'стоит отметить, что', replacement: '' },
  { phrase: 'стоит отметить', replacement: '' },
  { phrase: 'важно понимать, что', replacement: '' },
  { phrase: 'важно понимать', replacement: '' },
  { phrase: 'следует отметить, что', replacement: '' },
  { phrase: 'следует отметить', replacement: '' },
  { phrase: 'неудивительно, что', replacement: 'Немудрено, что ' },
  { phrase: 'в конечном итоге', replacement: 'в итоге ' },
  { phrase: 'в заключение', replacement: '' },
  { phrase: 'резюмируя', replacement: '' },
  { phrase: 'подводя итог', replacement: '' },
  { phrase: 'как бы то ни было, но', replacement: 'однако ' },
  { phrase: 'и это было лишь началом', replacement: 'и всё только начиналось' },
  { phrase: 'это была лишь прелюдия', replacement: 'это было лишь предвестием' },
];

/**
 * Repairs LLM sentence-stitching punctuation artifacts (`.,`, `,.`, `!.`, `?.`, `,,`, `..,`, `^—,`).
 * Ported from `Perevod_Ready/src/Perevod/utils/translation_quality.py` (`_PUNCT_ARTIFACT_PATTERNS`).
 */
export function repairPunctuationArtifacts(text: string): string {
  return text
    .replace(/\.,/g, '.')
    .replace(/,\./g, '.')
    .replace(/!\./g, '!')
    .replace(/\?\./g, '?')
    .replace(/,,+/g, ',')
    .replace(/(?<!\.)\.\.,/g, '...')
    .replace(/^(\s*)—,\s*/gm, '$1— ')
    .replace(/[ \t]+([,.;!?])/g, '$1');
}

export interface SanitizeChapterResult {
  cleanedText: string;
  removedLinesCount: number;
  removedSamples: string[];
}

/**
 * Raw Chapter Sanitizer (Q6: C + `dyad-apps/Perevod/sanitizer_patterns.txt` + `mt_check/extract.py`):
 * 1. Converts HTML block tags (`<p>`, `<br>`, `<div>`) into paragraph breaks and strips inline HTML tags.
 * 2. Unescapes HTML entities (`&nbsp;`, `&quot;`, `&mdash;`, `&#39;`, `&amp;`).
 * 3. Removes `TL Note:`, `Editor's Note:`, Patreon/Discord/Ko-fi promos, and scraper watermarks (`Rulate.ru`, `Webnovel`, etc.).
 * 4. Preserves ЛитРПГ `[System: ...]` brackets and `---` scene dividers.
 */
export function sanitizeRawChapterText(rawText: string): SanitizeChapterResult {
  if (!rawText || typeof rawText !== 'string') {
    return { cleanedText: '', removedLinesCount: 0, removedSamples: [] };
  }

  // Step 1: Unpack HTML block tags if the input came from HTML/EPUB/Web scraper
  let text = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<(?:p|div|section|article|h[1-6]|li|blockquote)(?:\s[^>]*)?>/gi, '')
    .replace(/<\/?(?:span|b|strong|i|em|u|a|font|small|sup|sub)(?:\s[^>]*)?>/gi, '');

  // Step 2: Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '...')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&amp;/gi, '&');

  // Step 3: Line-by-line watermark, translator note, and promo filter
  const junkLinePatterns: RegExp[] = [
    /^\s*(?:\[|\(|【)?\s*(?:TL\s*Note|T\/N|TN|Translator'?s?\s*Note|Editor'?s?\s*Note|ED\s*Note|A\/N|Author'?s?\s*Note|Примечание\s+(?:переводчика|редактора|автора)|П\.?\s*П\.?)\s*[:：\-]/i,
    /^\s*(?:Translated|Edited|Proofread)\s+by\s*[:：]/i,
    /(?:patreon\.com|ko-fi\.com|discord\.gg|paypal\.me|boosty\.to)/i,
    /(?:прочитано\s+на\s+rulate\.ru|перевод\s+выполнен\s+с\s+сайта|read\s+latest\s+chapters?\s+at|visit\s+wuxiaworld|webnovel\.com|royalroad\.com)/i,
    /^\s*(?:please\s+support\s+the\s+(?:author|translator)|don't\s+forget\s+to\s+vote\s+power\s+stones)/i,
    /^\s*[=*~_]{4,}\s*$/,
  ];

  const lines = text.split('\n');
  const keptLines: string[] = [];
  const removedSamples: string[] = [];
  let removedLinesCount = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      keptLines.push('');
      continue;
    }

    // Always keep canonical scene divider `---`
    if (trimmed === '---') {
      keptLines.push('---');
      continue;
    }

    const isJunk = junkLinePatterns.some((re) => re.test(trimmed));
    if (isJunk) {
      removedLinesCount++;
      if (removedSamples.length < 10) {
        removedSamples.push(trimmed.slice(0, 120));
      }
      continue;
    }

    keptLines.push(trimmed);
  }

  const cleanedText = keptLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    cleanedText,
    removedLinesCount,
    removedSamples,
  };
}

export interface ImportedEpubChapter {
  number: number;
  titleEng: string;
  engText: string;
  wordCountEng: number;
  href: string;
}

export interface EpubImportResult {
  bookTitle: string;
  author: string;
  chapters: ImportedEpubChapter[];
  totalRemovedJunkLines: number;
}

/**
 * Low-level ZIP Central Directory reader.
 * Extracts raw entries (`{ path, compressionMethod, compressedData }`) from a `.epub` or `.zip` buffer.
 */
function readZipEntriesRaw(zipBytes: Uint8Array): Array<{
  path: string;
  compressionMethod: number;
  compressedData: Uint8Array;
  uncompressedSize: number;
}> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder('utf-8');

  // Locate End of Central Directory (EOCD) signature 0x06054b50 scanning backwards
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, zipBytes.byteLength - 65557);
  for (let i = zipBytes.byteLength - 22; i >= minEocdSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Не найден заголовок EOCD ZIP-архива (файл повреждён или не является .epub/.zip)');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries: Array<{
    path: string;
    compressionMethod: number;
    compressedData: Uint8Array;
    uncompressedSize: number;
  }> = [];

  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries && ptr + 46 <= zipBytes.byteLength; idx++) {
    const sig = view.getUint32(ptr, true);
    if (sig !== 0x02014b50) break;

    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const path = decoder.decode(zipBytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 > zipBytes.byteLength) continue;
    const localSig = view.getUint32(localHeaderOffset, true);
    if (localSig !== 0x04034b50) continue;

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = Math.min(zipBytes.byteLength, dataStart + compressedSize);

    entries.push({
      path,
      compressionMethod,
      compressedData: zipBytes.subarray(dataStart, dataEnd),
      uncompressedSize,
    });
  }

  return entries;
}

/**
 * Inflates raw DEFLATE bytes in Browser (`DecompressionStream('deflate-raw')`) or Node.js.
 */
async function inflateRawBytesAsync(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array(compressed));
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.byteLength;
      }
    }
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  throw new Error('DecompressionStream deflate-raw is not available in this environment');
}

function parseEpubDecodedFileMap(fileMap: Map<string, string>): EpubImportResult {
  // 1. Find OPF path via META-INF/container.xml or fallback scan
  let opfPath = '';
  const containerXml = fileMap.get('META-INF/container.xml') || '';
  const rootfileMatch = containerXml.match(/full-path=["']([^"']+\.opf)["']/i);
  if (rootfileMatch && rootfileMatch[1]) {
    opfPath = rootfileMatch[1];
  } else {
    for (const key of fileMap.keys()) {
      if (key.toLowerCase().endsWith('.opf')) {
        opfPath = key;
        break;
      }
    }
  }

  const opfContent = opfPath ? fileMap.get(opfPath) || '' : '';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const titleMatch = opfContent.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const creatorMatch = opfContent.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const bookTitle = titleMatch ? sanitizeRawChapterText(titleMatch[1]).cleanedText : 'Импортированная новелла';
  const author = creatorMatch ? sanitizeRawChapterText(creatorMatch[1]).cleanedText : 'Unknown Author';

  // 2. Map manifest id -> href
  const manifestMap = new Map<string, string>();
  const itemRegex = /<item\b([^>]+)\/?>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRegex.exec(opfContent)) !== null) {
    const attrs = itemMatch[1];
    const idM = attrs.match(/\bid=["']([^"']+)["']/i);
    const hrefM = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (idM && hrefM) {
      manifestMap.set(idM[1], hrefM[1]);
    }
  }

  // 3. Collect ordered spine hrefs
  const orderedHrefs: string[] = [];
  const itemrefRegex = /<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*\/?>/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = itemrefRegex.exec(opfContent)) !== null) {
    const href = manifestMap.get(refMatch[1]);
    if (href) {
      orderedHrefs.push(href);
    }
  }

  // Fallback if spine is empty: take all .xhtml / .html files sorted naturally
  if (orderedHrefs.length === 0) {
    for (const key of Array.from(fileMap.keys()).sort()) {
      if (/\.(?:xhtml|html|htm)$/i.test(key)) {
        orderedHrefs.push(key);
      }
    }
  }

  const chapters: ImportedEpubChapter[] = [];
  let totalRemovedJunkLines = 0;

  for (const rawHref of orderedHrefs) {
    const cleanHref = rawHref.split('#')[0];
    // Skip navigation / cover / titlepage files
    if (/(?:^|\/)(?:nav|toc|titlepage|cover)\.(?:xhtml|html|htm)$/i.test(cleanHref)) {
      continue;
    }

    const fullPath = fileMap.has(opfDir + cleanHref) ? opfDir + cleanHref : cleanHref;
    const rawHtml = fileMap.get(fullPath);
    if (!rawHtml) continue;

    // Extract heading from <h1>, <h2>, or <title>
    const hMatch =
      rawHtml.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i) ||
      rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const extractedTitle = hMatch
      ? sanitizeRawChapterText(hMatch[1]).cleanedText.replace(/\n+/g, ' ').trim()
      : '';

    // Strip <head>...</head>, <style>...</style>, <nav>...</nav>, and first <h1>/<h2> if already extracted as title
    let bodyHtml = rawHtml
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '');

    if (hMatch && /<h[12]/i.test(hMatch[0])) {
      bodyHtml = bodyHtml.replace(hMatch[0], '');
    }

    const sanitized = sanitizeRawChapterText(bodyHtml);
    totalRemovedJunkLines += sanitized.removedLinesCount;

    if (!sanitized.cleanedText || sanitized.cleanedText.length < 15) continue;

    const chapNum = chapters.length + 1;
    const titleEng = extractedTitle || `Chapter ${chapNum}`;
    const wordCountEng = sanitized.cleanedText.split(/\s+/).filter(Boolean).length;

    chapters.push({
      number: chapNum,
      titleEng,
      engText: sanitized.cleanedText,
      wordCountEng,
      href: fullPath,
    });
  }

  return {
    bookTitle,
    author,
    chapters,
    totalRemovedJunkLines,
  };
}

/**
 * Unpacks an `.epub` binary buffer into clean chapters synchronously (for STORED EPUBs)
 * or asynchronously via `parseEpubArchiveToChaptersAsync` (for STORED + DEFLATE EPUBs).
 */
export function parseEpubArchiveToChapters(epubBytes: Uint8Array): EpubImportResult {
  const entries = readZipEntriesRaw(epubBytes);
  const decoder = new TextDecoder('utf-8');
  const fileMap = new Map<string, string>();

  for (const entry of entries) {
    if (entry.compressionMethod === 0) {
      fileMap.set(entry.path, decoder.decode(entry.compressedData));
    }
  }

  return parseEpubDecodedFileMap(fileMap);
}

export async function parseEpubArchiveToChaptersAsync(epubBytes: Uint8Array): Promise<EpubImportResult> {
  const entries = readZipEntriesRaw(epubBytes);
  const decoder = new TextDecoder('utf-8');
  const fileMap = new Map<string, string>();

  for (const entry of entries) {
    if (entry.compressionMethod === 0) {
      fileMap.set(entry.path, decoder.decode(entry.compressedData));
    } else if (entry.compressionMethod === 8) {
      try {
        const inflated = await inflateRawBytesAsync(entry.compressedData);
        fileMap.set(entry.path, decoder.decode(inflated));
      } catch {
        // Skip unreadable entry
      }
    }
  }

  return parseEpubDecodedFileMap(fileMap);
}

/**
 * Pass 2 Surgical Patch Item (`Perevod_Ready/src/Perevod/prompts/refine_system.txt` & `refine.py`).
 */
export interface SurgicalPatchItem {
  find: string;
  replace: string;
  reason?: string;
  kind?: 'glossary' | 'number' | 'calque' | 'grammar' | 'style' | string;
  all?: boolean;
  patchClass?: 'A_mistranslation' | 'B_omission_or_defect' | 'C_calque_or_slop' | 'D_inconsistency';
  provenance?: {
    source: 'pass2_critic' | 'self_repair' | 'manual_editor' | 'auto_repair';
    timestamp?: number;
    ruleId?: string;
  };
}

export interface SurgicalPatchResult {
  patchedText: string;
  appliedCount: number;
  skippedCount: number;
  appliedLog: Array<{
    find: string;
    replace: string;
    reason: string;
    count: number;
    patchClass?: 'A_mistranslation' | 'B_omission_or_defect' | 'C_calque_or_slop' | 'D_inconsistency';
    provenance?: unknown;
  }>;
  skippedLog: Array<{
    find: string;
    status:
      | 'noop'
      | 'not_found'
      | 'ambiguous_match'
      | 'unsafe_number_drop'
      | 'unsafe_glossary_erasure'
      | 'unsafe_tag_imbalance';
  }>;
}

/**
 * Mechanical Gate: Applies Pass 2 Literary Critic surgical patches
 * in reverse offset order (`b.start - a.start`) with multi-layer verification:
 * 1. Number preservation guard (`unsafe_number_drop`)
 * 2. Add-Only Canon Protection guard (`unsafe_glossary_erasure`)
 * 3. Tag and bracket balance guard (`unsafe_tag_imbalance`)
 * 4. Provenance and Patch Classification (A/B/C/D).
 */
export function applySurgicalPatches(
  text: string,
  patches: SurgicalPatchItem[],
  glossary?: CanonicalGlossary
): SurgicalPatchResult {
  if (!text || !Array.isArray(patches) || patches.length === 0) {
    return {
      patchedText: text || '',
      appliedCount: 0,
      skippedCount: 0,
      appliedLog: [],
      skippedLog: [],
    };
  }

  // Pre-collect Russian canonical terms for Add-Only Canon Protection (with inflected forms)
  const canonTermGroups: Array<{ base: string; forms: string[] }> = [];
  if (glossary) {
    (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
      Object.entries(glossary[cat] || {}).forEach(([eng, rus]) => {
        const raw = (rus || '').trim();
        const unquoted = raw.replace(/^[«"]|[»"]$/g, '').trim();
        if (unquoted.length >= 3) {
          const formsSet = new Set<string>();
          formsSet.add(raw.toLowerCase());
          formsSet.add(unquoted.toLowerCase());
          try {
            const inflected = buildInflectedRussianForms(unquoted, { category: cat });
            for (const f of inflected) {
              const cf = f.form.replace(/^[«"]|[»"]$/g, '').trim().toLowerCase();
              if (cf.length >= 3) {
                formsSet.add(cf);
              }
            }
          } catch {
            // fallback to base terms
          }
          canonTermGroups.push({ base: unquoted, forms: Array.from(formsSet) });
        }
      });
    });
  }

  let currentText = text;
  const appliedLog: Array<{
    find: string;
    replace: string;
    reason: string;
    count: number;
    patchClass?: 'A_mistranslation' | 'B_omission_or_defect' | 'C_calque_or_slop' | 'D_inconsistency';
    provenance?: unknown;
  }> = [];
  const skippedLog: Array<{
    find: string;
    status:
      | 'noop'
      | 'not_found'
      | 'ambiguous_match'
      | 'unsafe_number_drop'
      | 'unsafe_glossary_erasure'
      | 'unsafe_tag_imbalance';
  }> = [];

  for (const patch of patches) {
    const findStr = (patch.find || '').trim();
    const replaceStr = (patch.replace ?? '').trim();
    if (!findStr || findStr === replaceStr) {
      skippedLog.push({ find: findStr, status: 'noop' });
      continue;
    }

    // Safety guard 1: never allow a style patch to silently delete an Arabic number present in `find`
    const numsInFind = findStr.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || [];
    const numsInReplace = new Set(replaceStr.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []);
    if (numsInFind.some((n) => !numsInReplace.has(n))) {
      skippedLog.push({ find: findStr, status: 'unsafe_number_drop' });
      continue;
    }

    // Safety guard 2: Add-Only Canon Protection (unsafe_glossary_erasure)
    if (canonTermGroups.length > 0) {
      const findLower = findStr.toLowerCase();
      const replaceLower = replaceStr.toLowerCase();
      let hasErasedCanon = false;

      for (const group of canonTermGroups) {
        const matchedFormInFind = group.forms.find((form) => {
          const esc = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`(?<![а-яёА-ЯЁa-zA-Z0-9])${esc}(?![а-яёА-ЯЁa-zA-Z0-9])`, 'i');
          return re.test(findLower);
        });

        if (matchedFormInFind) {
          const matchedFormInReplace = group.forms.some((form) => {
            const esc = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(?<![а-яёА-ЯЁa-zA-Z0-9])${esc}(?![а-яёА-ЯЁa-zA-Z0-9])`, 'i');
            return re.test(replaceLower);
          });

          if (!matchedFormInReplace) {
            hasErasedCanon = true;
            break;
          }
        }
      }

      if (hasErasedCanon) {
        skippedLog.push({ find: findStr, status: 'unsafe_glossary_erasure' });
        continue;
      }
    }

    // Safety guard 3: Tag and bracket balance guard (unsafe_tag_imbalance)
    const openSq = (replaceStr.match(/\[/g) || []).length;
    const closeSq = (replaceStr.match(/\]/g) || []).length;
    const openGui = (replaceStr.match(/«/g) || []).length;
    const closeGui = (replaceStr.match(/»/g) || []).length;
    const openParen = (replaceStr.match(/\(/g) || []).length;
    const closeParen = (replaceStr.match(/\)/g) || []).length;
    const openI = (replaceStr.match(/<i>/gi) || []).length;
    const closeI = (replaceStr.match(/<\/i>/gi) || []).length;
    const openB = (replaceStr.match(/<b>/gi) || []).length;
    const closeB = (replaceStr.match(/<\/b>/gi) || []).length;

    if (
      openSq !== closeSq ||
      openGui !== closeGui ||
      openParen !== closeParen ||
      openI !== closeI ||
      openB !== closeB
    ) {
      skippedLog.push({ find: findStr, status: 'unsafe_tag_imbalance' });
      continue;
    }

    // Locate all occurrences in `currentText`
    const spans: Array<{ start: number; end: number }> = [];
    let searchFrom = 0;
    while (searchFrom <= currentText.length - findStr.length) {
      const idx = currentText.indexOf(findStr, searchFrom);
      if (idx === -1) break;
      spans.push({ start: idx, end: idx + findStr.length });
      searchFrom = idx + findStr.length;
    }

    if (spans.length === 0) {
      skippedLog.push({ find: findStr, status: 'not_found' });
      continue;
    }

    if (spans.length > 1 && !patch.all) {
      skippedLog.push({ find: findStr, status: 'ambiguous_match' });
      continue;
    }

    // Apply in reverse offset order so earlier indices never shift
    const sortedSpans = [...spans].sort((a, b) => b.start - a.start);
    for (const span of sortedSpans) {
      currentText =
        currentText.slice(0, span.start) + replaceStr + currentText.slice(span.end);
    }

    const patchClass =
      patch.patchClass ||
      (/mistranslation|неверн|ошибк/i.test(patch.reason || patch.kind || '')
        ? 'A_mistranslation'
        : /omission|defect|пропуск|потер/i.test(patch.reason || patch.kind || '')
        ? 'B_omission_or_defect'
        : /inconsistency|противореч|термин/i.test(patch.reason || patch.kind || '')
        ? 'D_inconsistency'
        : 'C_calque_or_slop');

    appliedLog.push({
      find: findStr,
      replace: replaceStr,
      reason: patch.reason || patch.kind || 'Литературная правка Pass 2',
      count: sortedSpans.length,
      patchClass,
      provenance: patch.provenance || { source: 'pass2_critic', timestamp: Date.now() },
    });
  }

  return {
    patchedText: currentText,
    appliedCount: appliedLog.length,
    skippedCount: skippedLog.length,
    appliedLog,
    skippedLog,
  };
}

export interface ChaptersZipArchivePackage {
  filename: string;
  bytes: Uint8Array;
  byteSize: number;
  chapterCount: number;
  fileList: string[];
}

/**
 * Compiles translated chapters into a `.zip` archive where each chapter is a standalone
 * UTF-8 LF `.txt` or `.md` file (`Chapter_0001.txt`, `Chapter_0002.txt`, ...) for Ranobelib / Author.Today / Boosty (`Q11: B`).
 */
export function buildChaptersZipArchive(
  novelName: string,
  chapters: Array<{ number: number; titleRus: string; contentRus: string }>,
  format: 'txt' | 'md' = 'txt'
): ChaptersZipArchivePackage {
  const encoder = new TextEncoder();
  const sorted = [...chapters].sort((a, b) => a.number - b.number);
  const ext = format === 'md' ? 'md' : 'txt';
  const files: Array<{ path: string; data: Uint8Array }> = [];
  const fileList: string[] = [];

  for (const ch of sorted) {
    const padded = String(ch.number).padStart(4, '0');
    const cleanHeading = (ch.titleRus || `Глава ${ch.number}`).replace(/\r\n/g, '\n').trim();
    const cleanBody = (ch.contentRus || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const fileContent =
      format === 'md'
        ? `# ${cleanHeading}\n\n${cleanBody}\n`
        : `${cleanHeading}\n\n${cleanBody}\n`;

    const filePath = `Chapter_${padded}.${ext}`;
    fileList.push(filePath);
    files.push({
      path: filePath,
      data: encoder.encode(fileContent),
    });
  }

  const manifestJson = JSON.stringify(
    {
      novelName,
      exportedAt: new Date().toISOString(),
      chapterCount: sorted.length,
      format: ext,
      files: fileList,
    },
    null,
    2
  );
  files.push({
    path: '00_MANIFEST.json',
    data: encoder.encode(manifestJson),
  });

  const bytes = createStoredZipArchive(files);
  const firstNum = sorted[0]?.number ?? 1;
  const lastNum = sorted[sorted.length - 1]?.number ?? 1;
  const slug = novelName
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, '_')
    .replace(/^_|_$/g, '');

  return {
    filename: `${slug || 'Novel'}_Chapters_${firstNum}_${lastNum}_${ext.toUpperCase()}.zip`,
    bytes,
    byteSize: bytes.byteLength,
    chapterCount: sorted.length,
    fileList,
  };
}

export type GikunCategory =
  | 'reading_aid'
  | 'bouten'
  | 'nomenclature'
  | 'litrpg_term'
  | 'deictic'
  | 'subtext';

export interface RubyGikunParseItem {
  base: string;
  ruby: string;
  category: GikunCategory;
  renderedTag: string;
}

export interface RubyGikunParseResult {
  parsedText: string;
  foundCount: number;
  items: RubyGikunParseItem[];
}

/**
 * Step 0.1: Deterministic Japanese Furigana, Gikun, and Bouten AST Pre-Parser.
 * Classifies Japanese ruby annotations into 6 linguistic types before Pass 1 translation
 * to eliminate bracketed artifacts in dialogue and enable natural Russian stylistic fusion.
 */
export function parseRubyAndGikunMarkup(sourceText: string): RubyGikunParseResult {
  if (!sourceText || typeof sourceText !== 'string') {
    return { parsedText: '', foundCount: 0, items: [] };
  }

  const items: RubyGikunParseItem[] = [];
  let working = sourceText;

  // 1. Bouten standalone notation: 《《text》》
  working = working.replace(/《《([^》\n]+)》》/g, (_, emphText) => {
    const renderedTag = `<emph text="${emphText}"/>`;
    items.push({
      base: emphText,
      ruby: 'bouten',
      category: 'bouten',
      renderedTag,
    });
    return renderedTag;
  });

  // 2. HTML <ruby> tags: <ruby><rb>Base</rb><rt>Ruby</rt></ruby> or <ruby>Base<rt>Ruby</rt></ruby>
  working = working.replace(
    /<ruby>(?:<rb>)?([^<]+)(?:<\/rb>)?<rt>([^<]+)<\/rt><\/ruby>/gi,
    (_, base, ruby) => {
      const parsed = classifyRubyItem(base.trim(), ruby.trim());
      items.push(parsed);
      return parsed.renderedTag;
    }
  );

  // 3. Syosetu / Kakuyomu ruby: ｜Base《Ruby》 or Base《Ruby》
  working = working.replace(
    /(?:｜([^\s《\n]+)|([一-龯々〆ヵヶa-zA-Z0-9]+))《([^》\n]+)》/g,
    (_, base1, base2, ruby) => {
      const base = (base1 || base2 || '').trim();
      const parsed = classifyRubyItem(base, (ruby || '').trim());
      items.push(parsed);
      return parsed.renderedTag;
    }
  );

  // 4. Kanji + Parentheses notation: 漢字(ふりがな/カタカナ)
  working = working.replace(
    /([一-龯々〆ヵヶ]{1,8})\(([ぁ-んァ-ヶーa-zA-Z0-9・•●]+)\)/g,
    (_, base, ruby) => {
      const parsed = classifyRubyItem(base.trim(), ruby.trim());
      items.push(parsed);
      return parsed.renderedTag;
    }
  );

  return {
    parsedText: working,
    foundCount: items.length,
    items,
  };
}

function classifyRubyItem(base: string, ruby: string): RubyGikunParseItem {
  // A. Bouten: ruby is a bullet/dot (・, •, ●)
  if (/^[・•●]+$/.test(ruby)) {
    const renderedTag = `<emph text="${base}"/>`;
    return { base, ruby, category: 'bouten', renderedTag };
  }

  // B. Deictic / Alias Gikun: pronoun in ruby refering to noun in base
  const deicticPattern = /^(?:ここ|ぼくたち|僕たち|わたし|私|あいつ|そこ|あれ|オレたち|俺たち|あんた|お前|きみ|君)$/;
  if (deicticPattern.test(ruby)) {
    const renderedTag = `<gikun type="deictic" spoken="${ruby}" referent="${base}"/>`;
    return { base, ruby, category: 'deictic', renderedTag };
  }

  // C. LitRPG Game Gikun: terms like クラス, スキル, ステータス, レベル, 職業, 技能
  const litrpgPattern = /クラス|スキル|ステータス|レベル|職業|技能|魔法|属性|ダンジョン/;
  if (litrpgPattern.test(ruby) || litrpgPattern.test(base)) {
    const renderedTag = `<gikun type="litrpg_term" spoken="${ruby}" meaning="${base}"/>`;
    return { base, ruby, category: 'litrpg_term', renderedTag };
  }

  // C2. Subtext Slang Gikun: terms like 本気《マジ》, 強敵《とも》, リアル, ガチ, ウソ
  const subtextSlangPattern = /^(?:マジ|ガチ|リアル|ウソ|とも|やつ|ヤツ|オトコ|オンナ)$/;
  if (subtextSlangPattern.test(ruby)) {
    const renderedTag = `<gikun type="subtext" spoken="${ruby}" hidden="${base}"/>`;
    return { base, ruby, category: 'subtext', renderedTag };
  }

  // D. Nomenclature / Chuunibyou Gikun: Kanji base + Katakana loanword
  const hasKanji = /[一-龯々〆ヵヶ]/.test(base);
  const isKatakana = /^[ァ-ヶー・\s]+$/.test(ruby);
  if (hasKanji && isKatakana) {
    const renderedTag = `<gikun type="nomenclature" spoken="${ruby}" meaning="${base}"/>`;
    return { base, ruby, category: 'nomenclature', renderedTag };
  }

  // E. Standard phonetic reading aid: pure Hiragana matching phonetic helper
  const isHiragana = /^[ぁ-んー\s]+$/.test(ruby);
  if (hasKanji && isHiragana && ruby.length <= base.length * 4) {
    return { base, ruby, category: 'reading_aid', renderedTag: base };
  }

  // F. Synonymous / Subtext Gikun: oxymoronic or contextual subtext
  const renderedTag = `<gikun type="subtext" spoken="${ruby}" hidden="${base}"/>`;
  return { base, ruby, category: 'subtext', renderedTag };
}

export interface KoreanParagraphNormalizeResult {
  normalizedText: string;
  groupedParagraphCount: number;
  originalLineCount: number;
  paragraphIndexMap: number[]; // maps each new paragraph index to original line index
}

/**
 * Normalizes fragmented Korean single-sentence mobile web-novel paragraphs into cohesive narrative units.
 * Preserves Dialogue lines (—, ", 「), scene dividers (---, ***), and system status boxes ([...]).
 */
export function normalizeKoreanOneLineParagraphs(rawText: string): KoreanParagraphNormalizeResult {
  if (!rawText || typeof rawText !== 'string') {
    return { normalizedText: '', groupedParagraphCount: 0, originalLineCount: 0, paragraphIndexMap: [] };
  }

  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const normalizedParagraphs: string[] = [];
  const paragraphIndexMap: number[] = [];

  let pendingNarrative: string[] = [];
  let pendingStartIndex = -1;

  const flushNarrative = () => {
    if (pendingNarrative.length > 0) {
      normalizedParagraphs.push(pendingNarrative.join(' '));
      paragraphIndexMap.push(pendingStartIndex >= 0 ? pendingStartIndex : 0);
      pendingNarrative = [];
      pendingStartIndex = -1;
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) {
      flushNarrative();
      continue;
    }

    const isDivider = line === '---' || line === '***' || line === '◇◇◇';
    const isSystemFrame =
      (line.startsWith('[') && line.endsWith(']')) ||
      (line.startsWith('【') && line.endsWith('】'));
    const isDialogue =
      /^[—\-"“'«‘「『]/.test(line) ||
      (line.endsWith('다."') || line.endsWith('다.’') || line.endsWith('요."'));

    if (isDivider || isSystemFrame || isDialogue) {
      flushNarrative();
      normalizedParagraphs.push(line);
      paragraphIndexMap.push(idx);
    } else {
      if (pendingStartIndex === -1) {
        pendingStartIndex = idx;
      }
      pendingNarrative.push(line);
      // Group up to 3 sentences or ~220 characters
      if (pendingNarrative.length >= 3 || pendingNarrative.join(' ').length >= 220) {
        flushNarrative();
      }
    }
  }

  flushNarrative();

  return {
    normalizedText: normalizedParagraphs.join('\n\n'),
    groupedParagraphCount: normalizedParagraphs.length,
    originalLineCount: lines.length,
    paragraphIndexMap,
  };
}

export interface ChapterChunkItem {
  chunkIndex: number;
  totalChunks: number;
  text: string;
  readOnlyPrecedingContext: string;
  readOnlyLookahead: string;
  startParagraphIndex: number;
  endParagraphIndex: number;
}

/**
 * Dialogue- and Scene-Aware Sliding Window Chunker (SceneDialogueChunker).
 * Enforces Dialogue Lock (never split mid-conversation), Frame Lock (never split [...] or dividers),
 * and provisions read-only preceding context + lookahead sentences.
 */
export function chunkChapterWithSceneAndDialogueLocks(
  chapterText: string,
  options?: {
    maxTokens?: number; // default ~1800 words/tokens
    precedingContextParagraphs?: number; // default 3
    lookaheadSentences?: number; // default 2
  }
): ChapterChunkItem[] {
  if (!chapterText || !chapterText.trim()) {
    return [];
  }

  const maxTokens = options?.maxTokens || 1800;
  const contextCount = options?.precedingContextParagraphs || 3;
  const lookaheadCount = options?.lookaheadSentences || 2;

  const paragraphs = chapterText
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  // Approximate tokens by word count
  const estimateTokens = (text: string) => Math.ceil((text.match(/\S+/g) || []).length * 1.3);

  const chunks: Array<{
    paragraphs: string[];
    startIdx: number;
    endIdx: number;
  }> = [];

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let currentStart = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const pTokens = estimateTokens(p);

    const isDialogue = /^[—\-"“'«‘「『]/.test(p);
    const nextP = i + 1 < paragraphs.length ? paragraphs[i + 1] : undefined;
    const nextIsDialogue = nextP ? /^[—\-"“'«‘「『]/.test(nextP) : false;
    const isDivider = p === '---' || p === '***' || p === '◇◇◇';
    const isSystemFrame =
      (p.startsWith('[') && p.endsWith(']')) ||
      (p.startsWith('【') && p.endsWith('】'));

    currentChunk.push(p);
    currentTokens += pTokens;

    // Check if we should split:
    // 1. Exceeded maxTokens
    // 2. NOT in Dialogue Lock (if this is dialogue and next is dialogue, keep together)
    // 3. NOT in Frame Lock
    const canSplit = !(isDialogue && nextIsDialogue) && !isSystemFrame && !isDivider;

    if (currentTokens >= maxTokens && canSplit && i < paragraphs.length - 1) {
      chunks.push({
        paragraphs: [...currentChunk],
        startIdx: currentStart,
        endIdx: i,
      });
      currentChunk = [];
      currentTokens = 0;
      currentStart = i + 1;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      paragraphs: [...currentChunk],
      startIdx: currentStart,
      endIdx: paragraphs.length - 1,
    });
  }

  // Build final ChapterChunkItem with preceding context & lookahead
  return chunks.map((c, cIdx) => {
    // Preceding context from previous chunk
    let precedingContext = '';
    if (cIdx > 0) {
      const prevChunkParas = chunks[cIdx - 1].paragraphs;
      const sliceCount = Math.min(contextCount, prevChunkParas.length);
      precedingContext = prevChunkParas.slice(-sliceCount).join('\n\n');
    }

    // Lookahead sentences from next chunk
    let lookahead = '';
    if (cIdx < chunks.length - 1) {
      const nextChunkFirstParas = chunks[cIdx + 1].paragraphs.slice(0, 2).join(' ');
      const sentences = nextChunkFirstParas
        .split(/(?<=[.!?。！？])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      lookahead = sentences.slice(0, lookaheadCount).join(' ');
    }

    return {
      chunkIndex: cIdx + 1,
      totalChunks: chunks.length,
      text: c.paragraphs.join('\n\n'),
      readOnlyPrecedingContext: precedingContext
        ? `[READ_ONLY_PRECEDING_CONTEXT - DO NOT TRANSLATE]:\n${precedingContext}`
        : '',
      readOnlyLookahead: lookahead
        ? `[READ_ONLY_LOOKAHEAD - DO NOT TRANSLATE]:\n${lookahead}`
        : '',
      startParagraphIndex: c.startIdx,
      endParagraphIndex: c.endIdx,
    };
  });
}

// Stage 1: Deep Chapter Postprocessing & Verification Pipeline
export * from './chapter-verifier.ts';

// Stage 2: Universal LLM Inference Port & Adapters
export * from './llm-inference-port.ts';

// Stage 3: Morphological Canon Glossary Vault
export {
  buildInflectedRussianForms,
  splitCompoundRussianTerm,
  buildSocialRegisterPromptBlock,
  deriveDefaultSpeechVector,
  buildCharacterVoicePromptBlock,
  lintGlossaryVault,
  computeChapterGlossaryCoverage,
  approveScoutedTermInVault,
  autoApprovePendingTermsInVault,
  upsertCanonTermInVault,
  removeCanonTermFromVault,
  applyCanonRippleToNovel,
  type InflectedFormItem,
  type SplitCompoundResult,
  type SocialRegisterEdge,
  type CharacterVoiceCardV3,
  type GlossaryLintIssue,
  type CanonVaultState,
  type ChapterGlossaryCoverageResult,
} from './canon-glossary-vault.ts';

// Stage 4: 5-Phase Batch Pipeline Orchestration Engine
export * from './pipeline-run-engine.ts';

// Stage 5: Project Repository, Hydration Guard & Bundle Serialization
export * from './storage-idb.ts';
