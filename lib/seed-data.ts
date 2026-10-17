import {
  getDefaultRulesForGenre,
  type CanonicalGlossary,
  type ScoutedTerm,
  type GenrePreset,
  type ProseTone,
  type LintRuleId,
  type GlossaryTermMeta,
  type HeroStateLedger,
} from './qa-linter';

export interface ChapterVersionSnapshot {
  id: string;
  timestamp: string;
  stageLabel: string;
  titleRus: string;
  rusText: string;
  wordCountRus: number;
  qaPassed: boolean;
  qaErrorCount: number;
}

export interface ChapterRecord {
  id: string;
  number: number;
  subPart?: string; // e.g. "7.1", "7.2" for split half-chapters
  titleEng: string;
  titleRus: string;
  engText: string;
  rusText: string;
  summary?: string; // Rolling Chapter Memory snapshot for cross-chapter context
  versionHistory?: ChapterVersionSnapshot[];
  scouted: boolean;
  translated: boolean;
  edited: boolean;
  verified: boolean;
  wordCountEng: number;
  wordCountRus: number;
  lastUpdated: string;
}

export interface NovelProject {
  id: string;
  name: string;
  rusTitle: string;
  author: string;
  sourceLang: 'ENG' | 'ZH';
  genrePreset: GenrePreset;
  proseTone: ProseTone;
  autoApproveThreshold: number;
  enabledRuleIds: LintRuleId[];
  heroLedger?: HeroStateLedger;
  styleGuideMd: string;
  contextMd: string;
  glossary: CanonicalGlossary;
  glossaryMeta: Record<string, GlossaryTermMeta>;
  scoutedTerms: ScoutedTerm[];
  chapters: ChapterRecord[];
}

