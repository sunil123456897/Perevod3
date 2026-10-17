/**
 * Pure TypeScript implementation of the Universal Web-Novel & Xianxia Deterministic QA Linter,
 * Configurable Rule Profiles, Character Gender & Voice/Politeness Validator, Rolling Chapter Memory,
 * 1:1 Paragraph Alignment & Drift Detector, Proximity Tautology Radar, Retroactive Canon Ripple Engine,
 * Word-Level Inline Diff, Bulk Chapter Parser, Rulate LF Exporter, and Split-Chapter Merger.
 * Self-contained module testable via `node --test`.
 */

export type GlossaryCategory =
  | 'realms'
  | 'characters'
  | 'sects_and_places'
  | 'system_and_terms'
  | 'units';

export type GrammaticalGender = 'M' | 'F' | 'N' | 'PL';

export interface GlossaryTermMeta {
  gender?: GrammaticalGender;
  declensionNote?: string; // e.g., "не склоняется" or "род. п.: Су Цинсюэ"
  voiceNote?: string; // e.g., "к ученикам на «ты», архаично-властный тон; к нему все на «вы»"
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
  | 'LATIN_LEAKAGE_AND_BRACKETS';

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

/**
 * Global Retroactive Canon Ripple Refactoring:
 * Replaces old Russian glossary term across all translated chapters while preserving case/capitalization.
 */
export interface CanonRippleChapterChange {
  chapterId: string;
  chapterNumber: number;
  ReplacementsCount: number;
  updatedTitleRus: string;
  updatedRusText: string;
  previewBefore: string;
  previewAfter: string;
}

export function previewAndApplyCanonRipple<
  T extends { id: string; number: number; titleRus: string; rusText: string }
>(
  chapters: T[],
  oldRusTerm: string,
  newRusTerm: string
): {
  changes: CanonRippleChapterChange[];
  totalOccurrences: number;
} {
  const cleanOld = oldRusTerm.trim();
  const cleanNew = newRusTerm.trim();
  if (!cleanOld || !cleanNew || cleanOld.toLowerCase() === cleanNew.toLowerCase()) {
    return { changes: [], totalOccurrences: 0 };
  }

  const escapedOld = cleanOld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?<![а-яёa-z])${escapedOld}(?![а-яёa-z])`, 'gi');

  const changes: CanonRippleChapterChange[] = [];
  let totalOccurrences = 0;

  for (const ch of chapters) {
    if (!ch.rusText.trim() && !ch.titleRus.trim()) continue;
    const matchesInBody = ch.rusText.match(regex) || [];
    const matchesInTitle = ch.titleRus.match(regex) || [];
    const count = matchesInBody.length + matchesInTitle.length;
    if (count === 0) continue;

    totalOccurrences += count;

    const replacePreservingCase = (match: string) => {
      const isUpperFirst =
        match[0] === match[0].toUpperCase() &&
        cleanOld[0] === cleanOld[0].toLowerCase();
      if (isUpperFirst) {
        return cleanNew.charAt(0).toUpperCase() + cleanNew.slice(1);
      }
      return cleanNew;
    };

    const updatedTitleRus = ch.titleRus.replace(regex, replacePreservingCase);
    const updatedRusText = ch.rusText.replace(regex, replacePreservingCase);

    const firstMatchingLine =
      ch.rusText.split(/\r?\n/).find((l) => regex.test(l)) || ch.titleRus;
    regex.lastIndex = 0;
    const previewAfter = firstMatchingLine.replace(regex, replacePreservingCase);

    changes.push({
      chapterId: ch.id,
      chapterNumber: ch.number,
      ReplacementsCount: count,
      updatedTitleRus,
      updatedRusText,
      previewBefore: firstMatchingLine,
      previewAfter,
    });
  }

  return { changes, totalOccurrences };
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

    // 10. MACHINE_CALQUES
    if (
      activeRules.has('MACHINE_CALQUES') &&
      /(?:не\s+удержался\s+от\s+(?:того,\s+чтобы|вопроса)|втянул\s+глоток\s+холодного\s+воздуха)/i.test(
        line
      )
    ) {
      issues.push({
        id: `lint-${lineNum}-calque`,
        ruleId: 'MACHINE_CALQUES',
        ruleTitle: 'Машинная калька / пурпурная проза',
        severity: 'error',
        line: lineNum,
        snippet: line,
        suggestion: line
          .replace(/не\s+удержался\s+от\s+вопроса/gi, 'невольно поинтересовался')
          .replace(/не\s+удержался\s+от\s+того,\s+чтобы\s+не\s+/gi, 'не сдержался и ')
          .replace(/не\s+удержался\s+от\s+того,\s+чтобы\s+/gi, 'не сдержался и ')
          .replace(/втянул\s+глоток\s+холодного\s+воздуха/gi, 'судорожно перевёл дыхание'),
        explanation:
          'Буквальные кальки («не удержался от вопроса», «втянул глоток холодного воздуха») заменяются живой литературной речью.',
      });
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

/**
 * Live Hero & World State Ledger (Auto-State Tracker across 50-500 chapters)
 */
export interface HeroStateLedger {
  protagonistName: string;
  cultivationRealm: string;
  resources: string[];
  artifactsAndFlames: string[];
  activeLocation: string;
  lastUpdatedChapter: number;
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
        resources: [...currentLedger.resources],
        artifactsAndFlames: [...currentLedger.artifactsAndFlames],
      }
    : {
        protagonistName: Object.values(glossary.characters)[0] || 'Линь Сюань',
        cultivationRealm: '3-й слой Очищения Ци',
        resources: ['Очки Истока: 100'],
        artifactsAndFlames: [],
        activeLocation: Object.values(glossary.sects_and_places)[0] || 'Секта Каменных Демонов',
        lastUpdatedChapter: 1,
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

  base.lastUpdatedChapter = Math.max(base.lastUpdatedChapter, chapterNumber);
  return base;
}

/**
 * Lookahead Batch Pre-Scouting across multiple chapters at once.
 * Aggregates cross-chapter term occurrences and boosts recurring terms to >=95% confidence.
 */
export function batchLookaheadScoutChapters(
  chapters: Array<{ number: number; titleEng: string; engText: string }>,
  glossary: CanonicalGlossary,
  existingScouted: ScoutedTerm[]
): {
  discoveredTerms: ScoutedTerm[];
  autoPromotedCount: number;
} {
  const knownEng = new Set<string>();
  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    Object.keys(glossary[cat] || {}).forEach((k) => knownEng.add(k.toLowerCase()));
  });
  existingScouted.forEach((t) => knownEng.add(t.eng.toLowerCase()));

  const builtins: Record<
    string,
    { rus: string; cat: GlossaryCategory; gender?: GrammaticalGender }
  > = {
    'Foundation Establishment Pill': {
      rus: 'Пилюля Заложения Основ',
      cat: 'system_and_terms',
      gender: 'F',
    },
    'Foundation Establishment': {
      rus: 'Заложение Основ',
      cat: 'realms',
      gender: 'N',
    },
    'Inner Sect': {
      rus: 'Внутренняя Секта',
      cat: 'sects_and_places',
      gender: 'F',
    },
    'Outer Sect': {
      rus: 'Внешняя Секта',
      cat: 'sects_and_places',
      gender: 'F',
    },
    'Crimson Flame Pavilion': {
      rus: 'Павильон Багрового Пламени',
      cat: 'sects_and_places',
      gender: 'M',
    },
    'Blood Condensation Pill': {
      rus: 'Пилюля Конденсации Крови',
      cat: 'system_and_terms',
      gender: 'F',
    },
    'Black Iron Cauldron': {
      rus: 'Котёл Чёрного Железа',
      cat: 'system_and_terms',
      gender: 'M',
    },
    'Secret Realm': {
      rus: 'Тайное Царство',
      cat: 'sects_and_places',
      gender: 'N',
    },
  };

  const hitMap = new Map<
    string,
    {
      eng: string;
      rus: string;
      category: GlossaryCategory;
      gender: GrammaticalGender;
      firstChapter: number;
      chapterOccurrences: number;
      snippet: string;
    }
  >();

  for (const ch of chapters) {
    for (const [eng, meta] of Object.entries(builtins)) {
      if (knownEng.has(eng.toLowerCase())) continue;
      if (ch.engText.toLowerCase().includes(eng.toLowerCase())) {
        const cur = hitMap.get(eng);
        if (cur) {
          cur.chapterOccurrences += 1;
        } else {
          hitMap.set(eng, {
            eng,
            rus: meta.rus,
            category: meta.cat,
            gender: meta.gender || 'M',
            firstChapter: ch.number,
            chapterOccurrences: 1,
            snippet: ch.engText.slice(0, 140),
          });
        }
      }
    }
  }

  const discoveredTerms: ScoutedTerm[] = [];
  let idx = 0;
  hitMap.forEach((val) => {
    const confidence = val.chapterOccurrences >= 2 ? 0.98 : 0.95;
    discoveredTerms.push({
      id: `lookahead-${Date.now()}-${idx++}`,
      eng: val.eng,
      rus_suggested: val.rus,
      category: val.category,
      gender: val.gender,
      chapter_first_seen: val.firstChapter,
      context_snippet: val.snippet,
      approved_for_glossary: true,
      confidence,
    });
  });

  return {
    discoveredTerms,
    autoPromotedCount: discoveredTerms.length,
  };
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

