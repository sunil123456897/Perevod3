/**
 * Pure TypeScript implementation of the Universal Web-Novel & Xianxia Deterministic QA Linter,
 * Configurable Rule Profiles, Character Gender & Voice/Politeness Validator, Rolling Chapter Memory,
 * 1:1 Paragraph Alignment & Drift Detector, Proximity Tautology Radar, Retroactive Canon Ripple Engine,
 * Word-Level Inline Diff, Bulk Chapter Parser, Rulate LF Exporter, and Split-Chapter Merger.
 * Self-contained module testable via `node --test`.
 */

import { buildInflectedRussianForms } from './russian-morphology.ts';
import type {
  GlossaryCategory,
  GrammaticalGender,
  CharacterSpeechVector,
  GlossaryTermMeta,
  CanonicalGlossary,
  ScoutedTerm,
  GenrePreset,
  ProseTone,
  LintSeverity,
  LintRuleId,
  LintIssue,
  LintReport,
  HeroStateLedger,
  ForwardFallingQuestion,
  LlmProviderType,
  LlmProviderConfig,
  GeminiThinkingLevel,
  ChapterQaSummary,
  SocialRegisterEdge,
} from './pipeline-types.ts';

export type {
  GlossaryCategory,
  GrammaticalGender,
  CharacterSpeechVector,
  GlossaryTermMeta,
  CanonicalGlossary,
  ScoutedTerm,
  GenrePreset,
  ProseTone,
  LintSeverity,
  LintRuleId,
  LintIssue,
  LintReport,
  HeroStateLedger,
  ForwardFallingQuestion,
  LlmProviderType,
  LlmProviderConfig,
  GeminiThinkingLevel,
  ChapterQaSummary,
  SocialRegisterEdge,
} from './pipeline-types.ts';

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

export interface LinterOptions {
  enabledRuleIds?: LintRuleId[];
  glossaryMeta?: Record<string, GlossaryTermMeta>;
  socialEdges?: SocialRegisterEdge[];
  dialogueRegisters?: Array<{ lineIndex?: number; speaker?: string; pronounMode: 'ты' | 'Вы' }>;
  analysisContext?: ChapterAnalysisContext;
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
  'сказал|подумал|ответил|спросил|воскликнул|прошептал|пробормотал|посмотрел|взглянул|шагнул|улыбнулся|нахмурился|кивнул|почувствовал|ощутил|решил|понял|заметил|качнул|вздохнул|усмехнулся|замер|обернулся|повернулся|поднял|опустил|взял|открыл|закрыл|произнес|произнёс|добавил|продолжил|возразил|бросил|выдохнул|сделал';

const REV_INTRANSITIVE_OR_SPEECH_VERBS =
  'сказал|подумал|ответил|спросил|воскликнул|прошептал|пробормотал|посмотрел|взглянул|шагнул|улыбнулся|нахмурился|кивнул|качнул|вздохнул|усмехнулся|замер|обернулся|повернулся|произнес|произнёс|добавил|продолжил|возразил|бросил|выдохнул';

const INDECLINABLE_FEM_NAMES = ['Айрам', 'Эстер', 'Фейт', 'Мей', 'Элизабет'];

const FEM_SUBJECT_BOUNDARY =
  '((?:^|[\\n.!?:;,…»"(\\[—]|(?<![а-яёА-ЯЁ-])(?:а|но|и|зато|однако|когда|пока|хотя|что|чтобы|ведь|где|как|если|словно|будто|точно|тогда|теперь|потом|затем|вдруг|внезапно|тут|лишь|только|даже|сама|эта|та|одна|леди|госпожа|принцесса|королева|сестра)(?![а-яёА-ЯЁ]))[ \\t]*(?:—[ \\t]+)?)';

const FEM_ADVERB_CHAIN =
  '(?:(?:не|так|очень|ещё|еще|уже|опять|снова|лишь|только|тут\\s+же|просто|даже|вдруг|внезапно|едва|чуть|нехотя|молча|тихо|громко|холодно|мрачно|резко|сухо|мягко|медленно|удивлённо|недоверчиво|внимательно|пристально|осторожно|быстро|слегка|устало|тяжело|горько|слабо|печально|радостно|решительно|спокойно|небрежно|нервно|судорожно)\\s+){0,2}';

const COPULA_VERB_PATTERN =
  '(?:(?:не\\s+)?(?:был|была|было|были|(?:стал|стала|стало|стали)(?!\\s+бы(?![а-яёА-ЯЁ]))|являлся|являлась|являлись|представлял|представляла|представляло|представляли))';

const ARTIFICIAL_COPULA_DASH_RE = new RegExp(
  `(?<=[а-яёА-ЯЁ0-9])\\s+(?:—|–|-)\\s+(${COPULA_VERB_PATTERN})(?![а-яёА-ЯЁ])`,
  'i'
);

const ARTIFICIAL_COPULA_DASH_GLOBAL_RE = new RegExp(
  `(?<=[а-яёА-ЯЁ0-9])\\s+(?:—|–|-)\\s+(${COPULA_VERB_PATTERN})(?![а-яёА-ЯЁ])`,
  'gi'
);

function toFemininePastVerb(verb: string): string {
  const lower = verb.toLowerCase();
  if (lower.endsWith('ся')) {
    return `${verb.slice(0, -2)}ась`;
  }
  if (lower === 'замер') {
    return `${verb}ла`;
  }
  return `${verb}а`;
}

interface CompiledFemGenderMatcher {
  name: string;
  femPattern: RegExp;
  revAttributionPattern: RegExp;
  revClauseStartPattern: RegExp;
  multiVerbPattern: RegExp;
}

const FEM_MATCHER_CACHE = new Map<string, CompiledFemGenderMatcher>();

function getCompiledFemGenderMatcher(femName: string): CompiledFemGenderMatcher {
  const cached = FEM_MATCHER_CACHE.get(femName);
  if (cached) return cached;

  const escapedName = femName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher: CompiledFemGenderMatcher = {
    name: femName,
    femPattern: new RegExp(
      `${FEM_SUBJECT_BOUNDARY}(${escapedName}[ \\t]+${FEM_ADVERB_CHAIN})(${COMMON_PAST_VERBS})(?![а-яё])`,
      'gi'
    ),
    revAttributionPattern: new RegExp(
      `([,!?…»"][ \\t]*—[ \\t]*${FEM_ADVERB_CHAIN})(${COMMON_PAST_VERBS})([ \\t]+${escapedName})(?![а-яё])`,
      'gi'
    ),
    revClauseStartPattern: new RegExp(
      `((?:^|[.!?\\n…:;][ \\t]*|[ \\t]*—[ \\t]+)(?:(?:[Аа]|[Нн]о|[Ии]|[Зз]ато|[Оо]днако|[Тт]ут|[Вв]друг|[Зз]атем|[Пп]отом|[Нн]аконец)[ \\t]+)?(?:не[ \\t]+)?)(${REV_INTRANSITIVE_OR_SPEECH_VERBS})([ \\t]+${escapedName})(?![а-яё])`,
      'gi'
    ),
    multiVerbPattern: new RegExp(
      `${FEM_SUBJECT_BOUNDARY}(${escapedName}[ \\t]+(?:(?![.!?\\n;]).){1,120}?[ \\t]+и[ \\t]+)(${COMMON_PAST_VERBS})(?![а-яё])`,
      'gi'
    ),
  };

  if (FEM_MATCHER_CACHE.size > 512) {
    FEM_MATCHER_CACHE.clear();
  }
  FEM_MATCHER_CACHE.set(femName, matcher);
  return matcher;
}

const MULTI_VERB_NEW_CLAUSE_RE =
  /(?:,\s*(?:а|но|однако|зато|хотя|когда|пока|что|чтобы|ведь|где|как|если)(?![а-яё])|,\s*и\s+(?:он|она|они|брат|отец|враг|мужчина|юноша|старик|король|принц|мастер|старейшина|[А-ЯЁ][а-яё]{2,})(?![а-яё])|[,;]\s*(?:он|брат|отец|враг|мужчина|юноша|старик|король|принц|мастер|старейшина)(?![а-яё]))/i;

function applyFemaleGenderAgreement(
  input: string,
  matcher: CompiledFemGenderMatcher,
  includeMultiClause: boolean
): { text: string; changed: boolean } {
  let text = input;
  let changed = false;

  const replaceWithCallback = (re: RegExp, fn: (...args: string[]) => string) => {
    re.lastIndex = 0;
    const next = text.replace(re, fn);
    if (next !== text) {
      text = next;
      changed = true;
    }
  };

  replaceWithCallback(matcher.femPattern, (_m, lead: string, prefix: string, verb: string) => {
    return `${lead}${prefix}${toFemininePastVerb(verb)}`;
  });

  replaceWithCallback(matcher.revAttributionPattern, (_m, lead: string, verb: string, suffix: string) => {
    return `${lead}${toFemininePastVerb(verb)}${suffix}`;
  });

  replaceWithCallback(matcher.revClauseStartPattern, (_m, lead: string, verb: string, suffix: string) => {
    return `${lead}${toFemininePastVerb(verb)}${suffix}`;
  });

  if (includeMultiClause) {
    replaceWithCallback(matcher.multiVerbPattern, (full: string, lead: string, body: string, verb2: string) => {
      if (MULTI_VERB_NEW_CLAUSE_RE.test(body)) {
        return full;
      }
      return `${lead}${body}${toFemininePastVerb(verb2)}`;
    });
  }

  return { text, changed };
}

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
  посмотр: 'взглянул, перевёл взгляд, воззрился',
  холодн: 'ледяной, студёный, бесстрастный',
  огромн: 'исполинский, громадный, массивный',
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

const RUS_NUMBER_WORD_PATTERNS: Array<{ digit: string; regex: RegExp }> = [
  {
    digit: '1',
    regex:
      /(?<![а-яёa-z])(?:один|одна|одно|одну|одного|одной|одним|одних|перв(?:ый|ого|ому|ым|ом|ая|ой|ую|ое|ые|ых|ыми))(?![а-яёa-z])/i,
  },
  {
    digit: '2',
    regex:
      /(?<![а-яёa-z])(?:два|две|двух|двум|двумя|двое|двоих|двоим|двоими|втор(?:ой|ого|ому|ым|ом|ая|ую|ое|ые|ых|ыми)|дважды|оба|обе|обоих|обеих)(?![а-яёa-z])/i,
  },
  {
    digit: '3',
    regex:
      /(?<![а-яёa-z])(?:три|трёх|трех|трём|трем|тремя|трое|троих|троим|троими|трет(?:ий|ьего|ьему|ьим|ьем|ья|ьей|ью|ье|ьи|ьих|ьими)|трижды)(?![а-яёa-z])/i,
  },
  {
    digit: '4',
    regex:
      /(?<![а-яёa-z])(?:четыре|четырёх|четырех|четырём|четырем|четырьмя|четверо|четверых|четверым|четверыми|четв[её]рт(?:ый|ого|ому|ым|ом|ая|ой|ую|ое|ые|ых|ыми))(?![а-яёa-z])/i,
  },
  {
    digit: '5',
    regex:
      /(?<![а-яёa-z])(?:пять|пяти|пятью|пятеро|пятерых|пятерым|пятерыми|пят(?:ый|ого|ому|ым|ом|ая|ой|ую|ое|ые|ых|ыми))(?![а-яёa-z])/i,
  },
  {
    digit: '6',
    regex:
      /(?<![а-яёa-z])(?:шесть|шести|шестью|шестеро|шестерых|шест(?:ой|ого|ому|ым|ом|ая|ую|ое|ые|ых|ыми))(?![а-яёa-z])/i,
  },
  {
    digit: '7',
    regex:
      /(?<![а-яёa-z])(?:семь|семи|семью|семеро|семерых|седьм(?:ой|ого|ому|ым|ом|ая|ую|ое|ые|ых|ыми))(?![а-яёa-z])/i,
  },
  {
    digit: '8',
    regex:
      /(?<![а-яёa-z])(?:восемь|восьми|восемью|восьмеро|восьмерых|восьм(?:ой|ого|ому|ым|ом|ая|ую|ое|ые|ых|ыми))(?![а-яёa-z])/i,
  },
  {
    digit: '9',
    regex:
      /(?<![а-яёa-z])(?:девять|девяти|девятью|девятеро|девятерых|девят(?:ый|ого|ому|ым|ом|ая|ой|ую|ое|ые|ых|ыми))(?![а-яёa-z])/i,
  },
  {
    digit: '10',
    regex:
      /(?<![а-яёa-z])(?:десять|десяти|десятью|десятеро|десятерых|десят(?:ый|ого|ому|ым|ом|ая|ой|ую|ое|ые|ых|ыми))(?![а-яёa-z])/i,
  },
];

export function extractNormalizedRussianNumbers(text: string): Set<string> {
  const nums = new Set<string>(text.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []);
  for (const entry of RUS_NUMBER_WORD_PATTERNS) {
    if (entry.regex.test(text)) {
      nums.add(entry.digit);
    }
  }
  return nums;
}

export function joinParagraphsPreservingSystemBoxes(paragraphs: string[]): string {
  const cleaned = paragraphs
    .flatMap((p) => (p || '').replace(/\r\n/g, '\n').split('\n'))
    .map((p) => p.trim())
    .filter(Boolean);
  if (cleaned.length === 0) return '';

  let result = cleaned[0];
  let inSystemBox = cleaned[0] === '---';

  for (let i = 1; i < cleaned.length; i++) {
    const prev = cleaned[i - 1];
    const curr = cleaned[i];
    const prevIsBracket = prev.startsWith('[') && prev.endsWith(']');
    const currIsBracket = curr.startsWith('[') && curr.endsWith(']');

    if (curr === '---') {
      if (inSystemBox) {
        result += '\n' + curr;
        inSystemBox = false;
      } else {
        result += '\n\n' + curr;
        inSystemBox = true;
      }
      continue;
    }

    if (inSystemBox || (prevIsBracket && currIsBracket)) {
      result += '\n' + curr;
    } else {
      result += '\n\n' + curr;
    }
  }

  return result;
}

export function normalizeRussianChapterTitle(title: string): string {
  return (title || '')
    .trim()
    .replace(/^(Глава\s+\d+(?:\.\d+)?)\s*[:.—–-]?\s+(?=\S)/i, '$1. ')
    .replace(/(?<!\.\.)\.$/, '')
    .trim();
}

export function normalizeRussianBookLayout(text: string): string {
  if (!text || !text.trim()) return text;
  const rawLines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const normalizedLines = rawLines.map((line) => {
    let working = line.replace(/(\d+)\s+цзиней(?![а-яёa-z])/gi, '$1 цзинь');
    if (working.startsWith('[') && working.endsWith(']')) {
      working = working
        .replace(/\(([^()]+?)\s+—\s+([^()]+?)\)/g, '($1, $2)')
        .replace(/^\[([^:]+:\s*[^(\]\n]+?)\s+—\s+([^()\]\n]+)\]$/, '[$1 ($2)]')
        .replace(
          /\[Бонус к скорости:\s*([+–-]?\d+%?)\s+к\s+скорости\s+передвижения\]/gi,
          '[Бонус к скорости: $1 (передвижение)]'
        );
    }
    return working;
  });

