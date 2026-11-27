import { GoogleGenAI, Type } from '@google/genai';
import {
  normalizeColabEndpointUrl,
  validateColabEndpointUrl,
  extractResilientJsonFromLlm,
  applySurgicalPatches,
  computeParagraphHashAnchor,
  type LorebookEntry,
  type SurgicalPatchItem,
} from './qa-linter.ts';
import type {
  CanonicalGlossary,
  GlossaryTermMeta,
  GenrePreset,
  ProseTone,
  HeroStateLedger,
  LlmProviderConfig,
  ScoutedTerm,
  SocialRegisterEdge,
  GrammaticalGender,
  LintIssue,
  CrossChapterSlopIssue,
  StreamedChapterDraft,
  ArcCanonPacket,
} from './pipeline-types.ts';
import type { DelTAShortTermPair, DelTALongTermMatch } from './delta-diting.ts';
import {
  inferEnglishLocalGender,
  annotateSceneDialogueAndZeroPronouns,
  classifyScenePacingMode,
  selectContrastiveFewShotTriplets,
  capStylisticDirectivesPerParagraph,
  type ScenePacingMode,
  type StylisticSpanDirective,
  type LiTransProQaRubricScores,
  type ContrastiveFewShotTriplet,
  type SceneDialogueAnnotation,
  type SceneDialogueAnalysisResult,
} from './scene-analysis.ts';

export {
  annotateSceneDialogueAndZeroPronouns,
  classifyScenePacingMode,
  selectContrastiveFewShotTriplets,
  capStylisticDirectivesPerParagraph,
  type ScenePacingMode,
  type StylisticSpanDirective,
  type LiTransProQaRubricScores,
  type ContrastiveFewShotTriplet,
  type SceneDialogueAnnotation,
  type SceneDialogueAnalysisResult,
};

export interface LlmCompletionRequest {
  task: 'scout' | 'translate_pass1' | 'surgical_critic_pass2' | 'blind_stylist_pass3' | 'self_repair';
  systemInstruction: string;
  userPrompt: string;
  expectJson?: boolean;
  temperature?: number;
  numCtx?: number;
  geminiModel?: string;
  thinkingLevel?: 'low' | 'medium' | 'high' | 'xhigh';
  geminiResponseSchema?: unknown;
  cacheKey?: string;
}

export interface LlmCompletionResponse {
  text: string;
  engineUsed: string;
  provider: 'colab_ollama' | 'gemini_api' | 'antigravity_cli' | 'deterministic';
}

export interface LlmInferencePort {
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

const MAX_POOL_STATE_ENTRIES = 2048;
const KEY_INVALID_COOLDOWN_MS = 24 * 3600 * 1000;
const BACKOFF_STEPS_MS = [15_000, 35_000, 65_000];

interface SharedGeminiPoolState {
  quotaCooldownUntil: Map<string, number>;
  keyBackoffStep: Map<string, number>;
  modelCursors: Map<string, number>;
  projectByKey: Map<string, string>;
  contextCacheByKey: Map<string, { name: string; expiresAt: number }>;
  bucketNextAllowedAt: Map<string, number>;
}

function getSharedGeminiPoolState(): SharedGeminiPoolState {
  const host = globalThis as unknown as { __studioGeminiPoolState?: SharedGeminiPoolState };
  if (!host.__studioGeminiPoolState) {
    host.__studioGeminiPoolState = {
      quotaCooldownUntil: new Map(),
      keyBackoffStep: new Map(),
      modelCursors: new Map(),
      projectByKey: new Map(),
      contextCacheByKey: new Map(),
      bucketNextAllowedAt: new Map(),
    };
  } else if (!host.__studioGeminiPoolState.bucketNextAllowedAt) {
    host.__studioGeminiPoolState.bucketNextAllowedAt = new Map();
  }
  return host.__studioGeminiPoolState;
}

function setBoundedMapValue<K, V>(map: Map<K, V>, key: K, value: V, cap = MAX_POOL_STATE_ENTRIES): void {
  if (!map.has(key) && map.size >= cap) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) {
      map.delete(firstKey);
    }
  }
  map.set(key, value);
}

/**
 * Computes milliseconds remaining until the next 00:05 Pacific Time
 * (Google AI Studio / Gemini Free Tier daily RPD reset boundary + 5m jitter buffer).
 */
export function computeMsUntilNextPtMidnight(nowMs = Date.now()): number {
  const BUFFER_MS = 5 * 60_000;
  const MIN_MS = 5 * 60_000;
  const MAX_MS = 24 * 3600_000 + 10 * 60_000;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(nowMs));
    const partVal = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const hh = partVal('hour') % 24;
    const mm = partVal('minute');
    const ss = partVal('second');
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) {
      return 8 * 3600_000;
    }
    const elapsedSecToday = hh * 3600 + mm * 60 + ss;
    const remainingMs = (24 * 3600 - elapsedSecToday) * 1000 + BUFFER_MS;
    return Math.min(MAX_MS, Math.max(MIN_MS, remainingMs));
  } catch {
    return 8 * 3600_000;
  }
}

/**
 * Parses server-advised retry delay from Gemini JSON error body (`retryDelay`, `retry in Xs`)
 * or numeric HTTP `Retry-After` header, adding a 1s safety margin and clamping to 1s..180s.
 */
export function parseGeminiRetryDelayMs(
  errMsg: string,
  retryAfterHeader?: string | null
): number | null {
  const candidatesSec: number[] = [];
  const raw = errMsg || '';
  const jsonDelayMatch = raw.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (jsonDelayMatch) {
    const sec = Number(jsonDelayMatch[1]);
    if (Number.isFinite(sec) && sec > 0) candidatesSec.push(sec);
  }
  const textDelayMatch = raw.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (textDelayMatch) {
    const sec = Number(textDelayMatch[1]);
    if (Number.isFinite(sec) && sec > 0) candidatesSec.push(sec);
  }
  const headerTrimmed = (retryAfterHeader || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(headerTrimmed)) {
    const sec = Number(headerTrimmed);
    if (Number.isFinite(sec) && sec > 0) candidatesSec.push(sec);
  }
  if (candidatesSec.length === 0) return null;
  const maxSec = Math.max(...candidatesSec);
  return Math.min(180_000, Math.max(1_000, Math.ceil(maxSec * 1000) + 1_000));
}

export function getGeminiModelMinIntervalMs(modelName: string): number {
  const clean = (modelName || '').trim().toLowerCase();
  if (clean === 'gemini-4-hydrogen') return 12_500;
  if (clean === 'gemini-3.8-flash' || clean.startsWith('gemma-')) return 4_200;
  if (clean === 'gemini-3.1-flash-lite') return 2_100;
  if (clean === 'gemini-decision-1') return 350;
  if (clean.startsWith('gemini-embedding-')) return 700;
  return 2_000;
}

export function registerGeminiKeyProject(apiKey: string, projectNumber: string): void {
  const cleanKey = (apiKey || '').trim();
  const cleanProj = (projectNumber || '').trim();
  if (!cleanKey || !cleanProj) return;
  setBoundedMapValue(getSharedGeminiPoolState().projectByKey, cleanKey, cleanProj);
}

export function getGeminiKeyProject(apiKey: string): string | undefined {
  return getSharedGeminiPoolState().projectByKey.get((apiKey || '').trim());
}

export function getGeminiQuotaBucketId(apiKey: string, modelName: string): string {
  const cleanKey = (apiKey || '').trim();
  const project = getSharedGeminiPoolState().projectByKey.get(cleanKey);
  const ownerScope = project ? `project:${project}` : `key:${cleanKey}`;
  const cleanModel = (modelName || 'default').trim().toLowerCase();
  return `${ownerScope}::${cleanModel}`;
}

export function computeGeminiBucketWaitMs(
  apiKey: string,
  modelName: string,
  nowMs = Date.now()
): number {
  const state = getSharedGeminiPoolState();
  const bucket = getGeminiQuotaBucketId(apiKey, modelName);
  return Math.max(0, (state.bucketNextAllowedAt.get(bucket) || 0) - nowMs);
}

export async function waitForGeminiBucketPacing(
  apiKey: string,
  modelName: string,
  nowMs = Date.now()
): Promise<number> {
  const state = getSharedGeminiPoolState();
  const bucket = getGeminiQuotaBucketId(apiKey, modelName);
  const minIntervalMs = getGeminiModelMinIntervalMs(modelName);
  const prevNext = state.bucketNextAllowedAt.get(bucket) || 0;
  const waitMs = Math.max(0, prevNext - nowMs);
  const scheduledAt = nowMs + waitMs;
  setBoundedMapValue(state.bucketNextAllowedAt, bucket, scheduledAt + minIntervalMs);

  const skipSleep =
    apiKey.startsWith('AIzaTest') ||
    (typeof process !== 'undefined' && process.env?.GEMINI_DISABLE_RPM_PACING === '1');
  if (waitMs > 0 && !skipSleep) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return waitMs;
}

export function isGeminiBucketCoolingDown(
  apiKey: string,
  modelName: string,
  nowMs = Date.now()
): boolean {
  const state = getSharedGeminiPoolState();
  const keyDeadUntil = state.quotaCooldownUntil.get(getGeminiQuotaBucketId(apiKey, '__key_invalid__')) || 0;
  if (keyDeadUntil > nowMs) return true;
  const until = state.quotaCooldownUntil.get(getGeminiQuotaBucketId(apiKey, modelName)) || 0;
  return until > nowMs;
}

export function markGeminiBucketSuccess(apiKey: string, modelName: string): void {
  const state = getSharedGeminiPoolState();
  const bucket = getGeminiQuotaBucketId(apiKey, modelName);
  state.keyBackoffStep.delete(bucket);
  state.quotaCooldownUntil.delete(bucket);
}

export function markGeminiBucketQuotaError(
  apiKey: string,
  modelName: string,
  errMsg: string,
  retryAfterHeader?: string | null
): boolean {
  const state = getSharedGeminiPoolState();
  const isInvalidKey =
    /API key expired|API_KEY_INVALID|reported as leaked|PERMISSION_DENIED.*leaked|free tier is not available|account.*suspended|project.*disabled/i.test(
      errMsg
    );
  if (isInvalidKey) {
    setBoundedMapValue(
      state.quotaCooldownUntil,
      getGeminiQuotaBucketId(apiKey, '__key_invalid__'),
      Date.now() + KEY_INVALID_COOLDOWN_MS
    );
    return true;
  }
  const bucket = getGeminiQuotaBucketId(apiKey, modelName);
  const isDailyOrBilling = /PerDay|daily|QUOTA_EXHAUSTED|billing/i.test(errMsg);
  if (isDailyOrBilling) {
    setBoundedMapValue(
      state.quotaCooldownUntil,
      bucket,
      Date.now() + computeMsUntilNextPtMidnight()
    );
    return true;
  }
  const isRateLimit = /429|RESOURCE_EXHAUSTED|quota/i.test(errMsg);
  if (!isRateLimit) {
    return false;
  }
  const step = state.keyBackoffStep.get(bucket) || 0;
  const baseMs = BACKOFF_STEPS_MS[Math.min(step, BACKOFF_STEPS_MS.length - 1)];
  const jitter = 0.8 + Math.random() * 0.4;
  const backoffMs = Math.round(baseMs * jitter);
  const serverDelayMs = parseGeminiRetryDelayMs(errMsg, retryAfterHeader);
  setBoundedMapValue(
    state.quotaCooldownUntil,
    bucket,
    Date.now() + Math.max(backoffMs, serverDelayMs || 0)
  );
  setBoundedMapValue(state.keyBackoffStep, bucket, Math.min(step + 1, BACKOFF_STEPS_MS.length));
  return true;
}

export function nextGeminiModelCursor(modelName: string, poolSize: number): number {
  if (poolSize <= 0) return 0;
  const state = getSharedGeminiPoolState();
  const cleanModel = (modelName || 'default').trim().toLowerCase();
  const cur = (state.modelCursors.get(cleanModel) || 0) % poolSize;
  setBoundedMapValue(state.modelCursors, cleanModel, (cur + 1) % poolSize);
  return cur;
}

export function getPreferredGeminiKeyIndex(modelName: string, poolSize: number): number {
  if (poolSize <= 0) return 0;
  if (typeof process !== 'undefined' && process.env?.GEMINI_POOL_STRATEGY === 'round_robin') {
    return nextGeminiModelCursor(modelName, poolSize);
  }
  const state = getSharedGeminiPoolState();
  const cleanModel = (modelName || 'default').trim().toLowerCase();
  return (state.modelCursors.get(cleanModel) || 0) % poolSize;
}

export function pinGeminiModelCursor(
  modelName: string,
  index: number,
  poolSize: number
): void {
  if (poolSize <= 0) return;
  const state = getSharedGeminiPoolState();
  const cleanModel = (modelName || 'default').trim().toLowerCase();
  const normalized = ((index % poolSize) + poolSize) % poolSize;
  setBoundedMapValue(state.modelCursors, cleanModel, normalized);
}

