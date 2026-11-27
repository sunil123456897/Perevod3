/**
 * Unified Embedded SQLite (WAL) Storage Engine for Node 22+ (`node:sqlite`).
 *
 * Uses `process.getBuiltinModule('node:sqlite')` at runtime instead of static `import 'node:sqlite'`
 * so Next.js 15 Webpack server bundling and `@types/node@^20` remain 100% green.
 *
 * Features:
 * - PRAGMA journal_mode = WAL; synchronous = NORMAL; busy_timeout = 5000; foreign_keys = ON
 * - Normalized tables: novels, chapters (per-chapter status & revision OCC), chapter_snapshots,
 *   glossary_entries, pipeline_jobs, meta
 * - Fail-loud error propagation on corrupted JSON files (no silent null updatedAt reset)
 * - Automatic idempotent import from `data/novels_db.json` and atomic JSON mirror serialization
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { ChapterRecord, ChapterVersionSnapshot, NovelProject } from './seed-data.ts';
import type {
  ChapterQaSummary,
  ChapterStatus,
  GlossaryCategory,
  PipelineJobMode,
  PipelineJobRecord,
  PipelineJobStatus,
} from './pipeline-types.ts';
import {
  parseDiskDatabasePayload,
  serializeDiskDatabasePayload,
} from './storage-idb.ts';

export const DEFAULT_SQLITE_DB_PATH = path.join(process.cwd(), 'data', 'studio.db');
export const DEFAULT_JSON_MIRROR_PATH = path.join(process.cwd(), 'data', 'novels_db.json');

export class DiskDatabaseConflictError extends Error {
  public readonly diskUpdatedAt: string | null;
  public readonly baseUpdatedAt: string | null;
  public readonly expectedRevision?: number;
  public readonly currentRevision?: number;

  constructor(
    diskUpdatedAt: string | null,
    baseUpdatedAt: string | null,
    details?: { expectedRevision?: number; currentRevision?: number; message?: string }
  ) {
    super(
      details?.message ||
        `Disk database conflict: disk updatedAt (${diskUpdatedAt}) differs from client baseUpdatedAt (${baseUpdatedAt})`
    );
    this.name = 'DiskDatabaseConflictError';
    this.diskUpdatedAt = diskUpdatedAt;
    this.baseUpdatedAt = baseUpdatedAt;
    this.expectedRevision = details?.expectedRevision;
    this.currentRevision = details?.currentRevision;
  }
}

interface SqliteStatementSync {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

interface SqliteDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementSync;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (location: string) => SqliteDatabaseSync;
}

function getNodeSqliteModule(): NodeSqliteModule {
  const proc = process as unknown as {
    getBuiltinModule?: (id: string) => unknown;
  };
  const mod = proc.getBuiltinModule?.('node:sqlite') as NodeSqliteModule | undefined;
  if (!mod || typeof mod.DatabaseSync !== 'function') {
    throw new Error(
      `Built-in 'node:sqlite' is unavailable in this Node runtime (${process.version}). Node 22.5+ is required.`
    );
  }
  return mod;
}

export function isProcessPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'EPERM';
  }
}

let lastIssuedEpochMs = 0;

export function nextMonotonicIsoTimestamp(minAfterIso?: string | null): string {
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

function atomicWriteFileSync(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

async function atomicWriteFileAsync(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await fsp.mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fsp.writeFile(tmpPath, content, 'utf-8');
    await fsp.rename(tmpPath, targetPath);
  } catch (err) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function deriveChapterStatus(ch: ChapterRecord): ChapterStatus {
  if (
    ch.status === 'pending' ||
    ch.status === 'translated' ||
    ch.status === 'verified' ||
    ch.status === 'quarantined'
  ) {
    return ch.status;
  }
  if (ch.verified) return 'verified';
  if (ch.translated && ch.rusText?.trim()) return 'translated';
  return 'pending';
}

function canonicalJsonString(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJsonString(item))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonString(obj[k])}`).join(',')}}`;
}

function stripSnapshotsFromChapter(ch: ChapterRecord): ChapterRecord {
  if (!ch.versionHistory || ch.versionHistory.length === 0) {
    return ch;
  }
  const rest = { ...ch };
  delete rest.versionHistory;
  return rest;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS novels (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_number REAL NOT NULL,
  sub_part TEXT,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  chapter_json TEXT NOT NULL,
  qa_summary_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chapters_novel_num
  ON chapters(novel_id, chapter_number, sub_part);

CREATE TABLE IF NOT EXISTS chapter_snapshots (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_novel_chapter
  ON chapter_snapshots(novel_id, chapter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS glossary_entries (
  novel_id TEXT NOT NULL,
  category TEXT NOT NULL,
  eng_term TEXT NOT NULL,
  rus_term TEXT NOT NULL,
  meta_json TEXT,
  PRIMARY KEY(novel_id, category, eng_term),
  FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  start_chapter REAL NOT NULL,
  end_chapter REAL NOT NULL,
  progress_pct INTEGER NOT NULL DEFAULT 0,
  current_chapter REAL,
  completed_chapters INTEGER NOT NULL DEFAULT 0,
  total_chapters INTEGER NOT NULL DEFAULT 0,
  quarantined_chapters INTEGER NOT NULL DEFAULT 0,
  owner_pid INTEGER,
  stats_json TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export interface StudioSqliteOptions {
  sqlitePath?: string;
  jsonMirrorPath?: string | null;
}

export class StudioSqliteDatabase {
  public readonly sqlitePath: string;
  public readonly jsonMirrorPath: string | null;
  private db: SqliteDatabaseSync;
  private closed = false;
  private mirrorFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private asyncMirrorChain: Promise<void> = Promise.resolve();
  private lastInternalMirrorWriteMs = 0;

  constructor(options?: StudioSqliteOptions) {
    this.sqlitePath = path.resolve(options?.sqlitePath || DEFAULT_SQLITE_DB_PATH);
    this.jsonMirrorPath =
      options?.jsonMirrorPath === null
        ? null
        : path.resolve(options?.jsonMirrorPath || DEFAULT_JSON_MIRROR_PATH);

    fs.mkdirSync(path.dirname(this.sqlitePath), { recursive: true });
    const { DatabaseSync } = getNodeSqliteModule();
    this.db = new DatabaseSync(this.sqlitePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA_SQL);
    const jobCols = this.db.prepare('PRAGMA table_info(pipeline_jobs)').all();
    if (!jobCols.some((c) => c.name === 'owner_pid')) {
      this.db.exec('ALTER TABLE pipeline_jobs ADD COLUMN owner_pid INTEGER');
    }
    this.setMetaIfAbsent('schemaVersion', '5.0-sqlite-wal');
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error(`StudioSqliteDatabase (${this.sqlitePath}) is closed`);
    }
  }

  public getMeta(key: string): string | null {
    this.ensureOpen();
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return typeof row?.value === 'string' ? row.value : null;
  }

  public setMeta(key: string, value: string): void {
    this.ensureOpen();
    this.db
      .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  private setMetaIfAbsent(key: string, value: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO meta(key, value) VALUES(?, ?)')
      .run(key, value);
  }

  private runInTransaction<T>(fn: () => T): T {
    this.ensureOpen();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure if already rolled back
      }
      throw err;
    }
  }

  /**
   * Imports legacy/external `novels_db.json` into SQLite when SQLite is empty
   * or when the JSON file was externally modified (Strict fail-loud on corrupted JSON).
   */
  public syncFromJsonIfNeeded(): { imported: boolean; updatedAt: string | null } {
    this.ensureOpen();
    if (!this.jsonMirrorPath || !fs.existsSync(this.jsonMirrorPath)) {
      return { imported: false, updatedAt: this.getMeta('updatedAt') };
    }

    const stat = fs.statSync(this.jsonMirrorPath);
    const jsonMtimeMs = Math.round(stat.mtimeMs);
    const savedMtimeRaw = this.getMeta('sourceJsonMtimeMs');
    const savedMtimeMs = savedMtimeRaw ? Number(savedMtimeRaw) : 0;
    const novelCountRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM novels').get();
    const novelCount = Number(novelCountRow?.cnt || 0);

    const needsInitialImport = novelCount === 0 && stat.size > 0;
    const externallyUpdated =
      novelCount > 0 &&
      savedMtimeMs > 0 &&
      jsonMtimeMs > savedMtimeMs + 250 &&
      Math.abs(jsonMtimeMs - this.lastInternalMirrorWriteMs) > 250;

    if (!needsInitialImport && !externallyUpdated) {
      return { imported: false, updatedAt: this.getMeta('updatedAt') };
    }

    // Fail-loud if the JSON file on disk is corrupt — never mask corruption as empty state!
    const raw = fs.readFileSync(this.jsonMirrorPath, 'utf-8');
    const parsed = parseDiskDatabasePayload(raw);
    const importTimestamp = parsed.updatedAt || nextMonotonicIsoTimestamp(this.getMeta('updatedAt'));

    this.writeAllNovelsInternal(parsed.novels, importTimestamp, false);
    this.setMeta('sourceJsonMtimeMs', String(jsonMtimeMs));
    return { imported: true, updatedAt: this.getMeta('updatedAt') };
  }

  private writeAllNovelsInternal(
    novels: NovelProject[],
    nextUpdatedAt: string,
    preserveChapterRevisions = true
  ): void {
    const currentUpdatedAtSnapshot = this.getMeta('updatedAt');
    const existingChapters = new Map<string, { revision: number; canonicalBaseJson: string }>();
    if (preserveChapterRevisions) {
      const revRows = this.db.prepare('SELECT id, revision, chapter_json FROM chapters').all();
      for (const r of revRows) {
        if (typeof r.id === 'string') {
          const prevRev = Number(r.revision || 1);
          let canonicalBaseJson = '';
          if (typeof r.chapter_json === 'string') {
            try {
              const parsed = JSON.parse(r.chapter_json) as Record<string, unknown>;
              delete parsed.revision;
              canonicalBaseJson = canonicalJsonString(parsed);
            } catch {
              canonicalBaseJson = '';
            }
          }
          existingChapters.set(r.id, {
            revision: prevRev,
            canonicalBaseJson,
          });
        }
      }
    }

    const upsertNovel = this.db.prepare(`
      INSERT INTO novels(id, sort_order, metadata_json, updated_at, revision)
      VALUES(?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        sort_order = excluded.sort_order,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        revision = novels.revision + 1
    `);

    const insertChapter = this.db.prepare(`
      INSERT INTO chapters(id, novel_id, chapter_number, sub_part, status, revision, chapter_json, qa_summary_json, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSnapshot = this.db.prepare(`
      INSERT INTO chapter_snapshots(id, chapter_id, novel_id, label, created_at, snapshot_json)
      VALUES(?, ?, ?, ?, ?, ?)
    `);

    const insertGlossary = this.db.prepare(`
      INSERT INTO glossary_entries(novel_id, category, eng_term, rus_term, meta_json)
      VALUES(?, ?, ?, ?, ?)
    `);

    this.runInTransaction(() => {
      const incomingNovelIds = new Set(novels.map((n) => n.id));
      const existingNovels = this.db.prepare('SELECT id FROM novels').all();
      for (const row of existingNovels) {
        if (typeof row.id === 'string' && !incomingNovelIds.has(row.id)) {
          this.db.prepare('DELETE FROM chapter_snapshots WHERE novel_id = ?').run(row.id);
          this.db.prepare('DELETE FROM novels WHERE id = ?').run(row.id);
        }
      }

      novels.forEach((novel, sortOrder) => {
        const metaObj = { ...novel, chapters: [] as ChapterRecord[] };
        upsertNovel.run(novel.id, sortOrder, JSON.stringify(metaObj), nextUpdatedAt);

        // Pre-validate chapter revisions before deleting rows (rolls back transaction on conflict)
        const preparedChapters = (novel.chapters || []).map((ch) => {
          const prev = existingChapters.get(ch.id);
          const status = deriveChapterStatus(ch);
          const stripped = stripSnapshotsFromChapter(ch);
          const incomingRev =
            typeof ch.revision === 'number' && Number.isFinite(ch.revision)
              ? ch.revision
              : undefined;

          let nextRev: number;
          if (prev) {
            const comparable = { ...stripped, status } as Record<string, unknown>;
            delete comparable.revision;
            const contentChanged = canonicalJsonString(comparable) !== prev.canonicalBaseJson;
            if (
              preserveChapterRevisions &&
              incomingRev !== undefined &&
              incomingRev < prev.revision &&
              contentChanged
            ) {
              throw new DiskDatabaseConflictError(currentUpdatedAtSnapshot, null, {
                expectedRevision: incomingRev,
                currentRevision: prev.revision,
                message: `Chapter ${ch.id} revision conflict during whole-book write: incoming ${incomingRev}, current ${prev.revision}`,
              });
            }
            nextRev = contentChanged
              ? Math.max(incomingRev ?? 0, prev.revision) + 1
              : Math.max(incomingRev ?? 0, prev.revision);
          } else {
            nextRev = incomingRev && incomingRev >= 1 ? incomingRev : 1;
          }

          return { ch, status, nextRev, cleanChapter: { ...stripped, status, revision: nextRev } };
        });

        // Replace normalized children atomically inside the transaction
        this.db.prepare('DELETE FROM chapters WHERE novel_id = ?').run(novel.id);
        this.db.prepare('DELETE FROM chapter_snapshots WHERE novel_id = ?').run(novel.id);
        this.db.prepare('DELETE FROM glossary_entries WHERE novel_id = ?').run(novel.id);

        // Glossary entries
        const categories = Object.keys(novel.glossary || {}) as GlossaryCategory[];
        for (const cat of categories) {
          const dict = novel.glossary[cat] || {};
          for (const [eng, rus] of Object.entries(dict)) {
            const termMeta = novel.glossaryMeta?.[eng];
            insertGlossary.run(
              novel.id,
              cat,
              eng,
              rus,
              termMeta ? JSON.stringify(termMeta) : null
            );
          }
        }

        // Chapters & up to 10 snapshots per chapter
        for (const { ch, status, nextRev, cleanChapter } of preparedChapters) {
          insertChapter.run(
            ch.id,
            novel.id,
            ch.number,
            ch.subPart || null,
            status,
            nextRev,
            JSON.stringify(cleanChapter),
            ch.qaSummary ? JSON.stringify(ch.qaSummary) : null,
            ch.lastUpdated || nextUpdatedAt
          );

          const snapshots = Array.isArray(ch.versionHistory)
            ? ch.versionHistory.slice(-10)
            : [];
          for (const snap of snapshots) {
            insertSnapshot.run(
              `${ch.id}::${snap.id}`,
              ch.id,
              novel.id,
              snap.stageLabel || 'snapshot',
              snap.timestamp || nextUpdatedAt,
              JSON.stringify(snap)
            );
          }
        }
      });

      this.setMeta('updatedAt', nextUpdatedAt);
    });
  }

  public readAllNovels(options?: { includeSnapshots?: boolean }): {
    novels: NovelProject[];
    updatedAt: string | null;
    version: string;
    diskPath: string;
  } {
    this.syncFromJsonIfNeeded();
    const includeSnapshots = options?.includeSnapshots !== false;

    const novelRows = this.db
      .prepare('SELECT id, metadata_json, revision FROM novels ORDER BY sort_order ASC')
      .all();
    const updatedAt = this.getMeta('updatedAt');

    if (novelRows.length === 0) {
      return {
        novels: [],
        updatedAt,
        version: '4.1-kanon-xianxia',
        diskPath: this.sqlitePath,
      };
    }

    const snapshotsByChapter = new Map<string, ChapterVersionSnapshot[]>();
    if (includeSnapshots) {
      const snapRows = this.db
        .prepare('SELECT chapter_id, snapshot_json FROM chapter_snapshots ORDER BY rowid ASC')
        .all();
      for (const row of snapRows) {
        if (typeof row.chapter_id !== 'string' || typeof row.snapshot_json !== 'string') continue;
        const parsedSnap = JSON.parse(row.snapshot_json) as ChapterVersionSnapshot;
        const list = snapshotsByChapter.get(row.chapter_id) || [];
        list.push(parsedSnap);
        snapshotsByChapter.set(row.chapter_id, list);
      }
    }

    const selectChapters = this.db.prepare(
      'SELECT id, chapter_json, qa_summary_json, status, revision FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC, COALESCE(sub_part, \'\') ASC'
    );

    const novels: NovelProject[] = novelRows.map((row) => {
      const novel = JSON.parse(String(row.metadata_json)) as NovelProject;
      const chRows = selectChapters.all(String(row.id));
      novel.chapters = chRows.map((chRow) => {
        const ch = JSON.parse(String(chRow.chapter_json)) as ChapterRecord;
        ch.status = (chRow.status as ChapterStatus) || deriveChapterStatus(ch);
        ch.revision = Number(chRow.revision || ch.revision || 1);
        if (typeof chRow.qa_summary_json === 'string' && chRow.qa_summary_json) {
          ch.qaSummary = JSON.parse(chRow.qa_summary_json) as ChapterQaSummary;
        }
        if (includeSnapshots) {
          const snaps = snapshotsByChapter.get(ch.id);
          if (snaps && snaps.length > 0) {
            ch.versionHistory = snaps.slice(-10);
          }
        }
        return ch;
      });
      return novel;
    });

    return {
      novels,
      updatedAt,
      version: '4.1-kanon-xianxia',
      diskPath: this.sqlitePath,
    };
  }

  public writeAllNovels(
    novels: NovelProject[],
    options?: {
      baseUpdatedAt?: string | null;
      syncJsonMirror?: boolean;
    }
  ): {
    updatedAt: string;
    savedCount: number;
    diskPath: string;
  } {
    this.syncFromJsonIfNeeded();
    const currentUpdatedAt = this.getMeta('updatedAt');

    if (
      typeof options?.baseUpdatedAt === 'string' &&
      options.baseUpdatedAt.length > 0 &&
      currentUpdatedAt !== null &&
      currentUpdatedAt !== options.baseUpdatedAt
    ) {
      throw new DiskDatabaseConflictError(currentUpdatedAt, options.baseUpdatedAt);
    }

    const nextUpdatedAt = nextMonotonicIsoTimestamp(currentUpdatedAt);
    this.writeAllNovelsInternal(novels, nextUpdatedAt, true);

    if (options?.syncJsonMirror !== false) {
      this.flushJsonMirrorSync(novels, nextUpdatedAt);
    }

    return {
      updatedAt: nextUpdatedAt,
      savedCount: novels.length,
      diskPath: this.sqlitePath,
    };
  }

  /**
   * Row-level Optimistic Concurrency Control on a single chapter:
   * updates ONLY the affected chapter row (`WHERE id = ? AND novel_id = ? AND revision = ?`),
   * persists capped snapshots, and schedules JSON mirror sync without rewriting the whole book per keystroke.
   */
  public patchChapterAtomic(
    novelId: string,
    chapterId: string,
    mutator: (current: ChapterRecord) => ChapterRecord,
    options?: {
      expectedRevision?: number;
      syncJsonMirror?: 'sync' | 'debounced' | 'none';
    }
  ): {
    chapter: ChapterRecord;
    revision: number;
    updatedAt: string;
  } {
    this.syncFromJsonIfNeeded();
    const currentUpdatedAt = this.getMeta('updatedAt');
    const nextUpdatedAt = nextMonotonicIsoTimestamp(currentUpdatedAt);

    const updated = this.runInTransaction(() => {
      const row = this.db
        .prepare('SELECT chapter_json, revision, qa_summary_json FROM chapters WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId);

      if (!row) {
        throw new Error(`Chapter ${chapterId} in novel ${novelId} not found`);
      }

      const currentRev = Number(row.revision || 1);
      if (
        typeof options?.expectedRevision === 'number' &&
        Number.isFinite(options.expectedRevision) &&
        options.expectedRevision !== currentRev
      ) {
        throw new DiskDatabaseConflictError(currentUpdatedAt, null, {
          expectedRevision: options.expectedRevision,
          currentRevision: currentRev,
          message: `Chapter ${chapterId} revision conflict: expected ${options.expectedRevision}, actual ${currentRev}`,
        });
      }

      const currentChapter = JSON.parse(String(row.chapter_json)) as ChapterRecord;
      currentChapter.revision = currentRev;
      if (typeof row.qa_summary_json === 'string' && row.qa_summary_json) {
        currentChapter.qaSummary = JSON.parse(row.qa_summary_json) as ChapterQaSummary;
      }

      const snapRows = this.db
        .prepare('SELECT snapshot_json FROM chapter_snapshots WHERE chapter_id = ? AND novel_id = ? ORDER BY rowid ASC')
        .all(chapterId, novelId);
      if (snapRows.length > 0) {
        currentChapter.versionHistory = snapRows.map((s) =>
          JSON.parse(String(s.snapshot_json)) as ChapterVersionSnapshot
        );
      }

      const nextChapterRaw = mutator(currentChapter);
      const nextRev = currentRev + 1;
      const nextStatus = deriveChapterStatus(nextChapterRaw);
      const cleanChapter: ChapterRecord = {
        ...stripSnapshotsFromChapter(nextChapterRaw),
        status: nextStatus,
        revision: nextRev,
      };

      const res = this.db
        .prepare(`
          UPDATE chapters
          SET chapter_number = ?, sub_part = ?, status = ?, revision = ?, chapter_json = ?, qa_summary_json = ?, updated_at = ?
          WHERE id = ? AND novel_id = ? AND revision = ?
        `)
        .run(
          cleanChapter.number,
          cleanChapter.subPart || null,
          nextStatus,
          nextRev,
          JSON.stringify(cleanChapter),
          cleanChapter.qaSummary ? JSON.stringify(cleanChapter.qaSummary) : null,
          cleanChapter.lastUpdated || nextUpdatedAt,
          chapterId,
          novelId,
          currentRev
        );

      if (Number(res.changes) !== 1) {
        throw new DiskDatabaseConflictError(currentUpdatedAt, null, {
          expectedRevision: currentRev,
          message: `Concurrent chapter modification on ${chapterId}`,
        });
      }

      const snapshots = Array.isArray(nextChapterRaw.versionHistory)
        ? nextChapterRaw.versionHistory.slice(-10)
        : currentChapter.versionHistory || [];
      if (snapshots.length > 0) {
        this.db
          .prepare('DELETE FROM chapter_snapshots WHERE chapter_id = ? AND novel_id = ?')
          .run(chapterId, novelId);
        const insSnap = this.db.prepare(
          'INSERT INTO chapter_snapshots(id, chapter_id, novel_id, label, created_at, snapshot_json) VALUES(?, ?, ?, ?, ?, ?)'
        );
        for (const snap of snapshots) {
          insSnap.run(
            `${chapterId}::${snap.id}`,
            chapterId,
            novelId,
            snap.stageLabel || 'snapshot',
            snap.timestamp || nextUpdatedAt,
            JSON.stringify(snap)
          );
        }
      }

      this.db
        .prepare('UPDATE novels SET updated_at = ?, revision = revision + 1 WHERE id = ?')
        .run(nextUpdatedAt, novelId);
      this.setMeta('updatedAt', nextUpdatedAt);

      return {
        chapter: {
          ...cleanChapter,
          ...(snapshots.length > 0 ? { versionHistory: snapshots } : {}),
        },
        revision: nextRev,
        updatedAt: nextUpdatedAt,
      };
    });

    const mirrorMode = options?.syncJsonMirror || 'debounced';
    if (mirrorMode === 'sync') {
      const full = this.readAllNovels({ includeSnapshots: true });
      this.flushJsonMirrorSync(full.novels, nextUpdatedAt);
    } else if (mirrorMode === 'debounced') {
      this.scheduleDebouncedJsonMirror();
    }

    return updated;
  }

  public commitBatchNovelResult(params: {
    novelId: string;
    updatedNovel: NovelProject;
    targetChapterIds: ReadonlySet<string>;
    initialChapterRevisions: ReadonlyMap<string, number>;
    committedChapterRevisions: ReadonlyMap<string, number>;
    conflictedChapterIds: ReadonlySet<string>;
    syncJsonMirror?: boolean;
  }): void {
    const processedMap = new Map(
      params.updatedNovel.chapters
        .filter((ch) => params.targetChapterIds.has(ch.id))
        .map((ch) => [ch.id, ch])
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = this.readAllNovels({ includeSnapshots: true });
      const baseNovels =
        latest.novels.length > 0 ? latest.novels : [params.updatedNovel];
      const mergedNovels = baseNovels.map((n) => {
        if (n.id !== params.novelId) return n;
        return {
          ...n,
          glossary: params.updatedNovel.glossary,
          glossaryMeta: params.updatedNovel.glossaryMeta,
          scoutedTerms: params.updatedNovel.scoutedTerms,
          heroLedger: params.updatedNovel.heroLedger,
          chapters: n.chapters.map((ch) => {
            if (!processedMap.has(ch.id) || params.conflictedChapterIds.has(ch.id)) {
              return ch;
            }
            if (params.committedChapterRevisions.has(ch.id)) {
              // patchChapterAtomic already persisted this chapter; preserve any newer user PATCH in SQLite
              return ch;
            }
            const initialRev = params.initialChapterRevisions.get(ch.id) ?? 1;
            const currentRev = ch.revision ?? 1;
            if (currentRev !== initialRev) {
              return ch;
            }
            return { ...processedMap.get(ch.id)!, revision: currentRev };
          }),
        };
      });

      try {
        this.writeAllNovels(mergedNovels, {
          baseUpdatedAt: latest.updatedAt,
          syncJsonMirror: params.syncJsonMirror ?? true,
        });
        return;
      } catch (err) {
        if (err instanceof DiskDatabaseConflictError && attempt < 2) {
          continue;
        }
        throw err;
      }
    }
  }

  public getChapterById(
    novelId: string,
    chapterId: string
  ): { chapter: ChapterRecord; updatedAt: string | null } | null {
    this.syncFromJsonIfNeeded();
    const row = this.db
      .prepare(
        'SELECT chapter_json, qa_summary_json, status, revision FROM chapters WHERE id = ? AND novel_id = ?'
      )
      .get(chapterId, novelId);
    if (!row) return null;

    const ch = JSON.parse(String(row.chapter_json)) as ChapterRecord;
    ch.status = (row.status as ChapterStatus) || deriveChapterStatus(ch);
    ch.revision = Number(row.revision || ch.revision || 1);
    if (typeof row.qa_summary_json === 'string' && row.qa_summary_json) {
      ch.qaSummary = JSON.parse(row.qa_summary_json) as ChapterQaSummary;
    }

    const snapRows = this.db
      .prepare(
        'SELECT snapshot_json FROM chapter_snapshots WHERE novel_id = ? AND chapter_id = ? ORDER BY rowid ASC'
      )
      .all(novelId, chapterId);
    if (snapRows.length > 0) {
      ch.versionHistory = snapRows
        .map((s) => JSON.parse(String(s.snapshot_json)) as ChapterVersionSnapshot)
        .slice(-10);
    }

    return {
      chapter: ch,
      updatedAt: this.getMeta('updatedAt'),
    };
  }

  public listChapterSnapshots(novelId: string, chapterId: string): ChapterVersionSnapshot[] {
    this.ensureOpen();
    const rows = this.db
      .prepare('SELECT snapshot_json FROM chapter_snapshots WHERE novel_id = ? AND chapter_id = ? ORDER BY rowid DESC')
      .all(novelId, chapterId);
    return rows.map((r) => JSON.parse(String(r.snapshot_json)) as ChapterVersionSnapshot);
  }

  // ============================================================================
  // PIPELINE JOBS PERSISTENCE
  // ============================================================================

  public upsertPipelineJob(job: PipelineJobRecord): void {
    this.ensureOpen();
    this.db
      .prepare(`
        INSERT INTO pipeline_jobs(
          id, novel_id, mode, status, start_chapter, end_chapter,
          progress_pct, current_chapter, completed_chapters, total_chapters,
          quarantined_chapters, owner_pid, stats_json, error_text, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          progress_pct = excluded.progress_pct,
          current_chapter = excluded.current_chapter,
          completed_chapters = excluded.completed_chapters,
          total_chapters = excluded.total_chapters,
          quarantined_chapters = excluded.quarantined_chapters,
          owner_pid = excluded.owner_pid,
          stats_json = excluded.stats_json,
          error_text = excluded.error_text,
          updated_at = excluded.updated_at
      `)
      .run(
        job.id,
        job.novelId,
        job.mode,
        job.status,
        job.startChapter,
        job.endChapter,
        job.progressPct,
        job.currentChapter,
        job.completedChapters,
        job.totalChapters,
        job.quarantinedChapters,
        job.ownerPid ?? null,
        job.statsJson || null,
        job.errorText || null,
        job.createdAt,
        job.updatedAt
      );
  }

  public getPipelineJob(jobId: string): PipelineJobRecord | null {
    this.ensureOpen();
    const row = this.db.prepare('SELECT * FROM pipeline_jobs WHERE id = ?').get(jobId);
    if (!row) return null;
    return this.mapJobRow(row);
  }

  public listPipelineJobs(limit = 25): PipelineJobRecord[] {
    this.ensureOpen();
    const rows = this.db
      .prepare('SELECT * FROM pipeline_jobs ORDER BY updated_at DESC LIMIT ?')
      .all(limit);
    return rows.map((r) => this.mapJobRow(r));
  }

  public findActiveJobForNovel(
    novelId: string,
    options?: {
      excludeJobId?: string;
      staleAfterMs?: number;
      reconcileSamePidOrphans?: boolean;
      activeSamePidJobIds?: ReadonlySet<string>;
    }
  ): PipelineJobRecord | null {
    this.ensureOpen();
    const staleAfterMs = options?.staleAfterMs ?? 15 * 60_000;
    const rows = this.db
      .prepare(
        "SELECT * FROM pipeline_jobs WHERE novel_id = ? AND status IN ('running', 'queued') ORDER BY updated_at DESC"
      )
      .all(novelId);

    for (const row of rows) {
      const job = this.mapJobRow(row);
      if (options?.excludeJobId && job.id === options.excludeJobId) {
        continue;
      }

      if (typeof job.ownerPid === 'number' && job.ownerPid > 0) {
        if (job.ownerPid === process.pid) {
          const isKnownActiveHere = options?.activeSamePidJobIds?.has(job.id) ?? false;
          if (!isKnownActiveHere && options?.reconcileSamePidOrphans) {
            this.upsertPipelineJob({
              ...job,
              status: 'failed',
              errorText:
                job.errorText ||
                'Сервер или процесс задачи с тем же PID был перезапущен до завершения фоновой задачи.',
              updatedAt: nextMonotonicIsoTimestamp(job.updatedAt),
            });
            continue;
          }
          return job;
        }
        if (isProcessPidAlive(job.ownerPid)) {
          return job;
        }
        this.upsertPipelineJob({
          ...job,
          status: 'failed',
          errorText:
            job.errorText ||
            `Процесс задачи (PID ${job.ownerPid}) завершился аварийно.`,
          updatedAt: nextMonotonicIsoTimestamp(job.updatedAt),
        });
        continue;
      }

      const ageMs = Date.now() - Date.parse(job.updatedAt);
      if (Number.isFinite(ageMs) && ageMs > staleAfterMs) {
        this.upsertPipelineJob({
          ...job,
          status: 'failed',
          errorText:
            job.errorText ||
            'Фоновая задача без активного владельца устарела и была помечена как прерванная.',
          updatedAt: nextMonotonicIsoTimestamp(job.updatedAt),
        });
        continue;
      }

      return job;
    }

    return null;
  }

  private mapJobRow(row: Record<string, unknown>): PipelineJobRecord {
    return {
      id: String(row.id),
      novelId: String(row.novel_id),
      mode: String(row.mode) as PipelineJobMode,
      status: String(row.status) as PipelineJobStatus,
      startChapter: Number(row.start_chapter),
      endChapter: Number(row.end_chapter),
      progressPct: Number(row.progress_pct || 0),
      currentChapter: row.current_chapter === null || row.current_chapter === undefined ? null : Number(row.current_chapter),
      completedChapters: Number(row.completed_chapters || 0),
      totalChapters: Number(row.total_chapters || 0),
      quarantinedChapters: Number(row.quarantined_chapters || 0),
      ownerPid:
        row.owner_pid === null || row.owner_pid === undefined
          ? null
          : Number(row.owner_pid),
      statsJson: typeof row.stats_json === 'string' ? row.stats_json : null,
      errorText: typeof row.error_text === 'string' ? row.error_text : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  public enqueueAsyncJsonMirror(): Promise<void> {
    if (!this.jsonMirrorPath || this.closed) return Promise.resolve();
    if (this.mirrorFlushTimer) {
      clearTimeout(this.mirrorFlushTimer);
      this.mirrorFlushTimer = null;
    }

    const mirrorPath = this.jsonMirrorPath;
    const task = this.asyncMirrorChain
      .catch(() => {})
      .then(async () => {
        if (this.closed) return;
        const full = this.readAllNovels({ includeSnapshots: true });
        const payloadTs =
          full.updatedAt || this.getMeta('updatedAt') || new Date().toISOString();
        const serialized = serializeDiskDatabasePayload(full.novels, payloadTs);
        await atomicWriteFileAsync(mirrorPath, serialized);
        const stat = await fsp.stat(mirrorPath);
        const mtimeMs = Math.round(stat.mtimeMs);
        this.lastInternalMirrorWriteMs = mtimeMs;
        if (!this.closed) {
          this.setMeta('sourceJsonMtimeMs', String(mtimeMs));
        }
      });

    this.asyncMirrorChain = task;
    return task;
  }

  public flushJsonMirrorSync(novels?: NovelProject[], updatedAt?: string): void {
    if (!this.jsonMirrorPath || this.closed) return;
    if (this.mirrorFlushTimer) {
      clearTimeout(this.mirrorFlushTimer);
      this.mirrorFlushTimer = null;
    }
    const payloadNovels = novels || this.readAllNovels({ includeSnapshots: true }).novels;
    const payloadTs = updatedAt || this.getMeta('updatedAt') || new Date().toISOString();
    const serialized = serializeDiskDatabasePayload(payloadNovels, payloadTs);
    atomicWriteFileSync(this.jsonMirrorPath, serialized);
    const stat = fs.statSync(this.jsonMirrorPath);
    const mtimeMs = Math.round(stat.mtimeMs);
    this.lastInternalMirrorWriteMs = mtimeMs;
    this.setMeta('sourceJsonMtimeMs', String(mtimeMs));
  }

  private scheduleDebouncedJsonMirror(): void {
    if (!this.jsonMirrorPath || this.closed) return;
    if (this.mirrorFlushTimer) {
      clearTimeout(this.mirrorFlushTimer);
    }
    this.mirrorFlushTimer = setTimeout(() => {
      this.mirrorFlushTimer = null;
      if (!this.closed) {
        try {
          this.flushJsonMirrorSync();
        } catch {
          // Best-effort background mirror
        }
      }
    }, 350);
    if (typeof this.mirrorFlushTimer.unref === 'function') {
      this.mirrorFlushTimer.unref();
    }
  }

  public close(): void {
    if (this.closed) return;
    if (this.mirrorFlushTimer) {
      clearTimeout(this.mirrorFlushTimer);
      this.mirrorFlushTimer = null;
      try {
        this.flushJsonMirrorSync();
      } catch {
        // Best-effort flush before closing DB handle
      }
    }
    this.closed = true;
    this.db.close();
  }
}

const openInstances = new Map<string, StudioSqliteDatabase>();

export function getStudioSqliteDb(options?: StudioSqliteOptions): StudioSqliteDatabase {
  const key = path.resolve(options?.sqlitePath || DEFAULT_SQLITE_DB_PATH);
  let instance = openInstances.get(key);
  if (!instance) {
    instance = new StudioSqliteDatabase(options);
    openInstances.set(key, instance);
  }
  return instance;
}

export function closeStudioSqliteDb(sqlitePath: string = DEFAULT_SQLITE_DB_PATH): void {
  const key = path.resolve(sqlitePath);
  const instance = openInstances.get(key);
  if (instance) {
    instance.close();
    openInstances.delete(key);
  }
}

export function closeAllStudioSqliteDbs(): void {
  for (const instance of openInstances.values()) {
    instance.close();
  }
  openInstances.clear();
}

export async function readSqliteDatabaseAsync(options?: StudioSqliteOptions): Promise<{
  novels: NovelProject[];
  updatedAt: string | null;
  version: string;
  diskPath: string;
}> {
  return getStudioSqliteDb(options).readAllNovels({ includeSnapshots: true });
}

export async function writeSqliteDatabaseAtomicAsync(
  novels: NovelProject[],
  options?: StudioSqliteOptions & {
    baseUpdatedAt?: string | null;
    syncJsonMirror?: boolean;
  }
): Promise<{
  updatedAt: string;
  savedCount: number;
  diskPath: string;
}> {
  const db = getStudioSqliteDb(options);
  const res = db.writeAllNovels(novels, {
    baseUpdatedAt: options?.baseUpdatedAt,
    syncJsonMirror: false,
  });
  if (options?.syncJsonMirror !== false && db.jsonMirrorPath) {
    await db.enqueueAsyncJsonMirror();
  }
  return res;
}
