import {
  filterGlossaryForChapter,
  runAdditionBySubtractionScout,
  type CanonicalGlossary,
  type GlossaryCategory,
  type GlossaryTermMeta,
  type GrammaticalGender,
  type ScoutedTerm,
  type CharacterSpeechVector,
} from './qa-linter.ts';

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

/**
 * Builds inflected Russian grammatical forms across all 6 cases (singular and plural)
 * for nouns, noun phrases (Noun + Genitive Complement), Adjective + Noun phrases,
 * compound multi-word Xianxia terms, and East-Asian anthroponyms.
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

  // 1. East-Asian Anthroponym Declension Rules (CJK Declension Guard)
  const isCharacterCategory =
    Boolean((meta as any)?.isPersonName) ||
    meta?.gender === 'F' ||
    meta?.gender === 'M' ||
    (meta as { category?: string })?.category === 'characters';

  const cjkSurnames =
    'Су|Линь|Чжан|Ван|Ли|Чэнь|Сяо|Лю|Е|Хуан|У|Цянь|Сунь|Чжоу|Ян|Хан|Хань|Бай|Цин|Фэн|Мэн|Тан|Чжао|Гу|Цзи|Ло|Ши|Юй|Се|Сун|Дун|Гао|Лян|Чжэн|Фан|Цзян|Вэй|Шэнь|Цзинь|Цзоу|Му|Хэ|Цзя|Пань|Ду|Хао|Кун|Юань|Цай|Тянь|Сюй|Лу|Го|Ма|Цуй|Жэнь|Вэнь|Не|Лань|Пак|Ким|Сон|Чхве|Ю|Чон|Кан|Чо|Юн|Чан|Син';
  const cjkNameRegex = new RegExp(`^(?:${cjkSurnames})\\s+[а-яёА-ЯЁ]+`, 'i');
  const isLikelyCjkName =
    isCharacterCategory ||
    cjkNameRegex.test(clean) ||
    clean === 'Су Цинсюэ' ||
    clean === 'Линь Сюань';

  if (isLikelyCjkName) {
    const isFem =
      meta?.gender === 'F' ||
      clean === 'Су Цинсюэ' ||
      (clean !== 'Линь Сюань' && /цинсюэ|бай\s+юэ|\bюй\b|сяосяо|\bмей\b|\bмэй\b|\bин\b|\bинь\b/i.test(lower));

    const nameParts = clean.split(/\s+/);
    const lastPart = nameParts[nameParts.length - 1];

    // Rule A: Syllables ending in -и, -у, -ю, -э, -о are indeclinable in Russian
    // Rule B: Feminine East-Asian names ending in consonants or -ь are indeclinable (нескл.)
    if (isFem || /[иуюэо]$/i.test(clean) || /[иуюэо]$/i.test(lastPart)) {
      const fixed = wrapQuotes(clean);
      addForm('nom_sg', fixed);
      addForm('gen_sg', fixed);
      addForm('dat_sg', fixed);
      addForm('acc_sg', fixed);
      addForm('ins_sg', fixed);
      addForm('pre_sg', fixed);
      return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
    }

    // Rule C: Masculine East-Asian names (Линь Сюань, Чжан Вэй, Хан Сень, Чжао Фэн)
    // First syllables are frozen surnames, only the final syllable declines!
    if (nameParts.length >= 2) {
      const prefix = nameParts.slice(0, -1).join(' ');

      let stem = lastPart;
      let gen = `${lastPart}а`;
      let dat = `${lastPart}у`;
      let acc = `${lastPart}а`;
      let ins = `${lastPart}ом`;
      let pre = `${lastPart}е`;
      let nomPl = `${lastPart}ы`;
      let genPl = `${lastPart}ов`;
      let datPl = `${lastPart}ам`;
      let accPl = `${lastPart}ов`;
      let insPl = `${lastPart}ами`;
      let prePl = `${lastPart}ах`;

      if (lastPart.endsWith('ь')) {
        stem = lastPart.slice(0, -1);
        gen = `${stem}я`;
        dat = `${stem}ю`;
        acc = `${stem}я`;
        ins = `${stem}ем`;
        pre = `${stem}е`;
        nomPl = `${stem}и`;
        genPl = `${stem}ей`;
        datPl = `${stem}ям`;
        accPl = `${stem}ей`;
        insPl = `${stem}ями`;
        prePl = `${stem}ях`;
      } else if (lastPart.endsWith('й')) {
        stem = lastPart.slice(0, -1);
        gen = `${stem}я`;
        dat = `${stem}ю`;
        acc = `${stem}я`;
        ins = `${stem}ем`;
        pre = `${stem}е`;
        nomPl = `${stem}и`;
        genPl = `${stem}ев`;
        datPl = `${stem}ям`;
        accPl = `${stem}ев`;
        insPl = `${stem}ями`;
        prePl = `${stem}ях`;
      }

      addForm('nom_sg', wrapQuotes(clean));
      addForm('gen_sg', wrapQuotes(`${prefix} ${gen}`));
      addForm('dat_sg', wrapQuotes(`${prefix} ${dat}`));
      addForm('acc_sg', wrapQuotes(`${prefix} ${acc}`));
      addForm('ins_sg', wrapQuotes(`${prefix} ${ins}`));
      addForm('pre_sg', wrapQuotes(`${prefix} ${pre}`));
      addForm('nom_pl', wrapQuotes(`${prefix} ${nomPl}`));
      addForm('gen_pl', wrapQuotes(`${prefix} ${genPl}`));
      addForm('dat_pl', wrapQuotes(`${prefix} ${datPl}`));
      addForm('acc_pl', wrapQuotes(`${prefix} ${accPl}`));
      addForm('ins_pl', wrapQuotes(`${prefix} ${insPl}`));
      addForm('pre_pl', wrapQuotes(`${prefix} ${prePl}`));

      return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
    } else if (nameParts.length === 1 && !isFem) {
      let stem = clean;
      let gen = `${clean}а`;
      let dat = `${clean}у`;
      let acc = `${clean}а`;
      let ins = `${clean}ом`;
      let pre = `${clean}е`;
      if (clean.endsWith('ь')) {
        stem = clean.slice(0, -1);
        gen = `${stem}я`;
        dat = `${stem}ю`;
        acc = `${stem}я`;
        ins = `${stem}ем`;
        pre = `${stem}е`;
      } else if (clean.endsWith('й')) {
        stem = clean.slice(0, -1);
        gen = `${stem}я`;
        dat = `${stem}ю`;
        acc = `${stem}я`;
        ins = `${stem}ем`;
        pre = `${stem}е`;
      }
      addForm('nom_sg', wrapQuotes(clean));
      addForm('gen_sg', wrapQuotes(gen));
      addForm('dat_sg', wrapQuotes(dat));
      addForm('acc_sg', wrapQuotes(acc));
      addForm('ins_sg', wrapQuotes(ins));
      addForm('pre_sg', wrapQuotes(pre));
      return Array.from(formsMap.entries()).map(([caseLabel, form]) => ({ caseLabel, form }));
    }
  }

  // 2. Head-Modifier Split for Compound Terms (CompoundTermInflector)
  // E.g., «Пилюля Девяти Превращений Лазурного Дракона», «Великий Канон Багрового Пламени»
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

    const isAdj = (w: string) => /^(?:[а-яёА-ЯЁ]+)(?:ый|ий|ой|ая|яя|ое|ее)$/i.test(w);
    if (words.length >= 2 && words.slice(0, -1).every(isAdj)) {
      // Pattern B: 1 or more Adjectives + Noun (e.g., духовный кристалл, высший истинный канон, девятилистная трава, лазурное пламя)
      const adjs = words.slice(0, -1);
      const noun = words[words.length - 1];
      const isFemAdj = /ая|яя$/i.test(adjs[0]);
      const isNeutAdj = /ое|ее$/i.test(adjs[0]);

      const inflectSingleAdj = (adj: string, c: string, isPlural = false) => {
        const stem = adj.slice(0, -2);
        const hasSibilant = /[жшчщгкхц]$/i.test(stem);
        if (isPlural) {
          if (c === 'nom' || c === 'acc') return `${stem}${hasSibilant ? 'ие' : 'ые'}`;
          if (c === 'gen' || c === 'pre') return `${stem}${hasSibilant ? 'их' : 'ых'}`;
          if (c === 'dat') return `${stem}${hasSibilant ? 'им' : 'ым'}`;
          if (c === 'ins') return `${stem}${hasSibilant ? 'ими' : 'ыми'}`;
        }
        if (isFemAdj) {
          if (c === 'nom') return adj;
          if (c === 'acc') return `${stem}ую`;
          return `${stem}ой`; // gen, dat, ins, pre
        }
        if (isNeutAdj) {
          if (c === 'nom' || c === 'acc') return adj;
          if (c === 'gen') return `${stem}${hasSibilant ? 'его' : 'ого'}`;
          if (c === 'dat') return `${stem}${hasSibilant ? 'ему' : 'ому'}`;
          if (c === 'ins') return `${stem}${hasSibilant ? 'им' : 'ым'}`;
          if (c === 'pre') return `${stem}${hasSibilant ? 'ем' : 'ом'}`;
        }
        // Masculine
        if (c === 'nom' || c === 'acc') return adj;
        if (c === 'gen') return `${stem}${hasSibilant ? 'его' : 'ого'}`;
        if (c === 'dat') return `${stem}${hasSibilant ? 'ему' : 'ому'}`;
        if (c === 'ins') return `${stem}${hasSibilant ? 'им' : 'ым'}`;
        if (c === 'pre') return `${stem}${hasSibilant ? 'ем' : 'ом'}`;
        return adj;
      };

      const inflectAdjs = (c: string, isPlural = false) =>
        adjs.map((a) => inflectSingleAdj(a, c, isPlural)).join(' ');

      if (isFemAdj) {
        // Feminine: девятилистная трава
        const nStem = noun.endsWith('а') || noun.endsWith('я') ? noun.slice(0, -1) : noun;
        const nounGenPl = noun.endsWith('я') ? `${nStem}ь` : nStem;
        addForm('nom_sg', `${inflectAdjs('nom')} ${nStem}а`);
        addForm('gen_sg', `${inflectAdjs('gen')} ${nStem}ы`);
        addForm('dat_sg', `${inflectAdjs('dat')} ${nStem}е`);
        addForm('acc_sg', `${inflectAdjs('acc')} ${nStem}у`);
        addForm('ins_sg', `${inflectAdjs('ins')} ${nStem}ой`);
        addForm('pre_sg', `${inflectAdjs('pre')} ${nStem}е`);
        addForm('nom_pl', `${inflectAdjs('nom', true)} ${nStem}ы`);
        addForm('gen_pl', `${inflectAdjs('gen', true)} ${nounGenPl}`);
        addForm('dat_pl', `${inflectAdjs('dat', true)} ${nStem}ам`);
        addForm('acc_pl', `${inflectAdjs('acc', true)} ${nStem}ы`);
        addForm('ins_pl', `${inflectAdjs('ins', true)} ${nStem}ами`);
        addForm('pre_pl', `${inflectAdjs('pre', true)} ${nStem}ах`);
      } else if (isNeutAdj) {
        // Neuter: тайное царство, лазурное пламя
        const nStem = noun.endsWith('о') || noun.endsWith('е') ? noun.slice(0, -1) : noun;
        addForm('nom_sg', `${inflectAdjs('nom')} ${noun}`);
        addForm('gen_sg', `${inflectAdjs('gen')} ${nStem}а`);
        addForm('dat_sg', `${inflectAdjs('dat')} ${nStem}у`);
        addForm('acc_sg', `${inflectAdjs('acc')} ${noun}`);
        addForm('ins_sg', `${inflectAdjs('ins')} ${nStem}ом`);
        addForm('pre_sg', `${inflectAdjs('pre')} ${nStem}е`);
        addForm('nom_pl', `${inflectAdjs('nom', true)} ${nStem}а`);
        addForm('gen_pl', `${inflectAdjs('gen', true)} ${nStem}`);
        addForm('dat_pl', `${inflectAdjs('dat', true)} ${nStem}ам`);
        addForm('acc_pl', `${inflectAdjs('acc', true)} ${nStem}а`);
        addForm('ins_pl', `${inflectAdjs('ins', true)} ${nStem}ами`);
        addForm('pre_pl', `${inflectAdjs('pre', true)} ${nStem}ах`);
      } else {
        // Masculine: высший истинный канон, духовный кристалл, золотой меч
        const nStem = noun.endsWith('ь') || noun.endsWith('й') ? noun.slice(0, -1) : noun;
        const nEndingPl = noun.endsWith('ь') ? 'и' : 'ы';
        const nEndingGenPl = noun.endsWith('ь') ? 'ей' : 'ов';
        const nGen = noun.endsWith('ь') || noun.endsWith('й') ? `${nStem}я` : `${noun}а`;
        const nDat = noun.endsWith('ь') || noun.endsWith('й') ? `${nStem}ю` : `${noun}у`;
        const nIns = noun.endsWith('ь') || noun.endsWith('й') ? `${nStem}ем` : `${noun}ом`;
        addForm('nom_sg', `${inflectAdjs('nom')} ${noun}`);
        addForm('gen_sg', `${inflectAdjs('gen')} ${nGen}`);
        addForm('dat_sg', `${inflectAdjs('dat')} ${nDat}`);
        addForm('acc_sg', `${inflectAdjs('acc')} ${noun}`);
        addForm('ins_sg', `${inflectAdjs('ins')} ${nIns}`);
        addForm('pre_sg', `${inflectAdjs('pre')} ${nStem}е`);
        addForm('nom_pl', `${inflectAdjs('nom', true)} ${nStem}${nEndingPl}`);
        addForm('gen_pl', `${inflectAdjs('gen', true)} ${nStem}${nEndingGenPl}`);
        addForm('dat_pl', `${inflectAdjs('dat', true)} ${nStem}ам`);
        addForm('acc_pl', `${inflectAdjs('acc', true)} ${nStem}${nEndingPl}`);
        addForm('ins_pl', `${inflectAdjs('ins', true)} ${nStem}ами`);
        addForm('pre_pl', `${inflectAdjs('pre', true)} ${nStem}ах`);
      }
    } else {
      // Pattern A: Head Noun + Genitive Complement (e.g. Пилюля Конденсации Крови)
      const h = firstWord;
      const tSuffix = tail ? ` ${tail}` : '';

      if (/[а-яёА-ЯЁ]+[иы]$/i.test(h)) {
        // Plural head noun (e.g., Очки, Врата)
        const stem = h.slice(0, -1);
        addForm('nom_pl', `${h}${tSuffix}`);
        addForm('gen_pl', `${stem}ов${tSuffix}`);
        addForm('dat_pl', `${stem}ам${tSuffix}`);
        addForm('acc_pl', `${h}${tSuffix}`);
        addForm('ins_pl', `${stem}ами${tSuffix}`);
        addForm('pre_pl', `${stem}ах${tSuffix}`);
      } else if (/[а-яёА-ЯЁ]+а$/i.test(h)) {
        // Feminine in -а (Секта, Трава)
        const stem = h.slice(0, -1);
        addForm('nom_sg', `${h}${tSuffix}`);
        addForm('gen_sg', `${stem}ы${tSuffix}`);
        addForm('dat_sg', `${stem}е${tSuffix}`);
        addForm('acc_sg', `${stem}у${tSuffix}`);
        addForm('ins_sg', `${stem}ой${tSuffix}`);
        addForm('pre_sg', `${stem}е${tSuffix}`);
        addForm('nom_pl', `${stem}ы${tSuffix}`);
        addForm('gen_pl', `${stem}${tSuffix}`);
        addForm('dat_pl', `${stem}ам${tSuffix}`);
        addForm('acc_pl', `${stem}ы${tSuffix}`);
        addForm('ins_pl', `${stem}ами${tSuffix}`);
        addForm('pre_pl', `${stem}ах${tSuffix}`);
      } else if (/[а-яёА-ЯЁ]+я$/i.test(h)) {
        // Feminine in -я (Пилюля)
        const stem = h.slice(0, -1);
        addForm('nom_sg', `${h}${tSuffix}`);
        addForm('gen_sg', `${stem}и${tSuffix}`);
        addForm('dat_sg', `${stem}е${tSuffix}`);
        addForm('acc_sg', `${stem}ю${tSuffix}`);
        addForm('ins_sg', `${stem}ей${tSuffix}`);
        addForm('pre_sg', `${stem}е${tSuffix}`);
        addForm('nom_pl', `${stem}и${tSuffix}`);
        addForm('gen_pl', `${stem}ь${tSuffix}`); // Пилюль!
        addForm('dat_pl', `${stem}ям${tSuffix}`);
        addForm('acc_pl', `${stem}и${tSuffix}`);
        addForm('ins_pl', `${stem}ями${tSuffix}`);
        addForm('pre_pl', `${stem}ях${tSuffix}`);
      } else if (/[а-яёА-ЯЁ]+(?:ие|ье)$/i.test(h)) {
        // Neuter in -ие (Заложение, Писание)
        const stem = h.slice(0, -2);
        addForm('nom_sg', `${h}${tSuffix}`);
        addForm('gen_sg', `${stem}ия${tSuffix}`);
        addForm('dat_sg', `${stem}ию${tSuffix}`);
        addForm('acc_sg', `${h}${tSuffix}`);
        addForm('ins_sg', `${stem}ием${tSuffix}`);
        addForm('pre_sg', `${stem}ии${tSuffix}`);
        addForm('nom_pl', `${stem}ия${tSuffix}`);
        addForm('gen_pl', `${stem}ий${tSuffix}`);
        addForm('dat_pl', `${stem}иям${tSuffix}`);
        addForm('acc_pl', `${stem}ия${tSuffix}`);
        addForm('ins_pl', `${stem}иями${tSuffix}`);
        addForm('pre_pl', `${stem}иях${tSuffix}`);
      } else if (/[а-яёА-ЯЁ]+о$/i.test(h)) {
        // Neuter in -о (Царство)
        const stem = h.slice(0, -1);
        addForm('nom_sg', `${h}${tSuffix}`);
        addForm('gen_sg', `${stem}а${tSuffix}`);
        addForm('dat_sg', `${stem}у${tSuffix}`);
        addForm('acc_sg', `${h}${tSuffix}`);
        addForm('ins_sg', `${stem}ом${tSuffix}`);
        addForm('pre_sg', `${stem}е${tSuffix}`);
        addForm('nom_pl', `${stem}а${tSuffix}`);
        addForm('gen_pl', `${stem}${tSuffix}`);
        addForm('dat_pl', `${stem}ам${tSuffix}`);
        addForm('acc_pl', `${stem}а${tSuffix}`);
        addForm('ins_pl', `${stem}ами${tSuffix}`);
        addForm('pre_pl', `${stem}ах${tSuffix}`);
      } else if (/[иуюэ]$/i.test(h)) {
        // Foreign stem ending in -и, -у, -ю, -э (Гу, Се, Луффи) - indeclinable
        addForm('nom_sg', `${h}${tSuffix}`);
        addForm('gen_sg', `${h}${tSuffix}`);
        addForm('dat_sg', `${h}${tSuffix}`);
        addForm('acc_sg', `${h}${tSuffix}`);
        addForm('ins_sg', `${h}${tSuffix}`);
        addForm('pre_sg', `${h}${tSuffix}`);
      } else if (h.endsWith('ь') || h.endsWith('й')) {
        // Soft masculine ending in -ь or -й (Чэнь, Меч, Край)
        const stem = h.slice(0, -1);
        addForm('nom_sg', `${h}${tSuffix}`);
        addForm('gen_sg', `${stem}я${tSuffix}`);
        addForm('dat_sg', `${stem}ю${tSuffix}`);
        addForm('acc_sg', `${h}${tSuffix}`);
        addForm('ins_sg', `${stem}ем${tSuffix}`);
        addForm('pre_sg', `${stem}е${tSuffix}`);
        addForm('nom_pl', `${stem}и${tSuffix}`);
        addForm('gen_pl', `${stem}ей${tSuffix}`);
        addForm('dat_pl', `${stem}ям${tSuffix}`);
        addForm('acc_pl', `${stem}и${tSuffix}`);
        addForm('ins_pl', `${stem}ями${tSuffix}`);
        addForm('pre_pl', `${stem}ях${tSuffix}`);
      } else {
        // Hard masculine consonant ending (Павильон, Канон, Котёл)
        addForm('nom_sg', `${h}${tSuffix}`);
        addForm('gen_sg', `${h}а${tSuffix}`);
        addForm('dat_sg', `${h}у${tSuffix}`);
        addForm('acc_sg', `${h}${tSuffix}`);
        addForm('ins_sg', `${h}ом${tSuffix}`);
        addForm('pre_sg', `${h}е${tSuffix}`);
        addForm('nom_pl', `${h}ы${tSuffix}`);
        addForm('gen_pl', `${h}ов${tSuffix}`);
        addForm('dat_pl', `${h}ам${tSuffix}`);
        addForm('acc_pl', `${h}ы${tSuffix}`);
        addForm('ins_pl', `${h}ами${tSuffix}`);
        addForm('pre_pl', `${h}ах${tSuffix}`);
      }
    }
  }

  const result: InflectedFormItem[] = [];
  formsMap.forEach((form, caseLabel) => {
    result.push({ caseLabel, form });
  });
  return result;
}

export interface CanonRippleChapterChange {
  chapterId: string;
  chapterNumber: number;
  ReplacementsCount: number;
  updatedTitleRus: string;
  updatedRusText: string;
  previewBefore: string;
  previewAfter: string;
}

/**
 * Universal Morphological Canon Ripple:
 * Replaces old Russian glossary term across all translated chapters
 * in ALL grammatical cases (nominative, genitive, dative, accusative, instrumental, prepositional).
 */
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
  const cleanOld = (oldRusTerm || '').trim();
  const cleanNew = (newRusTerm || '').trim();
  if (!cleanOld || !cleanNew || cleanOld.toLowerCase() === cleanNew.toLowerCase()) {
    return { changes: [], totalOccurrences: 0 };
  }

  // Generate inflected forms for both terms
  const oldForms = buildInflectedRussianForms(cleanOld);
  const newForms = buildInflectedRussianForms(cleanNew);

  const newFormsByCase = new Map<string, string>();
  for (const nf of newForms) {
    newFormsByCase.set(nf.caseLabel, nf.form);
  }

  // Create aligned replacement map { search, replace }
  const replacementPairs: Array<{ search: string; replace: string }> = [];
  const seenSearches = new Set<string>();

  for (const oform of oldForms) {
    const matchingNew = newFormsByCase.get(oform.caseLabel) || cleanNew;
    const lowerSearch = oform.form.toLowerCase();
    if (!seenSearches.has(lowerSearch)) {
      seenSearches.add(lowerSearch);
      replacementPairs.push({
        search: oform.form,
        replace: matchingNew,
      });
    }
  }

  // Always ensure base string is included
  if (!seenSearches.has(cleanOld.toLowerCase())) {
    replacementPairs.push({ search: cleanOld, replace: cleanNew });
  }

  // Sort by descending search length to avoid partial substring prefix clashes
  replacementPairs.sort((a, b) => b.search.length - a.search.length);

  const escapedSearches = replacementPairs.map((p) =>
    p.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const rippleRegex = new RegExp(
    `(?<![а-яёa-z0-9])(${escapedSearches.join('|')})(?![а-яёa-z0-9])`,
    'gi'
  );

  const formatReplacement = (match: string, rep: string): string => {
    if (match === match.toUpperCase()) {
      return rep.toUpperCase();
    }
    if (match === match.toLowerCase()) {
      return rep.toLowerCase();
    }
    if (match[0] === match[0].toUpperCase()) {
      const matchWords = match.split(/\s+/);
      const repWords = rep.split(/\s+/);
      const allSubsequentMatchWordsLower =
        matchWords.length > 1 && matchWords.slice(1).every((w) => w === w.toLowerCase());

      if (allSubsequentMatchWordsLower && repWords.length > 1) {
        return repWords
          .map((w, idx) =>
            idx === 0
              ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
              : w.toLowerCase()
          )
          .join(' ');
      }
      return rep.charAt(0).toUpperCase() + rep.slice(1);
    }
    return rep;
  };

  const changes: CanonRippleChapterChange[] = [];
  let totalOccurrences = 0;

  for (const ch of chapters) {
    if (!ch.rusText.trim() && !ch.titleRus.trim()) continue;

    let chapterMatchesCount = 0;
    let firstMatchingLine = '';

    const replaceText = (text: string): string => {
      return text.replace(rippleRegex, (matched) => {
        chapterMatchesCount++;
        const pair = replacementPairs.find(
          (p) => p.search.toLowerCase() === matched.toLowerCase()
        );
        const rep = pair ? pair.replace : cleanNew;
        return formatReplacement(matched, rep);
      });
    };

    // Find first matching line before replacing
    if (ch.titleRus && rippleRegex.test(ch.titleRus)) {
      firstMatchingLine = ch.titleRus;
    } else if (ch.rusText) {
      firstMatchingLine =
        ch.rusText.split(/\r?\n/).find((line) => {
          rippleRegex.lastIndex = 0;
          return rippleRegex.test(line);
        }) || '';
    }

    rippleRegex.lastIndex = 0;
    const updatedTitle = replaceText(ch.titleRus);
    const updatedBody = replaceText(ch.rusText);

    if (chapterMatchesCount > 0) {
      totalOccurrences += chapterMatchesCount;
      const previewAfter =
        updatedBody.split(/\r?\n/).find((l) => l.toLowerCase().includes(cleanNew.toLowerCase())) ||
        updatedTitle;

      changes.push({
        chapterId: ch.id,
        chapterNumber: ch.number,
        ReplacementsCount: chapterMatchesCount,
        updatedTitleRus: updatedTitle,
        updatedRusText: updatedBody,
        previewBefore: firstMatchingLine || ch.titleRus,
        previewAfter,
      });
    }
  }

  return { changes, totalOccurrences };
}

