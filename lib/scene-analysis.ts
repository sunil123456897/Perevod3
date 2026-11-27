import type {
  CanonicalGlossary,
  ContrastiveFewShotTriplet,
  GlossaryTermMeta,
  GrammaticalGender,
  LiTransProQaRubricScores,
  SceneDialogueAnalysisResult,
  SceneDialogueAnnotation,
  ScenePacingMode,
  SocialRegisterEdge,
  StylisticSpanDirective,
} from './pipeline-types.ts';

export type {
  ScenePacingMode,
  ContrastiveFewShotTriplet,
  StylisticSpanDirective,
  LiTransProQaRubricScores,
  SceneDialogueAnnotation,
  SceneDialogueAnalysisResult,
};

export function inferEnglishLocalGender(text: string): GrammaticalGender {
  const fHits = (
    text.match(
      /\b(?:she|her|hers|herself|lady|queen|princess|sister|girl|maiden|woman|empress|goddess|duchess|mother|wife|daughter)\b/gi
    ) || []
  ).length;
  const mHits = (
    text.match(
      /\b(?:he|his|him|himself|lord|king|prince|brother|boy|man|emperor|god|duke|father|husband|son)\b/gi
    ) || []
  ).length;
  if (fHits > mHits) return 'F';
  if (mHits > fHits) return 'M';
  return 'UNKNOWN';
}

/**
 * Pass 0: Scene Dialogue Annotation & Zero-Pronoun Disambiguation Engine.
 * Analyzes dialogue lines, attributes speakers/addressees, determines polite/casual mode,
 * and resolves implicit subjects for zero-pronouns in CJK/web-novel narratives.
 */
