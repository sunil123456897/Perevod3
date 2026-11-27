import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  DiskDatabaseConflictError,
  getStudioSqliteDb,
  isProcessPidAlive,
  nextMonotonicIsoTimestamp,
  type StudioSqliteDatabase,
} from './sqlite-db-server.ts';
import {
  runPipelineBatchOnNovel,
  ServerPipelineExecutionAdapter,
} from './pipeline-run-engine.ts';
import type {
  LlmProviderConfig,
  PipelineJobEvent,
  PipelineJobMode,
  PipelineJobRecord,
} from './pipeline-types.ts';
import type { ChapterRecord, NovelProject } from './seed-data.ts';

const MAX_EVENT_HISTORY_PER_JOB = 200;
const MAX_RECENT_COMPLETED_HISTORIES = 25;

export interface StartPipelineJobInput {
  novelId: string;
  targetChapterIds?: string[];
  startChapter?: number;
  endChapter?: number;
  mode?: PipelineJobMode;
  autoCanonEnabled?: boolean;
  twoPassCriticEnabled?: boolean;
  llmConfig: LlmProviderConfig;
}

interface ActiveJobRun {
  job: PipelineJobRecord;
  controller: AbortController;
  emitter: EventEmitter;
  history: PipelineJobEvent[];
}

export class StudioPipelineJobBroker {
  private readonly activeRuns = new Map<string, ActiveJobRun>();
  private readonly recentHistories = new Map<string, PipelineJobEvent[]>();
  private lastTimestamp: string | null = null;
  private readonly dbOverride?: StudioSqliteDatabase;

  constructor(dbOverride?: StudioSqliteDatabase) {
    this.dbOverride = dbOverride;
  }

  private getDb(): StudioSqliteDatabase {
    return this.dbOverride ?? getStudioSqliteDb();
  }

  private nextIso(): string {
    this.lastTimestamp = nextMonotonicIsoTimestamp(this.lastTimestamp);
    return this.lastTimestamp;
  }

  private reconcileOrphanedJob(job: PipelineJobRecord): PipelineJobRecord {
    const isInFlightStatus = job.status === 'running' || job.status === 'queued';
    if (!isInFlightStatus || this.activeRuns.has(job.id)) {
      return job;
    }

    if (
      typeof job.ownerPid === 'number' &&
      job.ownerPid > 0 &&
      job.ownerPid !== process.pid &&
      isProcessPidAlive(job.ownerPid)
    ) {
      return job;
    }

    const updated: PipelineJobRecord = {
      ...job,
      status: 'failed',
      errorText:
        job.errorText ||
        'Сервер был перезапущен во время выполнения фоновой задачи. Запустите повторный прогон оставшихся глав.',
      updatedAt: this.nextIso(),
    };
    try {
      this.getDb().upsertPipelineJob(updated);
    } catch {
      // Ignore write failures during reconciliation
    }
    return updated;
  }

  public listJobs(novelId?: string): PipelineJobRecord[] {
    const rows = this.getDb().listPipelineJobs(50);
    const reconciled = rows.map((row) => this.reconcileOrphanedJob(row));
    if (novelId) {
      return reconciled.filter((j) => j.novelId === novelId);
    }
    return reconciled;
  }

  public getJob(jobId: string): PipelineJobRecord | null {
    const active = this.activeRuns.get(jobId);
    if (active) {
      return { ...active.job };
    }
    const stored = this.getDb().getPipelineJob(jobId);
    if (!stored) return null;
    return this.reconcileOrphanedJob(stored);
  }

  private recordAndEmitEvent(run: ActiveJobRun, event: PipelineJobEvent): void {
    run.history.push(event);
    if (run.history.length > MAX_EVENT_HISTORY_PER_JOB) {
      run.history.splice(0, run.history.length - MAX_EVENT_HISTORY_PER_JOB);
    }
    run.emitter.emit('event', event);
  }

  private persistJobRecord(job: PipelineJobRecord): void {
    this.getDb().upsertPipelineJob({ ...job });
  }

  private archiveRun(jobId: string, run: ActiveJobRun): void {
    this.recentHistories.set(jobId, [...run.history]);
    while (this.recentHistories.size > MAX_RECENT_COMPLETED_HISTORIES) {
      const oldestKey = this.recentHistories.keys().next().value;
      if (oldestKey === undefined) break;
      this.recentHistories.delete(oldestKey);
    }
    this.activeRuns.delete(jobId);
  }

