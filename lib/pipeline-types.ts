/**
 * Leaf domain & pipeline contracts with ZERO runtime imports.
 * Breaks circular dependencies across qa-linter, delta-diting, canon-glossary-vault,
 * llm-inference-port, chapter-verifier, pipeline-run-engine, sqlite-db-server, and UI.
 */

export type GlossaryCategory =
  | 'realms'
  | 'characters'
  | 'sects_and_places'
  | 'system_and_terms'
  | 'units';

export type GrammaticalGender = 'M' | 'F' | 'N' | 'PL' | 'UNKNOWN';

export interface CharacterSpeechVector {
  registerLevel: number; // [-1.0 (грубый просторечный) .. +1.0 (высокий архаичный)]
  sentenceLengthBias: 'clipped_staccato' | 'balanced_conversational' | 'ornate_periodic';
  ellipsisRate: 'low' | 'medium' | 'high';
  inversionTendency: 'low' | 'medium' | 'high';
  preferredParticles: string[]; // e.g. ["-то", "ну", "ведь", "что ли"]
  forbiddenLexicon: string[]; // e.g. ["окей", "круто", "проблема", "информация"]
  catchphrasesOrTics?: string[];
  contrastiveDialogueSamples?: Array<{
    context: string;
    badNeutralAi: string;
    canonicalVoiceRu: string;
  }>;
}

