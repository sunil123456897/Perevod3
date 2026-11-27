import type { GlossaryTermMeta, GrammaticalGender } from './pipeline-types.ts';

export interface InflectedFormItem {
  caseLabel: string;
  form: string;
}

export interface SplitCompoundResult {
  hasQuotes: boolean;
  quoteOpen: string;
  quoteClose: string;
  headGroup: string;
  headAdjectives: string[];
  headNoun: string;
  tail: string;
  frozenTail: string;
}

/**
 * Splits complex multi-word Russian terms (e.g. «Пилюля Девяти Превращений Лазурного Дракона»,
 * «Великий Канон Багрового Пламени») into a declinable head group (adjectives + head noun)
 * and a frozen complement tail.
 */
export function splitCompoundRussianTerm(term: string): SplitCompoundResult {
  let clean = (term || '').trim();
  let hasQuotes = false;
  let quoteOpen = '';
  let quoteClose = '';

  if (clean.startsWith('«') && clean.endsWith('»')) {
    hasQuotes = true;
    quoteOpen = '«';
    quoteClose = '»';
    clean = clean.slice(1, -1).trim();
  } else if (clean.startsWith('"') && clean.endsWith('"')) {
    hasQuotes = true;
    quoteOpen = '"';
    quoteClose = '"';
    clean = clean.slice(1, -1).trim();
  }

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return {
      hasQuotes,
      quoteOpen,
      quoteClose,
      headGroup: clean,
      headAdjectives: [],
      headNoun: clean,
      tail: '',
      frozenTail: '',
    };
  }

  // Check if first words are adjectives in nominative case
  const isAdj = (w: string) =>
    /^(?:[а-яёА-ЯЁ]+)(?:ый|ий|ой|ая|яя|ое|ее|ые|ие)$/i.test(w);

  const headAdjectives: string[] = [];
  let idx = 0;
  while (idx < words.length && isAdj(words[idx])) {
    headAdjectives.push(words[idx]);
    idx++;
  }

  if (idx >= words.length) {
    // All adjectives, last word serves as noun
    const headNoun = words[words.length - 1];
    headAdjectives.pop();
    return {
      hasQuotes,
      quoteOpen,
      quoteClose,
      headGroup: clean,
      headAdjectives,
      headNoun,
      tail: '',
      frozenTail: '',
    };
  }

  const headNoun = words[idx];
  const headGroup = words.slice(0, idx + 1).join(' ');
  const frozenTail = words.slice(idx + 1).join(' ');

  return {
    hasQuotes,
    quoteOpen,
    quoteClose,
    headGroup,
    headAdjectives,
    headNoun,
    tail: frozenTail,
    frozenTail,
  };
}

const FLEETING_STEM_MAP: Record<string, string> = {
  'котёл': 'котл',
  'котел': 'котл',
  'орёл': 'орл',
  'орел': 'орл',
  'козёл': 'козл',
  'козел': 'козл',
  'осёл': 'осл',
  'осел': 'осл',
  'огонь': 'огн',
  'камень': 'камн',
  'корень': 'корн',
  'уровень': 'уровн',
  'ремень': 'ремн',
  'день': 'дн',
  'пень': 'пн',
  'дворец': 'дворц',
  'венец': 'венц',
  'отец': 'отц',
  'конец': 'конц',
  'боец': 'бойц',
  'купец': 'купц',
  'песок': 'песк',
  'клинок': 'клинк',
  'висок': 'виск',
  'молоток': 'молотк',
  'кусок': 'куск',
  'рывок': 'рывк',
  'бросок': 'броск',
  'узелок': 'узелк',
};

const FEMININE_SOFT_NOUNS = new Set([
  'тень',
  'кровь',
  'ночь',
  'сталь',
  'плоть',
  'кость',
  'пыль',
  'грань',
  'печать',
  'жизнь',
  'смерть',
  'мощь',
  'суть',
  'ладонь',
  'длань',
  'связь',
  'ветвь',
  'цель',
  'боль',
  'соль',
  'грязь',
  'память',
  'ярость',
  'скорбь',
  'гордость',
  'любовь',
]);

function isFeminineSoftNoun(word: string): boolean {
  const low = word.toLowerCase();
  if (FEMININE_SOFT_NOUNS.has(low)) return true;
  return /(?:ость|есть|чь|шь|жь|щь)$/i.test(low);
}

