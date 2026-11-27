import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  parseDiskDatabasePayload,
  serializeDiskDatabasePayload,
} from './storage-idb.ts';
import type { NovelProject } from './seed-data.ts';
import {
  DiskDatabaseConflictError,
  readSqliteDatabaseAsync,
  writeSqliteDatabaseAtomicAsync,
} from './sqlite-db-server.ts';

export const DEFAULT_DB_FILE_PATH = path.join(process.cwd(), 'data', 'novels_db.json');

export { DiskDatabaseConflictError };

const perPathWriteQueue = new Map<string, Promise<unknown>>();
let tmpSeq = 0;
let lastIssuedEpochMs = 0;

function nextMonotonicIsoTimestamp(minAfterIso?: string | null): string {
  let candidateMs = Date.now();
  if (minAfterIso) {
    const parsedMs = Date.parse(minAfterIso);
    if (Number.isFinite(parsedMs) && candidateMs <= parsedMs) {
      candidateMs = parsedMs + 1;
    }
  }
  if (candidateMs <= lastIssuedEpochMs) {
    candidateMs = lastIssuedEpochMs + 1;
  }
  lastIssuedEpochMs = candidateMs;
  return new Date(candidateMs).toISOString();
}

export async function readDiskDatabase(
  dbFilePath: string = DEFAULT_DB_FILE_PATH
): Promise<{
  novels: NovelProject[];
  updatedAt: string | null;
  version: string;
  diskPath: string;
}> {
  const resolvedPath = path.resolve(dbFilePath);
  if (resolvedPath === path.resolve(DEFAULT_DB_FILE_PATH)) {
    return readSqliteDatabaseAsync();
  }

  try {
    const raw = await fs.readFile(resolvedPath, 'utf-8');
    const parsed = parseDiskDatabasePayload(raw);
    return {
      novels: Array.isArray(parsed.novels) ? parsed.novels : [],
      updatedAt: parsed.updatedAt || null,
      version: parsed.version,
      diskPath: resolvedPath,
    };
  } catch (err: unknown) {
    const errno = err as NodeJS.ErrnoException;
    if (errno && errno.code === 'ENOENT') {
      return {
        novels: [],
        updatedAt: null,
        version: 'empty',
        diskPath: resolvedPath,
      };
    }
    throw err;
  }
}

export async function writeDiskDatabaseAtomic(
  novels: NovelProject[],
  options?: {
    dbFilePath?: string;
    baseUpdatedAt?: string | null;
  }
): Promise<{
  updatedAt: string;
  savedCount: number;
  diskPath: string;
}> {
  const resolvedPath = path.resolve(options?.dbFilePath || DEFAULT_DB_FILE_PATH);
  const isDefaultDb = resolvedPath === path.resolve(DEFAULT_DB_FILE_PATH);
  const previous = perPathWriteQueue.get(resolvedPath) ?? Promise.resolve();

  const task = previous
    .catch(() => {})
    .then(async () => {
      if (isDefaultDb) {
        return writeSqliteDatabaseAtomicAsync(novels, {
          baseUpdatedAt: options?.baseUpdatedAt,
        });
      }

      const currentOnDisk = await readDiskDatabase(resolvedPath);

      if (
        typeof options?.baseUpdatedAt === 'string' &&
        options.baseUpdatedAt.length > 0 &&
        currentOnDisk.updatedAt !== null &&
        currentOnDisk.updatedAt !== options.baseUpdatedAt
      ) {
        throw new DiskDatabaseConflictError(
          currentOnDisk.updatedAt,
          options.baseUpdatedAt
        );
      }

      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });

      const nextUpdatedAt = nextMonotonicIsoTimestamp(currentOnDisk.updatedAt);
      const payload = serializeDiskDatabasePayload(novels, nextUpdatedAt);
      const tmpPath = `${resolvedPath}.tmp.${process.pid}.${Date.now()}.${++tmpSeq}`;

      try {
        await fs.writeFile(tmpPath, payload, 'utf-8');
        await fs.rename(tmpPath, resolvedPath);
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        throw err;
      }

      return {
        updatedAt: nextUpdatedAt,
        savedCount: novels.length,
        diskPath: resolvedPath,
      };
    });

  perPathWriteQueue.set(resolvedPath, task);
  return task;
}