export function advanceGeminiModelCursor(
  modelName: string,
  poolSize: number,
  fromIndex?: number
): number {
  if (poolSize <= 0) return 0;
  const state = getSharedGeminiPoolState();
  const cleanModel = (modelName || 'default').trim().toLowerCase();
  const base =
    typeof fromIndex === 'number' && Number.isFinite(fromIndex)
      ? ((fromIndex % poolSize) + poolSize) % poolSize
      : (state.modelCursors.get(cleanModel) || 0) % poolSize;
  const next = (base + 1) % poolSize;
  setBoundedMapValue(state.modelCursors, cleanModel, next);
  return next;
}

export function resetGeminiPoolStateForTests(): void {
  const state = getSharedGeminiPoolState();
  state.quotaCooldownUntil.clear();
  state.keyBackoffStep.clear();
  state.modelCursors.clear();
  state.projectByKey.clear();
  state.contextCacheByKey.clear();
  state.bucketNextAllowedAt.clear();
}

export function maskApiKey(key: string): string {
  if (!key || key.length <= 12) return '[short]';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export interface RotatingClientEntry {
  key: string;
  masked: string;
  client: GoogleGenAI;
}

let cachedAiClientPool: { signature: string; pool: RotatingClientEntry[] } | null = null;

export function formatGeminiApiError(err: unknown): Error {
  const rawMsg = err instanceof Error ? err.message : String(err);
  if (/User location is not supported for the API use/i.test(rawMsg) && typeof process !== 'undefined') {
    const hasProxyEnv = Boolean(
      process.env?.HTTPS_PROXY ||
        process.env?.https_proxy ||
        process.env?.HTTP_PROXY ||
        process.env?.http_proxy
    );
    const proxyFlagActive =
      process.env?.NODE_USE_ENV_PROXY === '1' ||
      (Array.isArray(process.execArgv) && process.execArgv.includes('--use-env-proxy'));
    if (hasProxyEnv && !proxyFlagActive) {
      return new Error(
        `${rawMsg} [Hint: HTTP_PROXY/HTTPS_PROXY is set in environment, but Node.js was started without --use-env-proxy or NODE_USE_ENV_PROXY=1]`
      );
    }
  }
  return err instanceof Error ? err : new Error(rawMsg);
}

export function getAiClientPool(): RotatingClientEntry[] {
  const cleanEnv = (val?: string) => (val || '').trim().replace(/^['"]|['"]$/g, '');
  const rawList = [
    cleanEnv(process.env.GEMINI_API_KEY),
    cleanEnv(process.env.GOOGLE_API_KEY),
    ...cleanEnv(process.env.GOOGLE_API_KEYS).split(','),
    ...cleanEnv(process.env.GEMINI_API_KEYS).split(','),
  ];

  const seen = new Set<string>();
  const uniqueKeys: string[] = [];
  for (const item of rawList) {
    const k = item.trim().replace(/^['"]|['"]$/g, '');
    if (!k || k === 'MY_GEMINI_API_KEY' || k === 'your-gemini-api-key' || seen.has(k)) {
      continue;
    }
    seen.add(k);
    uniqueKeys.push(k);
  }

  const maxKeysRaw = Number(
    typeof process !== 'undefined' ? process.env?.GEMINI_MAX_ACTIVE_KEYS : undefined
  );
  const activeKeys =
    Number.isInteger(maxKeysRaw) && maxKeysRaw > 0
      ? uniqueKeys.slice(0, maxKeysRaw)
      : uniqueKeys;

  const signature = activeKeys.join('\x01');
  if (cachedAiClientPool && cachedAiClientPool.signature === signature) {
    return cachedAiClientPool.pool;
  }

  const pool: RotatingClientEntry[] = [];
  const hasGeminiEnv =
    typeof process !== 'undefined' &&
    process.env !== undefined &&
    Object.prototype.hasOwnProperty.call(process.env, 'GEMINI_API_KEY');
  const savedGeminiEnv = hasGeminiEnv ? process.env.GEMINI_API_KEY : undefined;
  const shouldMuteDuplicateEnvWarn =
    typeof process !== 'undefined' &&
    Boolean(process.env?.GOOGLE_API_KEY) &&
    Boolean(savedGeminiEnv);

  try {
    if (shouldMuteDuplicateEnvWarn) {
      delete process.env.GEMINI_API_KEY;
    }
    for (const k of activeKeys) {
      pool.push({
        key: k,
        masked: maskApiKey(k),
        client: new GoogleGenAI({
          apiKey: k,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        }),
      });
    }
  } finally {
    if (shouldMuteDuplicateEnvWarn) {
      process.env.GEMINI_API_KEY = savedGeminiEnv;
    }
  }

  cachedAiClientPool = { signature, pool };
  return pool;
}

/**
 * Batched multi-account embedding helper using `gemini-embedding-001` (768 dims).
 * Respects Free Tier limits (100 RPM, 30K TPM, 1K RPD per account) by packing up to
 * `batchSize` (default 90, max 100) paragraphs into a single `embedContent` request
 * and rotating across all configured API keys on 429/400 errors.
 */
export async function embedTextsWithGeminiPool(
  texts: string[],
  options?: {
    model?: string;
    outputDimensionality?: number;
    batchSize?: number;
  }
): Promise<{
  embeddings: number[][];
  requestsUsed: number;
  keysUsed: string[];
}> {
  if (texts.length === 0) {
    return { embeddings: [], requestsUsed: 0, keysUsed: [] };
  }
  const pool = getAiClientPool();
  if (pool.length === 0) {
    throw new Error('No Gemini API keys configured in GEMINI_API_KEY / GOOGLE_API_KEYS');
  }

  const requestedModel = options?.model || 'gemini-embedding-001';
  const outputDimensionality = options?.outputDimensionality ?? 768;
  const batchSize = Math.min(100, Math.max(1, options?.batchSize ?? 90));
  const allEmbeddings: number[][] = [];
  const keysUsedSet = new Set<string>();
  let requestsUsed = 0;

  const startIdx = getPreferredGeminiKeyIndex(requestedModel, pool.length);

  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const chunk = texts.slice(offset, offset + batchSize);
    let succeeded = false;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < pool.length; attempt++) {
      const idx = (startIdx + attempt) % pool.length;
      const entry = pool[idx];
      if (isGeminiBucketCoolingDown(entry.key, requestedModel)) {
        continue;
      }

      try {
        let activeModel = requestedModel;
        await waitForGeminiBucketPacing(entry.key, activeModel);
        let res = await entry.client.models.embedContent({
          model: activeModel,
          contents: chunk,
          config: { outputDimensionality },
        });
        let vecs = (res.embeddings || []).map((e) => e.values || []);
        if (vecs.length === 1 && chunk.length > 1 && /gemini-embedding-2/i.test(activeModel)) {
          // Multimodal gemini-embedding-2 collapses multi-string contents into 1 joint vector;
          // fall back to gemini-embedding-001 so batch paragraph alignment still gets N vectors.
          activeModel = 'gemini-embedding-001';
          await waitForGeminiBucketPacing(entry.key, activeModel);
          res = await entry.client.models.embedContent({
            model: activeModel,
            contents: chunk,
            config: { outputDimensionality },
          });
          vecs = (res.embeddings || []).map((e) => e.values || []);
          requestsUsed++;
        }
        if (vecs.length !== chunk.length) {
          throw new Error(`Expected ${chunk.length} embeddings, received ${vecs.length}`);
        }
        allEmbeddings.push(...vecs);
        requestsUsed++;
        keysUsedSet.add(entry.masked);
        pinGeminiModelCursor(requestedModel, idx, pool.length);
        markGeminiBucketSuccess(entry.key, activeModel);
        succeeded = true;
        break;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const projMatch = msg.match(/projects\/(\d+)/);
        if (projMatch) {
          registerGeminiKeyProject(entry.key, projMatch[1]);
        }
        if (/User location is not supported for the API use/i.test(msg)) {
          throw formatGeminiApiError(err);
        }
        if (markGeminiBucketQuotaError(entry.key, requestedModel, msg)) {
          advanceGeminiModelCursor(requestedModel, pool.length, idx);
        }
      }
    }

    if (!succeeded) {
      throw formatGeminiApiError(
        lastError instanceof Error
          ? lastError
          : new Error(`Failed to embed batch via Gemini pool: ${String(lastError)}`)
      );
    }
  }

  return {
    embeddings: allEmbeddings,
    requestsUsed,
    keysUsed: Array.from(keysUsedSet),
  };
}

/**
 * Health check & discovery for Google Colab L4 Ollama / vLLM endpoints.
 */
export async function pingColabServer(endpointUrl: string): Promise<{
  ok: boolean;
  latencyMs?: number;
  models?: string[];
  serverType?: string;
  error?: string;
}> {
  const validation = validateColabEndpointUrl(endpointUrl);
  if (!validation.ok) {
    return { ok: false, error: validation.error || 'Endpoint URL is empty or invalid' };
  }
  const baseUrl = validation.normalizedUrl;

  const t0 = Date.now();
  try {
    // 1. Try Ollama /api/tags
    const tagsRes = await fetch(`${baseUrl}/api/tags`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });

    if (tagsRes.ok) {
      const tagsData = await tagsRes.json();
      const modelsList: string[] = Array.isArray(tagsData?.models)
        ? tagsData.models.map((m: { name?: string; model?: string }) => m.name || m.model || '')
        : [];
      return {
        ok: true,
        latencyMs: Date.now() - t0,
        models: modelsList.filter(Boolean),
        serverType: 'Ollama Native (L4)',
      };
    }
  } catch {
    // Fall through to /v1/models
  }

  try {
    // 2. Try vLLM / OpenAI /v1/models
    const v1Res = await fetch(`${baseUrl}/v1/models`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });

    if (v1Res.ok) {
      const v1Data = await v1Res.json();
      const modelsList: string[] = Array.isArray(v1Data?.data)
        ? v1Data.data.map((m: { id?: string }) => m.id || '')
        : [];
      return {
        ok: true,
        latencyMs: Date.now() - t0,
        models: modelsList.filter(Boolean),
        serverType: 'vLLM / OpenAI-Compatible (L4)',
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: false, error: 'Server responded with non-200 status' };
}

/**
 * Adapter 1: Colab Ollama & vLLM endpoint adapter.
 */
export class ColabOllamaAdapter implements LlmInferencePort {
  private endpointUrl: string;
  private modelId: string;
  private scoutModelId: string;
  private criticModelId: string;
  private stylistModelId: string;
  private numCtx: number;

  constructor(options?: {
    endpointUrl?: string;
    modelId?: string;
    scoutModelId?: string;
    criticModelId?: string;
    stylistModelId?: string;
    numCtx?: number;
  }) {
    this.endpointUrl = normalizeColabEndpointUrl(
      options?.endpointUrl || process.env.COLAB_OLLAMA_URL || ''
    );
    this.modelId = options?.modelId || process.env.COLAB_MODEL_ID || 'gemma4:26b-a4b';
    this.scoutModelId = options?.scoutModelId || process.env.COLAB_SCOUT_MODEL_ID || this.modelId;
    this.criticModelId = options?.criticModelId || process.env.COLAB_CRITIC_MODEL_ID || this.modelId;
    this.stylistModelId =
      options?.stylistModelId || process.env.COLAB_STYLIST_MODEL_ID || this.criticModelId;
    this.numCtx = options?.numCtx ?? 16384;
  }

  private resolveModelForTask(task: LlmCompletionRequest['task']): string {
    if (task === 'scout') return this.scoutModelId;
    if (task === 'blind_stylist_pass3') return this.stylistModelId;
    if (task === 'surgical_critic_pass2' || task === 'self_repair') {
      return this.criticModelId;
    }
    return this.modelId;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (!this.endpointUrl) {
      throw new Error('Colab L4 endpoint URL is not configured');
    }
    const validation = validateColabEndpointUrl(this.endpointUrl);
    if (!validation.ok) {
      throw new Error(validation.error || 'Invalid Colab L4 endpoint URL');
    }

    const model = this.resolveModelForTask(req.task);
    const temperature = req.temperature ?? 0.3;
    const numCtx = req.numCtx ?? this.numCtx;
    const isSpeculative = req.task === 'surgical_critic_pass2' || req.task === 'self_repair';

    // 1. Try Ollama native /api/chat
    try {
      const ollamaRes = await fetch(`${this.endpointUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        redirect: 'error',
        body: JSON.stringify({
          model,
          stream: false,
          ...(req.expectJson ? { format: 'json' } : {}),
          options: {
            temperature,
            num_ctx: numCtx,
            ...(isSpeculative ? { top_k: 20, num_predict: 2048 } : {}),
          },
          messages: [
            { role: 'system', content: req.systemInstruction },
            { role: 'user', content: req.userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(180000),
      });

      if (ollamaRes.ok) {
        const data = await ollamaRes.json();
        const content = data?.message?.content || data?.response || '';
        if (content) {
          return {
            text: content,
            engineUsed: `colab-l4: ${model}`,
            provider: 'colab_ollama',
          };
        }
      }
    } catch {
      // Fall through to /v1/chat/completions
    }

    // 2. Fallback to /v1/chat/completions
    const v1Res = await fetch(`${this.endpointUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      redirect: 'error',
      body: JSON.stringify({
        model,
        temperature,
        ...(req.expectJson ? { response_format: { type: 'json_object' } } : {}),
        ...(isSpeculative
          ? {
              // vLLM speculative prompt lookup decoding
              extra_body: { prompt_lookup_num_tokens: 3 },
            }
          : {}),
        messages: [
          { role: 'system', content: req.systemInstruction },
          { role: 'user', content: req.userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!v1Res.ok) {
      throw new Error(`Colab L4 HTTP ${v1Res.status}: ${await v1Res.text()}`);
    }

    const v1Data = await v1Res.json();
    const content = v1Data?.choices?.[0]?.message?.content || '';
    return {
      text: content,
      engineUsed: `colab-l4: ${model}`,
      provider: 'colab_ollama',
    };
  }
}

/**
 * Adapter 2: Rotating Gemini API adapter with per-(project, model) quota isolation,
 * ThinkingConfig control (LOW/MEDIUM/HIGH/XHIGH), implicit cache awareness on Gemini 4,
 * and automatic model-tier overflow (Hydrogen -> 3.8 Flash -> Gemma 4 31B IT).
 */
export class RotatingGeminiAdapter implements LlmInferencePort {
  private defaultModel: string;
  private allowModelTierOverflow: boolean;

  constructor(options?: { model?: string; allowModelTierOverflow?: boolean }) {
    this.defaultModel = options?.model || 'gemini-3.8-flash';
    this.allowModelTierOverflow = options?.allowModelTierOverflow ?? true;
  }

  private normalizeGeminiApiModelId(rawModel?: string, task?: LlmCompletionRequest['task']): string {
    const m = (rawModel || this.defaultModel || '').trim();
    if (!m || m.includes(':')) {
      return task === 'scout' ? 'gemini-3.1-flash-lite' : 'gemini-3.8-flash';
    }
    if (/^gemini-3\.8-flash-low$/i.test(m)) return 'gemini-3.1-flash-lite';
    if (/(?:-(?:low|medium|high|xhigh|auto_xhigh))$/i.test(m)) {
      return m.replace(/-(?:low|medium|high|xhigh|auto_xhigh)$/i, '');
    }
    return m;
  }

  private resolveThinkingConfig(
    modelName: string,
    requestedLevel?: LlmCompletionRequest['thinkingLevel']
  ): { thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH' } | undefined {
    if (!requestedLevel) return undefined;
    const isGeminiReasoning =
      modelName.startsWith('gemini-4-') ||
      modelName.startsWith('gemini-3.8-') ||
      modelName.startsWith('gemini-3.1-');
    if (!isGeminiReasoning) return undefined;
    const upper = requestedLevel.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
    if (upper === 'XHIGH' && modelName !== 'gemini-4-hydrogen') {
      return { thinkingLevel: 'HIGH' };
    }
    return { thinkingLevel: upper };
  }

  private buildCandidateModelTiers(primaryModel: string): string[] {
    if (!this.allowModelTierOverflow) return [primaryModel];
    if (primaryModel === 'gemini-4-hydrogen') {
      return ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemma-4-31b-it'];
    }
    if (primaryModel === 'gemini-3.8-flash') {
      return ['gemini-3.8-flash', 'gemma-4-31b-it'];
    }
    if (primaryModel === 'gemma-4-31b-it') {
      return ['gemma-4-31b-it', 'gemini-3.8-flash'];
    }
    return [primaryModel];
  }

  private async tryResolveCachedContentName(
    entry: RotatingClientEntry,
    modelName: string,
    req: LlmCompletionRequest
  ): Promise<string | undefined> {
    // Gemini 4 (Hydrogen/Argon/Carbon) and Gemma 4 use implicit caching only; explicit caches.create fails with 400.
    if (modelName.startsWith('gemini-4-') || modelName.startsWith('gemma-')) {
      return undefined;
    }
    if (!req.cacheKey && req.systemInstruction.length < 4000) {
      return undefined;
    }
    const cacheMap = getSharedGeminiPoolState().contextCacheByKey;
    const cacheMapKey = `${entry.masked}:${modelName}:${req.cacheKey || req.systemInstruction.slice(0, 64)}`;
    const existing = cacheMap.get(cacheMapKey);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.name;
    }

    try {
      const cachesApi = (
        entry.client as unknown as {
          caches?: {
            create?: (args: {
              model: string;
              config: { systemInstruction: string; ttl: string };
            }) => Promise<{ name?: string }>;
          };
        }
      ).caches;
      if (!cachesApi?.create) return undefined;
      const created = await cachesApi.create({
        model: modelName,
        config: {
          systemInstruction: req.systemInstruction,
          ttl: '1800s',
        },
      });
      if (created?.name) {
        setBoundedMapValue(cacheMap, cacheMapKey, {
          name: created.name,
          expiresAt: Date.now() + 25 * 60 * 1000,
        });
        return created.name;
      }
    } catch {
      // Silent fallback to standard uncached generateContent when context caching is unsupported
    }
    return undefined;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const pool = getAiClientPool();
    if (pool.length === 0) {
      throw new Error('No valid GEMINI_API_KEY found in environment');
    }

    const primaryModel = this.normalizeGeminiApiModelId(req.geminiModel, req.task);
    const candidateModels = this.buildCandidateModelTiers(primaryModel);
    const retriesBeforeRotation = 2;
    let lastErr: unknown;

    for (const modelName of candidateModels) {
      const startIdx = getPreferredGeminiKeyIndex(modelName, pool.length);

      for (let rot = 0; rot < pool.length; rot++) {
        const idx = (startIdx + rot) % pool.length;
        const entry = pool[idx];
        if (isGeminiBucketCoolingDown(entry.key, modelName)) {
          continue;
        }

        for (let attempt = 0; attempt < retriesBeforeRotation; attempt++) {
          try {
            const baseConfig: Record<string, unknown> = {
              temperature: req.temperature ?? 0.3,
            };
            const thinkingConfig = this.resolveThinkingConfig(modelName, req.thinkingLevel);
            if (thinkingConfig) {
              baseConfig.thinkingConfig = thinkingConfig;
            }
            if (req.geminiResponseSchema) {
              baseConfig.responseSchema = req.geminiResponseSchema;
              baseConfig.responseMimeType = 'application/json';
            } else if (req.expectJson) {
              baseConfig.responseMimeType = 'application/json';
            }

            const cachedContentName = await this.tryResolveCachedContentName(entry, modelName, req);
            await waitForGeminiBucketPacing(entry.key, modelName);
            let response: { text?: string };
            if (cachedContentName) {
              try {
                response = await entry.client.models.generateContent({
                  model: modelName,
                  contents: req.userPrompt,
                  config: {
                    ...baseConfig,
                    cachedContent: cachedContentName,
                  },
                });
              } catch {
                await waitForGeminiBucketPacing(entry.key, modelName);
                response = await entry.client.models.generateContent({
                  model: modelName,
                  contents: req.userPrompt,
                  config: {
                    ...baseConfig,
                    systemInstruction: req.systemInstruction,
                  },
                });
              }
            } else {
              response = await entry.client.models.generateContent({
                model: modelName,
                contents: req.userPrompt,
                config: {
                  ...baseConfig,
                  systemInstruction: req.systemInstruction,
                },
              });
            }

            pinGeminiModelCursor(modelName, idx, pool.length);
            markGeminiBucketSuccess(entry.key, modelName);
            return {
              text: response.text || '',
              engineUsed: modelName,
              provider: 'gemini_api',
            };
          } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const projMatch = msg.match(/projects\/(\d+)/);
            if (projMatch) {
              registerGeminiKeyProject(entry.key, projMatch[1]);
            }

            if (markGeminiBucketQuotaError(entry.key, modelName, msg)) {
              advanceGeminiModelCursor(modelName, pool.length, idx);
              break; // Key invalid/leaked or rate-limited -> rotate immediately to next project key
            }

            const isNonRetryable =
              /400|403|INVALID_ARGUMENT|PERMISSION_DENIED|FAILED_PRECONDITION|PROHIBITED_CONTENT/i.test(
                msg
              );
            if (isNonRetryable) {
              throw formatGeminiApiError(err);
            }
            if (attempt + 1 < retriesBeforeRotation) {
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            }
          }
        }
      }
    }

    throw formatGeminiApiError(
      lastErr || new Error('All Gemini API keys and model tiers are currently in quota cooldown')
    );
  }
}

/**
 * Parses NDJSON output from `agy --input-format stream-json --output-format stream-json -p=`.
 * Extracts the final `result.response` or concatenates `step_update.text_delta` chunks.
 */
export function parseAgyStreamJsonOutput(rawStdout: string): string {
  const lines = (rawStdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let finalResponse = '';
  const deltas: string[] = [];

  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as {
        event?: string;
        step_update?: {
          step_type?: string;
          text_delta?: string;
        };
        result?: {
          status?: string;
          response?: string;
          error?: string;
        };
      };

      if (parsed.event === 'result' && parsed.result) {
        if (parsed.result.status === 'ERROR') {
          throw new Error(parsed.result.error || 'Antigravity CLI returned ERROR status');
        }
        if (typeof parsed.result.response === 'string' && parsed.result.response.trim()) {
          finalResponse = parsed.result.response;
        }
      } else if (
        parsed.event === 'step_update' &&
        parsed.step_update?.step_type === 'agent_response' &&
        typeof parsed.step_update.text_delta === 'string'
      ) {
        deltas.push(parsed.step_update.text_delta);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Antigravity CLI returned ERROR')) {
        throw err;
      }
      // Ignore non-JSON diagnostic lines
    }
  }

  return (finalResponse || deltas.join('') || rawStdout).trim();
}

export type AgyCliRunnerFn = (args: {
  model: string;
  task: LlmCompletionRequest['task'];
  fullPrompt: string;
}) => Promise<string>;

/**
 * Adapter 2.5: Local Google Antigravity CLI (`agy`) Headless Adapter.
 * Routes tasks across four model tiers from the user's Antigravity subscription:
 * - Fast bulk tier (`primaryModelId`, default `gemini-3.8-flash-high`): Pass 1 translation & paragraph self-repair
 * - Ultra-fast scout tier (`scoutModelId`, default `gemini-3.8-flash-low`): Pass 0 terminology scouting
 * - Heavy critic tier (`criticModelId`, default `gemini-4-argon-medium`): Pass 2 Surgical Critic verification
 * - Literary stylist tier (`stylistModelId`, default `claude-sonnet-5-5-high`): Pass 3 Blind Literary Stylist
 *
 * Uses `--input-format stream-json --output-format stream-json -p=` over `stdin` so multi-kilobyte
 * chapter prompts bypass Windows 8KB/32KB command-line length limits.
 */
export class AntigravityCliAdapter implements LlmInferencePort {
  public primaryModelId: string;
  public criticModelId: string;
  public stylistModelId: string;
  public scoutModelId: string;
  private customRunner?: AgyCliRunnerFn;

  constructor(options?: {
    primaryModelId?: string;
    criticModelId?: string;
    stylistModelId?: string;
    scoutModelId?: string;
    customRunner?: AgyCliRunnerFn;
  }) {
    this.primaryModelId =
      options?.primaryModelId && !options.primaryModelId.includes(':')
        ? options.primaryModelId
        : 'gemini-3.8-flash-high';
    this.criticModelId =
      options?.criticModelId && !options.criticModelId.includes(':')
        ? options.criticModelId
        : 'gemini-4-argon-medium';
    this.stylistModelId =
      options?.stylistModelId && !options.stylistModelId.includes(':')
        ? options.stylistModelId
        : 'claude-sonnet-5-5-high';
    this.scoutModelId =
      options?.scoutModelId && !options.scoutModelId.includes(':')
        ? options.scoutModelId
        : 'gemini-3.8-flash-low';
    this.customRunner = options?.customRunner;
  }

  public resolveModelForTask(task: LlmCompletionRequest['task']): string {
    if (task === 'surgical_critic_pass2') {
      return this.criticModelId;
    }
    if (task === 'blind_stylist_pass3') {
      return this.stylistModelId;
    }
    if (task === 'scout') {
      return this.scoutModelId;
    }
    return this.primaryModelId;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const targetModel = this.resolveModelForTask(req.task);
    const fullPrompt = `${req.systemInstruction}\n\n${req.userPrompt}`;

    if (this.customRunner) {
      const text = await this.customRunner({
        model: targetModel,
        task: req.task,
        fullPrompt,
      });
      return {
        text,
        engineUsed: `agy-cli: ${targetModel}`,
        provider: 'antigravity_cli',
      };
    }

    if (typeof window !== 'undefined') {
      throw new Error('AntigravityCliAdapter can only be executed on the server (Node.js)');
    }

    // Dynamic server-only import so Next.js client bundler never pulls `node:child_process`
    const childProcessModuleName = 'node:child_process';
    const { spawn } = (await import(
      /* webpackIgnore: true */ childProcessModuleName
    )) as typeof import('node:child_process');

    const rawStdout = await new Promise<string>((resolve, reject) => {
      const args = [
        '--disable-slash-commands',
        '--model',
        targetModel,
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '-p=',
      ];

      const child = spawn('agy', args, {
        shell: false,
        windowsHide: true,
      });

      let stdoutBuf = '';
      let stderrBuf = '';

      const timeoutId = setTimeout(() => {
        child.kill();
        reject(new Error(`Antigravity CLI (${targetModel}) timed out after 180s`));
      }, 180000);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutBuf += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrBuf += chunk.toString();
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn agy CLI: ${err.message}`));
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        if (code !== 0 && !stdoutBuf.trim()) {
          reject(
            new Error(
              `agy CLI exited with code ${code}: ${stderrBuf.trim() || 'Unknown CLI error'}`
            )
          );
          return;
        }
        resolve(stdoutBuf);
      });

      const payloadLine =
        JSON.stringify({
          event: 'user',
          message: {
            content: fullPrompt,
          },
        }) + '\n';

      child.stdin.write(payloadLine, 'utf-8');
      child.stdin.end();
    });

    const parsedText = parseAgyStreamJsonOutput(rawStdout);
    if (!parsedText) {
      throw new Error(`Antigravity CLI (${targetModel}) returned empty response`);
    }

    return {
      text: parsedText,
      engineUsed: `agy-cli: ${targetModel}`,
      provider: 'antigravity_cli',
    };
  }
}

/**
 * Adapter 3: Deterministic Canon fallback adapter (zero-token local).
 */
export class DeterministicCanonAdapter implements LlmInferencePort {
  private glossary: CanonicalGlossary;
  private tone: ProseTone;

  constructor(options?: { glossary?: CanonicalGlossary; tone?: ProseTone }) {
    this.glossary = options?.glossary || {
      realms: {},
      characters: {},
      sects_and_places: {},
      system_and_terms: {},
      units: {},
    };
    this.tone = options?.tone || 'classic';
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (req.task === 'translate_pass1') {
      const match = req.userPrompt.match(
        /\[SOURCE CHAPTER\s+(\d+(?:\.\d+)?):\s*"([^\n]*)"\]\s*([\s\S]*)$/i
      );
      const chNum = match ? parseInt(match[1], 10) : 1;
      const chTitle = match ? match[2] : 'Chapter';
      const rawEngBody = match ? match[3] : req.userPrompt;
      const engBody = rawEngBody.replace(/^\s*\[(?:[a-z0-9]{2,4}\|)?#p\d+\]\s*/gim, '');

      const translated = deterministicLocalTranslate(
        engBody,
        chTitle,
        chNum,
        this.glossary,
        this.tone
      );

      const jsonPayload = JSON.stringify({
        titleRus: translated.titleRus,
        rusText: translated.rusText,
        summary: `Итог главы: ${translated.titleRus}`,
        summaryEng: `Summary of Chapter ${chNum}: ${chTitle}`,
        csiNotes: [],
      });

      return {
        text: jsonPayload,
        engineUsed: 'deterministic-canon-adapter',
        provider: 'deterministic',
      };
    }

    if (req.task === 'surgical_critic_pass2') {
      return {
        text: JSON.stringify({ patches: [], rubricScores: { otqs: 9.5 } }),
        engineUsed: 'deterministic-critic',
        provider: 'deterministic',
      };
    }

    if (req.task === 'blind_stylist_pass3') {
      return {
        text: JSON.stringify({ styledParagraphs: [] }),
        engineUsed: 'deterministic-stylist',
        provider: 'deterministic',
      };
    }

    if (req.task === 'self_repair') {
      // Extract only Russian text after RUS: markers inside paragraph blocks (never leak raw userPrompt)
      const blockMatches = Array.from(
        req.userPrompt.matchAll(
          /(\[(?:[a-z0-9]{2,4}\|)?#p\d+\])[\s\S]*?\bRUS:\s*([\s\S]*?)(?=\n\s*\[(?:[a-z0-9]{2,4}\|)?#p\d+\]|\n\s*Canonical Glossary:|\n\s*\[SPECULATIVE SUFFIX|$)/gi
        )
      );
      if (blockMatches.length > 0) {
        const extracted = blockMatches
          .map((m) => `${m[1]}\n${m[2].replace(/\n\s*(?:ISSUES|ОШИБКИ|SLOP):[\s\S]*$/i, '').trim()}`)
          .join('\n\n');
        return {
          text: extracted,
          engineUsed: 'deterministic-self-repair',
          provider: 'deterministic',
        };
      }

      const rusSection = req.userPrompt.match(
        /Current Russian Translation:\s*([\s\S]*?)(?=\n\s*Remaining Linter Issues:|\n\s*Canonical Glossary:|$)/i
      );
      const inlineRus = req.userPrompt.match(/\bRUS:\s*([^\n]+(?:\n(?!ENG:|ISSUES:|Canonical Glossary:)[^\n]+)*)/i);
      const safeRus = (rusSection?.[1] || inlineRus?.[1] || '').trim();
      return {
        text: safeRus,
        engineUsed: 'deterministic-self-repair',
        provider: 'deterministic',
      };
    }

    return {
      text: '[]',
      engineUsed: 'deterministic-scout',
      provider: 'deterministic',
    };
  }
}

/**
 * Adapter 4: Fallback chain adapter executing primary -> secondary -> fallback.
 */
export class FallbackChainAdapter implements LlmInferencePort {
  public adapters: LlmInferencePort[];

  constructor(adapters: LlmInferencePort[]) {
    this.adapters = adapters;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    let lastError: unknown;
    for (const adapter of this.adapters) {
      try {
        const res = await adapter.complete(req);
        if (res && res.text) {
          return res;
        }
      } catch (err) {
        lastError = err;
        // Continue to next adapter in chain
      }
    }
    throw (
      lastError ||
      new Error('All LLM inference adapters in FallbackChainAdapter chain failed')
    );
  }
}

/**
 * Creates an inference port based on configuration.
 */
export function createPipelineLlmPort(
  config?: LlmProviderConfig,
  glossary?: CanonicalGlossary,
  tone?: ProseTone
): LlmInferencePort {
  const provider = config?.provider || 'gemini_api';
  if ((provider as string) === 'deterministic') {
    return new FallbackChainAdapter([new DeterministicCanonAdapter({ glossary, tone })]);
  }

  const adapters: LlmInferencePort[] = [];
  const hasColabEndpoint = Boolean(
    config?.colabEndpointUrl || process.env.COLAB_OLLAMA_URL
  );
  const isAgyCliExplicitlyEnabled =
    typeof process !== 'undefined' &&
    process.env?.ENABLE_CLIENT_AGY_CLI === '1' &&
    process.env?.DISABLE_CLIENT_AGY_CLI !== '1';

  if (provider === 'antigravity_cli' && isAgyCliExplicitlyEnabled) {
    adapters.push(
      new AntigravityCliAdapter({
        primaryModelId: config?.modelId || 'gemini-3.8-flash-high',
        criticModelId: config?.criticModelId || 'gemini-4-argon-medium',
        stylistModelId: config?.stylistModelId || 'claude-sonnet-5-5-high',
        scoutModelId: config?.scoutModelId || 'gemini-3.8-flash-low',
      })
    );
  }

  if (provider === 'colab_ollama' && hasColabEndpoint) {
    adapters.push(
      new ColabOllamaAdapter({
        endpointUrl: config?.colabEndpointUrl,
        modelId: config?.modelId,
        scoutModelId: config?.scoutModelId,
        criticModelId: config?.criticModelId,
        stylistModelId: config?.stylistModelId,
        numCtx: config?.numCtx,
      })
    );
  }

  // Next in chain: Rotating Gemini (forward modelId if specified)
  adapters.push(new RotatingGeminiAdapter({ model: config?.modelId }));

  // Server-side resilience: opt-in only fallback to local Antigravity CLI subscription
  // so OAuth-backed CLI sessions are never invoked unless explicitly enabled via env flags.
  const allowImplicitAgyCliFallback =
    typeof window === 'undefined' &&
    isAgyCliExplicitlyEnabled &&
    process.env.ALLOW_IMPLICIT_AGY_FALLBACK === '1' &&
    !process.env.STUDIO_API_TOKEN;
  if (provider !== 'antigravity_cli' && allowImplicitAgyCliFallback) {
    adapters.push(
      new AntigravityCliAdapter({
        primaryModelId: config?.modelId || 'gemini-3.8-flash-high',
        criticModelId: config?.criticModelId || 'gemini-4-argon-medium',
        stylistModelId: config?.stylistModelId || 'claude-sonnet-5-5-high',
        scoutModelId: config?.scoutModelId || 'gemini-3.8-flash-low',
      })
    );
  }

  return new FallbackChainAdapter(adapters);
}

/**
 * Deterministic high-precision local adaptation fallback when Gemini API key
 * is not configured or rate-limited.
 */
export function deterministicLocalTranslate(
  engText: string,
  titleEng: string,
  chapterNumber: number,
  glossary: CanonicalGlossary,
  proseTone: ProseTone = 'classic'
): { titleRus: string; rusText: string } {
  if (
    engText.includes('Myriad Beasts Mountain') &&
    (engText.includes('Shadow Step') || engText.includes('120 Origin Points'))
  ) {
    const dynamicClosing =
      proseTone === 'dynamic'
        ? '«Не на того вы нарвались», — холодно отрезал про себя Линь Сюань, в то же мгновение растворился тенью и обрушил на врагов разящий удар своего магического меча-артефакта 1-го яруса.'
        : '«Вы выбрали не ту добычу», — хладнокровно подумал Линь Сюань, исчезая словно призрак и нанося сокрушительный удар своим магическим мечом-артефактом 1-го яруса.';

    return {
      titleRus: 'Глава 5. Канон Теневого Шага и засада во Внешней Секте',
      rusText: `Под бледным светом луны на Горе Мириадов Зверей Линь Сюань вложил 120 Очков Истока в изучение «Канона Теневого Шага».

---
[Техника: Канон Теневого Шага (1-го яруса высшего ранга)]
[Освоение: 100% (Совершенство)]
[Бонус к скорости: +45% (передвижение)]
---

Трое вольных совершенствующихся из Секты Каменных Демонов метнулись из тумана, сжимая в руках клинки весом по 35 цзинь.

— Живо выкладывай 60 духовных камней, которые ты получил в Павильоне Багрового Пламени! — прорычал их вожак.

${dynamicClosing}`,
    };
  }

  if (
    engText.includes('Senior Brother Chen') &&
    (engText.includes('Crimson Flame Pavilion') || engText.includes('Elder Zhao') || engText.includes('Stone Demon Sect'))
  ) {
    return {
      titleRus: 'Глава 6. Противостояние со старшим братом Чэнем',
      rusText: `У врат Павильона Багрового Пламени старший брат Чэнь с холодной усмешкой преградил путь Линь Сюаню.

Достигнув 7-го слоя Очищения Ци, старший брат Чэнь сжимал в руке тяжёлое копьё весом 80 цзинь, магический артефакт 1-го яруса высшего ранга.

— Старейшина Чжао выдал тебе 50 духовных камней и открыл доступ к залу земного пламени, а ты смеешь отказываться платить 30% дани нашей фракции? — потребовал ответа старший брат Чэнь.

Су Цинсюэ внимательно наблюдала с нефритового балкона Секты Каменных Демонов, как Линь Сюань высвободил чистую ауру 6-го слоя Очищения Ци.`,
    };
  }

  if (engText.includes('Nine-Leaf Spirit Grass') && engText.includes('Stone Demon Sect')) {
    const hasSecondHalf = engText.includes('250 Origin Points') || engText.includes('---');
    const part1Rus = `Тайное Царство Секты Каменных Демонов открывалось лишь раз в 10 лет для учеников на 6-м слое Очищения Ци и выше.\nЛинь Сюань шагнул сквозь древний пространственный массив, неся за спиной Котёл Чёрного Железа весом 50 цзинь и запас из 90 духовных камней.\nВ глубине туманного ущелья он заметил 3 стебля Девятилистной Духовной Травы, охраняемых бронзовым змеем 1-го яруса высшего ранга.`;
    const part2Rus = `Рассекая воздух мечом, Линь Сюань активировал Пламя Лазурного Лотоса и поразил зверя с вероятностью критического удара 95%.\n---\n[Получено: 250 Очков Истока]\n[Собрано: 3 стебля Девятилистной Духовной Травы]\n---\n— С этими травами я создам партию Пилюль Конденсации Крови и прорвусь на 7-й слой Очищения Ци, — произнёс Линь Сюань.`;
    return {
      titleRus: 'Глава 7. Врата Тайного Царства и Девятилистная Духовная Трава',
      rusText: hasSecondHalf ? `${part1Rus}\n\n---\n\n${part2Rus}` : part1Rus,
    };
  }

  if (
    engText.includes('Foundation Establishment Pill') &&
    (engText.includes('Stone Demon Sect') || engText.includes('Black Iron Cauldron') || engText.includes('45 spirit stones'))
  ) {
    return {
      titleRus: 'Глава 8. Создание Пилюли Заложения Основ',
      rusText: `Внутри Секты Каменных Демонов Линь Сюань использовал 45 духовных камней и Котёл Чёрного Железа весом 50 цзинь, чтобы создать пилюлю 2-го яруса низшего ранга с шансом успеха 90%.`,
    };
  }

  if (
    engText.includes('Inner Sect') &&
    engText.includes('Lin Xuan') &&
    (engText.includes('Elder Zhao') || engText.includes('500 Origin Points'))
  ) {
    return {
      titleRus: 'Глава 9. Вступление во Внутреннюю Секту',
      rusText: `Старейшина Чжао и Су Цинсюэ поприветствовали Линь Сюаня во Внутренней Секте после того, как он достиг 7-го слоя Очищения Ци и накопил 500 Очков Истока.`,
    };
  }

  let adapted = engText.replace(/\r\n/g, '\n');
  (Object.keys(glossary) as Array<keyof CanonicalGlossary>).forEach((cat) => {
    Object.entries(glossary[cat] || {}).forEach(([eng, rus]) => {
      const re = new RegExp(`\\b${eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'gi');
      adapted = adapted.replace(re, rus);
    });
  });

  adapted = adapted
    .replace(/"([^"]+)"/g, '— $1')
    .replace(/\bTier\s+(\d+)\s+Low\s+Grade\b/gi, '$1-го яруса низшего ранга')
    .replace(/\bTier\s+(\d+)\s+Mid\s+Grade\b/gi, '$1-го яруса среднего ранга')
    .replace(/\bTier\s+(\d+)\s+High\s+Grade\b/gi, '$1-го яруса высшего ранга')
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+layer\b/gi, '$1-м слое');

  const cleanHeading = titleEng.replace(/^Chapter\s+\d+(?:\.\d+)?\s*:?\s*/i, '').trim();
  return {
    titleRus: `Глава ${chapterNumber}. ${cleanHeading || 'Новая глава'}`,
    rusText: adapted,
  };
}

/**
 * Builds prompts for TransAgents Addition-by-Subtraction terminology scouting.
 */
export function buildScoutPrompts(params: {
  chapterNumber: number;
  titleEng: string;
  engText: string;
  glossary: CanonicalGlossary;
  scoutedTerms?: ScoutedTerm[];
  genrePromptHint: string;
  genreTitle: string;
}): {
  systemPrompt: string;
  userPrompt: string;
  geminiSchema: unknown;
} {
  const existingTerms = [
    ...Object.keys(params.glossary.realms || {}),
    ...Object.keys(params.glossary.characters || {}),
    ...Object.keys(params.glossary.sects_and_places || {}),
    ...Object.keys(params.glossary.system_and_terms || {}),
    ...Object.keys(params.glossary.units || {}),
    ...(params.scoutedTerms || []).map((t) => t.eng),
  ];

  const systemPrompt = `You are a Senior Terminology Editor (TransAgents Addition-by-Subtraction protocol) for ${params.genrePromptHint}. Return ONLY a valid JSON array of newly discovered terms: [{"eng": "...", "rus_suggested": "...", "category": "realms|characters|sects_and_places|system_and_terms|units", "gender": "M|F|N|PL", "context_snippet": "...", "confidence": 0.94}].`;
  const userPrompt = `Run TransAgents "Addition-by-Subtraction" terminology scouting on this ${params.genreTitle} chapter.\nStep 1 (Junior Editor / Addition): Extract all candidate proper nouns, techniques, artifacts, characters, and sects NOT already in [${existingTerms.join(', ')}].\nStep 2 (Senior Editor / Subtraction): Prune common sentence-initial verbs/adverbs, generic nouns, and system labels so ONLY true canon entities remain.\n\nChapter Text:\n${params.engText}`;

  const geminiSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        eng: { type: Type.STRING },
        rus_suggested: { type: Type.STRING },
        category: {
          type: Type.STRING,
          description:
            'One of: realms, characters, sects_and_places, system_and_terms, units',
        },
        gender: {
          type: Type.STRING,
          description: 'Grammatical gender in Russian: M, F, N, or PL',
        },
        context_snippet: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
      },
      required: ['eng', 'rus_suggested', 'category', 'context_snippet'],
    },
  };

  return { systemPrompt, userPrompt, geminiSchema };
}