/**
 * Enhanced Lookahead Batch Pre-Scouting across a chapter range.
 * Combines built-in canonical templates with TransAgents Addition-by-Subtraction scout
 * across all chapters in range, tracks cross-chapter recurrence, and automatically
 * promotes terms with confidence >= 0.95 and approved_for_glossary = true.
 */
export function batchLookaheadScoutChapters(
  chapters: Array<{ number: number; titleEng: string; engText: string }>,
  glossary: CanonicalGlossary,
  existingScouted: ScoutedTerm[] = []
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

  // 1. Scan built-in canonical templates
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

    // 2. Scan Addition-by-Subtraction dynamic candidates
    const abs = runAdditionBySubtractionScout(ch.engText, ch.number, glossary, existingScouted);
    for (const term of abs.finalTerms) {
      if (knownEng.has(term.eng.toLowerCase())) continue;
      const cur = hitMap.get(term.eng);
      if (cur) {
        cur.chapterOccurrences += 1;
      } else {
        hitMap.set(term.eng, {
          eng: term.eng,
          rus: term.rus_suggested,
          category: term.category,
          gender: term.gender || 'M',
          firstChapter: ch.number,
          chapterOccurrences: 1,
          snippet: term.context_snippet || ch.engText.slice(0, 140),
        });
      }
    }
  }

  const discoveredTerms: ScoutedTerm[] = [];
  let idx = 0;
  let autoPromotedCount = 0;
  hitMap.forEach((val) => {
    const hasCyrillicTranslation = Boolean(val.rus && /[а-яёА-ЯЁ]/.test(val.rus));
    const isDomainCanon = /pill|sect|realm|cauldron|grass|flame|beast/i.test(val.eng);
    const confidence = hasCyrillicTranslation
      ? val.chapterOccurrences >= 2 || isDomainCanon
        ? 0.98
        : 0.95
      : 0.65;
    const approved = hasCyrillicTranslation;
    if (approved) autoPromotedCount++;
    discoveredTerms.push({
      id: `lookahead-${Date.now()}-${idx++}`,
      eng: val.eng,
      rus_suggested: val.rus,
      category: val.category,
      gender: val.gender,
      chapter_first_seen: val.firstChapter,
      context_snippet: val.snippet,
      approved_for_glossary: approved,
      confidence,
    });
  });

  return {
    discoveredTerms,
    autoPromotedCount,
  };
}

