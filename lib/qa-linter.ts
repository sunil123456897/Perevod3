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