export function annotateSceneDialogueAndZeroPronouns(
  engText: string,
  glossary: CanonicalGlossary,
  glossaryMeta?: Record<string, GlossaryTermMeta>,
  socialEdges?: SocialRegisterEdge[]
): SceneDialogueAnalysisResult {
  const paragraphs = (engText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

  const annotations: SceneDialogueAnnotation[] = [];
  const knownCharacters = Object.keys(glossary?.characters || {});
  let lastActiveSpeaker: string | undefined;

  const speechVerbs =
    '(?:said|Said|asked|Asked|shouted|Shouted|roared|Roared|sneered|Sneered|whispered|Whispered|murmured|Murmured|replied|Replied|chuckled|Chuckled|cried|Cried|declared|Declared|growled|Growled)';
  const postTagRegex = new RegExp(
    `${speechVerbs}\\s+(he|she|He|She|it|they|I|you|[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*)`
  );
  const preTagRegex = new RegExp(
    `(he|she|He|She|it|they|I|you|[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*)\\s+${speechVerbs}`
  );

  for (let idx = 0; idx < paragraphs.length; idx++) {
    const p = paragraphs[idx];
    const isDivider = p === '---' || p === '***' || p === '◇◇◇';
    const isSystemFrame =
      (p.startsWith('[') && p.endsWith(']')) || (p.startsWith('【') && p.endsWith('】'));
    if (isDivider || isSystemFrame) {
      continue;
    }

    const isDialogue = /^["“'«‘—\-]/.test(p) || /["“«]([^"»”]+)["»”]/.test(p);

    let detectedSpeaker: string | undefined;
    let detectedAddressee: string | undefined;

    const postTagMatch = p.match(postTagRegex);
    const preTagMatch = p.match(preTagRegex);

    const tagCandidate = postTagMatch
      ? postTagMatch[1]
      : preTagMatch
        ? preTagMatch[1]
        : undefined;

    const isPronoun = /^(?:he|she|it|they|someone|we|i|you)$/i.test(tagCandidate || '');

    if (tagCandidate && !isPronoun) {
      const matched = knownCharacters.find(
        (c) =>
          c.toLowerCase() === tagCandidate.toLowerCase() ||
          tagCandidate.toLowerCase().includes(c.toLowerCase())
      );
      detectedSpeaker = matched || tagCandidate;
    }

    if (isDialogue && !detectedSpeaker && lastActiveSpeaker) {
      const otherChar = knownCharacters.find(
        (c) => c !== lastActiveSpeaker && p.includes(c)
      );
      if (otherChar) {
        detectedSpeaker = otherChar;
      }
    }

    if (detectedSpeaker) {
      lastActiveSpeaker = detectedSpeaker;
      detectedAddressee = knownCharacters.find(
        (c) =>
          c.toLowerCase() !== detectedSpeaker?.toLowerCase() &&
          p.toLowerCase().includes(c.toLowerCase())
      );
    }

    let inferredGender: GrammaticalGender = 'UNKNOWN';
    if (detectedSpeaker && glossaryMeta?.[detectedSpeaker]?.gender) {
      inferredGender = glossaryMeta[detectedSpeaker].gender || 'UNKNOWN';
    } else if (isPronoun && /^she$/i.test(tagCandidate || '')) {
      inferredGender = 'F';
    } else if (isPronoun && /^he$/i.test(tagCandidate || '')) {
      inferredGender = 'M';
    } else {
      inferredGender = inferEnglishLocalGender(p);
    }

    let pronounMode: 'ты' | 'Вы' | 'auto' = 'auto';
    if (detectedSpeaker && detectedAddressee && Array.isArray(socialEdges)) {
      const edge = socialEdges.find(
        (e) =>
          e.fromCharacter.toLowerCase() === detectedSpeaker?.toLowerCase() &&
          e.toCharacter.toLowerCase() === detectedAddressee?.toLowerCase()
      );
      if (edge) {
        pronounMode = edge.pronounMode;
      }
    }

    let zeroPronounResolution: string | undefined;
    if (
      isDialogue ||
      /^(?:Turning|Looking|Smiling|Stepping|Taking|Reaching|Gazing)\b/i.test(p)
    ) {
      if (detectedSpeaker) {
        zeroPronounResolution = `Subject [${detectedSpeaker}]`;
      }
    }

    if (isDialogue || detectedSpeaker || zeroPronounResolution) {
      annotations.push({
        paragraphIndex: idx,
        speaker: detectedSpeaker,
        addressee: detectedAddressee,
        inferredGender,
        pronounMode,
        zeroPronounResolution,
        sourceSnippet: p.length > 80 ? p.slice(0, 80) + '...' : p,
      });
    }
  }

  const promptSummaryBlock =
    annotations.length === 0
      ? '[SCENE DIALOGUE & REGISTER MAP]: No complex multi-speaker dialogue identified.'
      : '[SCENE DIALOGUE & REGISTER MAP (PASS 0 ANNOTATIONS)]:\n' +
        annotations
          .map(
            (a) =>
              `[#p${a.paragraphIndex}] Speaker: ${a.speaker || 'Contextual'}, Addressee: ${
                a.addressee || 'Undetermined'
              }, Pronoun Mode: ${a.pronounMode || 'auto'}, Gender: ${a.inferredGender || 'UNKNOWN'}${
                a.zeroPronounResolution ? `, Implied: ${a.zeroPronounResolution}` : ''
              }`
          )
          .join('\n');

  return { annotations, promptSummaryBlock };
}

/**
 * Classifies scene pacing mode across 5 archetypal dynamics.
 */
export function classifyScenePacingMode(text: string): ScenePacingMode {
  const lower = (text || '').toLowerCase();

  const combatHits = (
    lower.match(
      /(?<![а-яёa-z0-9])(?:sword|blade|strike|spear|blood|slash|punch|kill|roar|clash|dodge|crush|attack|клинок|клинком|меч|мечом|удар|ударом|копь[её]|кровь|кровью|рассек|вожак|смерт|атак|атаки|бой|боем|рык)(?![а-яёa-z0-9])/gi
    ) || []
  ).length;

  const cultHits = (
    lower.match(
      /(?<![а-яёa-z0-9])(?:qi|dantian|meridian|cultivat|realm|breakthrough|meditat|elixir|dao|ци|даньтянь|меридиан|меридианы|культивац|прорыв|медитац|пилюл|пилюли|дао|энерги|энергия)(?![а-яёa-z0-9])/gi
    ) || []
  ).length;

  const comedyHits = (
    lower.match(
      /(?<![а-яёa-z0-9])(?:chuckle|sneer|grin|laugh|scoff|tease|idiot|fool|ridiculous|усмех|хохот|дурак|идиот|смех|шутк|шуткой|нелепо|чушь)(?![а-яёa-z0-9])/gi
    ) || []
  ).length;

  const pathosHits = (
    lower.match(
      /(?<![а-яёa-z0-9])(?:ancient|ancestor|grand|throne|destiny|sacred|emperor|grave|dignity|древн|предок|предков|трон|трона|судьб|судьба|священн|император|величи|величие|могил|могила)(?![а-яёa-z0-9])/gi
    ) || []
  ).length;

  const romanceHits = (
    lower.match(
      /(?<![а-яёa-z0-9])(?:blush|gaze|heartbeat|gentle|whisper|tender|embrace|взор|взором|румян|сердцебиени|нежн|ш[её]пот|ш[её]потом|объяти)(?![а-яёa-z0-9])/gi
    ) || []
  ).length;

  const counts: Array<{ mode: ScenePacingMode; score: number }> = [
    { mode: 'combat_action', score: combatHits },
    { mode: 'cultivation_epiphany', score: cultHits },
    { mode: 'comedy_banter', score: comedyHits },
    { mode: 'solemn_pathos', score: pathosHits },
    { mode: 'romance_psychology', score: romanceHits },
  ];

  counts.sort((a, b) => b.score - a.score);
  return counts[0].score > 0 ? counts[0].mode : 'cultivation_epiphany';
}

const CONTRASTIVE_FEW_SHOT_LIBRARY: ContrastiveFewShotTriplet[] = [
  {
    pacingMode: 'combat_action',
    rawSource: "The sword came at his throat. Lin Xuan didn't hesitate. He swung his blade and blocked it.",
    badAiDraft: 'Меч приближался к его горлу. Линь Сюань не колебался. Он взмахнул своим клинком и заблокировал его.',
    referenceRu: 'Клинок метил прямо в горло. Ни секунды не медля, Линь Сюань взметнул меч навстречу, и сталь со звоном приняла удар на себя.',
    whyExplanation: 'Динамичный синтаксис без ИИ-тире, устранение притяжательных калек («своим/его»), звукопись и глагольный напор.',
  },
  {
    pacingMode: 'combat_action',
    rawSource: 'Blood sprayed out. He stepped forward with a fierce punch aimed right at the demon’s skull.',
    badAiDraft: 'Кровь брызнула наружу. Он шагнул вперёд со свирепым ударом, направленным прямо на череп демона.',
    referenceRu: 'Брызнула кровь. Шагнув наперерез, он со всего маху впечатал кулак прямо в темя твари.',
    whyExplanation: 'Устранение тяжеловесных причастий («направленным на») и отказ от шаблонных ИИ-тире («Шаг вперёд — и...») в пользу живого глагола.',
  },
  {
    pacingMode: 'cultivation_epiphany',
    rawSource: 'After the completion of the absorption of the pill, the spiritual qi flowed through his meridians like a river.',
    badAiDraft: 'После завершения поглощения пилюли, духовная ци текла через его меридианы подобно реке.',
    referenceRu: 'Усвоив пилюлю, Линь Сюань ощутил, как духовная Ци широкой рекой хлынула по меридианам.',
    whyExplanation: 'Устранение канцелярита «после завершения поглощения» по Норе Галь, вербализация и одушевление восприятия.',
  },
  {
    pacingMode: 'cultivation_epiphany',
    rawSource: 'The barrier between layers began to crack. An ancient aura surged from the depth of his dantian.',
    badAiDraft: 'Барьер между слоями начал трескаться. Древняя аура хлынула из глубины его даньтяня.',
    referenceRu: 'Барьер между слоями пошёл трещинами. Из самых недр даньтяня поднялась первозданная мощь.',
    whyExplanation: 'Перестановка Тема → Рема, замена абстрактной «ауры» на осязаемую стилистику сянься.',
  },
  {
    pacingMode: 'comedy_banter',
    rawSource: '“Are you crazy? Why would I give you money?” he said with a twitching mouth.',
    badAiDraft: '— Ты сумасшедший? Почему я должен давать тебе деньги? — сказал он с подёргивающимся ртом.',
    referenceRu: '— С дуба рухнул, что ли? С какой стати мне тебе платить?! — проворчал он, и губы у него нервно дрогнули.',
    whyExplanation: 'Разговорные частицы «что ли», фразеологизм «с какой стати», замена китайской соматической кальки.',
  },
  {
    pacingMode: 'comedy_banter',
    rawSource: '“Senior Brother, you shouldn’t do that,” she whispered, not knowing whether to laugh or cry.',
    badAiDraft: '— Старший брат, ты не должен этого делать, — прошептала она, не зная, смеяться ей или плакать.',
    referenceRu: '— Старший брат, ну ты и даёшь... — вздохнула девушка, не зная, то ли смеяться, то ли плакать.',
    whyExplanation: 'Живая модальная частица «ну ... и», естественный оборот «то ли ... то ли» вместо буквального «смеяться или плакать».',
  },
  {
    pacingMode: 'solemn_pathos',
    rawSource: 'The grand elder stood atop the Myriad Beasts Mountain, gazing down at the disciples with cold eyes.',
    badAiDraft: 'Великий старейшина стоял на вершине Горы Мириадов Зверей, глядя вниз на учеников холодными глазами.',
    referenceRu: 'На вершине Горы Мириадов Зверей возвышался великий старейшина, бесстрастным взором оглядывая застывших внизу учеников.',
    whyExplanation: 'Инверсия Тема → Рема, возвышенный торжественный ритм без избыточных местоимений у частей тела.',
  },
  {
    pacingMode: 'romance_psychology',
    rawSource: 'She bit her lower lip, feeling a strange warmth in her chest as he took her hand.',
    badAiDraft: 'Она прикусила свою нижнюю губу, чувствуя странное тепло в своей груди, когда он взял её руку.',
    referenceRu: 'Девушка закусила губу, и от его прикосновения к ладони в груди разлилось непривычное тепло.',
    whyExplanation: 'Снятие тройного калькирования притяжательных местоимений (свою/своей/её) и плавная союзная связь без искусственных двоеточий и тире.',
  },
];

/**
 * Selects k contrastive Dynamic Few-Shot triplets for prompt injection.
 */
export function selectContrastiveFewShotTriplets(
  mode: ScenePacingMode,
  k = 3
): ContrastiveFewShotTriplet[] {
  const matches = CONTRASTIVE_FEW_SHOT_LIBRARY.filter((item) => item.pacingMode === mode);
  const fallbacks = CONTRASTIVE_FEW_SHOT_LIBRARY.filter((item) => item.pacingMode !== mode);
  return [...matches, ...fallbacks].slice(0, k);
}

/**
 * Kunilovskaya Constraint: Capping directives to <= 3 per paragraph prevents
 * hypertransformation and stylistic collapse during blind rewriting.
 */
export function capStylisticDirectivesPerParagraph(
  directives: StylisticSpanDirective[],
  maxPerParagraph = 3
): StylisticSpanDirective[] {
  const counts = new Map<number, number>();
  const capped: StylisticSpanDirective[] = [];

  for (const d of directives) {
    const cur = counts.get(d.paragraphIndex) || 0;
    if (cur < maxPerParagraph) {
      counts.set(d.paragraphIndex, cur + 1);
      capped.push(d);
    }
  }

  return capped;
}