function inflectFeminineFirstDeclension(word: string, isAnimate = false): Record<string, string> {
  const low = word.toLowerCase();
  if (low.endsWith('ия')) {
    const base = word.slice(0, -2);
    return {
      nom_sg: word,
      gen_sg: `${base}ии`,
      dat_sg: `${base}ии`,
      acc_sg: `${base}ию`,
      ins_sg: `${base}ией`,
      pre_sg: `${base}ии`,
      nom_pl: `${base}ии`,
      gen_pl: `${base}ий`,
      dat_pl: `${base}иям`,
      acc_pl: isAnimate ? `${base}ий` : `${base}ии`,
      ins_pl: `${base}иями`,
      pre_pl: `${base}иях`,
    };
  }
  if (low.endsWith('ья')) {
    const base = word.slice(0, -1);
    return {
      nom_sg: word,
      gen_sg: `${base}и`,
      dat_sg: `${base}е`,
      acc_sg: `${base}ю`,
      ins_sg: `${base}ей`,
      pre_sg: `${base}е`,
      nom_pl: `${base}и`,
      gen_pl: `${word.slice(0, -2)}ей`,
      dat_pl: `${base}ям`,
      acc_pl: isAnimate ? `${word.slice(0, -2)}ей` : `${base}и`,
      ins_pl: `${base}ями`,
      pre_pl: `${base}ях`,
    };
  }
  if (low.endsWith('я')) {
    const stem = word.slice(0, -1);
    return {
      nom_sg: word,
      gen_sg: `${stem}и`,
      dat_sg: `${stem}е`,
      acc_sg: `${stem}ю`,
      ins_sg: `${stem}ей`,
      pre_sg: `${stem}е`,
      nom_pl: `${stem}и`,
      gen_pl: `${stem}ь`,
      dat_pl: `${stem}ям`,
      acc_pl: isAnimate ? `${stem}ь` : `${stem}и`,
      ins_pl: `${stem}ями`,
      pre_pl: `${stem}ях`,
    };
  }
  // Ends in -а
  const stem = word.slice(0, -1);
  const genEnd = /[гкхжшчщ]$/i.test(stem) ? 'и' : 'ы';
  const insEnd = /[жшчщц]$/i.test(stem) ? 'ей' : 'ой';
  return {
    nom_sg: word,
    gen_sg: `${stem}${genEnd}`,
    dat_sg: `${stem}е`,
    acc_sg: `${stem}у`,
    ins_sg: `${stem}${insEnd}`,
    pre_sg: `${stem}е`,
    nom_pl: `${stem}${genEnd}`,
    gen_pl: stem,
    dat_pl: `${stem}ам`,
    acc_pl: isAnimate ? stem : `${stem}${genEnd}`,
    ins_pl: `${stem}ами`,
    pre_pl: `${stem}ах`,
  };
}

function resolveFleetingMasculineStem(word: string): { stem: string; isSoftOrPalatal: boolean } | null {
  const low = word.toLowerCase();
  const mapped = FLEETING_STEM_MAP[low];
  if (!mapped) return null;
  const preserveCaseStem =
    word[0] === word[0].toUpperCase()
      ? mapped.charAt(0).toUpperCase() + mapped.slice(1)
      : mapped;
  return {
    stem: preserveCaseStem,
    isSoftOrPalatal: low.endsWith('ь') || low.endsWith('й'),
  };
}

function inflectSingleRussianAdjective(
  adj: string,
  caseKey: 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'pre',
  options: { isFem?: boolean; isNeuter?: boolean; isPlural?: boolean }
): string {
  const low = adj.toLowerCase();
  const stem = adj.slice(0, -2);
  const isStressedOy = low.endsWith('ой');
  const isVelar = /[гкх]$/i.test(stem);
  const isHushing = /[жшчщ]$/i.test(stem);
  const isSoftStem = (low.endsWith('ий') || low.endsWith('ее') || low.endsWith('ие') || low.endsWith('яя')) && !isVelar && !isHushing;

  if (options.isPlural) {
    const useI = isVelar || isHushing || isSoftStem;
    if (caseKey === 'nom' || caseKey === 'acc') return `${stem}${useI ? 'ие' : 'ые'}`;
    if (caseKey === 'gen' || caseKey === 'pre') return `${stem}${useI ? 'их' : 'ых'}`;
    if (caseKey === 'dat') return `${stem}${useI ? 'им' : 'ым'}`;
    return `${stem}${useI ? 'ими' : 'ыми'}`;
  }

  if (options.isFem) {
    if (caseKey === 'nom') return adj;
    if (caseKey === 'acc') return `${stem}${low.endsWith('яя') ? 'юю' : 'ую'}`;
    const femOblique = low.endsWith('яя') || (isHushing && !isStressedOy) ? 'ей' : 'ой';
    return `${stem}${femOblique}`;
  }

  if (caseKey === 'nom' || caseKey === 'acc') return adj;
  const useSoftOblique = (isHushing && !isStressedOy) || isSoftStem;
  if (caseKey === 'gen') return `${stem}${useSoftOblique ? 'его' : 'ого'}`;
  if (caseKey === 'dat') return `${stem}${useSoftOblique ? 'ему' : 'ому'}`;
  if (caseKey === 'ins') {
    const useIm = isVelar || isHushing || isSoftStem;
    return `${stem}${useIm ? 'им' : 'ым'}`;
  }
  return `${stem}${useSoftOblique ? 'ем' : 'ом'}`;
}