  public startJob(
    input: StartPipelineJobInput
  ): { ok: true; job: PipelineJobRecord } | { ok: false; status: number; error: string } {
    const novelId = (input.novelId || '').trim();
    if (!novelId) {
      return { ok: false, status: 400, error: 'Не указан novelId для фоновой задачи.' };
    }

    for (const run of this.activeRuns.values()) {
      if (
        run.job.novelId === novelId &&
        (run.job.status === 'running' || run.job.status === 'queued')
      ) {
        return {
          ok: false,
          status: 409,
          error: `Для этой новеллы уже выполняется фоновая задача (${run.job.id}).`,
        };
      }
    }

    const db = this.getDb();
    const externalActive = db.findActiveJobForNovel(novelId, {
      reconcileSamePidOrphans: true,
      activeSamePidJobIds: new Set(this.activeRuns.keys()),
    });
    if (externalActive) {
      return {
        ok: false,
        status: 409,
        error: `Для этой новеллы уже выполняется фоновая/CLI-задача (${externalActive.id}, PID ${externalActive.ownerPid ?? 'unknown'}).`,
      };
    }

    const { novels } = db.readAllNovels();
    const novel = novels.find((n) => n.id === novelId);
    if (!novel) {
      return { ok: false, status: 404, error: `Новелла ${novelId} не найдена на сервере.` };
    }

    let targets: ChapterRecord[] = [];
    if (Array.isArray(input.targetChapterIds) && input.targetChapterIds.length > 0) {
      const requestedSet = new Set(input.targetChapterIds);
      targets = novel.chapters
        .filter((ch) => requestedSet.has(ch.id))
        .sort((a, b) => a.number - b.number);
    } else if (
      typeof input.startChapter === 'number' ||
      typeof input.endChapter === 'number'
    ) {
      const startNum = typeof input.startChapter === 'number' ? input.startChapter : 1;
      const endNum =
        typeof input.endChapter === 'number' ? input.endChapter : Number.MAX_SAFE_INTEGER;
      targets = novel.chapters
        .filter((ch) => ch.number >= startNum && ch.number <= endNum)
        .sort((a, b) => a.number - b.number);
    } else {
      targets = novel.chapters
        .filter((ch) => !ch.translated || ch.status === 'quarantined')
        .sort((a, b) => a.number - b.number);
    }

    if (targets.length === 0) {
      return {
        ok: false,
        status: 400,
        error: 'Нет целевых глав для запуска фоновой обработки.',
      };
    }

    const validModes: PipelineJobMode[] = ['full_5_phase', 'scout_only', 'verify_and_repair'];
    const mode: PipelineJobMode =
      input.mode && validModes.includes(input.mode) ? input.mode : 'full_5_phase';

    const now = this.nextIso();
    const job: PipelineJobRecord = {
      id: randomUUID(),
      novelId,
      mode,
      status: 'running',
      startChapter: targets[0].number,
      endChapter: targets[targets.length - 1].number,
      progressPct: 0,
      currentChapter: targets[0].number,
      completedChapters: 0,
      totalChapters: targets.length,
      quarantinedChapters: 0,
      ownerPid: process.pid,
      statsJson: null,
      errorText: null,
      createdAt: now,
      updatedAt: now,
    };

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);

    const run: ActiveJobRun = {
      job,
      controller: new AbortController(),
      emitter,
      history: [],
    };

    this.activeRuns.set(job.id, run);
    this.persistJobRecord(job);

    this.recordAndEmitEvent(run, {
      type: 'snapshot',
      jobId: job.id,
      timestamp: now,
      progressPct: 0,
      chapterNumber: targets[0].number,
      message: `Запущен пакет из ${targets.length} глав (${mode})`,
      job: { ...job },
    });

    const targetChapterIds = targets.map((c) => c.id);
    void this.executeJobAsync(run, novel, targetChapterIds, {
      mode,
      autoCanonEnabled: input.autoCanonEnabled ?? true,
      twoPassCriticEnabled: input.twoPassCriticEnabled ?? true,
      llmConfig: input.llmConfig,
    });

