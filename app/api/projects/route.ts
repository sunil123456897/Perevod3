import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE_PATH = path.join(DATA_DIR, 'novels_db.json');
const TMP_FILE_PATH = path.join(DATA_DIR, 'novels_db.json.tmp');

export async function GET() {
  try {
    const raw = await fs.readFile(DB_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.novels) && parsed.novels.length > 0) {
      return NextResponse.json({
        ok: true,
        novels: parsed.novels,
        updatedAt: parsed.updatedAt || null,
        diskPath: DB_FILE_PATH,
      });
    }
    return NextResponse.json({ ok: true, novels: [], diskPath: DB_FILE_PATH });
  } catch {
    return NextResponse.json({ ok: true, novels: [], diskPath: DB_FILE_PATH });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const novels = body?.novels;
    if (!Array.isArray(novels)) {
      return NextResponse.json(
        { error: 'Ожидался массив проектов novels[]' },
        { status: 400 }
      );
    }

    await fs.mkdir(DATA_DIR, { recursive: true });
    const payload = JSON.stringify(
      {
        version: '4.1-kanon-xianxia',
        updatedAt: new Date().toISOString(),
        novels,
      },
      null,
      2
    );

    // Atomic crash-safe write (tmp -> rename, ported from Perevod_Ready checkpoint.py)
    await fs.writeFile(TMP_FILE_PATH, payload, 'utf-8');
    await fs.rename(TMP_FILE_PATH, DB_FILE_PATH);

    return NextResponse.json({
      ok: true,
      savedCount: novels.length,
      diskPath: DB_FILE_PATH,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown disk write error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