export const INITIAL_NOVELS: NovelProject[] = [
  {
    id: 'i-can-upgrade-my-talent-infinitely',
    name: 'I Can Upgrade My Talent Infinitely',
    rusTitle: 'Я могу бесконечно улучшать свой талант',
    author: 'Azure Peak Immortal',
    sourceLang: 'ENG',
    genrePreset: 'xianxia',
    proseTone: 'classic',
    autoApproveThreshold: 0.92,
    enabledRuleIds: getDefaultRulesForGenre('xianxia'),
    heroLedger: {
      protagonistName: 'Линь Сюань',
      cultivationRealm: '6-й слой Очищения Ци',
      resources: ['Очки Истока: 100', 'Духовные камни (в обороте): 21'],
      artifactsAndFlames: [
        'Котёл Чёрного Железа',
        'Пламя Лазурного Лотоса',
        'Пилюля Конденсации Крови',
      ],
      activeLocation: 'Павильон Багрового Пламени · Секта Каменных Демонов',
      lastUpdatedChapter: 4,
    },
    styleGuideMd: `# Стилевой гид: I Can Upgrade My Talent Infinitely

1. **Иерархия культивации**: Qi Refining = Очищение Ци (слои с 1-го по 9-й), Foundation Establishment = Учреждение Основы, Core Formation = Формирование Ядра.
2. **Ранги предметов и пилюль**: Tier = Ярус (1-го яруса, 2-го яруса), Grade = Ранг (низшего, среднего, высшего ранга).
3. **Артефакты**: 1-й ярус — строго «Магический артефакт», 2-й ярус — «Духовный артефакт».
4. **Системные окна**: Оформляются через разделители \`---\` сверху и снизу, параметры в квадратных скобках.
5. **Прямая речь и мысли**: Реплики строго через длинное тире \`— \`, мысли в кавычках-ёлочках \`«...»\`.`,
    contextMd: `# Синопсис и состояние мира (Главы 1–7)

Линь Сюань — внешний ученик Секты Каменных Демонов, застрявший на 3-м слое Очищения Ци со смертным духовным корнем 9-го ранга. Пробудив Панель Бесконечного Возвышения Талантов, он поглощает осколки изначальной эссенции и начинает стремительный подъём через алхимию и создание пилюль 1-го яруса.`,
    glossary: {
      realms: {
        'Qi Refining': 'Очищение Ци',
        'Foundation Establishment': 'Учреждение Основы',
        'Core Formation': 'Формирование Ядра',
        'Nascent Soul': 'Зарождающаяся Душа',
      },
      characters: {
        'Lin Xuan': 'Линь Сюань',
        'Elder Zhao': 'старейшина Чжао',
        'Su Qingxue': 'Су Цинсюэ',
        'Deacon Wang': 'дьякон Ван',
      },
      sects_and_places: {
        'Stone Demon Sect': 'Секта Каменных Демонов',
        'Crimson Flame Pavilion': 'Павильон Багрового Пламени',
        'Outer Sect Peak': 'Пик Внешней Секты',
        'Myriad Beasts Mountain': 'Гора Мириадов Зверей',
      },
      system_and_terms: {
        'Spirit Stone': 'духовный камень',
        'Spirit Root': 'духовный корень',
        'Blood Condensation Pill': 'Пилюля Конденсации Крови',
        'Magical Artifact': 'магический артефакт',
        'Spirit Artifact': 'духовный артефакт',
        'Origin Points': 'Очки Истока',
      },
      units: {
        jin: 'цзинь',
        liang: 'лян',
        li: 'ли',
        zhang: 'чжан',
      },
    },
    glossaryMeta: {
      'Lin Xuan': {
        gender: 'M',
        declensionNote: 'мужской род, склоняется (Линь Сюаня, Линь Сюаню)',
        voiceNote: 'Сдержанный, расчётливый тон; к старейшинам — строго на «вы» и почтительно',
      },
      'Elder Zhao': {
        gender: 'M',
        declensionNote: 'мужской род, склоняется титул (старейшины Чжао)',
        voiceNote: 'Властный архаичный слог; к ученикам обращается на «ты»',
      },
      'Su Qingxue': {
        gender: 'F',
        declensionNote: 'женский род (Ж), китайское имя не склоняется',
        voiceNote: 'Холодная аристократичная речь, минимум эмоций, обращение на «вы»',
      },
      'Deacon Wang': {
        gender: 'M',
        declensionNote: 'мужской род, склоняется (дьякона Вана)',
        voiceNote: 'Строгий наставнический тон, громогласные объявления',
      },
      'Stone Demon Sect': {
        gender: 'F',
        declensionNote: 'женский род, склоняется слово «Секта»',
      },
      'Spirit Stone': {
        gender: 'M',
        declensionNote: 'мужской род, мн.ч.: духовные камни / духовных камней',
      },
    },
    scoutedTerms: [
      {
        id: 'scout-1',
        eng: 'Azure Lotus Fire',
        rus_suggested: 'Пламя Лазурного Лотоса',
        category: 'system_and_terms',
        gender: 'N',
        chapter_first_seen: 4,
        context_snippet: 'Elder Zhao summoned a wisp of Azure Lotus Fire beneath the cauldron.',
        approved_for_glossary: false,
        confidence: 0.96,
      },
      {
        id: 'scout-2',
        eng: 'Shadow Step Scripture',
        rus_suggested: 'Канон Теневого Шага',
        category: 'system_and_terms',
        gender: 'M',
        chapter_first_seen: 5,
        context_snippet: 'Lin Xuan comprehended the first layer of the Shadow Step Scripture.',
        approved_for_glossary: false,
        confidence: 0.93,
      },
      {
        id: 'scout-3',
        eng: 'Black Iron Cauldron',
        rus_suggested: 'Котёл Чёрного Железа',
        category: 'system_and_terms',
        gender: 'M',
        chapter_first_seen: 4,
        context_snippet: 'The Black Iron Cauldron weighed 50 jin and hummed with spiritual qi.',
        approved_for_glossary: false,
        confidence: 0.94,
      },
      {
        id: 'scout-4',
        eng: 'Senior Brother Chen',
        rus_suggested: 'старший брат Чэнь',
        category: 'characters',
        gender: 'M',
        chapter_first_seen: 6,
        context_snippet: 'Senior Brother Chen guarded the entrance of the Crimson Flame Pavilion.',
        approved_for_glossary: false,
        confidence: 0.91,
      },
    ],
    chapters: [
      {
        id: 'ch-1',
        number: 1,
        titleEng: 'Chapter 1: Awakening the Infinite Talent Panel',
        titleRus: 'Глава 1. Пробуждение Панели Бесконечного Таланта',
        engText: `Cold mountain wind swept across the Outer Sect Peak of the Stone Demon Sect.
Lin Xuan sat cross-legged on a worn straw mat inside his cave abode, staring at the 3 Spirit Stones left in his pouch.
For three years he had been stuck at the 3rd layer of Qi Refining. Without at least 15 Spirit Stones to purchase a Blood Condensation Pill of Tier 1 Low Grade, he would be expelled at the end of the month.
"Could this really be the limit of my mortal Spirit Root?" Lin Xuan thought bitterly.
Suddenly, a translucent azure interface unfolded before his eyes.
---
[Host: Lin Xuan]
[Cultivation: Qi Refining — 3rd Layer]
[Origin Points: 100]
[Alchemy Talent: Tier 1 Low Grade (Upgradeable — 85% compatibility)]
---
— Что это?! — прошептал Линь Сюань, чувствуя, как по меридианам разливается горячий поток.`,
        rusText: `Холодный горный ветер пронёсся над Пиком Внешней Секты, принадлежавшим Секте Каменных Демонов.
Линь Сюань сидел, скрестив ноги, на потёртой соломенной циновке в своей пещерной обители и смотрел на 3 духовных камня, оставшихся в его мешочке.
Вот уже три года он топтался на 3-м слое Очищения Ци. Без 15 духовных камней, необходимых для покупки Пилюли Конденсации Крови 1-го яруса низшего ранга, в конце месяца его неизбежно изгонят со двора.
«Неужели это действительно предел моего смертного духовного корня?» — с горечью подумал Линь Сюань.
Внезапно перед его внутренним взором развернулась полупрозрачная лазурная панель.
---
[Носитель: Линь Сюань]
[Культивация: Очищение Ци — 3-й слой]
[Очки Истока: 100]
[Талант к алхимии: 1-го яруса низшего ранга (Доступно улучшение — совместимость 85%)]
---
— Что это такое?! — прошептал Линь Сюань, ощущая, как по его меридианам стремительно разливается обжигающий поток духовной силы.`,
        summary:
          'В Главе 1 Линь Сюань на 3-м слое Очищения Ци пробуждает Панель Бесконечного Таланта с 100 Очками Истока и талантом к алхимии 1-го яруса низшего ранга (85%).',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 148,
        wordCountRus: 145,
        lastUpdated: '2026-10-16 01:15',
        versionHistory: [
          {
            id: 'ver-ch1-draft',
            timestamp: '2026-10-16 01:10',
            stageLabel: 'Черновой перевод (Фаза 2)',
            titleRus: 'Глава 1. Пробуждение Панели Бесконечного Таланта',
            rusText: `Холодный горный ветер пронёсся над Пиком Внешней Секты Секты Каменного Демона.
Линь Сюань сидел на соломенной циновке и смотрел на три духовных камня в своём мешочке.
Вот уже три года он топтался на третьем слое Очищения Ци. Без пятнадцати духовных камней для покупки Пилюли Конденсации Крови 1-го ранга низшего ранга его изгонят.
"Неужели это предел моего духовного корня?" — с горечью подумал Линь Сюань.
Внезапно перед его глазами развернулась лазурная панель.
---
[Носитель: Линь Сюань]
[Культивация: Очищение Ци — 3-й слой]
[Очки Истока: 100]
[Талант к алхимии: 1-го яруса низшего ранга (совместимость 85%)]
---
- Что это такое?! — прошептал Линь Сюань, чувствуя горячий поток.`,
            wordCountRus: 118,
            qaPassed: false,
            qaErrorCount: 5,
          },
          {
            id: 'ver-ch1-verified',
            timestamp: '2026-10-16 01:15',
            stageLabel: 'Авто-ремонт QA и 2-проходный критик (Фаза 4–5)',
            titleRus: 'Глава 1. Пробуждение Панели Бесконечного Таланта',
            rusText: `Холодный горный ветер пронёсся над Пиком Внешней Секты, принадлежавшим Секте Каменных Демонов.
Линь Сюань сидел, скрестив ноги, на потёртой соломенной циновке в своей пещерной обители и смотрел на 3 духовных камня, оставшихся в его мешочке.
Вот уже три года он топтался на 3-м слое Очищения Ци. Без 15 духовных камней, необходимых для покупки Пилюли Конденсации Крови 1-го яруса низшего ранга, в конце месяца его неизбежно изгонят со двора.
«Неужели это действительно предел моего смертного духовного корня?» — с горечью подумал Линь Сюань.
Внезапно перед его внутренним взором развернулась полупрозрачная лазурная панель.
---
[Носитель: Линь Сюань]
[Культивация: Очищение Ци — 3-й слой]
[Очки Истока: 100]
[Талант к алхимии: 1-го яруса низшего ранга (Доступно улучшение — совместимость 85%)]
---
— Что это такое?! — прошептал Линь Сюань, ощущая, как по его меридианам стремительно разливается обжигающий поток духовной силы.`,
            wordCountRus: 145,
            qaPassed: true,
            qaErrorCount: 0,
          },
        ],
      },
      {
        id: 'ch-2',
        number: 2,
        titleEng: 'Chapter 2: The Crimson Flame Pavilion Test',
        titleRus: 'Глава 2. Испытание в Павильоне Багрового Пламени',
        engText: `At dawn, Lin Xuan walked 12 li down the winding stone stairs toward the Crimson Flame Pavilion.
Deacon Wang stood beside a massive bronze furnace weighing 400 jin, inspecting 24 outer disciples.
"Whoever can refine a Blood Condensation Pill with at least 60% purity will receive 30 Spirit Stones and a Tier 1 Low Grade Magical Artifact!" Deacon Wang announced loudly.
Lin Xuan stepped forward calmly. With his upgraded perception, every impurity inside the herbs was crystal clear.`,
        rusText: `На рассвете Линь Сюань прошёл 12 ли вниз по извилистой каменной лестнице, ведущей к Павильону Багрового Пламени.
Дьякон Ван стоял у массивного бронзового котла весом в 400 цзинь, окидывая строгим взглядом 24 внешних учеников.
— Тот, кто сумеет завершить создание Пилюли Конденсации Крови с чистотой не менее 60%, получит в награду 30 духовных камней и магический артефакт 1-го яруса низшего ранга! — громогласно объявил дьякон Ван.
Линь Сюань спокойно шагнул вперёд. Благодаря улучшенному восприятию каждая крупица примесей в целебных травах была видна как на ладони.`,
        summary:
          'В Главе 2 Линь Сюань прибывает в Павильон Багрового Пламени, где дьякон Ван обещает 30 духовных камней и магический артефакт 1-го яруса за создание Пилюли Конденсации Крови чистотой от 60%.',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 84,
        wordCountRus: 88,
        lastUpdated: '2026-10-16 01:40',
      },
      {
        id: 'ch-3',
        number: 3,
        titleEng: 'Chapter 3: Breakthrough to the 5th Layer',
        titleRus: 'Глава 3. Прорыв на 5-й слой',
        engText: `Inside the quiet chamber of the Stone Demon Sect, Elder Zhao examined the 9 radiant pills resting inside the jade bottle.
Each Blood Condensation Pill retained 95% medicinal efficacy, far surpassing standard Tier 1 pills.
"Remarkable! Even Su Qingxue only achieved 75% purity when she was at the 5th layer of Qi Refining," Elder Zhao murmured.
Returning to his cave, Lin Xuan consumed 2 pills and absorbed 18 Spirit Stones, pushing his cultivation directly to the 5th layer of Qi Refining while gaining 250 Origin Points.`,
        rusText: `В тихом зале Секты Каменных Демонов старейшина Чжао внимательно изучал 9 сияющих пилюль, покоившихся на дне нефритового флакона.
Каждая Пилюля Конденсации Крови сохранила 95% целебной силы, многократно превосходя обычные пилюли 1-го яруса.
— Поразительно! Даже Су Цинсюэ достигала лишь 75% чистоты, когда находилась на 5-м слое Очищения Ци, — пробормотал старейшина Чжао.
Вернувшись в пещерную обитель, Линь Сюань принял 2 пилюли и поглотил 18 духовных камней, единым рывком подняв культивацию до 5-го слоя Очищения Ци и получив 250 Очков Истока.`,
        summary:
          'В Главе 3 старейшина Чжао восхищается 9 пилюлями с чистотой 95% (выше 75% у Су Цинсюэ), а Линь Сюань прорывается на 5-й слой Очищения Ци и получает 250 Очков Истока.',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 89,
        wordCountRus: 86,
        lastUpdated: '2026-10-16 02:05',
      },
      {
        id: 'ch-4',
        number: 4,
        titleEng: 'Chapter 4: The Black Iron Cauldron and Azure Lotus Fire',
        titleRus: 'Глава 4. Котёл Чёрного Железа и Пламя Лазурного Лотоса',
        engText: `Lin Xuan spent 21 Spirit Stones at the 6th layer of Qi Refining to acquire a Tier 1 Low Grade Magical Artifact cauldron weighing 50 jin.
Inside the Crimson Flame Pavilion of the Stone Demon Sect, Elder Zhao summoned a wisp of Azure Lotus Fire, while Su Qingxue looked at the cauldron and smiled.
"Can an outer disciple really refine pills with an 80% success rate?" Deacon Wang asked in shock.
Lin Xuan thought "This cauldron is a miracle" and began refining the Blood Condensation Pill.`,
        rusText: `Линь Сюань потратил двадцать один духовный камень на шестом слое Очищения Ци, чтобы приобрести духовный артефакт 1-го яруса, точнее котёл 1-го ранга низшего ранга весом 50 фунтов.
Внутри Павильона Багрового Пламени Секты Каменного Демона старейшина Чжао призвал всполох Пламени Лазурного Лотоса, а Су Цинсюэ посмотрел на котёл и улыбнулся.
- Неужели внешний ученик действительно способен варить пилюли с шансом восемьдесят процентов? : — сказал дьякон Ван, не удержался от вопроса и втянул глоток холодного воздуха.
Линь Сюань подумал "Этот котёл — настоящее чудо" и начал изготовление Пилюли Конденсации Крови.`,
        summary:
          'В Главе 4 Линь Сюань на 6-м слое Очищения Ци приобретает котёл весом 50 цзинь за 21 духовный камень и приступает к созданию пилюль с шансом 80% при поддержке Пламени Лазурного Лотоса.',
        scouted: true,
        translated: true,
        edited: false,
        verified: false,
        wordCountEng: 84,
        wordCountRus: 91,
        lastUpdated: '2026-10-16 02:30',
        versionHistory: [
          {
            id: 'ver-ch4-raw-mt',
            timestamp: '2026-10-16 02:22',
            stageLabel: 'Первичный черновик (Фаза 2 — до вычитки)',
            titleRus: 'Глава 4. Котёл Чёрного Железа',
            rusText: `Линь Сюань потратил двадцать один духовный камень на шестом слое Очищения Ци, чтобы приобрести духовный артефакт 1-го яруса, точнее котёл 1-го ранга низшего ранга весом 50 фунтов.
Внутри Павильона Багрового Пламени Секты Каменного Демона старейшина Чжао призвал всполох Пламени Лазурного Лотоса, а Су Цинсюэ посмотрел на котёл и улыбнулся.
- Неужели внешний ученик действительно способен варить пилюли с шансом восемьдесят процентов? : — сказал дьякон Ван, не удержался от вопроса и втянул глоток холодного воздуха.
Линь Сюань подумал "Этот котёл — настоящее чудо" и начал изготовление Пилюли Конденсации Крови.`,
            wordCountRus: 91,
            qaPassed: false,
            qaErrorCount: 8,
          },
          {
            id: 'ver-ch4-critic-preview',
            timestamp: '2026-10-16 02:28',
            stageLabel: 'Редакция 2-проходного критика (Фаза 3)',
            titleRus: 'Глава 4. Котёл Чёрного Железа и Пламя Лазурного Лотоса',
            rusText: `Линь Сюань потратил 21 духовный камень на 6-м слое Очищения Ци, чтобы приобрести магический артефакт 1-го яруса, точнее котёл 1-го яруса низшего ранга весом 50 цзинь.
Внутри Павильона Багрового Пламени Секты Каменных Демонов старейшина Чжао призвал всполох Пламени Лазурного Лотоса, а Су Цинсюэ посмотрела на котёл и улыбнулась.
— Неужели внешний ученик действительно способен создавать пилюли с шансом 80%? — сказал дьякон Ван, невольно поинтересовался и судорожно перевёл дыхание.
Линь Сюань подумал «Этот котёл — настоящее чудо» и начал изготовление Пилюли Конденсации Крови.`,
            wordCountRus: 84,
            qaPassed: true,
            qaErrorCount: 0,
          },
        ],
      },
      {
        id: 'ch-5',
        number: 5,
        titleEng: 'Chapter 5: Shadow Step Scripture and the Outer Sect Ambush',
        titleRus: 'Глава 5. Канон Теневого Шага и засада во Внешней Секте',
        engText: `Under the pale moonlight on Myriad Beasts Mountain, Lin Xuan invested 120 Origin Points into the Shadow Step Scripture.
---
[Technique: Shadow Step Scripture — Tier 1 High Grade]
[Mastery: 100% Perfection]
[Speed Bonus: +45% movement velocity]
---
Three rogue cultivators from the Stone Demon Sect lunged from the mist, wielding blades weighing 35 jin.
"Hand over the 60 Spirit Stones you earned at the Crimson Flame Pavilion!" their leader snarled.
"You chose the wrong target," Lin Xuan thought coldly, vanishing like a phantom and striking with his Magical Artifact sword.`,
        rusText: '',
        scouted: true,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: 95,
        wordCountRus: 0,
        lastUpdated: '2026-10-16 02:45',
      },
      {
        id: 'ch-6',
        number: 6,
        titleEng: 'Chapter 6: Confrontation with Senior Brother Chen',
        titleRus: 'Глава 6. Противостояние со старшим братом Чэнем',
        engText: `At the gate of the Crimson Flame Pavilion, Senior Brother Chen blocked Lin Xuan's path with a cold sneer.
Having reached the 7th layer of Qi Refining, Senior Brother Chen held a Tier 1 High Grade Magical Artifact spear weighing 80 jin.
"Elder Zhao gave you 50 Spirit Stones and access to the earth flame chamber, yet you refuse to pay 30% tribute to our faction?" Senior Brother Chen demanded.
Su Qingxue watched from the jade balcony of the Stone Demon Sect as Lin Xuan released the aura of the 6th layer of Qi Refining.`,
        rusText: '',
        scouted: false,
        translated: false,
        edited: false,
        verified: false,
        wordCountEng: 96,
        wordCountRus: 0,
        lastUpdated: '2026-10-16 02:50',
      },
      {
        id: 'ch-7-1',
        number: 7,
        subPart: '7.1',
        titleEng: 'Chapter 7.1: Secret Realm of the Stone Demon (Part 1)',
        titleRus: 'Глава 7.1. Тайное царство Каменных Демонов (Часть 1)',
        engText: `The ancient portal at the summit of the Stone Demon Sect rumbled as 100 Spirit Stones were embedded into the formation array.
Elder Zhao and Su Qingxue led 16 core and outer disciples toward the rift.
"Inside the Secret Realm, anyone who collects 10 stalks of Nine-Leaf Spirit Grass within 48 hours will be promoted to Inner Sect status," Elder Zhao declared.`,
        rusText: `Древний портал на вершине Секты Каменных Демонов глухо загудел, когда в формационный массив вложили 100 духовных камней.
Старейшина Чжао и Су Цинсюэ повели 16 ключевых и внешних учеников к пространственному разлому.
— Внутри Тайного царства каждый, кто соберёт 10 стеблей Девятилистной Духовной Травы за 48 часов, будет возвышен до статуса ученика Внутренней Секты, — объявил старейшина Чжао.`,
        summary:
          'В Главе 7.1 старейшина Чжао и Су Цинсюэ открывают портал Тайного царства с помощью 100 духовных камней для 16 учеников.',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 64,
        wordCountRus: 61,
        lastUpdated: '2026-10-16 03:00',
      },
      {
        id: 'ch-7-2',
        number: 7,
        subPart: '7.2',
        titleEng: 'Chapter 7.2: Secret Realm of the Stone Demon (Part 2)',
        titleRus: 'Глава 7.2. Тайное царство Каменных Демонов (Часть 2)',
        engText: `Stepping through the spatial barrier, Lin Xuan immediately sensed 95% denser spiritual qi than on the Outer Sect Peak.
His panel chimed as 300 Origin Points surged into his dantian, illuminating a hidden cave 8 li to the north where a Foundation Establishment legacy awaited.`,
        rusText: `Шагнув сквозь пространственный барьер, Линь Сюань мгновенно ощутил духовную ци на 95% плотнее, чем на Пике Внешней Секты.
Его панель тихо прозвенела, когда 300 Очков Истока хлынули в даньтянь, подсвечивая на карте скрытый грот в 8 ли к северу, где покоилось наследие Учреждения Основы.`,
        summary:
          'В Главе 7.2 Линь Сюань получает 300 Очков Истока в Тайном царстве и обнаруживает грот в 8 ли к северу с наследием Учреждения Основы.',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 47,
        wordCountRus: 48,
        lastUpdated: '2026-10-16 03:05',
      },
    ],
  },
  {
    id: 'solo-dungeon-monarch-litrpg',
    name: 'Shadow Monarch of the Abyssal Tower',
    rusTitle: 'Теневой Монарх Башни Бездны (ЛитРПГ / Охотники)',
    author: 'Seoul Dungeon Studio',
    sourceLang: 'ENG',
    genrePreset: 'litrpg',
    proseTone: 'dynamic',
    autoApproveThreshold: 0.92,
    enabledRuleIds: getDefaultRulesForGenre('litrpg'),
    styleGuideMd: `# Стилевой гид: Теневой Монарх Башни Бездны
- Системные уведомления строго внутри блоков \`---\`.
- Сохранять все проценты, ранги охотников (S, A, B) и числа урона.`,
    contextMd: `# Синопсис
Кан Джин — охотник E-ранга, получивший скрытый класс Архитектора Теней на 15-м этаже Башни Бездны.`,
    glossary: {
      realms: {
        'S-Rank Hunter': 'Охотник S-ранга',
        'Shadow Monarch': 'Теневой Монарх',
      },
      characters: {
        'Kang Jin': 'Кан Джин',
        'Yoo Mina': 'Ю Мина',
      },
      sects_and_places: {
        'Abyssal Tower': 'Башня Бездны',
        'Aegis Guild': 'Гильдия Эгида',
      },
      system_and_terms: {
        'Mana Crystal': 'кристалл маны',
        'Shadow Extraction': 'Извлечение Тени',
      },
      units: {},
    },
    glossaryMeta: {
      'Kang Jin': { gender: 'M', declensionNote: 'мужской род, склоняется (Кан Джина)' },
      'Yoo Mina': { gender: 'F', declensionNote: 'женский род (Ж), склоняется (Ю Мины)' },
    },
    scoutedTerms: [],
    chapters: [
      {
        id: 'litrpg-1',
        number: 1,
        titleEng: 'Chapter 1: Awakening the Shadow Extraction Skill',
        titleRus: 'Глава 1. Пробуждение навыка Извлечения Тени',
        engText: `Inside the 15th floor of the Abyssal Tower, Kang Jin absorbed 40 Mana Crystals while Yoo Mina guarded the gate of the Aegis Guild.
---
[Skill: Shadow Extraction — Tier 1 High Grade]
[Critical Damage Bonus: +75%]
---`,
        rusText: `На 15-м этаже Башни Бездны Кан Джин поглотил 40 кристаллов маны, пока Ю Мина охраняла врата Гильдии Эгида.
---
[Навык: Извлечение Тени — 1-го яруса высшего ранга]
[Бонус критического урона: +75%]
---`,
        summary:
          'В Главе 1 Кан Джин на 15-м этаже Башни Бездны поглощает 40 кристаллов маны и пробуждает навык Извлечения Тени (+75% крит. урона).',
        scouted: true,
        translated: true,
        edited: true,
        verified: true,
        wordCountEng: 38,
        wordCountRus: 35,
        lastUpdated: '2026-10-15 19:20',
      },
    ],
  },
];