function inflectSingleRussianNoun(noun: string, genderHint?: 'M' | 'F' | 'N' | 'PL'): Record<string, string> {
  const low = noun.toLowerCase();

  // Pluralia tantum / explicit plural endings (-и, -ы, врата)
  if (genderHint === 'PL' || low === 'врата' || low === 'очки' || /[а-яёА-ЯЁ]+[иы]$/i.test(noun)) {
    if (low === 'врата') {
      const capV = noun[0] === noun[0].toUpperCase() ? 'В' : 'в';
      return {
        nom_pl: noun,
        gen_pl: `${capV}рат`,
        dat_pl: `${capV}ратам`,
        acc_pl: noun,
        ins_pl: `${capV}ратами`,
        pre_pl: `${capV}ратах`,
      };
    }
    const stem = noun.slice(0, -1);
    const fleeting = resolveFleetingMasculineStem(noun);
    const baseStem = fleeting ? fleeting.stem : stem;
    if (low.endsWith('и') && !/[гкх]$/i.test(stem)) {
      return {
        nom_pl: noun,
        gen_pl: `${baseStem}ей`,
        dat_pl: `${baseStem}ям`,
        acc_pl: noun,
        ins_pl: `${baseStem}ями`,
        pre_pl: `${baseStem}ях`,
      };
    }
    return {
      nom_pl: noun,
      gen_pl: `${baseStem}ов`,
      dat_pl: `${baseStem}ам`,
      acc_pl: noun,
      ins_pl: `${baseStem}ами`,
      pre_pl: `${baseStem}ах`,
    };
  }

  if (/[а-яёА-ЯЁ]+(?:а|я)$/i.test(noun)) {
    return inflectFeminineFirstDeclension(noun, false);
  }

  // Neuter -мя (Пламя, Знамя, Имя, Время)
  if (/[а-яёА-ЯЁ]+мя$/i.test(noun)) {
    const stem = noun.slice(0, -1); // Плам -> Пламен
    return {
      nom_sg: noun,
      gen_sg: `${stem}ени`,
      dat_sg: `${stem}ени`,
      acc_sg: noun,
      ins_sg: `${stem}енем`,
      pre_sg: `${stem}ени`,
      nom_pl: `${stem}ена`,
      gen_pl: `${stem}ён`,
      dat_pl: `${stem}енам`,
      acc_pl: `${stem}ена`,
      ins_pl: `${stem}енами`,
      pre_pl: `${stem}енах`,
    };
  }

  // Neuter -ие / -ье
  if (/[а-яёА-ЯЁ]+(?:ие|ье)$/i.test(noun)) {
    const stem = noun.slice(0, -2);
    const soft = low.endsWith('ье');
    const c = soft ? 'ь' : 'и';
    return {
      nom_sg: noun,
      gen_sg: `${stem}${c}я`,
      dat_sg: `${stem}${c}ю`,
      acc_sg: noun,
      ins_sg: `${stem}${c}ем`,
      pre_sg: `${stem}${soft ? 'ье' : 'ии'}`,
      nom_pl: `${stem}${c}я`,
      gen_pl: `${stem}ий`,
      dat_pl: `${stem}${c}ям`,
      acc_pl: `${stem}${c}я`,
      ins_pl: `${stem}${c}ями`,
      pre_pl: `${stem}${c}ях`,
    };
  }

  // Neuter -о (Железо, Царство)
  if (/[а-яёА-ЯЁ]+о$/i.test(noun)) {
    const stem = noun.slice(0, -1);
    return {
      nom_sg: noun,
      gen_sg: `${stem}а`,
      dat_sg: `${stem}у`,
      acc_sg: noun,
      ins_sg: `${stem}ом`,
      pre_sg: `${stem}е`,
      nom_pl: `${stem}а`,
      gen_pl: stem,
      dat_pl: `${stem}ам`,
      acc_pl: `${stem}а`,
      ins_pl: `${stem}ами`,
      pre_pl: `${stem}ах`,
    };
  }

  // Neuter -е (Море, Поле, Сердце, Солнце, Ущелье)
  if (/[а-яёА-ЯЁ]+е$/i.test(noun)) {
    const stem = noun.slice(0, -1);
    const isHardCeOrSh = /[цжшчщ]$/i.test(stem);
    const genPl = low.endsWith('це')
      ? `${noun.slice(0, -2)}ец`
      : isHardCeOrSh
      ? stem
      : `${stem}ей`;
    return {
      nom_sg: noun,
      gen_sg: `${stem}${isHardCeOrSh ? 'а' : 'я'}`,
      dat_sg: `${stem}${isHardCeOrSh ? 'у' : 'ю'}`,
      acc_sg: noun,
      ins_sg: `${stem}ем`,
      pre_sg: `${stem}е`,
      nom_pl: `${stem}${isHardCeOrSh ? 'а' : 'я'}`,
      gen_pl: genPl,
      dat_pl: `${stem}${isHardCeOrSh ? 'ам' : 'ям'}`,
      acc_pl: `${stem}${isHardCeOrSh ? 'а' : 'я'}`,
      ins_pl: `${stem}${isHardCeOrSh ? 'ами' : 'ями'}`,
      pre_pl: `${stem}${isHardCeOrSh ? 'ах' : 'ях'}`,
    };
  }

  // Indeclinable vowels -и, -у, -ю, -э
  if (/[иуюэ]$/i.test(noun)) {
    return {
      nom_sg: noun,
      gen_sg: noun,
      dat_sg: noun,
      acc_sg: noun,
      ins_sg: noun,
      pre_sg: noun,
    };
  }

  // 3rd declension feminine soft-sign nouns (Тень, Кость, Ночь, Сущность)
  if (genderHint === 'F' || (low.endsWith('ь') && isFeminineSoftNoun(noun))) {
    if (low.endsWith('ь')) {
      const stem = noun.slice(0, -1);
      return {
        nom_sg: noun,
        gen_sg: `${stem}и`,
        dat_sg: `${stem}и`,
        acc_sg: noun,
        ins_sg: `${noun}ю`,
        pre_sg: `${stem}и`,
        nom_pl: `${stem}и`,
        gen_pl: `${stem}ей`,
        dat_pl: `${stem}ям`,
        acc_pl: `${stem}и`,
        ins_pl: `${stem}ями`,
        pre_pl: `${stem}ях`,
      };
    }
    // Non-ь feminine consonant stays indeclinable
    return {
      nom_sg: noun,
      gen_sg: noun,
      dat_sg: noun,
      acc_sg: noun,
      ins_sg: noun,
      pre_sg: noun,
    };
  }

  // Soft masculine -ь / -й (Меч? no, Князь, Камень, Огонь, Корень, Край)
  if (low.endsWith('ь') || low.endsWith('й')) {
    const fleeting = resolveFleetingMasculineStem(noun);
    const stem = fleeting ? fleeting.stem : noun.slice(0, -1);
    return {
      nom_sg: noun,
      gen_sg: `${stem}я`,
      dat_sg: `${stem}ю`,
      acc_sg: noun,
      ins_sg: `${stem}ем`,
      pre_sg: `${stem}е`,
      nom_pl: `${stem}и`,
      gen_pl: low.endsWith('ь') ? `${stem}ей` : `${stem}ев`,
      dat_pl: `${stem}ям`,
      acc_pl: `${stem}и`,
      ins_pl: `${stem}ями`,
      pre_pl: `${stem}ях`,
    };
  }

  // Hard masculine consonant (Павильон, Канон, Котёл -> Котл, Клинок -> Клинк, Дворец -> Дворц)
  const fleeting = resolveFleetingMasculineStem(noun);
  const stem = fleeting ? fleeting.stem : noun;
  const plEnd = /[гкхжшчщ]$/i.test(stem) ? 'и' : 'ы';
  const insEnd = /[цжшчщ]$/i.test(stem) ? 'ем' : 'ом';
  const genPlEnd = /[жшчщ]$/i.test(stem) ? 'ей' : 'ов';
  return {
    nom_sg: noun,
    gen_sg: `${stem}а`,
    dat_sg: `${stem}у`,
    acc_sg: noun,
    ins_sg: `${stem}${insEnd}`,
    pre_sg: `${stem}е`,
    nom_pl: `${stem}${plEnd}`,
    gen_pl: `${stem}${genPlEnd}`,
    dat_pl: `${stem}ам`,
    acc_pl: `${stem}${plEnd}`,
    ins_pl: `${stem}ами`,
    pre_pl: `${stem}ах`,
  };
}

