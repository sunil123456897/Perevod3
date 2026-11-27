import { NextRequest, NextResponse } from 'next/server';
import {
  getStudioSqliteDb,
  readSqliteDatabaseAsync,
  writeSqliteDatabaseAtomicAsync,
  DiskDatabaseConflictError,
} from '@/lib/sqlite-db-server';
import { verifyStudioApiRequest } from '@/lib/api-security';
import type { ChapterRecord } from '@/lib/seed-data';

export async function GET(req: NextRequest) {
  const auth = verifyStudioApiRequest(req, { requireMutationOrigin: false });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Unauthorized' },
      { status: auth.status }
    );
  }

  const { searchParams } = new URL(req.url);
  const novelId = (searchParams.get('novelId') || '').trim();
  const chapterId = (searchParams.get('chapterId') || '').trim();

  if (novelId && chapterId) {
    const found = getStudioSqliteDb().getChapterById(novelId, chapterId);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: `Глава ${chapterId} в новелле ${novelId} не найдена` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      chapter: found.chapter,
      updatedAt: found.updatedAt,
    });
  }

  const result = await readSqliteDatabaseAsync();
  return NextResponse.json({
    ok: true,
    novels: result.novels,
    updatedAt: result.updatedAt,
    diskPath: result.diskPath,
  });
}

export async function POST(req: NextRequest) {
  const auth = verifyStudioApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Unauthorized' },
      { status: auth.status }
    );
  }

  try {
    const body = await req.json();
    const novels = body?.novels;
    const baseUpdatedAt =
      typeof body?.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null;

    if (!Array.isArray(novels)) {
      return NextResponse.json(
        { error: 'Ожидался массив проектов novels[]' },
        { status: 400 }
      );
    }

    const saved = await writeSqliteDatabaseAtomicAsync(novels, { baseUpdatedAt });
    return NextResponse.json({
      ok: true,
      savedCount: saved.savedCount,
      updatedAt: saved.updatedAt,
      diskPath: saved.diskPath,
    });
  } catch (err: unknown) {
    if (err instanceof DiskDatabaseConflictError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'DISK_DB_CONFLICT',
          diskUpdatedAt: err.diskUpdatedAt,
          error:
            'База студии на диске была обновлёна внешним процессом (фоновой задачей или CLI-раннером). Перезапись отменена для защиты прогресса.',
        },
        { status: 409 }
      );
    }
    const msg = err instanceof Error ? err.message : 'Unknown disk write error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = verifyStudioApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Unauthorized' },
      { status: auth.status }
    );
  }

  try {
    const body = await req.json();
    const action = body?.action;
    const novelId = typeof body?.novelId === 'string' ? body.novelId.trim() : '';
    const chapterId = typeof body?.chapterId === 'string' ? body.chapterId.trim() : '';
    const chapterPatch = body?.chapterPatch as Partial<ChapterRecord> | undefined;
    const expectedRevision =
      typeof body?.expectedRevision === 'number' && Number.isFinite(body.expectedRevision)
        ? body.expectedRevision
        : undefined;

    if (
      action !== 'patch_chapter' ||
      !novelId ||
      !chapterId ||
      !chapterPatch ||
      typeof chapterPatch !== 'object' ||
      Array.isArray(chapterPatch)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Ожидались action: "patch_chapter", novelId, chapterId и объект chapterPatch.',
        },
        { status: 400 }
      );
    }

    const sanitizedPatch: Partial<ChapterRecord> = { ...chapterPatch };
    delete sanitizedPatch.revision;

    const result = getStudioSqliteDb().patchChapterAtomic(
      novelId,
      chapterId,
      (current) => ({
        ...current,
        ...sanitizedPatch,
        id: current.id,
      }),
      {
        expectedRevision,
        syncJsonMirror: 'debounced',
      }
    );

    return NextResponse.json({
      ok: true,
      chapter: result.chapter,
      revision: result.revision,
      updatedAt: result.updatedAt,
    });
  } catch (err: unknown) {
    if (err instanceof DiskDatabaseConflictError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'DISK_DB_CONFLICT',
          diskUpdatedAt: err.diskUpdatedAt,
          expectedRevision: err.expectedRevision,
          currentRevision: err.currentRevision,
          error: err.message,
        },
        { status: 409 }
      );
    }
    const msg = err instanceof Error ? err.message : 'Unknown chapter patch error';
    const status = /not found/i.test(msg) ? 404 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