  return joinParagraphsPreservingSystemBoxes(normalizedLines);
}

/**
 * Canonical 0-based paragraph/line splitter compatible with `joinParagraphsPreservingSystemBoxes`
 * (where system frames `--- ... ---` use single `\n` while narrative paragraphs use `\n\n`).
 */
export function splitChapterParagraphs(text: string): string[] {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
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
  const engLines = splitChapterParagraphs(engText);
  const rusLines = splitChapterParagraphs(rusText);

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
    const rusNums = extractNormalizedRussianNumbers(rusP);
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
 * Computes a robust 3-character base-36 hash anchor for an English paragraph.
 * Uses FNV-1a (32-bit) with index mixing.
 * 36^3 = 46,656 possible values (<0.1% collision probability over a chapter),
 * consuming only 5 tokens in the prompt: [a7f|#pK].
 */
export function computeParagraphHashAnchor(
  sourceParagraph: string,
  index: number
): string {
  const normalized = (sourceParagraph || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = (2166136261 ^ index) >>> 0;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const positiveHash = hash % 46656;
  return positiveHash.toString(36).padStart(3, '0');
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

export interface CompiledGlossaryEntry {
  eng: string;
  rus: string;
  category: GlossaryCategory;
  filterRegex: RegExp;
  lintRegex: RegExp;
  globalReplaceRegex: RegExp;
  significantStems: string[];
}

interface CompiledGlossaryBundle {
  signature: string;
  entries: CompiledGlossaryEntry[];
  sortedByEngLengthDesc: CompiledGlossaryEntry[];
  tautologyProtectedRegex: RegExp | null;
}

export interface ChapterAnalysisContext {
  engText: string;
  rusText: string;
  engLines: string[];
  rusLines: string[];
  engParagraphs: string[];
  rusParagraphs: string[];
  alignment: {
    pairs: AlignedParagraphPair[];
    engCount: number;
    rusCount: number;
    hasDrift: boolean;
  };
  engNumbers: string[];
  rusNumbers: Set<string>;
  filteredGlossary: CanonicalGlossary;
  matchedGlossaryCount: number;
  femaleCharacters: string[];
  compiledGlossary: CompiledGlossaryEntry[];
  glossarySignature: string;
}

const GLOSSARY_WEAK_CACHE = new WeakMap<CanonicalGlossary, CompiledGlossaryBundle>();
const GLOSSARY_LRU_CACHE = new Map<string, CompiledGlossaryBundle>();
const MAX_GLOSSARY_LRU = 32;

const TAUTOLOGY_TARGET_TRIGGER_RE = /(?:мгновенн|быстр|сказал|посмотрел|огромн)/i;

function computeGlossarySignature(glossary?: CanonicalGlossary): string {
  if (!glossary) return 'empty';
  const cats: GlossaryCategory[] = ['realms', 'characters', 'sects_and_places', 'system_and_terms', 'units'];
  let sig = '';
  for (const cat of cats) {
    const bucket = glossary[cat];
    if (!bucket) continue;
    const keys = Object.keys(bucket);
    sig += `${cat}:${keys.length}:`;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      sig += `${k}=${bucket[k]}|`;
    }
  }
  return sig;
}

function compileGlossaryBundle(glossary?: CanonicalGlossary): CompiledGlossaryBundle {
  const signature = computeGlossarySignature(glossary);
  if (glossary) {
    const weakHit = GLOSSARY_WEAK_CACHE.get(glossary);
    if (weakHit && weakHit.signature === signature) {
      return weakHit;
    }
  }
  const lruHit = GLOSSARY_LRU_CACHE.get(signature);
  if (lruHit) {
    GLOSSARY_LRU_CACHE.delete(signature);
    GLOSSARY_LRU_CACHE.set(signature, lruHit);
    if (glossary) {
      GLOSSARY_WEAK_CACHE.set(glossary, lruHit);
    }
    return lruHit;
  }

  const entries: CompiledGlossaryEntry[] = [];
  const protectedFormSet = new Set<string>();
  const cats: GlossaryCategory[] = ['realms', 'characters', 'sects_and_places', 'system_and_terms', 'units'];

  if (glossary) {
    for (const cat of cats) {
      const bucket = glossary[cat] || {};
      for (const [eng, rus] of Object.entries(bucket)) {
        const cleanEng = (eng || '').trim();
        const cleanRus = (rus || '').trim();
        if (cleanEng.length >= 2) {
          const escapedEng = cleanEng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const isProperNoun =
            (cat === 'characters' || cat === 'sects_and_places') && /^[A-Z]/.test(cleanEng);
          const significantStems = cleanRus
            .toLowerCase()
            .replace(/ё/g, 'е')
            .split(/[\s-]+/)
            .filter((w) => w.length >= 2)
            .map((w) => {
              if (w.startsWith('камен')) return 'кам';
              if (w.startsWith('корен')) return 'кор';
              return w.slice(0, Math.min(4, Math.max(2, w.length - 2)));
            });

          entries.push({
            eng: cleanEng,
            rus: cleanRus,
            category: cat,
            filterRegex: new RegExp(`\\b${escapedEng}s?\\b`, 'i'),
            lintRegex: new RegExp(`\\b${escapedEng}s?\\b`, isProperNoun ? '' : 'i'),
            globalReplaceRegex: new RegExp(`\\b${escapedEng}s?\\b`, 'gi'),
            significantStems,
          });
        }

        if (cleanRus && TAUTOLOGY_TARGET_TRIGGER_RE.test(cleanRus)) {
          protectedFormSet.add(cleanRus);
          const forms = buildInflectedRussianForms(cleanRus, { category: cat });
          for (const item of forms) {
            if (item.form && item.form.length >= 3) {
              protectedFormSet.add(item.form.trim());
            }
          }
        }
      }
    }
  }

  const sortedByEngLengthDesc = [...entries].sort((a, b) => b.eng.length - a.eng.length);
  const protectedForms = Array.from(protectedFormSet)
    .sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const tautologyProtectedRegex =
    protectedForms.length > 0
      ? new RegExp(`(?<![а-яёА-ЯЁ])(?:${protectedForms.join('|')})(?![а-яёА-ЯЁ])`, 'gi')
      : null;

  const bundle: CompiledGlossaryBundle = {
    signature,
    entries,
    sortedByEngLengthDesc,
    tautologyProtectedRegex,
  };

  if (GLOSSARY_LRU_CACHE.size >= MAX_GLOSSARY_LRU) {
    const oldestKey = GLOSSARY_LRU_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      GLOSSARY_LRU_CACHE.delete(oldestKey);
    }
  }
  GLOSSARY_LRU_CACHE.set(signature, bundle);
  if (glossary) {
    GLOSSARY_WEAK_CACHE.set(glossary, bundle);
  }
  return bundle;
}

function alignFromSplitParagraphs(engParagraphs: string[], rusParagraphs: string[]): {
  pairs: AlignedParagraphPair[];
  engCount: number;
  rusCount: number;
  hasDrift: boolean;
} {
  const maxLen = Math.max(engParagraphs.length, rusParagraphs.length);
  const pairs: AlignedParagraphPair[] = [];

  for (let i = 0; i < maxLen; i++) {
    const engP = engParagraphs[i] || '';
    const rusP = rusParagraphs[i] || '';
    const isSystemDivider = engP === '---' || rusP === '---';
    const isSystemProperty =
      (engP.startsWith('[') && engP.endsWith(']')) ||
      (rusP.startsWith('[') && rusP.endsWith(']'));

    const engNums = Array.from(new Set(engP.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []));
    const rusNums = extractNormalizedRussianNumbers(rusP);
    const missingNumbers = rusP ? engNums.filter((n) => !rusNums.has(n)) : [];

    const isDrifted =
      (Boolean(engP) && !rusP && rusParagraphs.length > 0) ||
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
    engCount: engParagraphs.length,
    rusCount: rusParagraphs.length,
    hasDrift: rusParagraphs.length > 0 && engParagraphs.length !== rusParagraphs.length,
  };
}

/**
 * Single-pass chapter analysis context (< 20 ms target): precomputes split lines, aligned pairs,
 * normalized numbers, compiled glossary matchers (WeakMap + LRU), and female character list once.
 */
export function createChapterAnalysisContext(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  options?: LinterOptions
): ChapterAnalysisContext {
  const bundle = compileGlossaryBundle(glossary);
  const engLines = (engText || '').replace(/\r\n/g, '\n').split('\n');
  const rusLines = (rusText || '').replace(/\r\n/g, '\n').split('\n');
  const engParagraphs = engLines.map((l) => l.trim()).filter(Boolean);
  const rusParagraphs = rusLines.map((l) => l.trim()).filter(Boolean);
  const alignment = alignFromSplitParagraphs(engParagraphs, rusParagraphs);

  const engNumbers = Array.from(new Set((engText || '').match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []));
  const rusNumbers = extractNormalizedRussianNumbers(rusText || '');

  const filteredGlossary: CanonicalGlossary = {
    realms: {},
    characters: {},
    sects_and_places: {},
    system_and_terms: {},
    units: {},
  };
  let matchedGlossaryCount = 0;
  for (const entry of bundle.entries) {
    if (entry.filterRegex.test(engText)) {
      filteredGlossary[entry.category][entry.eng] = entry.rus;
      matchedGlossaryCount++;
    }
  }

  const glossaryMeta = options?.glossaryMeta || {};
  const femaleCharacterSet = new Set<string>(INDECLINABLE_FEM_NAMES);
  const MASC_A_YA_EXCEPTIONS = new Set(['илья', 'никита', 'лука', 'фома', 'савва', 'кузьма', 'данила']);
  Object.entries(glossary?.characters || {}).forEach(([eng, rus]) => {
    const meta = glossaryMeta[eng];
    const cleanRus = rus.trim();
    const firstToken = cleanRus.split(/\s+/)[0] || '';
    if (meta?.gender === 'M' || meta?.gender === 'N') {
      femaleCharacterSet.delete(cleanRus);
      if (firstToken) femaleCharacterSet.delete(firstToken);
    } else if (
      meta?.gender === 'F' ||
      (!meta?.gender &&
        firstToken.length >= 3 &&
        /[ая]$/i.test(firstToken) &&
        !MASC_A_YA_EXCEPTIONS.has(firstToken.toLowerCase()))
    ) {
      femaleCharacterSet.add(cleanRus);
    }
  });

  return {
    engText,
    rusText,
    engLines,
    rusLines,
    engParagraphs,
    rusParagraphs,
    alignment,
    engNumbers,
    rusNumbers,
    filteredGlossary,
    matchedGlossaryCount,
    femaleCharacters: Array.from(femaleCharacterSet),
    compiledGlossary: bundle.entries,
    glossarySignature: bundle.signature,
  };
}

/**
 * Pure-JS 64-bit FNV-1a chapter fingerprint for caching UI & SQLite QA summaries without node:crypto.
 */
export function computeChapterFingerprint(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  options?: LinterOptions
): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= (c + i) & 0xffff;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
  };
  feed(engText || '');
  feed('\u0001');
  feed(rusText || '');
  feed('\u0002');
  feed(computeGlossarySignature(glossary));
  if (options?.enabledRuleIds) {
    feed('\u0003' + options.enabledRuleIds.join(','));
  }
  if (options?.glossaryMeta) {
    feed('\u0004' + JSON.stringify(options.glossaryMeta));
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Computes compact UI-ready QA summary from a single-pass lint execution (< 20 ms per chapter).
 */
export function computeChapterQaSummary(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  options?: LinterOptions
): ChapterQaSummary {
  const ctx = options?.analysisContext || createChapterAnalysisContext(engText, rusText, glossary, options);
  const report = runQaLinter(engText, rusText, glossary, { ...options, analysisContext: ctx });
  return {
    passed: report.passed,
    score: report.score,
    errorCount: report.errorCount,
    warningCount: report.warningCount,
    fingerprint: computeChapterFingerprint(engText, rusText, glossary, options),
    computedAt: new Date().toISOString(),
  };
}

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
  const bundle = compileGlossaryBundle(glossary);

  for (const entry of bundle.entries) {
    if (entry.filterRegex.test(engText)) {
      filteredGlossary[entry.category][entry.eng] = entry.rus;
      matchedCount++;
    }
  }

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

const INDECLINABLE_FEM_MATCHERS = INDECLINABLE_FEM_NAMES.map((indeclName) => ({
  name: indeclName,
  testRe: new RegExp(`(?<![а-яё])${indeclName}(?:а|у|ом|е|ой|ы|ам|ами|ах)(?![а-яё])`, 'i'),
  replaceRe: new RegExp(`(?<![а-яё])${indeclName}(?:а|у|ом|е|ой|ы|ам|ами|ах)(?![а-яё])`, 'gi'),
}));

interface MemoLintEntry {
  engText: string;
  rusText: string;
  glossarySig: string;
  rulesKey: string;
  metaKey: string;
  edgesKey: string;
  registersKey: string;
  report: LintReport;
}

const RUN_QA_LINTER_MEMO_CACHE: MemoLintEntry[] = [];
const MAX_LINT_MEMO = 16;

/**
 * Runs the configurable deterministic style, accuracy, gender, paragraph drift & tautology rules.
 */
export function runQaLinter(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  options?: LinterOptions
): LintReport {
  const ctx =
    options?.analysisContext ||
    createChapterAnalysisContext(engText, rusText, glossary, options);

  const rulesKey = options?.enabledRuleIds ? options.enabledRuleIds.join(',') : 'ALL';
  const metaKey = options?.glossaryMeta ? JSON.stringify(options.glossaryMeta) : '';
  const edgesKey = options?.socialEdges ? JSON.stringify(options.socialEdges) : '';
  const registersKey = options?.dialogueRegisters ? JSON.stringify(options.dialogueRegisters) : '';

  for (let i = RUN_QA_LINTER_MEMO_CACHE.length - 1; i >= 0; i--) {
    const entry = RUN_QA_LINTER_MEMO_CACHE[i];
    if (
      entry.engText === engText &&
      entry.rusText === rusText &&
      entry.glossarySig === ctx.glossarySignature &&
      entry.rulesKey === rulesKey &&
      entry.metaKey === metaKey &&
      entry.edgesKey === edgesKey &&
      entry.registersKey === registersKey
    ) {
      return { ...entry.report, issues: entry.report.issues.slice() };
    }
  }

  const activeRules = new Set<LintRuleId>(
    options?.enabledRuleIds || ALL_LINT_RULES.map((r) => r.id)
  );
  const issues: LintIssue[] = [];
  const lines = ctx.rusLines;
  const femaleCharacters = ctx.femaleCharacters;
  const femaleCharacterSet = new Set<string>(femaleCharacters);

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
      (/(?<![а-яёa-z])(?:фунт(?:ов|а|ы|е|ам)?|килограмм(?:ов|а|ы|е)?)(?![а-яёa-z])/i.test(line) ||
        /\d+\s+цзиней(?![а-яёa-z])/i.test(line))
    ) {
      issues.push({
        id: `lint-${lineNum}-weight`,
        ruleId: 'WEIGHT_UNITS',
        ruleTitle: 'Западные/метрические меры веса или склонение «цзиней»',
        severity: 'error',
        line: lineNum,
        snippet: line,
        suggestion: line
          .replace(/(?<![а-яёa-z])фунт(?:ов|а|ы|е|ам)?(?![а-яёa-z])/gi, 'цзинь')
          .replace(/(?<![а-яёa-z])килограмм(?:ов|а|ы|е)?(?![а-яёa-z])/gi, 'цзинь')
          .replace(/(\d+)\s+цзиней(?![а-яёa-z])/gi, '$1 цзинь'),
        explanation:
          'В мире сянься используются традиционные меры веса: неизменяемое в Р.п. мн.ч. «цзинь» (jin) и «лян» (liang).',
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

      if (/(?:\.,|,\.|!\.(?!\.)|\?\.(?!\.)|,,|\.\.,|^\s*—,)/.test(line)) {
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
      for (const indecl of INDECLINABLE_FEM_MATCHERS) {
        if (!femaleCharacterSet.has(indecl.name)) continue;
        if (indecl.testRe.test(line)) {
          issues.push({
            id: `lint-${lineNum}-indecl-${indecl.name}`,
            ruleId: 'CHARACTER_GENDER_MISMATCH',
            ruleTitle: `Ошибочное склонение несклоняемого женского имени («${indecl.name}»)`,
            severity: 'error',
            line: lineNum,
            snippet: line,
            suggestion: line.replace(indecl.replaceRe, indecl.name),
            explanation: `Женское имя «${indecl.name}» на согласную (и «Мей») по правилам русского языка не склоняется.`,
          });
        }
      }

      for (const femName of femaleCharacters) {
        const matcher = getCompiledFemGenderMatcher(femName);
        const agreed = applyFemaleGenderAgreement(line, matcher, true);
        if (agreed.changed) {
          issues.push({
            id: `lint-${lineNum}-gender-${femName}`,
            ruleId: 'CHARACTER_GENDER_MISMATCH',
            ruleTitle: `Нарушение женского рода персонажа («${femName}»)`,
            severity: 'error',
            line: lineNum,
            snippet: line,
            suggestion: agreed.text,
            explanation: `Персонаж «${femName}» имеет женский род (Ж) в глоссарии, но глагол стоит в мужском роде.`,
          });
        }
      }
    }
  });

  // 14. PARAGRAPH_DRIFT (1:1 Alignment & System Box Dividers)
  if (activeRules.has('PARAGRAPH_DRIFT') && rusText.trim()) {
    const alignment = ctx.alignment;
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
    ctx.rusLines.forEach((line, idx) => {
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
  const engNumbers = ctx.engNumbers;
  const rusNumbers = ctx.rusNumbers;
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
  let glossaryMatchesCount = 0;
  const lowerRus = rusText.toLowerCase().replace(/ё/g, 'е');

  for (const entry of ctx.compiledGlossary) {
    if (entry.lintRegex.test(engText)) {
      const matched =
        entry.significantStems.length === 0 ||
        entry.significantStems.every((stem) => lowerRus.includes(stem));

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
    ctx.alignment.pairs.forEach((pair) => {
      const pRus = pair.rusParagraph.trim();
      const pEng = pair.engParagraph.trim();
      if (!pRus || pRus === '---' || (pRus.startsWith('[') && pRus.endsWith(']'))) return;

      const copulaMatch = pRus.match(ARTIFICIAL_COPULA_DASH_RE);
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

      // Check for medial spaced hyphen (" - ") or en-dash (" – ") inside sentence
      if (/\S\s+(?:-|\u2013)\s+\S/.test(pRus)) {
        issues.push({
          id: `lint-${pair.index + 1}-spaced-hyphen-or-endash`,
          ruleId: 'DASH_AND_COMMA_INFLATION',
          ruleTitle: 'Дефис с пробелами (« - ») или среднее тире (« – ») внутри фразы',
          severity: 'warning',
          line: pair.index + 1,
          snippet: pRus,
          suggestion: 'Замените « - » / « – » на запятую, союз или (в атрибуции диалога) на длинное тире « — ».',
          explanation:
            'Обычный дефис с пробелами или среднее тире посреди русского предложения — типичный след необработанной генерации.',
        });
      }

      // Strip leading dialogue dash, speech/thought attribution tags (", — сказал" / ". — Она посмотрела"),
      // and standard Russian split-dialogue resumptions (". — Продолжение" / ", — продолжение")
      // so we measure purely narrative medial dashes.
      const isDialogueLine = /^—\s+/.test(pRus);
      const hasAttributionDash =
        /^«[^»]+»[,!?…]?\s*—\s+/.test(pRus) ||
        (isDialogueLine && /[,!?….]\s*—\s+/i.test(pRus.replace(/^—\s+/, '')));
      let narrativePart = pRus
        .replace(/^—\s+/, '')
        .replace(/^«[^»]+»[,!?…]?\s*—\s+/, '');
      if (isDialogueLine) {
        // In dialogue lines, strip all standard attribution/resumption dashes after [,!?….]
        narrativePart = narrativePart.replace(/[,!?….]\s*—\s+/g, ', ');
      }

      const rusNarrativeDashes = (narrativePart.match(/\s+(?:—|–)\s+/g) || []).length;
      const engDashes = (pEng.match(/—|–|--/g) || []).length;
      if (
        rusNarrativeDashes - engDashes >= 2 ||
        (rusNarrativeDashes >= 1 &&
          engDashes === 0 &&
          ((!isDialogueLine && hasAttributionDash) || /\s+—\s+и\s+/i.test(narrativePart)))
      ) {
        issues.push({
          id: `lint-${pair.index + 1}-dash-inflation`,
          ruleId: 'DASH_AND_COMMA_INFLATION',
          ruleTitle: `Избыточная инфляция ИИ-тире в повествовании (ΔDash = +${rusNarrativeDashes - engDashes})`,
          severity: 'warning',
          line: pair.index + 1,
          snippet: pRus,
          suggestion: 'Замените лишние повествовательные тире («—») на запятые, союзы или придаточные предложения.',
          explanation:
            'Нагромождение длинных тире в авторском повествовании или повторное тире в словах автора после реплики — характерный синтаксический штамп ИИ.',
        });
      }
    });
  }

  // 18. SYNTAX_MONOTONY_AND_BURSTINESS
  if (activeRules.has('SYNTAX_MONOTONY_AND_BURSTINESS') && rusText.trim()) {
    ctx.rusParagraphs.forEach((p, pIdx) => {
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
    const rusLines = ctx.rusLines;
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
    ctx.rusLines.forEach((rawLine, idx) => {
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

  const report: LintReport = {
    passed: errorCount === 0 && warningCount === 0,
    errorCount,
    warningCount,
    score,
    issues,
    checkedNumbersCount: engNumbers.length,
    glossaryMatchesCount,
  };

  if (RUN_QA_LINTER_MEMO_CACHE.length >= MAX_LINT_MEMO) {
    RUN_QA_LINTER_MEMO_CACHE.shift();
  }
  RUN_QA_LINTER_MEMO_CACHE.push({
    engText,
    rusText,
    glossarySig: ctx.glossarySignature,
    rulesKey,
    metaKey,
    edgesKey,
    registersKey,
    report: { ...report, issues: report.issues.slice() },
  });

  return report;
}

const VY_IRREGULAR_PREDICATE_MAP: Record<string, string> = {
  должны: 'должен',
  обязаны: 'обязан',
  готовы: 'готов',
  виноваты: 'виноват',
  правы: 'прав',
  уверены: 'уверен',
  способны: 'способен',
  слабы: 'слаб',
  глупы: 'глуп',
  живы: 'жив',
  мертвы: 'мёртв',
  свободны: 'свободен',
  были: 'был',
  хотите: 'хочешь',
  можете: 'можешь',
  сможете: 'сможешь',
  сумеете: 'сумеешь',
  смеете: 'смеешь',
  посмеете: 'посмеешь',
  знаете: 'знаешь',
  узнаете: 'узнаешь',
  будете: 'будешь',
  бежите: 'бежишь',
  едите: 'ешь',
  дадите: 'дашь',
  создадите: 'создашь',
  видите: 'видишь',
  увидите: 'увидишь',
  слышите: 'слышишь',
  услышите: 'услышишь',
  смотрите: 'смотришь',
  посмотрите: 'посмотришь',
  держите: 'держишь',
  молчите: 'молчишь',
  спите: 'спишь',
  стоите: 'стоишь',
  сидите: 'сидишь',
  лежите: 'лежишь',
  кричите: 'кричишь',
  дышите: 'дышишь',
  терпите: 'терпишь',
  любите: 'любишь',
  боитесь: 'боишься',
  побоитесь: 'побоишься',
};

function conjugate2PlTo2Sg(word: string): string {
  const lower = word.toLowerCase();
  const mapped = VY_IRREGULAR_PREDICATE_MAP[lower];
  if (mapped) {
    return word[0] === word[0].toUpperCase()
      ? mapped.charAt(0).toUpperCase() + mapped.slice(1)
      : mapped;
  }
  const suffixMatch = word.match(/^([а-яёА-ЯЁ]{2,}?)(ете|ёте|ите)(сь|ся)?$/i);
  if (suffixMatch) {
    const [, stem, ending, refl] = suffixMatch;
    const endLower = ending.toLowerCase();
    const sgEnding = endLower === 'ите' ? 'ишь' : endLower === 'ёте' ? 'ёшь' : 'ешь';
    const sgRefl = refl ? (refl.toLowerCase() === 'ся' ? 'ся' : 'ся') : '';
    return `${stem}${sgEnding}${sgRefl}`;
  }
  return word;
}

function shiftDialogueLineVyToTy(line: string): string {
  let l = line;
  const hadFormal = /(?<![а-яёА-ЯЁa-zA-Z0-9])(?:Вы|вы|Вас|вас|Вам|вам|Вами|вами|Ваш|ваш|Вашего|вашего|Вашему|вашему|Вашим|вашим|Вашем|вашем|Ваша|ваша|Ваше|ваше|Ваши|ваши)(?![а-яёА-ЯЁa-zA-Z0-9])/.test(l);
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]ы(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'ты');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]ас(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тебя');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]ам(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тебе');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]ами(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'тобой');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]ашего(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твоего');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]ашему(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твоему');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]ашим(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твоим');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]ашем(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твоём');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]аша(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твоя');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]аше(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твоё');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]аши(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твои');
  l = l.replace(/(?<![а-яёА-ЯЁa-zA-Z0-9])[Вв]аш(?![а-яёА-ЯЁa-zA-Z0-9])/g, 'твой');

  if (hadFormal) {
    l = l.replace(
      /(?<![а-яёА-ЯЁ])(ты(?:\s+(?:(?:не|уже|даже|всё\s+ещё|все\s+еще|ведь|сами|правда|разве|сейчас|тут|же)\s+)){0,2})([а-яёА-ЯЁ]{3,})(?![а-яёА-ЯЁ])/g,
      (_m, lead: string, verb: string) => `${lead}${conjugate2PlTo2Sg(verb)}`
    );
    l = l.replace(
      /(?<![а-яёА-ЯЁ])(скажи|послушай|посмотри|уйди|уходи|возьми|прости|отдай|прекрати|погоди|стой|подумай|ответь|убирай|заткни|останови)(тесь|те)(?![а-яёА-ЯЁ])/gi,
      (_m, stem: string, suffix: string) => {
        if (suffix.toLowerCase() === 'тесь') {
          return stem.endsWith('й') || stem.endsWith('Й') ? `${stem}ся` : `${stem}сь`;
        }
        return stem;
      }
    );
  }
  return l;
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
      pattern: /:[ \t]*—/g,
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
      ruleId: 'WEIGHT_UNITS',
      pattern: /(\d+)\s+цзиней(?![а-яёa-z])/gi,
      replace: '$1 цзинь',
      desc: 'Исправлено склонение «цзиней» → неизменяемое «цзинь»',
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
      pattern: ARTIFICIAL_COPULA_DASH_GLOBAL_RE,
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
        const l = shiftDialogueLineVyToTy(line);
        if (l !== line) {
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
    const copulaFollowRe = new RegExp(`^${COPULA_VERB_PATTERN}(?![а-яёА-ЯЁ])`, 'i');
    let relaxedDashes = false;
    const fixedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---' || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        return line;
      }

      let updated = line;

      // 1. Convert spaced hyphen/en-dash after quote/exclamation/question into proper dialogue attribution em-dash
      const afterQuoteFixed = updated.replace(/([,!?»"])\s+(?:-|\u2013)\s+/g, '$1 — ');
      if (afterQuoteFixed !== updated) {
        updated = afterQuoteFixed;
        relaxedDashes = true;
      }

      // 2. Replace remaining medial spaced hyphens (" - ") and en-dashes (" – ") with space before copula or comma elsewhere
      const medialHyphenFixed = updated.replace(/(\S)\s+(?:-|\u2013)\s+(\S[^\s]*)/g, (m, prev: string, nextWord: string) => {
        if (copulaFollowRe.test(nextWord)) {
          return `${prev} ${nextWord}`;
        }
        return `${prev}, ${nextWord}`;
      });
      if (medialHyphenFixed !== updated) {
        updated = medialHyphenFixed;
        relaxedDashes = true;
      }

      // 3. Replace AI connector " — и " inside narrative with ", и "
      const isDialogue = /^\s*—\s+/.test(updated);
      const isThought = /^\s*«[^»]+»\s*,?\s*—\s+/.test(updated);
      if (!isDialogue) {
        const andDashFixed = updated.replace(/(\S)\s+—\s+и\s+/g, '$1, и ');
        if (andDashFixed !== updated) {
          updated = andDashFixed;
          relaxedDashes = true;
        }
      }

      // 4. Relax excess medial em-dashes in narrative (preserving dialogue attribution/resumption dashes after [,!?….»])
      const bodyAfterLead = isDialogue
        ? updated.replace(/^\s*—\s+/, '')
        : isThought
          ? updated.replace(/^\s*«[^»]+»[,!?…]?\s*—\s+/, '')
          : updated;
      const nonAttributionBody = isDialogue
        ? bodyAfterLead.replace(/[,!?….»]\s*—\s+/g, ', ')
        : bodyAfterLead;
      const medialDashes = nonAttributionBody.match(/\s+—\s+/g) || [];
      if (isThought && medialDashes.length >= 1) {
        relaxedDashes = true;
        let seenFirstAttribution = false;
        updated = updated.replace(/(\s+)—(\s+)/g, (m, _b, a, offset) => {
          if (!seenFirstAttribution) {
            seenFirstAttribution = true;
            return m;
          }
          if (copulaFollowRe.test(updated.slice(offset + m.length))) {
            return a;
          }
          return `,${a}`;
        });
      } else if (!isDialogue && medialDashes.length >= 2) {
        relaxedDashes = true;
        let count = 0;
        updated = updated.replace(/(\s+)—(\s+)/g, (m, _b, a, offset) => {
          if (offset === 0 || /^\s*$/.test(updated.slice(0, offset))) {
            return m;
          }
          count++;
          if (count > 1) {
            return copulaFollowRe.test(updated.slice(offset + m.length)) ? a : `,${a}`;
          }
          return m;
        });
      } else if (isDialogue && medialDashes.length >= 2) {
        relaxedDashes = true;
        let nonAttrCount = 0;
        updated = updated.replace(/(\S)(\s+)—(\s+)/g, (m, prevChar, _b, a, offset) => {
          if (/[,!?….»]/.test(prevChar)) {
            return m;
          }
          nonAttrCount++;
          if (nonAttrCount > 1) {
            return copulaFollowRe.test(updated.slice(offset + m.length)) ? `${prevChar}${a}` : `${prevChar},${a}`;
          }
          return m;
        });
      }
      return updated;
    });
    if (relaxedDashes) {
      text = fixedLines.join('\n');
      appliedFixes.push('Устранена инфляция ИИ-тире: дефисы с пробелами и избыточные тире заменены на запятые');
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

  // Character gender & indeclinable feminine name auto-repair
  if (activeRules.has('CHARACTER_GENDER_MISMATCH')) {
    const femSet = new Set<string>(INDECLINABLE_FEM_NAMES);
    const MASC_A_YA_EXCEPTIONS = new Set(['илья', 'никита', 'лука', 'фома', 'савва', 'кузьма', 'данила']);
    if (options?.glossary?.characters) {
      Object.entries(options.glossary.characters).forEach(([eng, rus]) => {
        const cleanRus = rus.trim();
        const firstToken = cleanRus.split(/\s+/)[0] || '';
        const explicitGender = options.glossaryMeta?.[eng]?.gender;
        if (explicitGender === 'M' || explicitGender === 'N') {
          femSet.delete(cleanRus);
          if (firstToken) femSet.delete(firstToken);
        } else if (
          explicitGender === 'F' ||
          (!explicitGender &&
            firstToken.length >= 3 &&
            /[ая]$/i.test(firstToken) &&
            !MASC_A_YA_EXCEPTIONS.has(firstToken.toLowerCase()))
        ) {
          femSet.add(cleanRus);
        }
      });
    }

    for (const indecl of INDECLINABLE_FEM_MATCHERS) {
      if (!femSet.has(indecl.name)) continue;
      if (indecl.testRe.test(text)) {
        text = text.replace(indecl.replaceRe, indecl.name);
        appliedFixes.push(`Восстановлена несклоняемая форма женского имени «${indecl.name}»`);
      }
    }

    for (const rus of femSet) {
      const matcher = getCompiledFemGenderMatcher(rus);
      const agreed = applyFemaleGenderAgreement(text, matcher, true);
      if (agreed.changed) {
        text = agreed.text;
        appliedFixes.push(`Согласован женский род глаголов для персонажа «${rus}»`);
      }
    }
  }

  // Nora Gal Anti-Bureaucracy (verbal-noun chains -> active Russian verbs)
  const noraGalBureaucracyRules: Array<{ re: RegExp; rep: string; label: string }> = [
    {
      re: /Осуществление\s+перемещения\s+([а-яё\s]+?)\s+производилось\s+с\s+обеспечением\s+выполнения\s+предписания\s+([а-яё\s]+?)\./gi,
      rep: 'Отряд $1 двигался вперёд строго по приказу $2.',
      label: 'Устранён канцелярский штамп («осуществление перемещения... производилось с обеспечением»)',
    },
    {
      re: /Выполнение\s+задержания\s+([а-яё\s]+?)\s+сопровождалось\s+составлением\s+описания\s+([а-яё\s]+?)\s+и\s+принятием\s+решения\./gi,
      rep: 'Схватив $1, стража тут же описала $2 и решила, как поступить дальше.',
      label: 'Устранён канцелярский штамп («выполнение задержания... сопровождалось составлением»)',
    },
    {
      re: /(?<![а-яё])осуществил(а|и|)\s+перемещение(?![а-яё])/gi,
      rep: 'переместил$1ся',
      label: 'Канцелярит Норы Галь: «осуществил перемещение» → живой глагол',
    },
    {
      re: /(?<![а-яё])осуществил(а|и|)\s+атаку(?![а-яё])/gi,
      rep: 'атаковал$1',
      label: 'Канцелярит Норы Галь: «осуществил атаку» → «атаковал»',
    },
    {
      re: /(?<![а-яё])осуществил(а|и|)\s+прорыв(?![а-яё])/gi,
      rep: 'прорвал$1ся',
      label: 'Канцелярит Норы Галь: «осуществил прорыв» → «прорвался»',
    },
    {
      re: /(?<![а-яё])принял(а|и|)\s+решение(?![а-яё])/gi,
      rep: 'решил$1',
      label: 'Канцелярит Норы Галь: «принял решение» → «решил»',
    },
    {
      re: /(?<![а-яё])предпринял(а|и|)\s+попытку(?![а-яё])/gi,
      rep: 'попытал$1ся',
      label: 'Канцелярит Норы Галь: «предпринял попытку» → «попытался»',
    },
  ];
  for (const ng of noraGalBureaucracyRules) {
    if (ng.re.test(text)) {
      text = text.replace(ng.re, (_, g1, g2) => {
        if (ng.rep.includes('$1') && ng.rep.includes('$2')) {
          return ng.rep.replace('$1', g1).replace('$2', g2);
        }
        if (ng.rep.includes('переместил$1ся')) {
          return g1 === 'а' ? 'переместилась' : g1 === 'и' ? 'переместились' : 'переместился';
        }
        if (ng.rep.includes('прорвал$1ся')) {
          return g1 === 'а' ? 'прорвалась' : g1 === 'и' ? 'прорвались' : 'прорвался';
        }
        if (ng.rep.includes('попытал$1ся')) {
          return g1 === 'а' ? 'попыталась' : g1 === 'и' ? 'попытались' : 'попытался';
        }
        return ng.rep.replace('$1', g1 || '');
      });
      appliedFixes.push(ng.label);
    }
  }

  // Zero-Leakage Latin & Unclosed Bracket Auto-Repair
  const glossaryBundle = options?.glossary ? compileGlossaryBundle(options.glossary) : null;
  if (activeRules.has('LATIN_LEAKAGE_AND_BRACKETS')) {
    let latinFixed = false;
    if (glossaryBundle) {
      for (const entry of glossaryBundle.sortedByEngLengthDesc) {
        entry.globalReplaceRegex.lastIndex = 0;
        if (entry.globalReplaceRegex.test(text)) {
          entry.globalReplaceRegex.lastIndex = 0;
          text = text.replace(entry.globalReplaceRegex, entry.rus);
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
        replacements: ['взглянул', 'перевёл взгляд', 'воззрился'],
      },
      {
        regex: /(?<![а-яё])огромный(?![а-яё])/gi,
        replacements: ['исполинский', 'громадный', 'массивный'],
      },
    ];

    const protectedTermRegex = glossaryBundle?.tautologyProtectedRegex || null;
    const isProtectedOffset = (
      spans: Array<[number, number]>,
      start: number,
      length: number
    ): boolean => {
      const end = start + length;
      return spans.some(([s, e]) => start < e && end > s);
    };

    let tautologyRepairedCount = 0;
    const paragraphs = text.split('\n');
    const deTautologized = paragraphs.map((p) => {
      let updatedP = p;
      const protectedSpans: Array<[number, number]> = [];
      if (protectedTermRegex) {
        protectedTermRegex.lastIndex = 0;
        let spanMatch: RegExpExecArray | null;
        while ((spanMatch = protectedTermRegex.exec(updatedP)) !== null) {
          protectedSpans.push([spanMatch.index, spanMatch.index + spanMatch[0].length]);
        }
      }

      for (const rule of synonymPool) {
        const unprotectedStarts = new Set<number>();
        rule.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = rule.regex.exec(updatedP)) !== null) {
          if (!isProtectedOffset(protectedSpans, match.index, match[0].length)) {
            unprotectedStarts.add(match.index);
          }
        }
        if (unprotectedStarts.size >= 3) {
          let occ = 0;
          updatedP = updatedP.replace(rule.regex, (m, offset: number) => {
            if (!unprotectedStarts.has(offset)) return m;
            occ++;
            if (occ === 1) return m;
            tautologyRepairedCount++;
            const syn = rule.replacements[(occ - 2) % rule.replacements.length];
            const isUpper = m[0] === m[0].toUpperCase();
            return isUpper ? syn.charAt(0).toUpperCase() + syn.slice(1) : syn;
          });
          // Recompute protected spans only if length changed inside a paragraph containing protected terms
          if (protectedSpans.length > 0 && protectedTermRegex) {
            protectedSpans.length = 0;
            protectedTermRegex.lastIndex = 0;
            let spanMatch: RegExpExecArray | null;
            while ((spanMatch = protectedTermRegex.exec(updatedP)) !== null) {
              protectedSpans.push([spanMatch.index, spanMatch.index + spanMatch[0].length]);
            }
          }
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
  const chapterCtx = createChapterAnalysisContext(engText, rusText, glossary, {
    enabledRuleIds,
    glossaryMeta,
  });
  const alignment = chapterCtx.alignment;
  const scopedGlossary = chapterCtx.filteredGlossary;
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
          glossary: scopedGlossary,
          glossaryMeta,
          enabledRuleIds,
        });
        repairedParagraphs.push(repairedText);
      }
      surgicallyFixedIndices.push(pair.index);
      details.push(`Абзац #${pair.index}: восстановлен системный разделитель ---`);
      continue;
    }

    if (!workingRusP.trim() && pair.engParagraph.trim()) {
      // Untranslated paragraph fallback: apply glossary + rank conversion
      let fallbackP = pair.engParagraph;
      const { repairedText } = autoRepairRussianText(fallbackP, {
        glossary: scopedGlossary,
        glossaryMeta,
        enabledRuleIds,
      });
      fallbackP = repairedText;
      repairedParagraphs.push(fallbackP);
      surgicallyFixedIndices.push(pair.index);
      details.push(`Абзац #${pair.index}: восстановлен пропущенный абзац`);
      continue;
    }

    // Run targeted auto-repair on this paragraph if it has issues or missing numbers
    const paraLint = runQaLinter(pair.engParagraph, workingRusP, scopedGlossary, {
      enabledRuleIds,
      glossaryMeta,
    });
    if (!paraLint.passed || pair.missingNumbers.length > 0) {
      const { repairedText, appliedFixes } = autoRepairRussianText(workingRusP, {
        glossary: scopedGlossary,
        glossaryMeta,
        enabledRuleIds,
      });
      if (repairedText !== workingRusP) {
        workingRusP = repairedText;
        surgicallyFixedIndices.push(pair.index);
        details.push(
          `Абзац #${pair.index}: ${appliedFixes.slice(0, 2).join('; ') || 'исправлен точечно'}`
        );
      }
    }

    if (workingRusP.trim()) {
      repairedParagraphs.push(workingRusP);
    }
  }

  return {
    repairedRusText: joinParagraphsPreservingSystemBoxes(repairedParagraphs),
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

  // Detect acquired named artifacts, techniques, pills & flames from glossary.system_and_terms
  const NON_ARTIFACT_GENERIC_TERMS = new Set([
    'origin points',
    'spirit stone',
    'spirit stones',
    'spirit root',
    'spiritual root',
    'magical artifact',
    'spiritual artifact',
    'perfection',
    'rogue cultivators',
    'очки истока',
    'духовный камень',
    'духовные камни',
    'духовный корень',
    'магический артефакт',
    'духовный артефакт',
    'совершенство',
    'вольные совершенствующиеся',
  ]);
  const NAMED_ARTIFACT_OR_TECHNIQUE_RE =
    /Cauldron|Fire|Flame|Pill|Grass|Herb|Lotus|Sword|Blade|Scripture|Technique|Manual|Art|Bell|Mirror|Seal|Ring|Pagoda|Talisman|Spear|Bow|Armor|котёл|плам|огн|пилюл|трав|лотос|меч|клинок|канон|техник|искусств|колокол|зеркал|печат|кольц|пагод|талисман|копь/i;

  base.artifactsAndFlames = base.artifactsAndFlames.filter(
    (item) =>
      /[а-яёА-ЯЁ]/.test(item) &&
      !NON_ARTIFACT_GENERIC_TERMS.has(item.trim().toLowerCase()) &&
      !/ярус|ранг/i.test(item)
  );
  Object.entries(glossary.system_and_terms || {}).forEach(([eng, rus]) => {
    const cleanEng = eng.trim();
    const cleanRus = (rus || '').trim();
    if (!cleanRus || !/[а-яёА-ЯЁ]/.test(cleanRus)) return;
    if (
      NON_ARTIFACT_GENERIC_TERMS.has(cleanEng.toLowerCase()) ||
      NON_ARTIFACT_GENERIC_TERMS.has(cleanRus.toLowerCase())
    ) {
      return;
    }
    if (!NAMED_ARTIFACT_OR_TECHNIQUE_RE.test(cleanEng) && !NAMED_ARTIFACT_OR_TECHNIQUE_RE.test(cleanRus)) {
      return;
    }
    const escapedEng = cleanEng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      new RegExp(`\\b${escapedEng}\\b`, 'i').test(engText) ||
      combinedRus.toLowerCase().includes(cleanRus.toLowerCase().slice(0, 6))
    ) {
      if (!base.artifactsAndFlames.includes(cleanRus)) {
        base.artifactsAndFlames.push(cleanRus);
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
          if (cat === 'units') return;
          Object.values(glossary?.[cat] || {}).forEach((entity) => {
            if (!entity || entity.length < 3 || !/[а-яёА-ЯЁ]/.test(entity)) return;
            const esc = entity.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const wordBoundaryRe = new RegExp(`(?<![а-яёa-z0-9])${esc}(?![а-яёa-z0-9])`, 'i');
            if (wordBoundaryRe.test(cleanQ)) {
              relatedEntities.push(entity);
            }
          });
        });
        if (relatedEntities.length === 0) {
          const questionStopwords = new Set([
            'что', 'кто', 'где', 'куда', 'откуда', 'когда', 'почему', 'зачем',
            'как', 'какой', 'какая', 'какое', 'какие', 'чей', 'чья', 'чьё', 'чьи',
            'неужели', 'разве', 'или', 'если', 'хотя', 'это', 'этот', 'эта', 'эти',
            'тот', 'та', 'те', 'он', 'она', 'они', 'мы', 'вы', 'ты', 'ли', 'же', 'ведь',
            'сможет', 'может', 'будет', 'есть', 'нет',
          ]);
          const firstCap = (cleanQ.match(/[А-ЯЁ][а-яё]{2,}/g) || [])
            .filter((w) => !questionStopwords.has(w.toLowerCase()))
            .slice(0, 2);
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
    let gender: GrammaticalGender = dictHit?.gender || 'UNKNOWN';
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

/**
 * Post-filters LLM Scout candidate terms through Agent S (Subtraction) and Number-Parity rules:
 * - Blocks system rank/grade/level formulas (`Tier 1 High Grade`, `Mastery`, `Perfection`, `Chapter 5`)
 *   that are governed by `TIER_VS_GRADE` and `WRITTEN_NUMERALS`.
 * - Blocks terms where `eng` has Arabic digits (`1`) that were converted to words (`первый`) in `rus_suggested`.
 * - Blocks lowercase common nouns (`rogue cultivators`) and untranslated Latin strings.
 */
export function filterScoutedTermsWithAgentS<
  T extends {
    eng: string;
    rus_suggested: string;
    category: GlossaryCategory;
    gender?: GrammaticalGender;
    context_snippet?: string;
    confidence?: number;
  },
>(
  candidates: T[],
  existingGlossary?: CanonicalGlossary,
  existingScouted?: ScoutedTerm[]
): T[] {
  if (!Array.isArray(candidates)) return [];

  const knownAll = new Set<string>();
  if (existingGlossary) {
    (Object.keys(existingGlossary) as GlossaryCategory[]).forEach((cat) => {
      Object.keys(existingGlossary[cat] || {}).forEach((k) =>
        knownAll.add(k.trim().toLowerCase())
      );
    });
  }
  (existingScouted || []).forEach((t) => {
    if (t?.eng) knownAll.add(t.eng.trim().toLowerCase());
  });

  const out: T[] = [];
  for (const item of candidates) {
    const eng = (item?.eng || '').trim();
    const rus = (item?.rus_suggested || '').trim();
    if (!eng || !rus || !/[а-яёА-ЯЁ]/.test(rus)) continue;
    if (knownAll.has(eng.toLowerCase())) continue;

    // 1. Block structural rank/tier/grade/system labels handled by deterministic rules
    if (
      /^(?:Chapter|Tier|Level|Stage|Layer|Rank|Grade|Mastery|Perfection|Speed\s+Bonus|Low\s+Grade|Mid(?:dle)?\s+Grade|High\s+Grade|Peak\s+Grade)\b/i.test(
        eng
      ) ||
      /\b(?:Low|Mid(?:dle)?|High|Peak)\s+Grade$/i.test(eng)
    ) {
      continue;
    }

    // 2. Require capitalized proper noun (or whitelisted Daoist unit)
    if (!/^[A-Z]/.test(eng) && !/^(?:dantian|qi|jin|liang|li|zhang)$/i.test(eng)) {
      continue;
    }

    // 3. Enforce Arabic number parity between eng and rus_suggested
    const engNums = eng.match(/\d+/g) || [];
    const rusNums = new Set(rus.match(/\d+/g) || []);
    if (engNums.some((n) => !rusNums.has(n))) {
      continue;
    }

    knownAll.add(eng.toLowerCase());
    out.push({
      ...item,
      eng,
      rus_suggested: rus,
    });
  }

  return out;
}

// ============================================================================
// MODULE 6: GOOGLE COLAB L4 (24GB VRAM) & MULTI-MODEL PROVIDER ADAPTER
// ============================================================================

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

export interface GeminiCloudModelSpec {
  id: string;
  title: string;
  role: 'primary' | 'critic' | 'scout';
  quotaPerProject: string;
  contextWindow: string;
  supportsXHighThinking: boolean;
  roleBadge: string;
  descriptionRus: string;
}

export const GEMINI_CLOUD_MODEL_CATALOG: GeminiCloudModelSpec[] = [
  {
    id: 'gemini-4-hydrogen',
    title: 'Gemini 4 Hydrogen',
    role: 'primary',
    quotaPerProject: '5 RPM · 250K TPM · 20 RPD / проект',
    contextWindow: '1M',
    supportsXHighThinking: true,
    roleBadge: 'Флагман художественного перевода (Pass 1)',
    descriptionRus:
      'Топовая облачная модель с уровнями мышления LOW/MEDIUM/HIGH/XHIGH и переливом на Flash при исчерпании дневного лимита.',
  },
  {
    id: 'gemini-3.8-flash',
    title: 'Gemini 3.8 Flash',
    role: 'critic',
    quotaPerProject: 'Free Tier · высокий RPD',
    contextWindow: '1M',
    supportsXHighThinking: false,
    roleBadge: 'Хирург Pass 2, Стилист Pass 3 и резерв',
    descriptionRus:
      'Быстрая облачная модель для хирургической правки дефектов, литературной шлифовки и автоматического подхвата при исчерпании квоты Hydrogen.',
  },
  {
    id: 'gemma-4-31b-it',
    title: 'Gemma 4 31B IT (Cloud)',
    role: 'primary',
    quotaPerProject: 'Отдельная квота Gemma API',
    contextWindow: '256K',
    supportsXHighThinking: false,
    roleBadge: 'Облачный литературный резерв',
    descriptionRus:
      'Плотная 31B модель на серверах Google AI Studio с живым русским диалоговым слогом и отдельным дневным бюджетом.',
  },
  {
    id: 'gemma-4-26b-a4b-it',
    title: 'Gemma 4 26B A4B IT (Cloud)',
    role: 'primary',
    quotaPerProject: 'Отдельная квота Gemma API',
    contextWindow: '256K',
    supportsXHighThinking: false,
    roleBadge: 'Скоростной облачный MoE',
    descriptionRus:
      'Быстрая MoE-модель (~4B активных параметров) для массового прогона глав в облаке при заполнении квот линейки Gemini.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    title: 'Gemini 3.1 Flash Lite',
    role: 'scout',
    quotaPerProject: 'Высокая облачная квота',
    contextWindow: '1M',
    supportsXHighThinking: false,
    roleBadge: 'Пре-скаут терминов и родов (Pass 0)',
    descriptionRus:
      'Сверхбыстрая облачная модель для генерации предложенных русских переводов новых имён и техник.',
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
  provider: 'gemini_api',
  colabEndpointUrl: '',
  modelId: 'gemini-4-hydrogen',
  scoutModelId: 'gemini-3.1-flash-lite',
  criticModelId: 'gemini-3.8-flash',
  stylistModelId: 'gemini-3.8-flash',
  thinkingLevel: 'auto_xhigh',
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
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) return '';
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProto
    .replace(/\/+(?:v1\/chat\/completions|v1\/models|v1|api\/chat|api\/generate|api\/tags)\/?$/i, '')
    .replace(/\/+$/, '');
}

function parseIpv4Octets(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return [octets[0], octets[1], octets[2], octets[3]];
}

function isBlockedIpv4Octets(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // RFC1918 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local / cloud metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12
  if (a === 192 && (b === 168 || b === 0)) return true; // 192.0.0.0/24 & RFC1918 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast & reserved
  return false;
}

function parseIpv6Hextets(rawAddr: string): number[] | null {
  const addr = rawAddr.split('%')[0].toLowerCase();
  if (!addr.includes(':')) return null;
  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const parseTokens = (segment: string): number[] | null => {
    if (!segment) return [];
    const tokens = segment.split(':');
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok) return null;
      if (tok.includes('.')) {
        if (i !== tokens.length - 1) return null;
        const ipv4 = parseIpv4Octets(tok);
        if (!ipv4) return null;
        out.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        out.push(parseInt(tok, 16));
      }
    }
    return out;
  };

  if (halves.length === 1) {
    const full = parseTokens(halves[0]);
    return full && full.length === 8 ? full : null;
  }
  const left = parseTokens(halves[0]);
  const right = parseTokens(halves[1]);
  if (!left || !right) return null;
  const gap = 8 - (left.length + right.length);
  if (gap < 1) return null;
  return [...left, ...new Array(gap).fill(0), ...right];
}

function isBlockedIpv6Host(host: string): boolean {
  const hextets = parseIpv6Hextets(host);
  if (!hextets) return true;
  const headZero = hextets.slice(0, 7).every((h) => h === 0);
  if (headZero && (hextets[7] === 0 || hextets[7] === 1)) {
    return true; // :: and ::1
  }
  // IPv4-mapped ::ffff:0:0/96 (incl. [::ffff:a9fe:a9fe], [::ffff:169.254.169.254]) & IPv4-compatible ::/96
  if (hextets.slice(0, 5).every((h) => h === 0) && (hextets[5] === 0xffff || hextets[5] === 0)) {
    return true;
  }
  // NAT64 64:ff9b::/96
  if (
    hextets[0] === 0x0064 &&
    hextets[1] === 0xff9b &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0
  ) {
    return true;
  }
  const first = hextets[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

/**
 * Validates a Colab / Ollama endpoint URL against SSRF to cloud metadata, loopback/CGNAT/RFC1918/IPv6 internal ranges,
 * credentialed URLs, or unsafe plain HTTP hosts (allowing only local Ollama port 11434 or public https://).
 */
export function validateColabEndpointUrl(rawUrl: string): {
  ok: boolean;
  normalizedUrl: string;
  error?: string;
} {
  const normalized = normalizeColabEndpointUrl(rawUrl);
  if (!normalized) {
    return { ok: false, normalizedUrl: '', error: 'Empty or unsupported URL scheme' };
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, normalizedUrl: '', error: 'Only http:// and https:// are allowed' };
    }
    if (parsed.username || parsed.password) {
      return {
        ok: false,
        normalizedUrl: '',
        error: 'Credentials (user:pass) are forbidden in endpoint URL (SSRF guard)',
      };
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    if (!host) {
      return { ok: false, normalizedUrl: '', error: 'Missing endpoint hostname' };
    }

    if (parsed.protocol === 'http:') {
      const isAllowedOllamaLocal =
        (host === 'localhost' || host === '127.0.0.1') &&
        parsed.port === '11434' &&
        !parsed.search &&
        !parsed.hash;
      if (!isAllowedOllamaLocal) {
        return {
          ok: false,
          normalizedUrl: '',
          error:
            'Blocked non-HTTPS endpoint: http:// is restricted strictly to http://localhost:11434 or http://127.0.0.1:11434 (SSRF guard)',
        };
      }
      return { ok: true, normalizedUrl: normalized };
    }

    // Strict SSRF checks for https:// endpoints
    if (
      host === 'localhost' ||
      host === 'metadata.google.internal' ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      host.endsWith('.local') ||
      host.endsWith('.localdomain')
    ) {
      return {
        ok: false,
        normalizedUrl: '',
        error: 'Blocked internal/local hostname (SSRF guard)',
      };
    }

    if (host.includes(':') && isBlockedIpv6Host(host)) {
      return {
        ok: false,
        normalizedUrl: '',
        error: 'Blocked internal, loopback, link-local, mapped, or multicast IPv6 address (SSRF guard)',
      };
    }

    if (/^(?:\d+|0x[0-9a-f]+)$/i.test(host)) {
      return {
        ok: false,
        normalizedUrl: '',
        error: 'Blocked obfuscated integer/hex IP hostname (SSRF guard)',
      };
    }

    const ipv4 = parseIpv4Octets(host);
    if (ipv4 && isBlockedIpv4Octets(ipv4)) {
      return {
        ok: false,
        normalizedUrl: '',
        error: 'Blocked private, loopback, CGNAT, or link-local IPv4 host (SSRF guard)',
      };
    }

    return { ok: true, normalizedUrl: normalized };
  } catch {
    return { ok: false, normalizedUrl: '', error: 'Invalid URL format' };
  }
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
    .replace(/!\.(?!\.)/g, '!')
    .replace(/\?\.(?!\.)/g, '?')
    .replace(/,,+/g, ',')
    .replace(/(?<!\.)\.\.,/g, '...')
    .replace(/^(\s*)—,\s*/gm, '$1— ')
    .replace(/[ \t]+([,.;!?])/g, '$1');
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