export interface ChapterGlossaryCoverageResult {
  canonInSource: number;
  canonMatchedInRus: number;
  unapprovedInChapter: number;
  totalDetectedTerms: number;
  glossaryCoveragePct: number;
}

/**
 * Unified calculation of canonical terminology coverage for a chapter.
 * Shared across TranslationAnalyticsChart and Pipeline chapter table.
 */
export function computeChapterGlossaryCoverage(
  chapter: { engText: string; rusText?: string; translated?: boolean },
  glossary: CanonicalGlossary,
  scoutedTerms: ScoutedTerm[]
): ChapterGlossaryCoverageResult {
  const { filteredGlossary, matchedCount: canonInSource } = filterGlossaryForChapter(
    chapter.engText,
    glossary
  );

  let canonMatchedInRus = 0;
  const lowerRus = (chapter.rusText || '').toLowerCase().replace(/ё/g, 'е');

  if (chapter.rusText && chapter.rusText.trim()) {
    Object.values(filteredGlossary).forEach((bucket) => {
      Object.values(bucket || {}).forEach((rusTerm) => {
        const rusStr = String(rusTerm || '');
        const stems = rusStr
          .toLowerCase()
          .replace(/ё/g, 'е')
          .split(/\s+/)
          .filter((w) => w.length >= 2)
          .map((w) => {
            if (w.startsWith('камен')) return 'кам';
            if (w.startsWith('корен')) return 'кор';
            return w.slice(0, Math.min(4, Math.max(2, w.length - 2)));
          });

        const matched = stems.length === 0 || stems.every((stem) => lowerRus.includes(stem));
        if (matched) {
          canonMatchedInRus++;
        }
      });
    });
  }

  let unapprovedInChapter = 0;
  scoutedTerms.forEach((st) => {
    if (!st.approved_for_glossary) {
      const escaped = st.eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}s?\\b`, 'i').test(chapter.engText)) {
        unapprovedInChapter++;
      }
    }
  });

  const totalDetectedTerms = canonInSource + unapprovedInChapter;
  let glossaryCoveragePct = 0;

  if (chapter.translated && chapter.rusText && chapter.rusText.trim()) {
    if (totalDetectedTerms === 0) {
      glossaryCoveragePct = 100;
    } else {
      glossaryCoveragePct = Math.min(
        100,
        Math.round((canonMatchedInRus / totalDetectedTerms) * 100)
      );
    }
  } else if (totalDetectedTerms > 0) {
    glossaryCoveragePct = Math.round((canonInSource / totalDetectedTerms) * 100);
  }

  return {
    canonInSource,
    canonMatchedInRus,
    unapprovedInChapter,
    totalDetectedTerms,
    glossaryCoveragePct,
  };
}

export interface CanonVaultState {
  glossary: CanonicalGlossary;
  glossaryMeta: Record<string, GlossaryTermMeta>;
  scoutedTerms: ScoutedTerm[];
}

/**
 * Pure state mutation: Approves a candidate scouted term and adds it to Canon glossary & meta.
 */
export function approveScoutedTermInVault(
  vault: CanonVaultState,
  termId: string,
  overrides?: {
    rusSuggested?: string;
    category?: GlossaryCategory;
    gender?: GrammaticalGender;
  }
): CanonVaultState {
  const target = vault.scoutedTerms.find((t) => t.id === termId);
  if (!target) return vault;

  const category = overrides?.category || target.category;
  const rus = (overrides?.rusSuggested || target.rus_suggested).trim();
  const gender = overrides?.gender || target.gender;

  const nextGlossary = {
    ...vault.glossary,
    [category]: {
      ...vault.glossary[category],
      [target.eng]: rus,
    },
  };

  const nextMeta = { ...vault.glossaryMeta };
  if (gender) {
    nextMeta[target.eng] = { ...nextMeta[target.eng], gender };
  }

  const nextScouted = vault.scoutedTerms.map((t) =>
    t.id === termId ? { ...t, approved_for_glossary: true, rus_suggested: rus, category, gender } : t
  );

  return {
    glossary: nextGlossary,
    glossaryMeta: nextMeta,
    scoutedTerms: nextScouted,
  };
}

/**
 * Pure state mutation: Auto-approves all pending scouted terms meeting minimum confidence.
 */
export function autoApprovePendingTermsInVault(
  vault: CanonVaultState,
  minConfidence = 0.9
): { updatedVault: CanonVaultState; approvedCount: number } {
  let approvedCount = 0;
  let curVault = vault;

  for (const st of vault.scoutedTerms) {
    const hasCyrillic = Boolean(st.rus_suggested && /[а-яёА-ЯЁ]/.test(st.rus_suggested));
    if (!st.approved_for_glossary && hasCyrillic && st.confidence >= minConfidence) {
      curVault = approveScoutedTermInVault(curVault, st.id);
      approvedCount++;
    }
  }

  return { updatedVault: curVault, approvedCount };
}

/**
 * Pure state mutation: Adds or updates a canonical glossary term with metadata.
 */
export function upsertCanonTermInVault(
  vault: CanonVaultState,
  category: GlossaryCategory,
  eng: string,
  rus: string,
  meta?: GlossaryTermMeta
): CanonVaultState {
  const cleanEng = eng.trim();
  const cleanRus = rus.trim();
  if (!cleanEng || !cleanRus) return vault;

  const nextGlossary = {
    ...vault.glossary,
    [category]: {
      ...vault.glossary[category],
      [cleanEng]: cleanRus,
    },
  };

  const nextMeta = { ...vault.glossaryMeta };
  if (meta && (meta.gender || meta.declensionNote || meta.voiceNote)) {
    nextMeta[cleanEng] = { ...meta };
  }

  return {
    glossary: nextGlossary,
    glossaryMeta: nextMeta,
    scoutedTerms: vault.scoutedTerms,
  };
}

/**
 * Pure state mutation: Removes a canonical glossary term from vault.
 */
export function removeCanonTermFromVault(
  vault: CanonVaultState,
  category: GlossaryCategory,
  eng: string
): CanonVaultState {
  const nextBucket = { ...vault.glossary[category] };
  delete nextBucket[eng];

  const nextGlossary = {
    ...vault.glossary,
    [category]: nextBucket,
  };

  const nextMeta = { ...vault.glossaryMeta };
  delete nextMeta[eng];

  return {
    glossary: nextGlossary,
    glossaryMeta: nextMeta,
    scoutedTerms: vault.scoutedTerms,
  };
}

/**
 * Pure state mutation: Applies Morphological Canon Ripple to an entire novel and updates glossary.
 */
export function applyCanonRippleToNovel<
  T extends {
    id: string;
    chapters: Array<{ id: string; number: number; titleRus: string; rusText: string }>;
    glossary: CanonicalGlossary;
    glossaryMeta?: Record<string, GlossaryTermMeta>;
    scoutedTerms?: ScoutedTerm[];
  }
>(
  novel: T,
  oldRusTerm: string,
  newRusTerm: string
): { updatedNovel: T; rippleReport: ReturnType<typeof previewAndApplyCanonRipple> } {
  const rippleReport = previewAndApplyCanonRipple(novel.chapters, oldRusTerm, newRusTerm);

  const changesMap = new Map<string, { titleRus: string; rusText: string }>();
  for (const ch of rippleReport.changes) {
    changesMap.set(ch.chapterId, {
      titleRus: ch.updatedTitleRus,
      rusText: ch.updatedRusText,
    });
  }

  const updatedChapters = novel.chapters.map((ch) => {
    const change = changesMap.get(ch.id);
    if (!change) return ch;
    return {
      ...ch,
      titleRus: change.titleRus,
      rusText: change.rusText,
    };
  });

  // Also update glossary if oldRusTerm was defined in any category
  const updatedGlossary: CanonicalGlossary = { ...novel.glossary };
  (Object.keys(updatedGlossary) as GlossaryCategory[]).forEach((cat) => {
    const bucket = { ...updatedGlossary[cat] };
    Object.entries(bucket).forEach(([eng, rus]) => {
      if (rus.toLowerCase() === oldRusTerm.toLowerCase()) {
        bucket[eng] = newRusTerm;
      }
    });
    updatedGlossary[cat] = bucket;
  });

  const updatedNovel: T = {
    ...novel,
    chapters: updatedChapters,
    glossary: updatedGlossary,
  };

  return { updatedNovel, rippleReport };
}

export interface SocialRegisterEdge {
  fromCharacter: string;
  toCharacter: string;
  valence: number; // [-1.0 .. +1.0] (вражда <-> близость)
  coarseRole: 'hierarchical' | 'peer' | 'kinship' | 'hostile';
  fineRole: string; // e.g., "ученик -> старейшина", "старший брат -> младший брат"
  pronounMode: 'ты' | 'Вы';
  updatedAtChapter: number;
}

export function buildSocialRegisterPromptBlock(
  edges: SocialRegisterEdge[],
  activeCharacters?: string[]
): string {
  if (!edges || edges.length === 0) return '';
  const filtered =
    activeCharacters && activeCharacters.length > 0
      ? edges.filter(
          (e) =>
            activeCharacters.some(
              (c) =>
                e.fromCharacter.toLowerCase().includes(c.toLowerCase()) ||
                c.toLowerCase().includes(e.fromCharacter.toLowerCase())
            ) ||
            activeCharacters.some(
              (c) =>
                e.toCharacter.toLowerCase().includes(c.toLowerCase()) ||
                c.toLowerCase().includes(e.toCharacter.toLowerCase())
            )
        )
      : edges;
  if (filtered.length === 0) return '';

  const jsonSummary = filtered.map((e) => ({
    from: e.fromCharacter,
    to: e.toCharacter,
    register: e.pronounMode,
    role: e.fineRole,
    type: e.coarseRole,
    valence: e.valence,
  }));

  return `[DIRECTED SOCIAL REGISTER GRAPH (ты ↔ Вы)]\n${JSON.stringify(jsonSummary, null, 2)}`;
}

export interface GlossaryLintIssue {
  type: 'alias_collision' | 'title_attached' | 'homonym_surname' | 'substring_shadowing';
  severity: 'error' | 'warning';
  term: string;
  category?: string;
  details: string;
  recommendation: string;
}

export function lintGlossaryVault(
  glossary: CanonicalGlossary,
  glossaryMeta?: Record<string, GlossaryTermMeta>
): GlossaryLintIssue[] {
  const issues: GlossaryLintIssue[] = [];

  // 1. Alias Collision: same Russian translation mapped to different English keys
  const rusToEngMap = new Map<string, Array<{ eng: string; category: string }>>();
  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    Object.entries(glossary[cat] || {}).forEach(([eng, rus]) => {
      const normRus = (rus || '').trim().toLowerCase();
      if (!normRus) return;
      const list = rusToEngMap.get(normRus) || [];
      list.push({ eng, category: cat });
      rusToEngMap.set(normRus, list);
    });
  });

  rusToEngMap.forEach((occurrences, normRus) => {
    if (occurrences.length > 1) {
      const uniqueEngs = Array.from(new Set(occurrences.map((o) => o.eng)));
      if (uniqueEngs.length > 1) {
        issues.push({
          type: 'alias_collision',
          severity: 'warning',
          term: normRus,
          category: occurrences[0].category,
          details: `Русский термин «${normRus}» привязан к разным английским ключам: [${uniqueEngs.join(', ')}]`,
          recommendation: 'Используйте явный алиас или унифицируйте английские термины в глоссарии.',
        });
      }
    }
  });

  // 2. Title Attached: Honorific titles glued to character names
  const attachedTitleRegex =
    /^(?:Старейшина|Старший\s+брат|Младший\s+брат|Старшая\s+сестра|Младшая\s+сестра|Мастер|Глава\s+секты|Патриарх|Владыка|Учитель|Лорд|Император|Принц|Фея|Даос|Elder|Senior\s+Brother|Junior\s+Brother|Senior\s+Sister|Junior\s+Sister|Master|Sect\s+Master|Patriarch|Lord|Emperor|Prince|Fairy|Daoist)\s+/i;
  Object.entries(glossary.characters || {}).forEach(([eng, rus]) => {
    if (attachedTitleRegex.test(rus) || attachedTitleRegex.test(eng)) {
      issues.push({
        type: 'title_attached',
        severity: 'error',
        term: rus,
        category: 'characters',
        details: `В термин персонажа «${rus}» (${eng}) включён титул или обращение.`,
        recommendation: 'Выделите имя персонажа в категорию characters, а титул добавьте в system_and_terms.',
      });
    }
  });

  // 3. Homonym Surname: Single-word Chinese/Korean surname without given name
  const singleSurnameRegex =
    /^(?:Чжао|Чэнь|Линь|Ван|Ли|Су|Сяо|Лю|Е|Хуан|У|Цянь|Сунь|Чжоу|Ян|Zhao|Chen|Lin|Wang|Li|Su|Xiao|Liu|Zhang|Ye|Huang|Wu|Qian|Sun|Zhou|Yang)$/i;
  Object.entries(glossary.characters || {}).forEach(([eng, rus]) => {
    if (singleSurnameRegex.test(rus.trim()) || singleSurnameRegex.test(eng.trim())) {
      issues.push({
        type: 'homonym_surname',
        severity: 'warning',
        term: rus,
        category: 'characters',
        details: `Односложная фамилия «${rus}» (${eng}) без уточнения личного имени может вызвать омонимические коллизии с другими персонажами того же клана.`,
        recommendation: 'Укажите полное имя персонажа (напр. «Линь Сюань» вместо «Линь»).',
      });
    }
  });

  // 4. Substring Shadowing: Shorter term is a prefix or whole-word substring of a longer term
  const allTerms: Array<{ eng: string; rus: string; category: string }> = [];
  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    Object.entries(glossary[cat] || {}).forEach(([eng, rus]) => {
      allTerms.push({ eng, rus, category: cat });
    });
  });

  const reportedShadows = new Set<string>();
  const isShadowed = (shortStr: string, longStr: string): boolean => {
    if (!shortStr || !longStr || shortStr.length >= longStr.length) return false;
    const esc = shortStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRe = new RegExp(`(?:^|[\\s.,!?:;«"'\\[(])${esc}(?:$|[\\s.,!?:;»"'\\])])`, 'i');
    return wordRe.test(longStr);
  };

  for (let i = 0; i < allTerms.length; i++) {
    for (let j = 0; j < allTerms.length; j++) {
      if (i === j) continue;
      const a = allTerms[i];
      const b = allTerms[j];
      const cleanEngA = a.eng.trim();
      const cleanEngB = b.eng.trim();
      const cleanRusA = a.rus.replace(/^[«"]|[»"]$/g, '').trim();
      const cleanRusB = b.rus.replace(/^[«"]|[»"]$/g, '').trim();

      const engClash = isShadowed(cleanEngA, cleanEngB);
      const rusClash = isShadowed(cleanRusA, cleanRusB);

      if (engClash || rusClash) {
        const shadowKey = `${a.eng}->${b.eng}`;
        if (!reportedShadows.has(shadowKey)) {
          reportedShadows.add(shadowKey);
          issues.push({
            type: 'substring_shadowing',
            severity: 'warning',
            term: a.eng,
            category: a.category,
            details: `Короткий термин «${a.eng}» («${a.rus}») входит как отдельная часть в более длинный термин «${b.eng}» («${b.rus}»).`,
            recommendation: 'Убедитесь, что поиск терминов выполняется в порядке убывания длины (longest-match-first).',
          });
        }
      }
    }
  }

  return issues;
}

export interface CharacterVoiceCardV3 {
  charNameEng: string;
  charNameRus: string;
  gender: GrammaticalGender;
  declensionNote?: string;
  voiceNote?: string;
  speechVector: CharacterSpeechVector;
}

/**
 * Derives or defaults an 8-attribute S-VoCAL speech vector for a character.
 */
export function deriveDefaultSpeechVector(
  charNameRus: string,
  meta?: GlossaryTermMeta
): CharacterSpeechVector {
  if (meta?.speechVector) {
    return meta.speechVector;
  }

  const voiceNoteLower = (meta?.voiceNote || '').toLowerCase();
  const isFemale = meta?.gender === 'F';

  // 1. Archetype detection from voiceNote or character name
  if (voiceNoteLower.includes('архаичн') || voiceNoteLower.includes('старейшин') || voiceNoteLower.includes('властн')) {
    return {
      registerLevel: 0.8,
      sentenceLengthBias: 'ornate_periodic',
      ellipsisRate: 'low',
      inversionTendency: 'high',
      preferredParticles: ['же', 'ведь', 'ибо'],
      forbiddenLexicon: ['окей', 'круто', 'проблема', 'парень', 'чувак'],
      catchphrasesOrTics: ['Дерзость.', 'Ничтожество.'],
      contrastiveDialogueSamples: [
        {
          context: 'Отказ младшему ученику',
          badNeutralAi: '«Я не дам тебе эту таблетку, потому что ты ещё не готов к ней».',
          canonicalVoiceRu: '«Мал ещё тягаться со старшими. Знай своё место».',
        },
      ],
    };
  }

  if (voiceNoteLower.includes('груб') || voiceNoteLower.includes('разбойн') || voiceNoteLower.includes('бродяч')) {
    return {
      registerLevel: -0.7,
      sentenceLengthBias: 'clipped_staccato',
      ellipsisRate: 'low',
      inversionTendency: 'low',
      preferredParticles: ['-то', 'ну', 'слышь'],
      forbiddenLexicon: ['изволите', 'соблаговолите', 'позвольте'],
      catchphrasesOrTics: ['Живо выкладывай!'],
      contrastiveDialogueSamples: [
        {
          context: 'Требование дани',
          badNeutralAi: '«Отдай нам пожалуйста свои духовные камни прямо сейчас».',
          canonicalVoiceRu: '«Живо выкладывай камни, если шкура дорога!»',
        },
      ],
    };
  }

  if (isFemale || voiceNoteLower.includes('холодн') || voiceNoteLower.includes('дева') || voiceNoteLower.includes('фея')) {
    return {
      registerLevel: 0.5,
      sentenceLengthBias: 'balanced_conversational',
      ellipsisRate: 'medium',
      inversionTendency: 'medium',
      preferredParticles: ['же', 'разве', 'уж'],
      forbiddenLexicon: ['братан', 'чувак', 'бабло', 'парень'],
      contrastiveDialogueSamples: [
        {
          context: 'Холодное предупреждение',
          badNeutralAi: '«Ты делаешь ошибку, нападая на меня в этом месте».',
          canonicalVoiceRu: '«Не ту цель выбрал. Опомниться не успеешь».',
        },
      ],
    };
  }

  // Default protagonist / cultivation youth vector
  return {
    registerLevel: 0.1,
    sentenceLengthBias: 'balanced_conversational',
    ellipsisRate: 'low',
    inversionTendency: 'medium',
    preferredParticles: ['же', '-то', 'ну', 'что ли'],
    forbiddenLexicon: ['окей', 'круто', 'информация', 'проблема'],
    contrastiveDialogueSamples: [
      {
        context: 'Боевая усмешка',
        badNeutralAi: '«Вы совершили ошибку, выбрав меня в качестве своей цели».',
        canonicalVoiceRu: '«Не на того напали», — холодно усмехнулся юноша.',
      },
    ],
  };
}

/**
 * Builds the CharacterVoiceCardV3 prompt block (S-VoCAL & Speech Vectors)
 * for all characters present in the chapter.
 */
export function buildCharacterVoicePromptBlock(
  filteredGlossary: CanonicalGlossary,
  glossaryMeta?: Record<string, GlossaryTermMeta>
): string {
  const characters = filteredGlossary.characters || {};
  const entries = Object.entries(characters);
  if (entries.length === 0) {
    return '[CHARACTER VOICE CARDS (S-VoCAL & SPEECH VECTORS)]: No named characters in active chapter vocabulary.';
  }

  const lines: string[] = ['[CHARACTER VOICE CARDS (S-VoCAL & SPEECH VECTORS)]:'];

  for (const [eng, rus] of entries) {
    const meta = glossaryMeta?.[eng];
    const vector = deriveDefaultSpeechVector(rus, meta);
    const gender = meta?.gender || 'M';

    lines.push(`### ${rus} (${eng}) · Gender: ${gender}`);
    if (meta?.declensionNote) {
      lines.push(`- Declension Note: ${meta.declensionNote}`);
    }
    if (meta?.voiceNote) {
      lines.push(`- Role & Social Tone: ${meta.voiceNote}`);
    }
    lines.push(
      `- SpeechVector: Register: ${vector.registerLevel > 0 ? `+${vector.registerLevel}` : vector.registerLevel}, Rhythm: ${vector.sentenceLengthBias}, Inversion: ${vector.inversionTendency}, Ellipsis: ${vector.ellipsisRate}`
    );
    lines.push(`- Preferred Particles: ${vector.preferredParticles.map((p) => `«${p}»`).join(', ')}`);
    lines.push(`- Forbidden Lexicon (DO NOT USE IN REPLIES): ${vector.forbiddenLexicon.map((w) => `"${w}"`).join(', ')}`);
    if (vector.catchphrasesOrTics && vector.catchphrasesOrTics.length > 0) {
      lines.push(`- Characteristic Tics: ${vector.catchphrasesOrTics.join('; ')}`);
    }
    if (vector.contrastiveDialogueSamples && vector.contrastiveDialogueSamples.length > 0) {
      lines.push('- Contrastive Samples:');
      for (const s of vector.contrastiveDialogueSamples) {
        lines.push(`  * [${s.context}] Bad AI: ${s.badNeutralAi} → Canonical RU: ${s.canonicalVoiceRu}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

