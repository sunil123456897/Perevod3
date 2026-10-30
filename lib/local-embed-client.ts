import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { embedTextsWithGeminiPool } from './llm-inference-port.ts';

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

export interface ChapterNeuralAuditResult {
  chapter: number;
  pairs: number;
  rusCount: number;
  alignmentMode: string;
  meanCosine: number;
  minCosine: number;
  lowSimilarityCount: number;
  lowPairs: LowSimilarityPair[];
  embeddingEngine: EmbeddingEngineId;
  device: string;
  latencyMs: number;
}

interface PendingRequest {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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

  constructor() {
    const cleanup = () => {
      this.shutdown();
    };
    process.once('exit', cleanup);
  }

  private ensureWorker(): Promise<{ device: string; pid: number }> {
    if (Date.now() < this.disabledUntil) {
      return Promise.reject(new Error('LOCAL_WORKER_COOLDOWN'));
    }
    if (this.proc && this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise((resolve, reject) => {
      const scriptPath = path.join(process.cwd(), 'scripts', 'local-embed-bridge.py');
      const child = spawn('python', [scriptPath, '--daemon'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.proc = child;
      let isReady = false;

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

      // Keep handles referenced during initial READY handshake
      setHandlesRef(true);

      const startupTimer = setTimeout(() => {
        if (!isReady) {
          this.killWorker();
          reject(new Error('LOCAL_EMBED_STARTUP_TIMEOUT'));
        }
      }, 30000);

      const rl = readline.createInterface({ input: child.stdout });
      this.rl = rl;

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) return;
        try {
          const msg = JSON.parse(trimmed);
          if (!isReady && msg.status === 'READY') {
            isReady = true;
            clearTimeout(startupTimer);
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

      child.on('error', (err) => {
        clearTimeout(startupTimer);
        this.rejectAllPending(err);
        this.killWorker();
        if (!isReady) reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(startupTimer);
        const err = new Error(`LOCAL_EMBED_EXITED_${code}`);
        this.rejectAllPending(err);
        this.proc = null;
        this.rl = null;
        this.readyPromise = null;
        if (!isReady) reject(err);
      });
    });

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
        embeddingEngine: 'local-embeddinggemma-2',
        device: res.device || this.device,
        latencyMs: Date.now() - t0,
      };
    } catch {
      // Cloud fallback via Gemini Embedding 2 key pool
      const [engRes, rusRes] = await Promise.all([
        embedTextsWithGeminiPool(engParagraphs),
        embedTextsWithGeminiPool(rusParagraphs),
      ]);
      const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] || 0), 0);
      const norm = (a: number[]) => Math.sqrt(dot(a, a)) || 1;
      const cos = (a: number[], b: number[]) => dot(a, b) / (norm(a) * norm(b));

      const diff = Math.abs(rusParagraphs.length - engParagraphs.length);
      const window = diff > 0 ? Math.max(2, diff + 3) : 0;
      const cosines: number[] = [];
      const lowPairs: LowSimilarityPair[] = [];

      for (let idx = 0; idx < engParagraphs.length; idx++) {
        let bestJ = Math.min(idx, rusParagraphs.length - 1);
        let bestScore = -1;
        if (window === 0 && idx < rusParagraphs.length) {
          bestJ = idx;
          bestScore = cos(engRes.embeddings[idx] || [], rusRes.embeddings[idx] || []);
        } else {
          const jStart = Math.max(0, Math.min(idx - 3, rusParagraphs.length - window - 1));
          const jEnd = Math.min(rusParagraphs.length, Math.max(idx + window + 1, jStart + 1));
          for (let j = jStart; j < jEnd; j++) {
            const sc = cos(engRes.embeddings[idx] || [], rusRes.embeddings[j] || []);
            if (sc > bestScore) {
              bestScore = sc;
              bestJ = j;
            }
          }
        }
        cosines.push(bestScore);
        if (engParagraphs[idx].trim().length < 18 && rusParagraphs[bestJ].trim().length < 18) {
          continue;
        }
        if (bestScore < threshold) {
          lowPairs.push({
            index: idx + 1,
            matchedRusIndex: bestJ + 1,
            cosine: Number(bestScore.toFixed(4)),
            eng: engParagraphs[idx].slice(0, 110),
            rus: rusParagraphs[bestJ].slice(0, 110),
          });
        }
      }

      const meanCosine = cosines.reduce((a, b) => a + b, 0) / cosines.length;
      const minCosine = Math.min(...cosines);
      return {
        chapter: chapterNumber,
        pairs: engParagraphs.length,
        rusCount: rusParagraphs.length,
        alignmentMode: window === 0 ? '1:1' : `window(±${window})`,
        meanCosine: Number(meanCosine.toFixed(4)),
        minCosine: Number(minCosine.toFixed(4)),
        lowSimilarityCount: lowPairs.length,
        lowPairs: lowPairs.slice(0, 10),
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
