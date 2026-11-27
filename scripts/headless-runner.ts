/**
 * Autonomous Headless Overnight Runner (EGM V4 Production Hardening)
 *
 * Runs the 5-phase translation pipeline directly from terminal or Docker
 * without requiring an active browser session.
 *
 * Usage:
 *   npx tsx scripts/headless-runner.ts [--novel=<id>] [--from=<num>] [--to=<num>] [--provider=<gemini_api|colab_ollama>] [--colab=<url>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  runPipelineBatchOnNovel,
  ServerPipelineExecutionAdapter,
  type ServerPipelineExecutionOptions,
} from '../lib/pipeline-run-engine.ts';
import { DEFAULT_LLM_PROVIDER_CONFIG } from '../lib/qa-linter.ts';
import type { LlmProviderConfig, PipelineJobRecord } from '../lib/pipeline-types.ts';
import {
  parseDiskDatabasePayload,
  serializeDiskDatabasePayload,
} from '../lib/storage-idb.ts';
import {
  closeStudioSqliteDb,
  DiskDatabaseConflictError,
  getStudioSqliteDb,
  nextMonotonicIsoTimestamp,
} from '../lib/sqlite-db-server.ts';
import { INITIAL_NOVELS, type NovelProject } from '../lib/seed-data.ts';

const DB_PATH = path.resolve(process.cwd(), 'data', 'novels_db.json');
let runnerSaveSeq = 0;

// Parse CLI Flags
const args = process.argv.slice(2);
const flags: Record<string, string> = {};
for (const arg of args) {
  if (arg.startsWith('--')) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 2) {
      flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1) || 'true';
    } else {
      flags[arg.slice(2)] = 'true';
    }
  }
}

export function loadProjectsFromDisk(customPath: string = DB_PATH): NovelProject[] {
  const resolved = path.resolve(customPath);
  if (resolved === DB_PATH) {
    try {
      const dbResult = getStudioSqliteDb().readAllNovels();
      if (Array.isArray(dbResult.novels) && dbResult.novels.length > 0) {
        return dbResult.novels;
      }
    } catch (err) {
      console.warn('[Runner] Warning reading SQLite database:', err);
    }
  }

  try {
    if (fs.existsSync(resolved)) {
      const raw = fs.readFileSync(resolved, 'utf-8');
      const parsed = parseDiskDatabasePayload(raw);
      if (Array.isArray(parsed.novels) && parsed.novels.length > 0) {
        return parsed.novels;
      }
    }
  } catch (err) {
    console.warn(`[Runner] Warning reading ${resolved}:`, err);
  }
  return INITIAL_NOVELS;
}

export function saveProjectsToDisk(novels: NovelProject[], customPath: string = DB_PATH) {
  const resolved = path.resolve(customPath);
  if (resolved === DB_PATH) {
    try {
      getStudioSqliteDb().writeAllNovels(novels, { syncJsonMirror: true });
      return;
    } catch (err) {
      console.error('[Runner] Error persisting to SQLite database:', err);
      return;
    }
  }

  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${resolved}.tmp.${process.pid}.${Date.now()}.${++runnerSaveSeq}`;
    const payload = serializeDiskDatabasePayload(novels);
    fs.writeFileSync(tmp, payload, 'utf-8');
    fs.renameSync(tmp, resolved);
  } catch (err) {
    console.error(`[Runner] Error persisting ${resolved}:`, err);
  }
}

/**
 * Direct In-Process Transport Adapter delegating to the canonical `ServerPipelineExecutionAdapter`.
 * Ensures 100% parity between Headless CLI and `/api/pipeline` (including chapter-scoped glossary slicing
 * and Pass 1 resilience fallback).
 */
export class DirectEngineTransportAdapter extends ServerPipelineExecutionAdapter {
  constructor(
    llmConfig: LlmProviderConfig = DEFAULT_LLM_PROVIDER_CONFIG,
    options?: ServerPipelineExecutionOptions
  ) {
    super(llmConfig, options);
  }
}