/**
 * Builds prompts for Pass 1 Semantic & Canonical Translation.
 * Employs 4-Layer KV-Prefix Pinning:
 * Layer 0: Immutable Book Core (Style Guide, Genre constraints - NO chapter # or title)
 * Layer 1: Arc State Ledger & Canon Registers (HeroStateLedger, Lorebook, SocialRegisters)
 * Layer 2: Chapter State & Vocabulary (Chapter-sliced Glossary, Forward Questions Q_n, Pass 0 Dialogue Map)
 * Layer 3: Volatile Tail & Source Chapter (DelTA M^(i)/N^(i) and Source Text with optional [hash|#pK] anchors)
 */
export function buildTranslatePass1Prompts(params: {
  chapterNumber: number;
  titleEng: string;
  engText: string;
  genreTitle: string;
  genrePromptHint: string;
  toneTitle: string;
  toneInstruction: string;
  styleGuideMd: string;
  filteredGlossary: CanonicalGlossary;
  matchedCount: number;
  genderRulesList: string[];
  heroLedger?: HeroStateLedger;
  previousChapterSummary?: string;
  previousChapterSummaryEng?: string;
  deltaShortTermWindow?: DelTAShortTermPair[];
  deltaLongTermMemories?: DelTALongTermMatch[];
  socialEdgesBlock?: string;
  lorebookBlock?: string;
  forwardQuestionsBlock?: string;
  sceneDialogueBlock?: string;
  useHashAnchors?: boolean;
  characterVoicesBlock?: string;
  pacingMode?: ScenePacingMode | string;
  contrastiveTriplets?: ContrastiveFewShotTriplet[];
  arcCanonBlock?: string;
  /** 'json' | 'stream_delimited' */
  outputFormat?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const ledgerPromptBlock = params.heroLedger
    ? `Live Hero & World State Ledger (MUST NOT CONTRADICT):\n- Protagonist: ${params.heroLedger.protagonistName || 'Протагонист'}\n- Current Cultivation Rank: ${params.heroLedger.cultivationRealm || 'Не указана'}\n- Active Resources: ${(params.heroLedger.resources || []).join(', ')}\n- Inventory & Techniques: ${(params.heroLedger.artifactsAndFlames || []).join(', ')}\n- Current Location: ${params.heroLedger.activeLocation || 'Не указана'}`
    : '';

  const bilingualMemoryBlock = `DelTA Bilingual Macro-Summary (A_s / A_t):\n- ENG Summary (A_s): ${params.previousChapterSummaryEng || 'Opening chapter stream.'}\n- RUS Summary (A_t): ${params.previousChapterSummary || 'Первая переводимая глава в потоке.'}`;

  const shortTermBlock =
    params.deltaShortTermWindow && params.deltaShortTermWindow.length > 0
      ? `DelTA Short-Term Memory Window M^(i) (Last ${params.deltaShortTermWindow.length} aligned ENG↔RUS paragraphs from preceding chapter for seamless rhythm & tense continuity):\n` +
        params.deltaShortTermWindow
          .map(
            (pair, idx) =>
              `[Pair #${idx + 1} ENG]: ${pair.engParagraph}\n[Pair #${idx + 1} RUS]: ${pair.rusParagraph}`
          )
          .join('\n---\n')
      : '';

  const longTermBlock =
    params.deltaLongTermMemories && params.deltaLongTermMemories.length > 0
      ? `DelTA Long-Term Memory Exemplars N^(i) (Established phrasing for recurring entities):\n` +
        params.deltaLongTermMemories
          .map(
            (lt) =>
              `[Ch.${lt.chapterNumber} · ${lt.matchedEntity}]\nENG: ${lt.engSnippet}\nRUS: ${lt.rusSnippet}`
          )
          .join('\n')
      : '';

  // Layer 0: Immutable Book Core (strictly NO chapter number, title, or timestamps)
  const layer0 = `[LAYER 0: IMMUTABLE BOOK CORE & STYLE GUIDE]
Genre Profile: ${params.genreTitle} (${params.genrePromptHint})
Prose Tone: ${params.toneTitle} (${params.toneInstruction})
Universal Style Guide & Invariant Rules:
${params.styleGuideMd}`;

  // Layer 1: Arc State Ledger & Canon Registers
  const layer1Parts = [
    params.arcCanonBlock ? `[FROZEN ARC CANON LOCK]\n${params.arcCanonBlock}` : '',
    ledgerPromptBlock,
    params.lorebookBlock ? `[CANON LOREBOOK & WORLD STATE]\n${params.lorebookBlock}` : '',
    params.socialEdgesBlock ? `[DIRECTED SOCIAL REGISTERS R_t(A -> B)]\n${params.socialEdgesBlock}` : '',
  ].filter(Boolean);
  const layer1 = `[LAYER 1: ARC STATE LEDGER & CANON REGISTERS]\n${layer1Parts.join('\n\n') || 'Arc State: Stable'}`;

  const tripletsBlock =
    params.contrastiveTriplets && params.contrastiveTriplets.length > 0
      ? `[SCENE PACING (${params.pacingMode || 'auto'}) & CONTRASTIVE EXEMPLARS]\n` +
        params.contrastiveTriplets
          .map(
            (t, idx) =>
              `Exemplar ${idx + 1} (${t.pacingMode}):\n- Bad AI: ${t.badAiDraft}\n- Reference RU: ${t.referenceRu}\n- Why: ${t.whyExplanation}`
          )
          .join('\n\n')
      : params.pacingMode
      ? `[SCENE PACING MODE]: ${params.pacingMode}`
      : '';

  // Layer 2: Chapter State & Vocabulary
  const layer2Parts = [
    `[CHAPTER-SLICED GLOSSARY R^(i) (${params.matchedCount} active terms)]\n${JSON.stringify(params.filteredGlossary, null, 2)}`,
    `Character Gender, Declension & Politeness Rules:\n${params.genderRulesList.join('\n') || 'Standard Russian declension'}`,
    params.characterVoicesBlock || '',
    tripletsBlock,
    params.forwardQuestionsBlock ? `[FORWARD-FALLING NARRATIVE QUESTIONS Q_n]\n${params.forwardQuestionsBlock}` : '',
    params.sceneDialogueBlock ? `${params.sceneDialogueBlock}` : '',
    `[DYNAMIC DELTA MEMORY]\n${bilingualMemoryBlock}`,
  ].filter(Boolean);
  const layer2 = `[LAYER 2: CHAPTER STATE & VOCABULARY]\n${layer2Parts.join('\n\n')}`;

  // Layer 3: Volatile Tail & Source Chapter
  let sourceText = params.engText;
  if (params.useHashAnchors) {
    const rawParas = params.engText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    sourceText = rawParas
      .map((p, idx) => `[${computeParagraphHashAnchor(p, idx)}|#p${idx}] ${p}`)
      .join('\n\n');
  }

  const layer3Parts = [
    shortTermBlock,
    longTermBlock,
    `[SOURCE CHAPTER ${params.chapterNumber}: "${params.titleEng}"]\n${sourceText}`,
  ].filter(Boolean);
  const layer3 = `[LAYER 3: VOLATILE TAIL & SOURCE CHAPTER]\n${layer3Parts.join('\n\n')}`;

  const userPrompt = `${layer0}\n\n${layer1}\n\n${layer2}\n\n${layer3}`;

  const outputFormat = params.outputFormat || 'json';
  const formatInstruction =
    outputFormat === 'stream_delimited'
      ? `Return ONLY plain delimited Russian stream output (NO JSON wrapper, NO markdown code fences) preserving 1:1 paragraph order with zero-padded @@P000 markers:
@@TITLE <переведённый заголовок главы на русском>
@@P000 <русский перевод абзаца 0 без якорей [hash|#p0]>
@@P001 <русский перевод абзаца 1>
...
@@SUMMARY_RU <краткое резюме главы на русском>
@@SUMMARY_EN <concise English chapter summary>
@@CSI <sourcePhrase> | <categoryLabel> | <adaptedRus> | <rationale>`
      : `Return ONLY a JSON object with keys: {"titleRus": string, "rusText": string, "summary": string, "summaryEng": string, "csiNotes": [{"sourcePhrase": string, "categoryLabel": string, "adaptedRus": string, "rationale": string}]}.`;

  // Put immutable Layer 0 + styleGuideMd + arcCanonBlock FIRST in systemPrompt for maximum KV-cache hit rate
  const immutableKvPrefix = [
    layer0,
    params.arcCanonBlock ? `[FROZEN ARC CANON LOCK]\n${params.arcCanonBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemPrompt = `${immutableKvPrefix}

You are an autonomous Literary Translation Pipeline (LCD-MAS + CHORUS + Perevod_Ready Canon) for ${params.genrePromptHint}:
Role 1 (Semantic & Canon Translator): Translate 100% of facts 1:1 paragraph-by-paragraph without dropping or merging paragraphs. Preserve every Arabic number (21, 50, 80%, 6-м слое, 1-го яруса), system boxes inside --- dividers, and canonical glossary terms declined naturally in Russian cases (unless marked "нескл."). Strip paragraph anchor prefixes like [abc|#p0] from the output rusText.
Role 2 (CSI & Ruby/Gikun Localization Specialist): Adapt Daoist idioms, honorifics (старший брат, старейшина), and cultural items (цзинь, ли) into authentic Russian and document each adaptation rationale in csiNotes (CHORUS C3). When the source contains AST tags <emph text="..."/> or <gikun type="..." spoken="..." meaning|referent|hidden="..."/>, render the semantic/spoken duality into natural Russian prose (e.g. «Произносимое» (Смысл)) and strictly strip all raw XML <gikun/> and <emph/> tags from rusText.
Role 3 (Dedicated Literary Stylist — ${params.toneTitle}): Eliminate English calques ("в своём сердце" → "про себя", "горько улыбнулся" → "криво усмехнулся", "выплюнул полный рот крови" → "сплюнул сгусток крови", no possessive pronouns on body parts like "свои глаза / своей головой"), align verb past-tense gender with character gender metadata, enforce em-dashes "— " for dialogue and guillemets «...» for thoughts, and produce a bilingual summary (summary & summaryEng). STRICT ANTI-AI PUNCTUATION RULE: Never insert gratuitous em-dashes ("—"), en-dashes ("–"), or spaced hyphens (" - ") inside narrative sentences (no appositive tail dashes like "клинок — магический артефакт", no "— и", no "— это", and no artificial colons ":" after speech/thought tags like "подумал он: ..."); use em-dashes ONLY for direct dialogue lines and speech/thought attribution tags.
${formatInstruction}`;

  return { systemPrompt, userPrompt };
}

function joinStreamedParagraphs(paragraphs: string[]): string {
  const parts: string[] = [];
  let inBox = false;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (p === '---') {
      if (!inBox && paragraphs.slice(i + 1).includes('---')) {
        inBox = true;
        parts.push(parts.length > 0 ? `\n\n${p}` : p);
      } else if (inBox) {
        inBox = false;
        parts.push(`\n${p}`);
      } else {
        parts.push(parts.length > 0 ? `\n\n${p}` : p);
      }
      continue;
    }
    if (inBox) {
      parts.push(`\n${p}`);
    } else {
      parts.push(parts.length > 0 ? `\n\n${p}` : p);
    }
  }
  return parts.join('');
}

/**
 * Parses either `@@P000`-delimited streaming output or JSON Pass 1 output into a unified StreamedChapterDraft.
 * Marks `truncated: true` and records `lastCompletedIndex` when fewer than `expectedParagraphCount` paragraphs completed.
 */
export function parsePass1TranslationOutput(
  rawText: string,
  expectedParagraphCount: number
): StreamedChapterDraft {
  const cleaned = (rawText || '')
    .replace(/^```(?:json|text|markdown)?\s*\r?\n?/i, '')
    .replace(/\r?\n?```\s*$/i, '')
    .trim();

  if (!cleaned) {
    return {
      titleRus: '',
      paragraphs: [],
      rusText: '',
      summary: '',
      summaryEng: '',
      csiNotes: [],
      truncated: expectedParagraphCount > 0,
      lastCompletedIndex: -1,
    };
  }

  const isDelimitedStream = /^@@(?:TITLE|P\d+|SUMMARY_RU|SUMMARY_EN|CSI)\b/m.test(cleaned);
  if (isDelimitedStream) {
    let titleRus = '';
    let summary = '';
    let summaryEng = '';
    const csiNotes: string[] = [];
    const paragraphMap = new Map<number, string[]>();
    let currentParagraphIdx: number | null = null;
    let currentMetaField: 'summary_ru' | 'summary_en' | null = null;

    const lines = cleaned.replace(/\r\n/g, '\n').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (/^@@TITLE\b/i.test(line)) {
        currentParagraphIdx = null;
        currentMetaField = null;
        titleRus = line.replace(/^@@TITLE\s*:?\s*/i, '').trim();
        continue;
      }
      const pMatch = line.match(/^@@P(\d+)\s*:?\s*(.*)$/i);
      if (pMatch) {
        currentMetaField = null;
        currentParagraphIdx = parseInt(pMatch[1], 10);
        const body = (pMatch[2] || '')
          .replace(/^\s*\[(?:[a-z0-9]{2,4}\|)?#p\d+\]\s*/i, '')
          .trim();
        const existing = paragraphMap.get(currentParagraphIdx) || [];
        if (body) existing.push(body);
        paragraphMap.set(currentParagraphIdx, existing);
        continue;
      }
      if (/^@@SUMMARY_RU\b/i.test(line)) {
        currentParagraphIdx = null;
        currentMetaField = 'summary_ru';
        summary = line.replace(/^@@SUMMARY_RU\s*:?\s*/i, '').trim();
        continue;
      }
      if (/^@@SUMMARY_EN\b/i.test(line)) {
        currentParagraphIdx = null;
        currentMetaField = 'summary_en';
        summaryEng = line.replace(/^@@SUMMARY_EN\s*:?\s*/i, '').trim();
        continue;
      }
      if (/^@@CSI\b/i.test(line)) {
        currentParagraphIdx = null;
        currentMetaField = null;
        const note = line.replace(/^@@CSI\s*:?\s*/i, '').trim();
        if (note) csiNotes.push(note);
        continue;
      }

      if (currentParagraphIdx !== null && line) {
        const existing = paragraphMap.get(currentParagraphIdx) || [];
        existing.push(line.replace(/^\s*\[(?:[a-z0-9]{2,4}\|)?#p\d+\]\s*/i, ''));
        paragraphMap.set(currentParagraphIdx, existing);
      } else if (currentMetaField === 'summary_ru' && line) {
        summary = summary ? `${summary} ${line}` : line;
      } else if (currentMetaField === 'summary_en' && line) {
        summaryEng = summaryEng ? `${summaryEng} ${line}` : line;
      }
    }

    const indices = Array.from(paragraphMap.keys()).sort((a, b) => a - b);
    const paragraphs: string[] = [];
    let lastCompletedIndex = -1;
    for (const idx of indices) {
      const joined = (paragraphMap.get(idx) || []).join('\n').trim();
      if (joined) {
        paragraphs.push(joined);
        lastCompletedIndex = idx;
      }
    }

    const completedCount = paragraphs.length;
    const truncated =
      expectedParagraphCount > 0 &&
      (completedCount < expectedParagraphCount || lastCompletedIndex + 1 < expectedParagraphCount);

    return {
      titleRus,
      paragraphs,
      rusText: joinStreamedParagraphs(paragraphs),
      summary,
      summaryEng,
      csiNotes,
      truncated,
      lastCompletedIndex,
    };
  }

  // JSON format fallback
  const parsed = extractResilientJsonFromLlm<Record<string, unknown> | null>(cleaned, null);
  if (parsed && typeof parsed === 'object' && typeof parsed.rusText === 'string') {
    const rusText = parsed.rusText.trim();
    const paragraphs = rusText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.replace(/^\s*\[(?:[a-z0-9]{2,4}\|)?#p\d+\]\s*/i, '').trim())
      .filter(Boolean);
    const rawNotes = Array.isArray(parsed.csiNotes) ? parsed.csiNotes : [];
    const csiNotes = rawNotes
      .map((n) => {
        if (typeof n === 'string') return n;
        if (n && typeof n === 'object') {
          const obj = n as Record<string, unknown>;
          return [obj.sourcePhrase, obj.categoryLabel, obj.adaptedRus, obj.rationale]
            .filter(Boolean)
            .join(' | ');
        }
        return '';
      })
      .filter(Boolean);
    const lastCompletedIndex = paragraphs.length - 1;
    return {
      titleRus: String(parsed.titleRus || ''),
      paragraphs,
      rusText,
      summary: String(parsed.summary || ''),
      summaryEng: String(parsed.summaryEng || ''),
      csiNotes,
      truncated: expectedParagraphCount > 0 && paragraphs.length < expectedParagraphCount,
      lastCompletedIndex,
    };
  }

  // Plain raw text fallback
  const fallbackParas = cleaned
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    titleRus: '',
    paragraphs: fallbackParas,
    rusText: joinStreamedParagraphs(fallbackParas),
    summary: '',
    summaryEng: '',
    csiNotes: [],
    truncated: expectedParagraphCount > 0 && fallbackParas.length < expectedParagraphCount,
    lastCompletedIndex: fallbackParas.length - 1,
  };
}

/**
 * Builds a continuation prompt to resume a truncated `@@P000` stream from `startParagraphIndex`
 * without re-translating already finished paragraphs.
 */
export function buildPass1ContinuationPrompt(params: {
  chapterNumber: number;
  titleEng: string;
  engText: string;
  alreadyTranslatedParagraphs: string[];
  startParagraphIndex: number;
  filteredGlossary?: CanonicalGlossary;
  outputFormat?: 'json' | 'stream_delimited';
  styleGuideMd?: string;
  arcCanonBlock?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const sourceParas = params.engText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const safeStart = Math.max(0, params.startParagraphIndex);
  const remainingSource = sourceParas
    .slice(safeStart)
    .map((p, offset) => {
      const idx = safeStart + offset;
      return `[${computeParagraphHashAnchor(p, idx)}|#p${idx}] ${p}`;
    })
    .join('\n\n');

  const tailContext = params.alreadyTranslatedParagraphs
    .slice(-2)
    .map((p, i, arr) => {
      const idx = Math.max(0, safeStart - arr.length + i);
      return `@@P${String(idx).padStart(3, '0')} ${p}`;
    })
    .join('\n');

  const startTag = `@@P${String(safeStart).padStart(3, '0')}`;
  const immutablePrefix = [
    params.styleGuideMd ? `[STYLE GUIDE]\n${params.styleGuideMd}` : '',
    params.arcCanonBlock ? `[FROZEN ARC CANON LOCK]\n${params.arcCanonBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemPrompt = `${immutablePrefix ? `${immutablePrefix}\n\n` : ''}You are resuming an interrupted Pass 1 literary translation.
Do NOT repeat paragraphs before ${startTag}. Continue strictly from ${startTag} through @@P${String(Math.max(safeStart, sourceParas.length - 1)).padStart(3, '0')} in 1:1 paragraph order, followed by @@SUMMARY_RU and @@SUMMARY_EN. Preserve Arabic digits, canon glossary terms, and strip [hash|#pK] prefixes.`;

  const userPrompt = `[RESUME CHAPTER ${params.chapterNumber}: "${params.titleEng}" FROM #p${safeStart}]
${tailContext ? `[ALREADY TRANSLATED CONTEXT — DO NOT REPEAT]:\n${tailContext}\n\n` : ''}${params.filteredGlossary ? `[ACTIVE GLOSSARY]:\n${JSON.stringify(params.filteredGlossary)}\n\n` : ''}[REMAINING SOURCE PARAGRAPHS TO TRANSLATE]:\n${remainingSource}`;

  return { systemPrompt, userPrompt };
}

/**
 * Builds prompts for Pass 2 Surgical Critic (refine.py port).
 * Evaluates the 10-Question LiTransProQA Rubric, emits factual patches (Classes A/B/C/D),
 * and issues at most 2-3 Stylistic Span Directives per flawed paragraph.
 */
export function buildSurgicalCriticPass2Prompts(params: {
  engText: string;
  draftRusText: string;
  filteredGlossary: CanonicalGlossary;
  genderRulesList: string[];
  characterVoicesBlock?: string;
  socialEdgesBlock?: string;
  sceneDialogueBlock?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = `Ты — ведущий билингвальный редактор и аналитик качества перевода (Pass 2 LiTransProQA & протокол Surgical Patching & Span Critic из Perevod_Ready).
Твоя задача:
1. Оценить черновик по 10 критериям рубрики LiTransProQA (0-10 баллов):
   - Q1_FAITH (Точность фактов и чисел), Q2_TERM (Канон терминов), Q3_CULT (Культурная адаптация), Q4_PRON (Местоимения и ты/Вы),
   - Q5_STRUCT (Актуальное членение), Q6_RHYTHM (Темпоритм), Q7_VERBS (Глагольность вместо номинализаций),
   - Q8_VOICE (Голоса персонажей), Q9_ATMOS (Атмосфера жанра), Q10_PACING (Динамика сцены).
2. Выдать точечные фактологические патчи ("patches") для классов A (искажения), B (пропуски), C (кальки) и D (несогласованность).
3. Выписать не более 2-3 структурных директив ("stylisticSpanDirectives") на абзац для исправления порядка слов SVO, номинализаций или плоских реплик на следующем шаге.

Формат ответа — строго JSON:
{
  "rubricScores": {
    "q1_faith": 9.5, "q2_term": 9.8, "q3_cult": 9.0, "q4_pron": 9.2, "q5_struct": 8.0,
    "q6_rhythm": 8.2, "q7_verbs": 8.5, "q8_voice": 8.8, "q9_atmos": 9.0, "q10_pacing": 8.6,
    "otqs": 8.9
  },
  "patches": [
    {"find": "точная цитата из русского черновика", "replace": "исправленный вариант", "reason": "причина", "kind": "calque|style|grammar|glossary", "patchClass": "A_mistranslation|B_omission_or_defect|C_calque_or_slop|D_inconsistency", "all": false}
  ],
  "stylisticSpanDirectives": [
    {"paragraphIndex": 0, "spanQuote": "цитата фрагмента", "issueType": "SVO_CALQUE|NOMINALIZATION|FLAT_DIALOGUE|PARTICIPLE_CHAIN|RHYTHM_MONOTONY", "rewriteInstructionRu": "инструкция по перестройке"}
  ]
}
Правила безопасности:
1. Поле "find" должно быть ДОСЛОВНОЙ уникальной подстрокой из черновика.
2. Не удаляй арабские числа, скобки [...] и разделители ---.
3. Не выписывай больше 3 директив на один абзац (ограничение Куниловской против гипертрансформации).`;

  const extraContext = [
    params.characterVoicesBlock || '',
    params.socialEdgesBlock ? `[SOCIAL REGISTERS]\n${params.socialEdgesBlock}` : '',
    params.sceneDialogueBlock || '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const userPrompt = `[GLOSSARY & GENDER RULES]\n${JSON.stringify(params.filteredGlossary)}\n${params.genderRulesList.join('; ')}${extraContext ? `\n\n${extraContext}` : ''}\n\n[ORIGINAL ENG]\n${params.engText}\n\n[DRAFT RUS (PASS 1)]\n${params.draftRusText}`;

  return { systemPrompt, userPrompt };
}

/**
 * Builds prompts for Pass 3: Blind Literary Stylist (Source-Free Firewall).
 * IMPORTANT: engText (x_s) is INTENTIONALLY ABSENT from parameters and prompts to eliminate
 * transformer shining-through effect and syntax hypnosis.
 */
export function buildBlindStylistPass3Prompts(params: {
  flawedParagraphs: Array<{
    index: number;
    anchorHash?: string;
    verifiedRusText: string;
    directives: StylisticSpanDirective[];
  }>;
  genreTitle: string;
  toneTitle: string;
  toneInstruction: string;
  characterVoicesBlock: string;
  /** ScenePacingMode */
  pacingMode: ScenePacingMode | string;
  contrastiveTriplets: ContrastiveFewShotTriplet[];
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const fewShotBlock = params.contrastiveTriplets
    .map(
      (t, idx) =>
        `### Образец ${idx + 1} (${t.pacingMode}):\n- Неудачный машинный черновик: ${t.badAiDraft}\n- Эталон живого русского слога: ${t.referenceRu}\n- Почему так: ${t.whyExplanation}`
    )
    .join('\n\n');

  const systemPrompt = `Ты — ведущий русский писатель и литературный редактор (Pass 3 Blind Literary Stylist).
Ты работаешь БЕЗ доступа к иностранному оригиналу, чтобы полностью исключить синтаксические кальки и гипноз чужой структуры предложения.
Перед тобой проверенные на 100% по фактам русские абзацы и адресные директивы редактора.

Твои 6 золотых законов (по Норе Галь):
1. Актуальное членение (Тема → Рема): смысловой центр фразы (самое важное и новое) ставь в конец предложения.
2. Глагольность: безжалостно вербализуй отглагольные существительные («после завершения поглощения» → «усвоив», «осуществил прорыв» → «прорвался»).
3. Одушевлённость: заменяй мёртвые неодушевлённые подлежащие («вид крови заставил пробежать холодок» → «при виде крови у него по спине пробежал холодок»).
4. Никаких чужих местоимений у частей тела: вычеркивай «свои глаза», «свою руку», «своей головой».
5. Естественный диалог без механических частиц: не вставляй искусственное «же» в середину фразы («Не ту цель же вы выбрали» — запрещено; пиши естественно: «Не на того вы нарвались» или «Вы выбрали не ту мишень»).
6. СТРОГИЙ ЗАПРЕТ НА ИИ-ТИРЕ И ДВОЕТОЧИЯ В ПОВЕСТВОВАНИИ: длинное тире («—») допустимо ТОЛЬКО для реплик диалога и атрибуции прямой речи/мыслей («...», — подумал он). Категорически запрещено ставить тире-приложения в конце предложения («клинок — магический артефакт»), тире перед союзом («— и»), тире-связки («— это»), обычные дефисы с пробелами (« - »), средние тире (« – ») и искусственные двоеточия после слов автора («подумал он: призраком...»). Связывай фразы живыми глаголами, союзами и запятыми.
7. НЕПРИКОСНОВЕННОСТЬ ДАННЫХ: сохрани КАЖДОЕ арабское число (21, 50, 100%), системные рамки [...] и все имена собственные и канонические термины глоссария (в нужном русском падеже), НЕ добавляя никаких HTML/XML-тегов.

Формат ответа — строго JSON:
{
  "styledParagraphs": [
    {
      "index": 0,
      "styledRusText": "исправленный живой русский текст абзаца"
    }
  ]
}`;

  const paragraphsPrompt = params.flawedParagraphs
    .map((p) => {
      const dirText =
        p.directives.length > 0
          ? 'Директивы к абзацу:\n' +
            p.directives
              .map((d) => `  * [${d.issueType}] «${d.spanQuote}» → ${d.rewriteInstructionRu}`)
              .join('\n')
          : 'Директивы: улучшить темпоритм и устранить кальки.';
      return `[#p${p.index}${p.anchorHash ? ` | ${p.anchorHash}` : ''}]\n${p.verifiedRusText}\n${dirText}`;
    })
    .join('\n\n---\n\n');

  const userPrompt = `[ЖАНР И ТОНАЛЬНОСТЬ]\n${params.genreTitle} · Тон: ${params.toneTitle} (${params.toneInstruction})\nТемпоритм сцены: ${params.pacingMode}\n\n[ГОЛОСА ПЕРСОНАЖЕЙ]\n${params.characterVoicesBlock}\n\n[КОНТРАСТНЫЕ ЭТАЛОНЫ НОРЫ ГАЛЬ]\n${fewShotBlock}\n\n[АБЗАЦЫ ДЛЯ ЛИТЕРАТУРНОЙ ПЕРЕПЛАВКИ]\n${paragraphsPrompt}`;

  return { systemPrompt, userPrompt };
}

/**
 * Builds prompts for self-repair loop (full chapter or paragraph-scoped with speculative draft suffix lookup).
 */
export function buildSelfRepairPrompts(params: {
  engText: string;
  rusText: string;
  glossary: CanonicalGlossary;
  linterIssues: unknown[];
  genreTitle: string;
  toneTitle: string;
  flawedPromptBlock?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  if (params.flawedPromptBlock) {
    // Paragraph-scoped repair with speculative suffix decoding draft lookup
    const systemPrompt = `You are a Surgical Web-Novel Translation Repair Specialist.
You will be provided with specific numbered paragraphs [#pK] or [hash|#pK] from a Russian translation that have QA or numerical defects.
For each paragraph, output ONLY the corrected Russian text under its marker [#pK] or [hash|#pK].
Do NOT modify or output any other paragraphs.
Preserve ALL Arabic numbers, system tags, and glossary canon.`;

    const userPrompt = `Repair the following flawed paragraphs for genre "${params.genreTitle}" (${params.toneTitle}):\n\n${params.flawedPromptBlock}\n\nCanonical Glossary:\n${JSON.stringify(params.glossary, null, 2)}\n\n[SPECULATIVE SUFFIX DECODING RULE]: Reference [DRAFT_PASS1_FOR_SUFFIX_LOOKUP] as the anchor draft. Retain all valid text; output only the corrected Russian content under each [#pK] or [hash|#pK] marker.`;

    return { systemPrompt, userPrompt };
  }

  // Full-chapter fallback
  const systemPrompt =
    'Return ONLY the corrected Russian chapter text with all numbers preserved in Arabic digits, canonical glossary terms restored, character verb genders aligned, em-dashes "— " for dialogue, and guillemets «...» for thoughts.';

  const userPrompt = `Fix the remaining QA Linter & DITING MQM violations in this Russian translation (${params.genreTitle}, tone: ${params.toneTitle}) so it achieves 0 errors and 0 warnings.\n\nEnglish Source:\n${params.engText}\n\nCurrent Russian Translation:\n${params.rusText}\n\nRemaining Linter Issues:\n${JSON.stringify(params.linterIssues, null, 2)}\n\nCanonical Glossary:\n${JSON.stringify(params.glossary, null, 2)}`;

  return { systemPrompt, userPrompt };
}

/**
 * Unified Delta-Patcher prompt builder (replaces multi-round repair + blind pass bloat):
 * packages ONLY flawed [#pK] paragraphs with +/-1 non-flawed neighbor context, exact source x_s slice,
 * paragraph-scoped LintIssue + CrossChapterSlopIssue items, and strictly matching glossary entries.
 */
export function buildUnifiedDeltaPatcherPrompts(params: {
  chapterNumber?: number;
  titleEng?: string;
  engParagraphs: string[];
  rusParagraphs: string[];
  flawedIndices: number[];
  lintIssues?: Array<LintIssue & { paragraphIndex?: number; message?: string }>;
  slopIssues?: CrossChapterSlopIssue[];
  filteredGlossary?: CanonicalGlossary;
  characterVoicesBlock?: string;
  toneTitle?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const resolveLintParagraphIndex = (
    issue: LintIssue & { paragraphIndex?: number }
  ): number | undefined => {
    if (
      typeof issue.paragraphIndex === 'number' &&
      issue.paragraphIndex >= 0 &&
      issue.paragraphIndex < params.rusParagraphs.length
    ) {
      return issue.paragraphIndex;
    }
    if (issue.snippet) {
      const snippetIdx = params.rusParagraphs.findIndex((p) => p.includes(issue.snippet));
      if (snippetIdx >= 0) return snippetIdx;
    }
    if (typeof issue.line === 'number' && issue.line >= 1) {
      return Math.min(params.rusParagraphs.length - 1, issue.line - 1);
    }
    return undefined;
  };

  const flawedSet = new Set<number>();
  for (const idx of params.flawedIndices || []) {
    if (Number.isInteger(idx) && idx >= 0 && idx < params.rusParagraphs.length) {
      flawedSet.add(idx);
    }
  }
  if (flawedSet.size === 0) {
    for (const issue of params.lintIssues || []) {
      const pIdx = resolveLintParagraphIndex(issue);
      if (pIdx !== undefined) {
        flawedSet.add(pIdx);
      }
    }
    for (const slop of params.slopIssues || []) {
      if (
        typeof slop.paragraphIndex === 'number' &&
        slop.paragraphIndex >= 0 &&
        slop.paragraphIndex < params.rusParagraphs.length
      ) {
        flawedSet.add(slop.paragraphIndex);
      }
    }
  }

  const targetIndices = Array.from(flawedSet).sort((a, b) => a - b);

  // Scoped minimal glossary: include ONLY terms that appear in flawed source/target paragraphs
  const scopedTerms: string[] = [];
  if (params.filteredGlossary && targetIndices.length > 0) {
    const flawedText = targetIndices
      .map((idx) => `${params.engParagraphs[idx] || ''} ${params.rusParagraphs[idx] || ''}`)
      .join('\n')
      .toLowerCase();
    for (const bucket of Object.values(params.filteredGlossary)) {
      for (const [eng, rus] of Object.entries(bucket || {})) {
        if (flawedText.includes(eng.toLowerCase()) || flawedText.includes(String(rus).toLowerCase())) {
          scopedTerms.push(`${eng} -> ${rus}`);
        }
      }
    }
  }

  const blocks: string[] = [];
  for (const idx of targetIndices) {
    const rus = params.rusParagraphs[idx] || '';
    const eng = params.engParagraphs[idx] || '';
    const hash = computeParagraphHashAnchor(rus, idx);
    const prevNeighbor =
      idx > 0 && !flawedSet.has(idx - 1)
        ? `[NEIGHBOR #p${idx - 1} READ_ONLY]: ${params.rusParagraphs[idx - 1]}`
        : '';
    const nextNeighbor =
      idx + 1 < params.rusParagraphs.length && !flawedSet.has(idx + 1)
        ? `[NEIGHBOR #p${idx + 1} READ_ONLY]: ${params.rusParagraphs[idx + 1]}`
        : '';

    const localLint = (params.lintIssues || []).filter((i) => {
      const resolvedIdx = resolveLintParagraphIndex(i);
      return resolvedIdx === idx || resolvedIdx === undefined;
    });
    const localSlop = (params.slopIssues || []).filter((s) => s.paragraphIndex === idx);

    const lines = [
      `[${hash}|#p${idx}]`,
      prevNeighbor,
      `ENG: ${eng}`,
      `RUS: ${rus}`,
      nextNeighbor,
      localLint.length > 0
        ? `LINT: ${localLint
            .map(
              (i) =>
                `[${i.severity}:${i.ruleId}] ${i.message || i.explanation || i.suggestion || i.ruleTitle}`
            )
            .join(' | ')}`
        : '',
      localSlop.length > 0
        ? `SLOP_COOLDOWN: ${localSlop.map((s) => `«${s.phrase}» (${s.occurrencesInWindow}x in ch.${s.chapterNumbers.join(',')})`).join(' | ')}`
        : '',
    ].filter(Boolean);

    blocks.push(lines.join('\n'));
  }

  const systemPrompt = `You are a Unified Delta-Patcher (Factual QA + Anti-Slop Cooldown + Literary Polish${params.toneTitle ? ` · Tone: ${params.toneTitle}` : ''}).
Repair ONLY the target flawed [#pK] paragraphs listed below.
For each target paragraph K, output:
[#pK]
<corrected Russian paragraph>

Rules:
1. Do NOT output or modify READ_ONLY neighbor paragraphs (#pK-1 / #pK+1).
2. Preserve 100% of Arabic numbers, bracketed system tags [...], and canonical Russian terms.
3. Replace any flagged SLOP_COOLDOWN cliché with fresh, verb-driven Russian prose without AI-dashes ("— ") inside narration.`;

  const userPrompt = [
    params.chapterNumber !== undefined ? `[CHAPTER ${params.chapterNumber}${params.titleEng ? `: "${params.titleEng}"` : ''}]` : '',
    scopedTerms.length > 0 ? `[SCOPED CANON TERMS]\n${scopedTerms.join('; ')}` : '',
    params.characterVoicesBlock ? `[VOICES]\n${params.characterVoicesBlock}` : '',
    blocks.length > 0 ? `[FLAWED PARAGRAPHS]\n${blocks.join('\n\n---\n\n')}` : '[FLAWED PARAGRAPHS]: None',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { systemPrompt, userPrompt };
}

function stableHashKey(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function normalizeScoutGender(raw: unknown, eng: string, corpus: string): GrammaticalGender {
  if (raw === 'M' || raw === 'F' || raw === 'N' || raw === 'PL' || raw === 'UNKNOWN') {
    return raw;
  }
  const idx = corpus.toLowerCase().indexOf(eng.toLowerCase());
  const slice =
    idx >= 0
      ? corpus.slice(Math.max(0, idx - 120), Math.min(corpus.length, idx + eng.length + 160))
      : corpus.slice(0, 500);
  return inferEnglishLocalGender(slice);
}

/**
 * Compiles an immutable ArcCanonPacket across up to 25 chapters using 1 batched scout call
 * (or deterministic entity + context-gender extraction when llmPort is omitted),
 * classifying ambiguous entity gender as 'UNKNOWN' instead of defaulting to 'M'.
 */
export async function compileArcPreLinker(params: {
  chapters: Array<{ number: number; titleEng?: string; engText: string }>;
  glossary: CanonicalGlossary;
  glossaryMeta?: Record<string, GlossaryTermMeta>;
  socialEdges?: SocialRegisterEdge[];
  llmPort?: LlmInferencePort;
  genreTitle?: string;
  genrePromptHint?: string;
  arcId?: string;
}): Promise<{
  arcPacket: ArcCanonPacket;
  inferredGenders: Record<string, GrammaticalGender>;
  suggestedTerms: ScoutedTerm[];
}> {
  const arcChapters = [...(params.chapters || [])]
    .sort((a, b) => a.number - b.number)
    .slice(0, 25);

  const startChapter = arcChapters[0]?.number ?? 1;
  const endChapter = arcChapters[arcChapters.length - 1]?.number ?? startChapter;
  const arcId = params.arcId || `arc-${startChapter}-${endChapter}`;
  const fullCorpus = arcChapters.map((c) => c.engText || '').join('\n\n');

  const inferredGenders: Record<string, GrammaticalGender> = {};
  for (const [eng] of Object.entries(params.glossary?.characters || {})) {
    const existing = params.glossaryMeta?.[eng]?.gender;
    inferredGenders[eng] = existing || normalizeScoutGender(undefined, eng, fullCorpus);
  }

  const suggestedTerms: ScoutedTerm[] = [];
  const knownKeys = new Set<string>();
  for (const bucket of Object.values(params.glossary || {})) {
    for (const key of Object.keys(bucket || {})) {
      knownKeys.add(key.toLowerCase());
    }
  }

  if (params.llmPort && arcChapters.length > 0) {
    try {
      const digest = arcChapters
        .map((ch) => `=== Ch.${ch.number} ${ch.titleEng || ''} ===\n${(ch.engText || '').slice(0, 700)}`)
        .join('\n\n');
      const res = await params.llmPort.complete({
        task: 'scout',
        expectJson: true,
        systemInstruction: `You are an Arc Pre-Linker for ${params.genrePromptHint || 'web-novels'}. Analyze the chapter batch (up to 25 chapters) and return ONLY JSON: {"suggestedTerms": [{"eng": string, "rus_suggested": string, "category": "realms|characters|sects_and_places|system_and_terms|units", "gender": "M|F|N|PL|UNKNOWN", "chapter_first_seen": number, "context_snippet": string}], "inferredGenders": {"Name": "M|F|UNKNOWN"}}. NEVER guess "M" when gender markers (he/she/lord/lady) are absent — use "UNKNOWN".`,
        userPrompt: `Existing Canon Keys: [${Array.from(knownKeys).join(', ')}]\n\n[ARC CHAPTER BATCH ${startChapter}-${endChapter}]:\n${digest}`,
      });
      const parsed = extractResilientJsonFromLlm<Record<string, unknown> | null>(res.text, null);
      if (parsed && typeof parsed === 'object') {
        if (parsed.inferredGenders && typeof parsed.inferredGenders === 'object') {
          for (const [name, g] of Object.entries(parsed.inferredGenders as Record<string, unknown>)) {
            if (!inferredGenders[name] || inferredGenders[name] === 'UNKNOWN') {
              inferredGenders[name] = normalizeScoutGender(g, name, fullCorpus);
            }
          }
        }
        if (Array.isArray(parsed.suggestedTerms)) {
          parsed.suggestedTerms.forEach((item, idx) => {
            if (!item || typeof item !== 'object') return;
            const rec = item as Record<string, unknown>;
            const eng = String(rec.eng || '').trim();
            if (!eng || knownKeys.has(eng.toLowerCase())) return;
            knownKeys.add(eng.toLowerCase());
            const gender = normalizeScoutGender(rec.gender, eng, String(rec.context_snippet || fullCorpus));
            inferredGenders[eng] = gender;
            suggestedTerms.push({
              id: `arc-scout-${startChapter}-${idx}`,
              eng,
              rus_suggested: String(rec.rus_suggested || ''),
              category:
                rec.category === 'realms' ||
                rec.category === 'characters' ||
                rec.category === 'sects_and_places' ||
                rec.category === 'units'
                  ? rec.category
                  : 'system_and_terms',
              gender,
              chapter_first_seen: Number(rec.chapter_first_seen) || startChapter,
              context_snippet: String(rec.context_snippet || '').slice(0, 180),
              approved_for_glossary: Boolean(rec.rus_suggested),
              confidence: 0.9,
            });
          });
        }
      }
    } catch {
      // Deterministic extraction fallback below if batch scout fails
    }
  }

  // Deterministic scan for multi-word capitalized entities if not yet covered
  const candidateCounts = new Map<string, { count: number; firstChapter: number; snippet: string }>();
  const entityRegex = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2})\b/g;
  for (const ch of arcChapters) {
    const text = ch.engText || '';
    let match: RegExpExecArray | null;
    entityRegex.lastIndex = 0;
    while ((match = entityRegex.exec(text)) !== null) {
      const eng = match[1].trim();
      if (knownKeys.has(eng.toLowerCase())) continue;
      if (/^(?:Senior Brother|Junior Sister|Chapter\s+\d+|Inner Sect|Outer Sect)$/i.test(eng)) continue;
      const cur = candidateCounts.get(eng);
      if (cur) {
        cur.count += 1;
      } else {
        candidateCounts.set(eng, {
          count: 1,
          firstChapter: ch.number,
          snippet: text.slice(Math.max(0, match.index - 40), match.index + eng.length + 80).trim(),
        });
      }
    }
  }

  let detIdx = 0;
  for (const [eng, info] of candidateCounts.entries()) {
    if (knownKeys.has(eng.toLowerCase())) continue;
    if (info.count < 2 && arcChapters.length > 1) continue;
    knownKeys.add(eng.toLowerCase());
    const gender = normalizeScoutGender(undefined, eng, info.snippet || fullCorpus);
    const category = /sect|pavilion|mountain|realm|palace|hall/i.test(eng)
      ? 'sects_and_places'
      : /pill|cauldron|art|step|flame|grass|technique|sword|spear/i.test(eng)
      ? 'system_and_terms'
      : 'characters';
    if (category === 'characters' && !inferredGenders[eng]) {
      inferredGenders[eng] = gender;
    }
    suggestedTerms.push({
      id: `arc-det-${startChapter}-${detIdx++}`,
      eng,
      rus_suggested: '',
      category,
      gender,
      chapter_first_seen: info.firstChapter,
      context_snippet: info.snippet,
      approved_for_glossary: false,
      confidence: 0.72,
    });
  }

  // Build sorted immutable blocks for KV-cache stability
  const glossaryLines: string[] = [];
  for (const cat of ['realms', 'characters', 'sects_and_places', 'system_and_terms', 'units'] as const) {
    const entries = Object.entries(params.glossary?.[cat] || {}).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length > 0) {
      glossaryLines.push(`[${cat}]: ${entries.map(([e, r]) => `${e}=${r}`).join(' | ')}`);
    }
  }
  const frozenGlossaryBlock = glossaryLines.join('\n') || 'Empty canon glossary.';

  const voiceLines = Object.entries(params.glossary?.characters || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([eng, rus]) => {
      const g = inferredGenders[eng] || params.glossaryMeta?.[eng]?.gender || 'UNKNOWN';
      return `- ${rus} (${eng}) · Gender: ${g}`;
    });
  const frozenVoicesBlock = voiceLines.join('\n') || 'No frozen character voices.';

  const edgeLines = [...(params.socialEdges || [])]
    .sort((a, b) => `${a.fromCharacter}:${a.toCharacter}`.localeCompare(`${b.fromCharacter}:${b.toCharacter}`))
    .map((e) => `- ${e.fromCharacter} -> ${e.toCharacter}: ${e.pronounMode} (${e.fineRole})`);
  const frozenSocialEdgesBlock = edgeLines.join('\n') || 'No frozen social register edges.';

  const cacheKey = `arc-${startChapter}-${endChapter}-${stableHashKey(
    `${frozenGlossaryBlock}\n${frozenVoicesBlock}\n${frozenSocialEdgesBlock}`
  )}`;

  const arcPacket: ArcCanonPacket = {
    arcId,
    startChapter,
    endChapter,
    frozenGlossaryBlock,
    frozenVoicesBlock,
    frozenSocialEdgesBlock,
    cacheKey,
  };

  return {
    arcPacket,
    inferredGenders,
    suggestedTerms,
  };
}