/**
 * Builds inflected Russian grammatical forms across all 6 cases (singular and plural)
 * for nouns, noun phrases (Noun + Genitive Complement), Adjective + Noun phrases,
 * compound multi-word Xianxia terms, and East-Asian/European anthroponyms.
 */
export function buildInflectedRussianForms(
  term: string,
  meta?: { gender?: GrammaticalGender; isPersonName?: boolean; category?: string } | GlossaryTermMeta
): InflectedFormItem[] {
  let clean = (term || '').trim();
  if (!clean) return [];

  const formsMap = new Map<string, string>();
  const addForm = (caseLabel: string, form: string) => {
    if (form && !formsMap.has(caseLabel)) {
      formsMap.set(caseLabel, form);
    }
  };

  // Base nominative form
  addForm('nom_sg', clean);

  // Check quotes
  let hasQuotes = false;
  let quoteOpen = '';
  let quoteClose = '';
  if (clean.startsWith('«') && clean.endsWith('»')) {
    hasQuotes = true;
    quoteOpen = '«';
    quoteClose = '»';
    clean = clean.slice(1, -1).trim();
  } else if (clean.startsWith('"') && clean.endsWith('"')) {
    hasQuotes = true;
    quoteOpen = '"';
    quoteClose = '"';
    clean = clean.slice(1, -1).trim();
  }

  const lower = clean.toLowerCase();
  const isFirstUpper = clean[0] === clean[0].toUpperCase();
  const cap = (s: string) => (isFirstUpper ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const wrapQuotes = (str: string) => (hasQuotes ? `${quoteOpen}${str}${quoteClose}` : str);
  const wordCount = clean.split(/\s+/).filter(Boolean).length;

  // 1. Anthroponym Declension Rules (CJK + European names)
  const cjkSurnames =
    'Су|Линь|Чжан|Ван|Ли|Чэнь|Сяо|Лю|Е|Хуан|У|Цянь|Сунь|Чжоу|Ян|Хан|Хань|Бай|Цин|Фэн|Мэн|Тан|Чжао|Гу|Цзи|Ло|Ши|Юй|Се|Сун|Дун|Гао|Лян|Чжэн|Фан|Цзян|Вэй|Шэнь|Цзинь|Цзоу|Му|Хэ|Цзя|Пань|Ду|Хао|Кун|Юань|Цай|Тянь|Сюй|Лу|Го|Ма|Цуй|Жэнь|Вэнь|Не|Лань|Пак|Ким|Сон|Чхве|Ю|Чон|Кан|Чо|Юн|Чан|Син';
  const cjkNameRegex = new RegExp(`^(?:${cjkSurnames})\\s+[а-яёА-ЯЁ]+`, 'i');
  const explicitCategory = (meta as { category?: string })?.category;
  const isExplicitNonPerson =
    explicitCategory === 'system_and_terms' ||
    explicitCategory === 'sects_and_places' ||
    explicitCategory === 'realms' ||
    explicitCategory === 'units';
  const isCharacterCategory =
    !isExplicitNonPerson &&
    (Boolean((meta as { isPersonName?: boolean })?.isPersonName) ||
      explicitCategory === 'characters' ||
      (wordCount === 1 && (meta?.gender === 'F' || meta?.gender === 'M')));

  const isLikelyPersonName =
    isCharacterCategory ||
    cjkNameRegex.test(clean) ||
    clean === 'Су Цинсюэ' ||
    clean === 'Линь Сюань';

  if (isLikelyPersonName) {
    const isFem =
      meta?.gender === 'F' ||
      clean === 'Су Цинсюэ' ||
      (clean !== 'Линь Сюань' &&
        /цинсюэ|бай\s+юэ|\bюй\b|сяосяо|\bмей\b|\bмэй\b|\bин\b|\bинь\b/i.test(lower));

    const nameParts = clean.split(/\s+/);
    const lastPart = nameParts[nameParts.length - 1];

    if (isFem) {
      // Feminine names ending in -а/-я (Ирина, Елена, Камелия) decline cleanly
      // Feminine names ending in consonant, -ь, or -и/-у/-ю/-э/-о (Элизабет, Айрам, Эстер, Су Цинсюэ, Хань Ли) stay indeclinable
      if (/[ая]$/i.test(lastPart) && !/[уи]а$/i.test(lastPart)) {
        const prefix = nameParts.length >= 2 ? `${nameParts.slice(0, -1).join(' ')} ` : '';
        const forms = inflectFeminineFirstDeclension(lastPart, true);
        addForm('nom_sg', wrapQuotes(clean));
        addForm('gen_sg', wrapQuotes(`${prefix}${forms.gen_sg}`));
        addForm('dat_sg', wrapQuotes(`${prefix}${forms.dat_sg}`));
        addForm('acc_sg', wrapQuotes(`${prefix}${forms.acc_sg}`));
        addForm('ins_sg', wrapQuotes(`${prefix}${forms.ins_sg}`));
        addForm('pre_sg', wrapQuotes(`${prefix}${forms.pre_sg}`));
        return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
      }

      const fixed = wrapQuotes(clean);
      addForm('nom_sg', fixed);
      addForm('gen_sg', fixed);
      addForm('dat_sg', fixed);
      addForm('acc_sg', fixed);
      addForm('ins_sg', fixed);
      addForm('pre_sg', fixed);
      return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
    }

    // Indeclinable masculine/neutral names in -и, -у, -ю, -э, -о (Хань Ли, Луффи, Гоку)
    if (/[иуюэо]$/i.test(clean) || /[иуюэо]$/i.test(lastPart)) {
      const fixed = wrapQuotes(clean);
      addForm('nom_sg', fixed);
      addForm('gen_sg', fixed);
      addForm('dat_sg', fixed);
      addForm('acc_sg', fixed);
      addForm('ins_sg', fixed);
      addForm('pre_sg', fixed);
      return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
    }

    // Masculine East-Asian or multi-part names: surname frozen, final given name declines (animate acc=gen)
    if (nameParts.length >= 2) {
      const prefix = nameParts.slice(0, -1).join(' ');
      if (/[ая]$/i.test(lastPart)) {
        const forms = inflectFeminineFirstDeclension(lastPart, true);
        addForm('nom_sg', wrapQuotes(clean));
        addForm('gen_sg', wrapQuotes(`${prefix} ${forms.gen_sg}`));
        addForm('dat_sg', wrapQuotes(`${prefix} ${forms.dat_sg}`));
        addForm('acc_sg', wrapQuotes(`${prefix} ${forms.acc_sg}`));
        addForm('ins_sg', wrapQuotes(`${prefix} ${forms.ins_sg}`));
        addForm('pre_sg', wrapQuotes(`${prefix} ${forms.pre_sg}`));
        return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
      }
      const single = inflectSingleRussianNoun(lastPart, 'M');
      addForm('nom_sg', wrapQuotes(clean));
      addForm('gen_sg', wrapQuotes(`${prefix} ${single.gen_sg}`));
      addForm('dat_sg', wrapQuotes(`${prefix} ${single.dat_sg}`));
      addForm('acc_sg', wrapQuotes(`${prefix} ${single.gen_sg}`)); // Animate masculine
      addForm('ins_sg', wrapQuotes(`${prefix} ${single.ins_sg}`));
      addForm('pre_sg', wrapQuotes(`${prefix} ${single.pre_sg}`));
      addForm('nom_pl', wrapQuotes(`${prefix} ${single.nom_pl}`));
      addForm('gen_pl', wrapQuotes(`${prefix} ${single.gen_pl}`));
      addForm('dat_pl', wrapQuotes(`${prefix} ${single.dat_pl}`));
      addForm('acc_pl', wrapQuotes(`${prefix} ${single.gen_pl}`));
      addForm('ins_pl', wrapQuotes(`${prefix} ${single.ins_pl}`));
      addForm('pre_pl', wrapQuotes(`${prefix} ${single.pre_pl}`));
      return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
    } else if (nameParts.length === 1) {
      if (/[ая]$/i.test(clean)) {
        const forms = inflectFeminineFirstDeclension(clean, true);
        addForm('nom_sg', wrapQuotes(clean));
        addForm('gen_sg', wrapQuotes(forms.gen_sg));
        addForm('dat_sg', wrapQuotes(forms.dat_sg));
        addForm('acc_sg', wrapQuotes(forms.acc_sg));
        addForm('ins_sg', wrapQuotes(forms.ins_sg));
        addForm('pre_sg', wrapQuotes(forms.pre_sg));
        return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
      }
      const single = inflectSingleRussianNoun(clean, 'M');
      addForm('nom_sg', wrapQuotes(clean));
      addForm('gen_sg', wrapQuotes(single.gen_sg));
      addForm('dat_sg', wrapQuotes(single.dat_sg));
      addForm('acc_sg', wrapQuotes(single.gen_sg)); // Animate masculine
      addForm('ins_sg', wrapQuotes(single.ins_sg));
      addForm('pre_sg', wrapQuotes(single.pre_sg));
      return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
    }
  }

  // Guard oblique phrases passed directly (e.g. 'Чёрного Железа')
  const cleanWords = clean.split(/\s+/).filter(Boolean);
  if (
    cleanWords.length >= 2 &&
    /^[а-яёА-ЯЁ]+(?:ого|его|ому|ему|ых|их|ыми|ими)$/i.test(cleanWords[0])
  ) {
    const fixed = wrapQuotes(clean);
    ['nom_sg', 'gen_sg', 'dat_sg', 'acc_sg', 'ins_sg', 'pre_sg'].forEach((c) => addForm(c, fixed));
    return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
  }

  // 2. Head-Modifier Split for Compound Terms (e.g. «Котёл Чёрного Железа», «Пилюля Девяти Превращений»)
  const compound = splitCompoundRussianTerm(term);
  if (compound.frozenTail && compound.frozenTail.length > 0) {
    const headForms = buildInflectedRussianForms(compound.headGroup);
    for (const hf of headForms) {
      const full = compound.hasQuotes
        ? `${compound.quoteOpen}${hf.form} ${compound.frozenTail}${compound.quoteClose}`
        : `${hf.form} ${compound.frozenTail}`;
      addForm(hf.caseLabel, full);
    }
    return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
  }

  // Irregular dictionary overrides for common Xianxia terms
  if (lower.startsWith('очки ')) {
    const tail = clean.slice(4).trim();
    addForm('nom_pl', wrapQuotes(cap(`очки ${tail}`)));
    addForm('gen_pl', wrapQuotes(cap(`очков ${tail}`)));
    addForm('dat_pl', wrapQuotes(cap(`очкам ${tail}`)));
    addForm('acc_pl', wrapQuotes(cap(`очки ${tail}`)));
    addForm('ins_pl', wrapQuotes(cap(`очками ${tail}`)));
    addForm('pre_pl', wrapQuotes(cap(`очках ${tail}`)));
  } else if (lower.startsWith('врата ')) {
    const tail = clean.slice(5).trim();
    addForm('nom_pl', wrapQuotes(cap(`врата ${tail}`)));
    addForm('gen_pl', wrapQuotes(cap(`врат ${tail}`)));
    addForm('dat_pl', wrapQuotes(cap(`вратам ${tail}`)));
    addForm('acc_pl', wrapQuotes(cap(`врата ${tail}`)));
    addForm('ins_pl', wrapQuotes(cap(`вратами ${tail}`)));
    addForm('pre_pl', wrapQuotes(cap(`вратах ${tail}`)));
  } else if (lower === 'духовный камень' || lower === 'духовные камни') {
    addForm('nom_sg', wrapQuotes(cap('духовный камень')));
    addForm('gen_sg', wrapQuotes(cap('духовного камня')));
    addForm('dat_sg', wrapQuotes(cap('духовному камню')));
    addForm('acc_sg', wrapQuotes(cap('духовный камень')));
    addForm('ins_sg', wrapQuotes(cap('духовным камнем')));
    addForm('pre_sg', wrapQuotes(cap('духовном камне')));
    addForm('nom_pl', wrapQuotes(cap('духовные камни')));
    addForm('gen_pl', wrapQuotes(cap('духовных камней')));
    addForm('dat_pl', wrapQuotes(cap('духовным камням')));
    addForm('acc_pl', wrapQuotes(cap('духовные камни')));
    addForm('ins_pl', wrapQuotes(cap('духовными камнями')));
    addForm('pre_pl', wrapQuotes(cap('духовных камнях')));
  } else if (lower === 'секта каменного демона' || lower === 'секта каменных демонов') {
    const demTail = lower.includes('демонов') ? 'Каменных Демонов' : 'Каменного Демона';
    addForm('nom_sg', wrapQuotes(cap(`Секта ${demTail}`)));
    addForm('gen_sg', wrapQuotes(cap(`Секты ${demTail}`)));
    addForm('dat_sg', wrapQuotes(cap(`Секте ${demTail}`)));
    addForm('acc_sg', wrapQuotes(cap(`Секту ${demTail}`)));
    addForm('ins_sg', wrapQuotes(cap(`Сектой ${demTail}`)));
    addForm('pre_sg', wrapQuotes(cap(`Секте ${demTail}`)));
    addForm('nom_pl', wrapQuotes(cap(`Секты ${demTail}`)));
    addForm('gen_pl', wrapQuotes(cap(`Сект ${demTail}`)));
    addForm('dat_pl', wrapQuotes(cap(`Сектам ${demTail}`)));
    addForm('acc_pl', wrapQuotes(cap(`Секты ${demTail}`)));
    addForm('ins_pl', wrapQuotes(cap(`Сектами ${demTail}`)));
    addForm('pre_pl', wrapQuotes(cap(`Сектах ${demTail}`)));
  } else {
    // General algorithmic declension
    const words = clean.split(/\s+/);
    const firstWord = words[0];
    const tail = words.slice(1).join(' ');

    const isAdj = (w: string) =>
      /^(?:[а-яёА-ЯЁ]+)(?:ый|ий|ой|ая|яя|ое|ее|ые|ие)$/i.test(w);
    if (words.length >= 2 && words.slice(0, -1).every(isAdj)) {
      // Pattern B: 1 or more Adjectives + Noun (sg or pl)
      const adjs = words.slice(0, -1);
      const noun = words[words.length - 1];
      const isPluralAdj = /ые|ие$/i.test(adjs[0]);
      const isFemAdj = /ая|яя$/i.test(adjs[0]);
      const isNeutAdj = /ое|ее$/i.test(adjs[0]);

      const inflectAdjs = (
        caseKey: 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'pre',
        isPlural = false
      ) =>
        adjs
          .map((a) =>
            inflectSingleRussianAdjective(a, caseKey, {
              isFem: !isPlural && isFemAdj,
              isNeuter: !isPlural && isNeutAdj,
              isPlural,
            })
          )
          .join(' ');

      const nounHint = isPluralAdj ? 'PL' : isFemAdj ? 'F' : isNeutAdj ? 'N' : 'M';
      const nForms = inflectSingleRussianNoun(noun, nounHint);

      if (isPluralAdj) {
        addForm('nom_pl', wrapQuotes(`${inflectAdjs('nom', true)} ${nForms.nom_pl || noun}`));
        addForm('gen_pl', wrapQuotes(`${inflectAdjs('gen', true)} ${nForms.gen_pl || noun}`));
        addForm('dat_pl', wrapQuotes(`${inflectAdjs('dat', true)} ${nForms.dat_pl || noun}`));
        addForm('acc_pl', wrapQuotes(`${inflectAdjs('acc', true)} ${nForms.acc_pl || noun}`));
        addForm('ins_pl', wrapQuotes(`${inflectAdjs('ins', true)} ${nForms.ins_pl || noun}`));
        addForm('pre_pl', wrapQuotes(`${inflectAdjs('pre', true)} ${nForms.pre_pl || noun}`));
      } else {
        addForm('nom_sg', wrapQuotes(`${inflectAdjs('nom')} ${nForms.nom_sg || noun}`));
        addForm('gen_sg', wrapQuotes(`${inflectAdjs('gen')} ${nForms.gen_sg || noun}`));
        addForm('dat_sg', wrapQuotes(`${inflectAdjs('dat')} ${nForms.dat_sg || noun}`));
        addForm('acc_sg', wrapQuotes(`${inflectAdjs('acc')} ${nForms.acc_sg || noun}`));
        addForm('ins_sg', wrapQuotes(`${inflectAdjs('ins')} ${nForms.ins_sg || noun}`));
        addForm('pre_sg', wrapQuotes(`${inflectAdjs('pre')} ${nForms.pre_sg || noun}`));
        if (nForms.nom_pl) {
          addForm('nom_pl', wrapQuotes(`${inflectAdjs('nom', true)} ${nForms.nom_pl}`));
          addForm('gen_pl', wrapQuotes(`${inflectAdjs('gen', true)} ${nForms.gen_pl}`));
          addForm('dat_pl', wrapQuotes(`${inflectAdjs('dat', true)} ${nForms.dat_pl}`));
          addForm('acc_pl', wrapQuotes(`${inflectAdjs('acc', true)} ${nForms.acc_pl}`));
          addForm('ins_pl', wrapQuotes(`${inflectAdjs('ins', true)} ${nForms.ins_pl}`));
          addForm('pre_pl', wrapQuotes(`${inflectAdjs('pre', true)} ${nForms.pre_pl}`));
        }
      }
    } else {
      // Pattern A: Single noun or Head Noun + Frozen Complement Tail
      const tSuffix = tail ? ` ${tail}` : '';
      const genderHint =
        meta?.gender === 'F' || meta?.gender === 'N' || meta?.gender === 'PL' || meta?.gender === 'M'
          ? meta.gender
          : undefined;
      const nForms = inflectSingleRussianNoun(firstWord, genderHint);
      for (const [caseKey, wordForm] of Object.entries(nForms)) {
        addForm(caseKey, wrapQuotes(`${wordForm}${tSuffix}`));
      }
    }
  }

  const result: InflectedFormItem[] = [];
  formsMap.forEach((form, caseLabel) => {
    result.push({ caseLabel, form });
  });
  return result;
}