    return { ok: true, job: { ...job } };
  }

  private async executeJobAsync(
    run: ActiveJobRun,
    novel: NovelProject,
    targetChapterIds: string[],
    opts: {
      mode: PipelineJobMode;
      autoCanonEnabled: boolean;
      twoPassCriticEnabled: boolean;
      llmConfig: LlmProviderConfig;
    }
  ): Promise<void> {
    const db = this.getDb();
    const chapterNumberById = new Map(novel.chapters.map((c) => [c.id, c.number]));
    const targetChapterIdSet = new Set(targetChapterIds);
    const initialChapterRevisions = new Map(
      novel.chapters.map((c) => [c.id, Number(c.revision || 1)])
    );
    const committedChapterRevisions = new Map<string, number>();
    const conflictedChapterIds = new Set<string>();
    let processedCount = 0;

    try {
      const transport = new ServerPipelineExecutionAdapter(opts.llmConfig);
      const batchRes = await runPipelineBatchOnNovel({
        novel,
        targetChapterIds,
        mode: opts.mode,
        autoCanonEnabled: opts.autoCanonEnabled,
        twoPassCriticEnabled: opts.twoPassCriticEnabled,
        llmConfig: opts.llmConfig,
        transport,
        signal: run.controller.signal,
        shouldAbort: () => run.controller.signal.aborted,
        onProgress: (event) => {
          const ts = this.nextIso();

          if (event.type === 'chapter_start') {
            const chapNum = chapterNumberById.get(event.chapterId) ?? null;
            run.job.currentChapter = chapNum;
            run.job.updatedAt = ts;
            this.persistJobRecord(run.job);
            this.recordAndEmitEvent(run, {
              type: 'phase',
              jobId: run.job.id,
              timestamp: ts,
              progressPct: run.job.progressPct,
              chapterId: event.chapterId,
              chapterNumber: chapNum ?? undefined,
              phase: `Глава ${chapNum ?? event.chapterId}`,
              message: `Старт обработки главы ${chapNum ?? event.chapterId}`,
              job: { ...run.job },
            });
            return;
          }

          if (event.type === 'phase_step') {
            run.job.updatedAt = ts;
            this.recordAndEmitEvent(run, {
              type: 'phase',
              jobId: run.job.id,
              timestamp: ts,
              progressPct: run.job.progressPct,
              chapterId: event.chapterId,
              chapterNumber: run.job.currentChapter ?? undefined,
              phase: event.label,
              message: `Фаза ${event.step}/5: ${event.label}`,
              job: { ...run.job },
            });
            return;
          }

          if (event.type === 'chapter_complete') {
            const isQuarantined = event.chapter.status === 'quarantined';
            let skippedByUserConflict = false;
            try {
              const patchRes = db.patchChapterAtomic(
                novel.id,
                event.chapterId,
                () => event.chapter,
                {
                  expectedRevision: initialChapterRevisions.get(event.chapterId),
                  syncJsonMirror: 'debounced',
                }
              );
              committedChapterRevisions.set(event.chapterId, patchRes.revision);
            } catch (patchErr) {
              if (patchErr instanceof DiskDatabaseConflictError) {
                conflictedChapterIds.add(event.chapterId);
                skippedByUserConflict = true;
              } else {
                console.error(
                  `[JobBroker ${run.job.id}] Failed to persist chapter ${event.chapterId}:`,
                  patchErr
                );
              }
            }

            processedCount++;
            if (isQuarantined && !skippedByUserConflict) {
              run.job.quarantinedChapters += 1;
            } else if (!skippedByUserConflict) {
              run.job.completedChapters += 1;
            }

            const pct = Math.min(
              99,
              Math.round((processedCount / Math.max(1, run.job.totalChapters)) * 100)
            );
            run.job.progressPct = pct;
            run.job.currentChapter = event.chapter.number;
            run.job.updatedAt = ts;
            this.persistJobRecord(run.job);

            this.recordAndEmitEvent(run, {
              type: isQuarantined ? 'chapter_quarantined' : 'chapter_done',
              jobId: run.job.id,
              timestamp: ts,
              progressPct: pct,
              chapterId: event.chapterId,
              chapterNumber: event.chapter.number,
              message: skippedByUserConflict
                ? `Глава ${event.chapter.number}: сохранена пользовательская правка (OCC конфликт ревизии)`
                : isQuarantined
                  ? `Глава ${event.chapter.number} переведена в карантин: ${event.chapter.quarantineReason || 'сбой LLM'}`
                  : `Глава ${event.chapter.number} обработана (${event.chapter.wordCountRus} сл.)`,
              job: { ...run.job },
            });
          }
        },
      });

      if (batchRes?.updatedNovel) {
        db.commitBatchNovelResult({
          novelId: novel.id,
          updatedNovel: batchRes.updatedNovel,
          targetChapterIds: targetChapterIdSet,
          initialChapterRevisions,
          committedChapterRevisions,
          conflictedChapterIds,
          syncJsonMirror: true,
        });
      }

      const endTs = this.nextIso();
      if (run.controller.signal.aborted || run.job.status === 'cancelled') {
        run.job.status = 'cancelled';
        run.job.currentChapter = null;
        run.job.updatedAt = endTs;
        this.persistJobRecord(run.job);
        this.recordAndEmitEvent(run, {
          type: 'cancelled',
          jobId: run.job.id,
          timestamp: endTs,
          progressPct: run.job.progressPct,
          message: 'Фоновая задача остановлена пользователем.',
          job: { ...run.job },
        });
        return;
      }

      run.job.status = 'completed';
      run.job.progressPct = 100;
      run.job.currentChapter = null;
      run.job.statsJson = JSON.stringify({
        processedChaptersCount: batchRes.processedChaptersCount,
        completedChapters: run.job.completedChapters,
        quarantinedChapters: run.job.quarantinedChapters,
      });
      run.job.updatedAt = endTs;
      this.persistJobRecord(run.job);

      this.recordAndEmitEvent(run, {
        type: 'completed',
        jobId: run.job.id,
        timestamp: endTs,
        progressPct: 100,
        message: `Пакет завершён: готово ${run.job.completedChapters}, в карантине ${run.job.quarantinedChapters}.`,
        job: { ...run.job },
      });
    } catch (err: unknown) {
      const failTs = this.nextIso();
      if (run.controller.signal.aborted || run.job.status === 'cancelled') {
        run.job.status = 'cancelled';
        run.job.currentChapter = null;
        run.job.updatedAt = failTs;
        this.persistJobRecord(run.job);
        this.recordAndEmitEvent(run, {
          type: 'cancelled',
          jobId: run.job.id,
          timestamp: failTs,
          progressPct: run.job.progressPct,
          message: 'Фоновая задача остановлена пользователем.',
          job: { ...run.job },
        });
      } else {
        const msg = err instanceof Error ? err.message : 'Неизвестная ошибка фонового конвейера';
        run.job.status = 'failed';
        run.job.currentChapter = null;
        run.job.errorText = msg;
        run.job.updatedAt = failTs;
        this.persistJobRecord(run.job);
        this.recordAndEmitEvent(run, {
          type: 'failed',
          jobId: run.job.id,
          timestamp: failTs,
          progressPct: run.job.progressPct,
          message: msg,
          job: { ...run.job },
        });
      }
    } finally {
      this.archiveRun(run.job.id, run);
    }
  }

  public cancelJob(jobId: string): PipelineJobRecord | null {
    const active = this.activeRuns.get(jobId);
    if (active) {
      if (!active.controller.signal.aborted) {
        active.controller.abort();
      }
      if (active.job.status === 'running' || active.job.status === 'queued') {
        active.job.status = 'cancelled';
        active.job.updatedAt = this.nextIso();
        this.persistJobRecord(active.job);
        this.recordAndEmitEvent(active, {
          type: 'cancelled',
          jobId: active.job.id,
          timestamp: active.job.updatedAt,
          progressPct: active.job.progressPct,
          message: 'Запрошена остановка фоновой задачи...',
          job: { ...active.job },
        });
      }
      return { ...active.job };
    }

    const stored = this.getDb().getPipelineJob(jobId);
    if (!stored) return null;
    if (stored.status === 'running' || stored.status === 'queued') {
      const updated: PipelineJobRecord = {
        ...stored,
        status: 'cancelled',
        updatedAt: this.nextIso(),
      };
      this.persistJobRecord(updated);
      return updated;
    }
    return stored;
  }

  public subscribe(
    jobId: string,
    listener: (event: PipelineJobEvent) => void
  ): {
    job: PipelineJobRecord | null;
    history: PipelineJobEvent[];
    unsubscribe: () => void;
  } {
    const active = this.activeRuns.get(jobId);
    if (active) {
      active.emitter.on('event', listener);
      return {
        job: { ...active.job },
        history: [...active.history],
        unsubscribe: () => {
          active.emitter.off('event', listener);
        },
      };
    }

    const stored = this.getJob(jobId);
    const recentHistory = this.recentHistories.get(jobId) ?? [];
    return {
      job: stored,
      history: [...recentHistory],
      unsubscribe: () => {},
    };
  }
}

const globalForBroker = globalThis as unknown as {
  __canonStudioJobBroker?: StudioPipelineJobBroker;
};

export function getStudioJobBroker(): StudioPipelineJobBroker {
  if (!globalForBroker.__canonStudioJobBroker) {
    globalForBroker.__canonStudioJobBroker = new StudioPipelineJobBroker();
  }
  return globalForBroker.__canonStudioJobBroker;
}