export interface GlossaryTermMeta {
  gender?: GrammaticalGender;
  declensionNote?: string;
  voiceNote?: string;
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

export interface SocialRegisterEdge {
  fromCharacter: string;
  toCharacter: string;
  valence: number;
  coarseRole: 'hierarchical' | 'peer' | 'kinship' | 'hostile';
  fineRole: string;
  pronounMode: 'ты' | 'Вы';
  updatedAtChapter: number;
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

export interface HeroStateLedger {
  protagonistName: string;
  cultivationRealm: string;
  resources: string[];
  artifactsAndFlames: string[];
  activeLocation: string;
  lastUpdatedChapter: number;
  forwardQuestions?: ForwardFallingQuestion[];
}

export type CsiCategory = 'idiom' | 'honorific' | 'daoist_term' | 'system_formula';

export interface CsiCulturalNote {
  id: string;
  sourcePhrase: string;
  category: CsiCategory;
  categoryLabel: string;
  adaptedRus: string;
  rationale: string;
}

export interface StylometricMetrics {
  wordCount: number;
  sentenceCount: number;
  mattr100: number;
  burstinessCv: number;
  openerEntropy: number;
  nominalizationPer100Words: number;
  nominalizationHotspotParagraphs: number[];
  negationPolarityMismatchParagraphs: number[];
  internalDashPer100Words: number;
  tautologyPer1000Words: number;
  wordExpansionRatio: number;
}

export interface DitingQualityReport {
  idiomAccuracy: number;
  referentialCohesion: number;
  characterVoiceFidelity: number;
  culturalAdaptation: number;
  literaryRhythm: number;
  terminologyPrecision: number;
  overallScore: number;
  mqmGrade: 'Эталон (DITING 95+)' | 'Высокий (85–94)' | 'Требует правки (<85)';
  stylometry?: StylometricMetrics;
}

export type GeminiThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'auto_xhigh';

export type LlmProviderType =
  | 'colab_ollama'
  | 'gemini_api'
  | 'antigravity_cli'
  | 'deterministic';

export interface LlmProviderConfig {
  provider: LlmProviderType;
  colabEndpointUrl?: string;
  modelId: string;
  scoutModelId?: string;
  criticModelId?: string;
  stylistModelId?: string;
  thinkingLevel?: GeminiThinkingLevel;
  useDecisionEngine?: boolean;
  temperature?: number;
  numCtx?: number;
}

// ============================================================================
// AUTOPILOT QUALITY 10/10 CONTRACTS (QUARANTINE, STREAMING, ARC COMPILER, SSE)
// ============================================================================

export type ChapterStatus = 'pending' | 'translated' | 'verified' | 'quarantined';

export interface ChapterQaSummary {
  passed: boolean;
  score: number;
  errorCount: number;
  warningCount: number;
  fingerprint: string;
  computedAt: string;
}

export interface CrossChapterSlopIssue {
  paragraphIndex: number; // 0-based
  phrase: string;
  occurrencesInWindow: number;
  chapterNumbers: number[];
}

export interface StreamedChapterDraft {
  titleRus: string;
  paragraphs: string[];
  rusText: string;
  summary: string;
  summaryEng: string;
  csiNotes: string[];
  truncated: boolean;
  lastCompletedIndex: number;
}

export interface ArcCanonPacket {
  arcId: string;
  startChapter: number;
  endChapter: number;
  frozenGlossaryBlock: string;
  frozenVoicesBlock: string;
  frozenSocialEdgesBlock: string;
  cacheKey: string;
}

export type PipelineJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PipelineJobMode = 'full_5_phase' | 'scout_only' | 'verify_and_repair';

export interface PipelineJobRecord {
  id: string;
  novelId: string;
  mode: PipelineJobMode;
  status: PipelineJobStatus;
  startChapter: number;
  endChapter: number;
  progressPct: number;
  currentChapter: number | null;
  completedChapters: number;
  totalChapters: number;
  quarantinedChapters: number;
  ownerPid?: number | null;
  statsJson?: string | null;
  errorText?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineJobEvent {
  type:
    | 'snapshot'
    | 'phase'
    | 'chapter_done'
    | 'chapter_quarantined'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'heartbeat';
  jobId: string;
  timestamp: string;
  progressPct: number;
  phase?: string;
  chapterId?: string;
  chapterNumber?: number;
  message?: string;
  job?: PipelineJobRecord;
}

export type EmbeddingEngineId =
  | 'local-embeddinggemma-2'
  | 'gemini-embedding-2-fallback'
  | 'mock-adapter';

export interface LowSimilarityPair {
  index: number; // 1-based paragraph index in ENG
  matchedRusIndex: number; // 1-based paragraph index in RUS
  cosine: number;
  eng: string;
  rus: string;
}

export interface PairCosineEntry {
  index: number; // 0-based paragraph index in ENG
  matchedRusIndex: number; // 0-based paragraph index in RUS
  cosine: number;
}

export interface ChapterNeuralAuditResult {
  chapter: number;
  pairs: number;
  rusCount: number;
  alignmentMode: string;
  meanCosine: number;
  minCosine: number;
  lowSimilarityCount: number;
  lowPairs: LowSimilarityPair[];
  pairCosines?: PairCosineEntry[];
  embeddingEngine: EmbeddingEngineId;
  device: string;
  latencyMs: number;
}

export type ScenePacingMode =
  | 'combat_action'
  | 'cultivation_epiphany'
  | 'comedy_banter'
  | 'solemn_pathos'
  | 'romance_psychology';

export interface ContrastiveFewShotTriplet {
  pacingMode: ScenePacingMode;
  rawSource: string;
  badAiDraft: string;
  referenceRu: string;
  whyExplanation: string;
}

export interface StylisticSpanDirective {
  paragraphIndex: number;
  anchorHash?: string;
  spanQuote: string;
  issueType:
    | 'SVO_CALQUE'
    | 'NOMINALIZATION'
    | 'FLAT_DIALOGUE'
    | 'PARTICIPLE_CHAIN'
    | 'RHYTHM_MONOTONY';
  rewriteInstructionRu: string;
}

export interface LiTransProQaRubricScores {
  q1_faith: number;
  q2_term: number;
  q3_cult: number;
  q4_pron: number;
  q5_struct: number;
  q6_rhythm: number;
  q7_verbs: number;
  q8_voice: number;
  q9_atmos: number;
  q10_pacing: number;
  otqs: number;
}

export interface SceneDialogueAnnotation {
  paragraphIndex: number;
  speaker?: string;
  addressee?: string;
  inferredGender?: GrammaticalGender;
  pronounMode?: 'ты' | 'Вы' | 'auto';
  zeroPronounResolution?: string;
  sourceSnippet: string;
}

export interface SceneDialogueAnalysisResult {
  annotations: SceneDialogueAnnotation[];
  promptSummaryBlock: string;
}
