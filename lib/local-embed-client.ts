import type readline from 'node:readline';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { embedTextsWithGeminiPool } from './llm-inference-port.ts';
import type {
  ChapterNeuralAuditResult,
  EmbeddingEngineId,
  LowSimilarityPair,
  PairCosineEntry,
} from './pipeline-types.ts';

export type {
  ChapterNeuralAuditResult,
  EmbeddingEngineId,
  LowSimilarityPair,
  PairCosineEntry,
} from './pipeline-types.ts';

interface PendingRequest {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_ENG_EMBED_CACHE_ENTRIES = 64;
const ENOENT_COOLDOWN_MS = 5 * 60_000;
const MAX_CRASH_BACKOFF_MS = 5 * 60_000;
const BASE_CRASH_BACKOFF_MS = 5_000;

function hashParagraphList(paragraphs: string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let p = 0; p < paragraphs.length; p++) {
    const s = paragraphs[p]!;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= (c + i) & 0xffff;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
    h1 ^= 0xff;
    h1 = Math.imul(h1, 0x01000193);
  }
  return `${paragraphs.length}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

function alignMonotonicDp(simMatrix: number[][], reusePenalty = 0.08): number[] {
  const n = simMatrix.length;
  const m = n > 0 ? simMatrix[0]!.length : 0;
  if (n === 0 || m === 0) return [];

  let dpPrev = simMatrix[0]!.slice();
  const back: Int32Array[] = Array.from({ length: n }, () => new Int32Array(m).fill(-1));

  for (let i = 1; i < n; i++) {
    const dpCurr = new Array<number>(m);
    const row = simMatrix[i]!;
    const backRow = back[i]!;
    let bestLtVal = Number.NEGATIVE_INFINITY;
    let bestLtJ = -1;

    for (let j = 0; j < m; j++) {
      if (j > 0 && dpPrev[j - 1]! > bestLtVal) {
        bestLtVal = dpPrev[j - 1]!;
        bestLtJ = j - 1;
      }
      const sameVal = dpPrev[j]! - reusePenalty;
      if (bestLtJ !== -1 && bestLtVal >= sameVal) {
        dpCurr[j] = bestLtVal + row[j]!;
        backRow[j] = bestLtJ;
      } else {
        dpCurr[j] = sameVal + row[j]!;
        backRow[j] = j;
      }
    }
    dpPrev = dpCurr;
  }

  let bestLastJ = 0;
  let bestScore = dpPrev[0]!;
  for (let j = 1; j < m; j++) {
    if (dpPrev[j]! > bestScore) {
      bestScore = dpPrev[j]!;
      bestLastJ = j;
    }
  }

  const path = new Array<number>(n);
  let currJ = bestLastJ;
  for (let i = n - 1; i >= 0; i--) {
    path[i] = currJ;
    currJ = back[i]![currJ]!;
  }
  return path;
}

export function getOrderedPythonCandidates(
  platform: string = typeof process !== 'undefined' ? process.platform : 'linux',
  localEmbedPython: string = typeof process !== 'undefined' ? process.env?.LOCAL_EMBED_PYTHON || '' : ''
): string[] {
  const candidates: string[] = [];
  const envBin = localEmbedPython.trim();
  if (envBin) candidates.push(envBin);
  // On Windows, `python3` often resolves to the Microsoft Store App Execution Alias
  // (WindowsApps\python3.exe) which exits with code 9009 instead of ENOENT, whereas
  // `python` points to the real installed interpreter with CUDA.
  if (platform === 'win32') {
    candidates.push('python', 'python3');
  } else {
    candidates.push('python3', 'python');
  }
  return Array.from(new Set(candidates));
}

export function buildSanitizedPythonEnv(
  baseEnv: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
): Record<string, string | undefined> {
  const cleanEnv: Record<string, string | undefined> = { ...baseEnv };
  for (const key of ['ALL_PROXY', 'all_proxy'] as const) {
    const val = cleanEnv[key];
    if (typeof val === 'string' && /^socks5h?:\/\//i.test(val.trim())) {
      delete cleanEnv[key];
    }
  }
  cleanEnv.HF_HUB_DISABLE_TELEMETRY = cleanEnv.HF_HUB_DISABLE_TELEMETRY || '1';
  cleanEnv.PYTHONIOENCODING = cleanEnv.PYTHONIOENCODING || 'utf-8';
  return cleanEnv;
}

export class LocalEmbedBridgeClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private readyPromise: Promise<{ device: string; pid: number }> | null = null;
  private pending = new Map<string, PendingRequest>();
  private reqCounter = 0;
  private crashCount = 0;
  private disabledUntil = 0;
  private device = 'cuda';
  private intentionallyStopped = false;
  private engEmbeddingCache = new Map<string, number[][]>();

  constructor() {
    if (typeof process !== 'undefined' && typeof process.once === 'function') {
      const cleanup = () => {
        this.shutdown();
      };
      process.once('exit', cleanup);
    }
  }

  private getPythonCandidates(): string[] {
    return getOrderedPythonCandidates();
  }

  private recordCrashBackoff() {
    this.crashCount++;
    const backoffMs = Math.min(
      MAX_CRASH_BACKOFF_MS,
      BASE_CRASH_BACKOFF_MS * Math.pow(2, Math.min(this.crashCount - 1, 6))
    );
    this.disabledUntil = Date.now() + backoffMs;
  }

  private async getCachedEngEmbeddings(engParagraphs: string[]): Promise<number[][]> {
    const key = hashParagraphList(engParagraphs);
    const cached = this.engEmbeddingCache.get(key);
    if (cached) {
      this.engEmbeddingCache.delete(key);
      this.engEmbeddingCache.set(key, cached);
      return cached;
    }
    const res = await embedTextsWithGeminiPool(engParagraphs);
    if (this.engEmbeddingCache.size >= MAX_ENG_EMBED_CACHE_ENTRIES) {
      const oldestKey = this.engEmbeddingCache.keys().next().value;
      if (oldestKey !== undefined) this.engEmbeddingCache.delete(oldestKey);
    }
    this.engEmbeddingCache.set(key, res.embeddings);
    return res.embeddings;
  }

  private ensureWorker(): Promise<{ device: string; pid: number }> {
    if (typeof window !== 'undefined') {
      return Promise.reject(new Error('LOCAL_WORKER_BROWSER_UNSUPPORTED'));
    }
    if (Date.now() < this.disabledUntil) {
      return Promise.reject(new Error('LOCAL_WORKER_COOLDOWN'));
    }
    if (this.proc && this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = (async () => {
      const pathModName = 'node:path';
      const rlModName = 'node:readline';
      const cpModName = 'node:child_process';
      const [pathMod, readlineMod, cpMod] = await Promise.all([
        import(/* webpackIgnore: true */ pathModName) as Promise<typeof import('node:path')>,
        import(/* webpackIgnore: true */ rlModName) as Promise<typeof import('node:readline')>,
        import(/* webpackIgnore: true */ cpModName) as Promise<typeof import('node:child_process')>,
      ]);

      const scriptPath = pathMod.join(process.cwd(), 'scripts', 'local-embed-bridge.py');
      const candidates = this.getPythonCandidates();
      const sanitizedEnv = buildSanitizedPythonEnv(process.env) as NodeJS.ProcessEnv;
      this.intentionallyStopped = false;

      const tryCandidate = (candidateIdx: number): Promise<{ device: string; pid: number }> => {
        const pythonBin = candidates[candidateIdx]!;
        return new Promise<{ device: string; pid: number }>((resolve, reject) => {
          const child = cpMod.spawn(pythonBin, [scriptPath, '--daemon'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: sanitizedEnv,
            windowsHide: true,
          });

          this.proc = child;
          let isReady = false;
          let settled = false;
          let fallbackScheduled = false;

          const tryFallbackCandidate = (): boolean => {
            if (
              fallbackScheduled ||
              isReady ||
              this.intentionallyStopped ||
              candidateIdx + 1 >= candidates.length
            ) {
              return false;
            }
            fallbackScheduled = true;
            settled = true;
            try {
              rl.close();
            } catch {}
            if (this.rl === rl) this.rl = null;
            if (this.proc === child) this.proc = null;
            tryCandidate(candidateIdx + 1).then(resolve, reject);
            return true;
          };

          const setHandlesRef = (referenced: boolean) => {
            try {
              if (referenced) {
                child.ref();
                if (typeof (child.stdout as any)?.ref === 'function') (child.stdout as any).ref();
              } else {
                child.unref();
                if (typeof (child.stdout as any)?.unref === 'function') (child.stdout as any).unref();
                if (typeof (child.stderr as any)?.unref === 'function') (child.stderr as any).unref();
                if (typeof (child.stdin as any)?.unref === 'function') (child.stdin as any).unref();
              }
            } catch {}
          };

          setHandlesRef(true);

          const startupTimer = setTimeout(() => {
            if (!isReady && !settled) {
              settled = true;
              this.recordCrashBackoff();
              this.killWorker();
              reject(new Error('LOCAL_EMBED_STARTUP_TIMEOUT'));
            }
          }, 30000);

          const rl = readlineMod.createInterface({ input: child.stdout });
          this.rl = rl;

          rl.on('line', (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{')) return;
            try {
              const msg = JSON.parse(trimmed);
              if (!isReady && msg.status === 'READY') {
                isReady = true;
                settled = true;
                clearTimeout(startupTimer);
                this.crashCount = 0;
                this.disabledUntil = 0;
                this.device = msg.device || 'cuda';
                if (this.pending.size === 0) setHandlesRef(false);
                resolve({ device: this.device, pid: msg.pid || 0 });
                return;
              }
              const id = msg.id;
              if (id && this.pending.has(id)) {
                const entry = this.pending.get(id)!;
                clearTimeout(entry.timer);
                this.pending.delete(id);
                if (this.pending.size === 0) setHandlesRef(false);
                if (msg.ok === false) {
                  entry.reject(new Error(msg.error || 'LOCAL_EMBED_ERROR'));
                } else {
                  entry.resolve(msg);
                }
              }
            } catch {
              // ignore non-JSON stdout lines
            }
          });

          child.on('error', (err: NodeJS.ErrnoException) => {
            clearTimeout(startupTimer);
            if (tryFallbackCandidate()) {
              return;
            }
            if (err.code === 'ENOENT') {
              this.disabledUntil = Date.now() + ENOENT_COOLDOWN_MS;
            } else {
              this.recordCrashBackoff();
            }
            this.rejectAllPending(err);
            this.killWorker();
            if (!settled) {
              settled = true;
              reject(err);
            }
          });

          child.on('close', (code) => {
            clearTimeout(startupTimer);
            if (tryFallbackCandidate()) {
              return;
            }
            if (fallbackScheduled) return;
            if (code !== 0 && !this.intentionallyStopped) {
              this.recordCrashBackoff();
            }
            const err = new Error(`LOCAL_EMBED_EXITED_${code}`);
            this.rejectAllPending(err);
            if (this.rl === rl) {
              try {
                rl.close();
              } catch {}
              this.rl = null;
            }
            if (this.proc === child) this.proc = null;
            this.readyPromise = null;
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
        });
      };

      return tryCandidate(0);
    })();

    return this.readyPromise;
  }

  private rejectAllPending(err: Error) {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }

  private killWorker() {
    if (this.rl) {
      try {
        this.rl.close();
      } catch {}
      this.rl = null;
    }
    if (this.proc) {
      try {
        this.proc.stdin.end();
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
    this.readyPromise = null;
  }

  public shutdown() {
    this.intentionallyStopped = true;
    if (this.proc) {
      try {
        this.proc.stdin.write(JSON.stringify({ cmd: 'exit' }) + '\n');
      } catch {}
    }
    this.killWorker();
  }

  private async sendCommand(payload: Record<string, unknown>, timeoutMs = 20000): Promise<any> {
    await this.ensureWorker();
    if (!this.proc) throw new Error('LOCAL_EMBED_WORKER_NOT_RUNNING');

    const id = `req-${++this.reqCounter}-${Date.now()}`;
    return new Promise((resolve, reject) => {
      // Keep event loop and stdout stream alive while a request is actively in-flight
      this.proc?.ref();
      if (typeof (this.proc?.stdout as any)?.ref === 'function') (this.proc?.stdout as any).ref();
      const unrefIfIdle = () => {
        if (this.pending.size === 0 && this.proc) {
          this.proc.unref();
          if (typeof (this.proc.stdout as any)?.unref === 'function') (this.proc.stdout as any).unref();
        }
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.crashCount++;
        if (this.crashCount >= 2) {
          this.disabledUntil = Date.now() + 60000;
        }
        this.killWorker();
        reject(new Error('LOCAL_EMBED_REQUEST_TIMEOUT'));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (val) => {
          unrefIfIdle();
          resolve(val);
        },
        reject: (err) => {
          unrefIfIdle();
          reject(err);
        },
        timer,
      });

      try {
        this.proc!.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        unrefIfIdle();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public async embedTexts(texts: string[]): Promise<{
    embeddings: number[][];
    engine: EmbeddingEngineId;
    device: string;
    latencyMs: number;
  }> {
    if (texts.length === 0) {
      return { embeddings: [], engine: 'local-embeddinggemma-2', device: this.device, latencyMs: 0 };
    }
    const t0 = Date.now();
    try {
      const res = await this.sendCommand({ cmd: 'embed', texts });
      return {
        embeddings: res.embeddings as number[][],
        engine: 'local-embeddinggemma-2',
        device: res.device || this.device,
        latencyMs: Date.now() - t0,
      };
    } catch {
      const poolRes = await embedTextsWithGeminiPool(texts);
      return {
        embeddings: poolRes.embeddings,
        engine: 'gemini-embedding-2-fallback',
        device: 'cloud-gemini-pool',
        latencyMs: Date.now() - t0,
      };
    }
  }

  public async auditChapterParagraphs(
    chapterNumber: number,
    engParagraphs: string[],
    rusParagraphs: string[],
    threshold = 0.55
  ): Promise<ChapterNeuralAuditResult> {
    const t0 = Date.now();
    if (engParagraphs.length === 0 || rusParagraphs.length === 0) {
      return {
        chapter: chapterNumber,
        pairs: 0,
        rusCount: rusParagraphs.length,
        alignmentMode: '1:1',
        meanCosine: 1,
        minCosine: 1,
        lowSimilarityCount: 0,
        lowPairs: [],
        embeddingEngine: 'local-embeddinggemma-2',
        device: this.device,
        latencyMs: 0,
      };
    }

    try {
      const res = await this.sendCommand({
        cmd: 'audit_chapters',
        threshold,
        chapters: [
          {
            number: chapterNumber,
            engParagraphs,
            rusParagraphs,
          },
        ],
      });
      const ch = res.chapters?.[0];
      return {
        chapter: chapterNumber,
        pairs: ch?.pairs ?? engParagraphs.length,
        rusCount: ch?.rusCount ?? rusParagraphs.length,
        alignmentMode: ch?.alignmentMode ?? '1:1',
        meanCosine: ch?.meanCosine ?? 1,
        minCosine: ch?.minCosine ?? 1,
        lowSimilarityCount: ch?.lowSimilarityCount ?? 0,
        lowPairs: ch?.lowPairs ?? [],
        pairCosines: ch?.pairCosines,
        embeddingEngine: 'local-embeddinggemma-2',
        device: res.device || this.device,
        latencyMs: Date.now() - t0,
      };
    } catch {
      // Cloud fallback via Gemini Embedding 2 key pool (caches ENG embeddings by hash)
      const [engEmbeddings, rusRes] = await Promise.all([
        this.getCachedEngEmbeddings(engParagraphs),
        embedTextsWithGeminiPool(rusParagraphs),
      ]);
      const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] || 0), 0);
      const norm = (a: number[]) => Math.sqrt(dot(a, a)) || 1;
      const cos = (a: number[], b: number[]) => dot(a, b) / (norm(a) * norm(b));

      const sameCount = engParagraphs.length === rusParagraphs.length;
      const simMatrix: number[][] = engParagraphs.map((_, i) =>
        sameCount
          ? [cos(engEmbeddings[i] || [], rusRes.embeddings[i] || [])]
          : rusParagraphs.map((__, j) => cos(engEmbeddings[i] || [], rusRes.embeddings[j] || []))
      );
      const matchedIndices = sameCount
        ? engParagraphs.map((_, i) => i)
        : alignMonotonicDp(simMatrix);

      const cosines: number[] = [];
      const lowPairs: LowSimilarityPair[] = [];
      const pairCosines: PairCosineEntry[] = [];

      for (let idx = 0; idx < engParagraphs.length; idx++) {
        const bestJ = matchedIndices[idx]!;
        const bestScore = sameCount ? simMatrix[idx]![0]! : simMatrix[idx]![bestJ]!;
        cosines.push(bestScore);
        if (engParagraphs[idx]!.trim().length < 18 && rusParagraphs[bestJ]!.trim().length < 18) {
          continue;
        }
        const roundedScore = Number(bestScore.toFixed(4));
        pairCosines.push({ index: idx, matchedRusIndex: bestJ, cosine: roundedScore });
        if (bestScore < threshold) {
          lowPairs.push({
            index: idx + 1,
            matchedRusIndex: bestJ + 1,
            cosine: roundedScore,
            eng: engParagraphs[idx]!.slice(0, 110),
            rus: rusParagraphs[bestJ]!.slice(0, 110),
          });
        }
      }

      const meanCosine = cosines.reduce((a, b) => a + b, 0) / cosines.length;
      const minCosine = Math.min(...cosines);
      return {
        chapter: chapterNumber,
        pairs: engParagraphs.length,
        rusCount: rusParagraphs.length,
        alignmentMode: sameCount ? '1:1' : 'monotonic-dp',
        meanCosine: Number(meanCosine.toFixed(4)),
        minCosine: Number(minCosine.toFixed(4)),
        lowSimilarityCount: lowPairs.length,
        lowPairs: lowPairs.slice(0, 10),
        pairCosines,
        embeddingEngine: 'gemini-embedding-2-fallback',
        device: 'cloud-gemini-pool',
        latencyMs: Date.now() - t0,
      };
    }
  }
}

const globalForEmbed = globalThis as unknown as {
  __localEmbedBridgeClient?: LocalEmbedBridgeClient;
};

export function getLocalEmbedBridgeClient(): LocalEmbedBridgeClient {
  if (!globalForEmbed.__localEmbedBridgeClient) {
    globalForEmbed.__localEmbedBridgeClient = new LocalEmbedBridgeClient();
  }
  return globalForEmbed.__localEmbedBridgeClient;
}

export function shutdownLocalEmbedBridgeClient(): void {
  if (globalForEmbed.__localEmbedBridgeClient) {
    globalForEmbed.__localEmbedBridgeClient.shutdown();
    globalForEmbed.__localEmbedBridgeClient = undefined;
  }
}
