import { NextRequest, NextResponse } from 'next/server';
import { getStudioJobBroker } from '@/lib/job-broker';
import {
  sanitizeClientLlmConfig,
  verifyStudioApiRequest,
} from '@/lib/api-security';
import type { LlmProviderConfig, PipelineJobMode } from '@/lib/pipeline-types';

export async function GET(req: NextRequest) {
  const auth = verifyStudioApiRequest(req, { requireMutationOrigin: false });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Unauthorized' },
      { status: auth.status }
    );
  }

  const broker = getStudioJobBroker();
  const { searchParams } = new URL(req.url);
  const jobId = (searchParams.get('jobId') || '').trim();
  const novelId = (searchParams.get('novelId') || '').trim() || undefined;

  if (jobId) {
    const job = broker.getJob(jobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, error: `Задача ${jobId} не найдена` },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, job });
  }

  const jobs = broker.listJobs(novelId);
  return NextResponse.json({ ok: true, jobs });
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
    const safeLlmConfig = sanitizeClientLlmConfig(
      body?.llmConfig as Partial<LlmProviderConfig> | undefined,
      auth
    );

    const broker = getStudioJobBroker();
    const started = broker.startJob({
      novelId: typeof body?.novelId === 'string' ? body.novelId : '',
      targetChapterIds: Array.isArray(body?.targetChapterIds)
        ? body.targetChapterIds.filter((id: unknown): id is string => typeof id === 'string')
        : undefined,
      startChapter:
        typeof body?.startChapter === 'number' && Number.isFinite(body.startChapter)
          ? body.startChapter
          : undefined,
      endChapter:
        typeof body?.endChapter === 'number' && Number.isFinite(body.endChapter)
          ? body.endChapter
          : undefined,
      mode: body?.mode as PipelineJobMode | undefined,
      autoCanonEnabled:
        typeof body?.autoCanonEnabled === 'boolean' ? body.autoCanonEnabled : true,
      twoPassCriticEnabled:
        typeof body?.twoPassCriticEnabled === 'boolean'
          ? body.twoPassCriticEnabled
          : true,
      llmConfig: safeLlmConfig,
    });

    if (!started.ok) {
      return NextResponse.json(
        { ok: false, error: started.error },
        { status: started.status }
      );
    }

    return NextResponse.json({ ok: true, job: started.job });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start background job';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = verifyStudioApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Unauthorized' },
      { status: auth.status }
    );
  }

  const { searchParams } = new URL(req.url);
  let jobId = (searchParams.get('jobId') || '').trim();
  if (!jobId) {
    try {
      const body = await req.json();
      if (typeof body?.jobId === 'string') {
        jobId = body.jobId.trim();
      }
    } catch {
      // Ignore empty body on DELETE
    }
  }

  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'Не указан jobId для отмены задачи' },
      { status: 400 }
    );
  }

  const cancelled = getStudioJobBroker().cancelJob(jobId);
  if (!cancelled) {
    return NextResponse.json(
      { ok: false, error: `Задача ${jobId} не найдена` },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, job: cancelled });
}