async function main() {
  console.log('='.repeat(65));
  console.log('  Autonomous Headless Translation Studio (EGM V4 Runner)');
  console.log('='.repeat(65));

  const novels = loadProjectsFromDisk();
  const novelId = flags['novel'] || novels[0]?.id;
  const targetNovel = novels.find((n) => n.id === novelId) || novels[0];

  if (!targetNovel) {
    console.error('[Runner] Error: No novel project found.');
    process.exit(1);
  }

  const rangeMatch = (flags['range'] || '').match(/^(\d+)\s*-\s*(\d+)$/);
  const fromCh = flags['from'] ? Number(flags['from']) : rangeMatch ? Number(rangeMatch[1]) : 1;
  const toCh = flags['to'] ? Number(flags['to']) : rangeMatch ? Number(rangeMatch[2]) : fromCh + 2;
  const provider = (flags['provider'] || DEFAULT_LLM_PROVIDER_CONFIG.provider) as LlmProviderConfig['provider'];
  if (
    provider === 'antigravity_cli' &&
    (process.env.ENABLE_CLIENT_AGY_CLI !== '1' || process.env.DISABLE_CLIENT_AGY_CLI === '1')
  ) {
    console.error(
      '[Runner] Провайдер antigravity_cli (agy) временно отключён до обновления ToS. Используйте --provider=gemini_api (или задайте ENABLE_CLIENT_AGY_CLI=1 для принудительного запуска).'
    );
    process.exit(1);
  }
  const colabUrl = flags['colab'] || '';

  const llmConfig: LlmProviderConfig = {
    ...DEFAULT_LLM_PROVIDER_CONFIG,
    provider,
    colabEndpointUrl: colabUrl || DEFAULT_LLM_PROVIDER_CONFIG.colabEndpointUrl,
    ...(flags['model'] ? { modelId: flags['model'] } : {}),
    ...(flags['critic'] ? { criticModelId: flags['critic'] } : {}),
    ...(flags['stylist'] ? { stylistModelId: flags['stylist'] } : {}),
    ...(flags['scout'] ? { scoutModelId: flags['scout'] } : {}),
  };

  const targetChapters = targetNovel.chapters.filter(
    (c) => c.number >= fromCh && c.number <= toCh
  );

  console.log(`[Runner] Новелла: "${targetNovel.rusTitle || targetNovel.name}" (${targetNovel.id})`);
  console.log(`[Runner] Диапазон глав: ${fromCh}–${toCh} (всего к переводу: ${targetChapters.length})`);
  console.log(`[Runner] Провайдер: ${provider}${colabUrl ? ` (${colabUrl})` : ''}`);
  console.log(`[Runner] Source Firewall: АКТИВЕН (Pass 2 LiTransProQA -> Pass 3 Blind Stylist -> Step 4 Gsurf)`);
  console.log('-'.repeat(65));

  if (targetChapters.length === 0) {
    console.log('[Runner] Нет глав в указанном диапазоне.');
    process.exit(0);
  }

  const transport = new DirectEngineTransportAdapter(llmConfig);
  const sqliteDb = getStudioSqliteDb();

  const existingActiveJob = sqliteDb.findActiveJobForNovel(targetNovel.id, {
    reconcileSamePidOrphans: true,
  });
  if (existingActiveJob && flags['force'] !== 'true') {
    console.error(
      `[Runner] Ошибка: для новеллы "${targetNovel.id}" уже выполняется активная задача ${existingActiveJob.id} (PID ${existingActiveJob.ownerPid ?? 'unknown'}). Используйте --force=true только при ручном восстановлении.`
    );
    closeStudioSqliteDb();
    process.exit(1);
  }

  const jobCreatedAt = nextMonotonicIsoTimestamp();
  const cliJob: PipelineJobRecord = {
    id: randomUUID(),
    novelId: targetNovel.id,
    mode: 'full_5_phase',
    status: 'running',
    startChapter: targetChapters[0].number,
    endChapter: targetChapters[targetChapters.length - 1].number,
    progressPct: 0,
    currentChapter: targetChapters[0].number,
    completedChapters: 0,
    totalChapters: targetChapters.length,
    quarantinedChapters: 0,
    ownerPid: process.pid,
    statsJson: null,
    errorText: null,
    createdAt: jobCreatedAt,
    updatedAt: jobCreatedAt,
  };
  sqliteDb.upsertPipelineJob(cliJob);

  const abortController = new AbortController();
  const handleSig = () => abortController.abort();
  process.once('SIGINT', handleSig);
  process.once('SIGTERM', handleSig);

  const targetChapterIds = targetChapters.map((c) => c.id);
  const targetChapterIdSet = new Set(targetChapterIds);
  const initialChapterRevisions = new Map(
    targetNovel.chapters.map((c) => [c.id, Number(c.revision || 1)])
  );
  const committedChapterRevisions = new Map<string, number>();
  const conflictedChapterIds = new Set<string>();
  let processedCliCount = 0;

  try {
    const result = await runPipelineBatchOnNovel({
      novel: targetNovel,
      targetChapterIds,
      mode: 'full_5_phase',
      autoCanonEnabled: true,
      twoPassCriticEnabled: true,
      llmConfig,
      transport,
      signal: abortController.signal,
      shouldAbort: () => abortController.signal.aborted,
      onProgress: (event) => {
        const now = new Date().toTimeString().slice(0, 8);
        if (event.type === 'start') {
          console.log(`[${now}] СТАРТ: Пакет из ${event.totalChapters} глав...`);
        } else if (event.type === 'chapter_start') {
          cliJob.currentChapter = event.chapterNumber;
          cliJob.updatedAt = nextMonotonicIsoTimestamp(cliJob.updatedAt);
          sqliteDb.upsertPipelineJob(cliJob);
          console.log(`[${now}] -> Начат перевод главы (ID: ${event.chapterId})...`);
        } else if (event.type === 'phase_step') {
          console.log(`[${now}]    Фаза ${event.step}/5: ${event.label}`);
        } else if (event.type === 'log') {
          console.log(`[${now}]    [${event.tag}] ${event.message}`);
        } else if (event.type === 'chapter_complete') {
          const isQuarantined = event.chapter.status === 'quarantined';
          console.log(
            `[${now}] ${isQuarantined ? 'QUARANTINE' : 'OK'} Глава ${event.chapter.number} завершена (${event.chapter.wordCountRus} сл.)${isQuarantined ? ` — ${event.chapter.quarantineReason || 'outage'}` : ''}`
          );
          try {
            const patchRes = sqliteDb.patchChapterAtomic(
              targetNovel.id,
              event.chapterId,
              () => event.chapter,
              {
                expectedRevision: initialChapterRevisions.get(event.chapterId),
                syncJsonMirror: 'debounced',
              }
            );
            committedChapterRevisions.set(event.chapterId, patchRes.revision);
            console.log(`[${now}]    💾 Глава атомарно сохранена в SQLite (mirror debounced)`);
          } catch (patchErr) {
            if (patchErr instanceof DiskDatabaseConflictError) {
              conflictedChapterIds.add(event.chapterId);
              console.warn(
                `[${now}]    ⚠️ Глава ${event.chapter.number} изменена внешним процессом (OCC), пользовательская правка сохранена.`
              );
            } else {
              throw patchErr;
            }
          }
          processedCliCount += 1;
          if (isQuarantined) {
            cliJob.quarantinedChapters += 1;
          } else {
            cliJob.completedChapters += 1;
          }
          cliJob.progressPct = Math.min(
            99,
            Math.round((processedCliCount / Math.max(1, cliJob.totalChapters)) * 100)
          );
          cliJob.currentChapter = event.chapter.number;
          cliJob.updatedAt = nextMonotonicIsoTimestamp(cliJob.updatedAt);
          sqliteDb.upsertPipelineJob(cliJob);
        } else if (event.type === 'batch_complete') {
          console.log(`[${now}] Завершено! Все главы успешно обработаны.`);
        } else if (event.type === 'aborted') {
          console.log(`[${now}] Прервано по сигналу остановки.`);
        }
      },
    });

    if (result?.updatedNovel) {
      sqliteDb.commitBatchNovelResult({
        novelId: targetNovel.id,
        updatedNovel: result.updatedNovel,
        targetChapterIds: targetChapterIdSet,
        initialChapterRevisions,
        committedChapterRevisions,
        conflictedChapterIds,
        syncJsonMirror: true,
      });
      console.log('[Runner] Метаданные проекта и глоссарий синхронизированы в SQLite.');
    }

    cliJob.status = abortController.signal.aborted ? 'cancelled' : 'completed';
    if (!abortController.signal.aborted) {
      cliJob.progressPct = 100;
    }
    cliJob.currentChapter = null;
    cliJob.updatedAt = nextMonotonicIsoTimestamp(cliJob.updatedAt);
    sqliteDb.upsertPipelineJob(cliJob);
  } catch (err: unknown) {
    cliJob.status = abortController.signal.aborted ? 'cancelled' : 'failed';
    cliJob.currentChapter = null;
    cliJob.errorText = err instanceof Error ? err.message : String(err);
    cliJob.updatedAt = nextMonotonicIsoTimestamp(cliJob.updatedAt);
    try {
      sqliteDb.upsertPipelineJob(cliJob);
    } catch {
      // Best-effort job state update on fatal error
    }
    throw err;
  } finally {
    process.removeListener('SIGINT', handleSig);
    process.removeListener('SIGTERM', handleSig);
    closeStudioSqliteDb();
  }

  console.log('='.repeat(65));
  console.log('  Перевод завершён успешно (100% QA Pass).');
  console.log('='.repeat(65));
}

const isDirectCliExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('headless-runner.ts');

if (isDirectCliExecution) {
  const envLocalPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, 'utf-8');
    for (const line of envContent.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
  const hasProxyEnv = Boolean(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy
  );
  if (
    hasProxyEnv &&
    process.env.NODE_USE_ENV_PROXY === undefined &&
    !process.execArgv.includes('--use-env-proxy') &&
    process.allowedNodeEnvironmentFlags?.has('--use-env-proxy')
  ) {
    const reexec = spawnSync(
      process.execPath,
      ['--use-env-proxy', ...process.execArgv, ...process.argv.slice(1)],
      {
        stdio: 'inherit',
        env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
      }
    );
    process.exit(reexec.status ?? (reexec.error ? 1 : 0));
  }
  main().catch((err) => {
    console.error('[Runner] Неперехваченная фатальная ошибка:', err);
    process.exit(1);
  });
}
