import { NextRequest, NextResponse } from 'next/server';
import { getStudioJobBroker } from '@/lib/job-broker';
import { verifyStudioApiRequest } from '@/lib/api-security';
import type { PipelineJobEvent } from '@/lib/pipeline-types';

export const dynamic = 'force-dynamic';

const SSE_HEARTBEAT_MS = 15_000;
const TERMINAL_EVENT_TYPES = new Set<PipelineJobEvent['type']>([
  'completed',
  'failed',
  'cancelled',
]);

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = verifyStudioApiRequest(req, { requireMutationOrigin: false });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Unauthorized' },
      { status: auth.status }
    );
  }

  const { id: jobId } = await context.params;
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'Не указан ID задачи' },
      { status: 400 }
    );
  }

  const broker = getStudioJobBroker();
  const encoder = new TextEncoder();
  let cleanupRef: (() => void) | null = null;

  const initialCheck = broker.getJob(jobId);
  if (!initialCheck) {
    return NextResponse.json(
      { ok: false, error: `Задача ${jobId} не найдена` },
      { status: 404 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let unsubscribeFn = () => {};

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        unsubscribeFn();
        req.signal.removeEventListener('abort', cleanup);
        try {
          controller.close();
        } catch {
          // Ignore double close
        }
      };
      cleanupRef = cleanup;

      const enqueueEvent = (evt: PipelineJobEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const subscription = broker.subscribe(jobId, (evt) => {
        enqueueEvent(evt);
        if (TERMINAL_EVENT_TYPES.has(evt.type)) {
          cleanup();
        }
      });
      unsubscribeFn = subscription.unsubscribe;

      const currentJob = subscription.job ?? initialCheck;
      const snapshotEvent: PipelineJobEvent = {
        type: 'snapshot',
        jobId,
        timestamp: new Date().toISOString(),
        progressPct: currentJob.progressPct,
        chapterNumber: currentJob.currentChapter ?? undefined,
        message: `Подключено к задаче ${jobId} (${currentJob.status})`,
        job: currentJob,
      };
      enqueueEvent(snapshotEvent);

      for (const pastEvent of subscription.history) {
        if (pastEvent.type === 'snapshot') continue;
        enqueueEvent(pastEvent);
      }

      if (
        currentJob.status === 'completed' ||
        currentJob.status === 'failed' ||
        currentJob.status === 'cancelled'
      ) {
        const hasTerminalHistory = subscription.history.some((e) =>
          TERMINAL_EVENT_TYPES.has(e.type)
        );
        if (!hasTerminalHistory) {
          enqueueEvent({
            type: currentJob.status,
            jobId,
            timestamp: currentJob.updatedAt,
            progressPct: currentJob.progressPct,
            message: currentJob.errorText || `Задача в статусе ${currentJob.status}`,
            job: currentJob,
          });
        }
        cleanup();
        return;
      }

      heartbeatTimer = setInterval(() => {
        const latest = broker.getJob(jobId);
        enqueueEvent({
          type: 'heartbeat',
          jobId,
          timestamp: new Date().toISOString(),
          progressPct: latest?.progressPct ?? currentJob.progressPct,
          chapterNumber: latest?.currentChapter ?? undefined,
        });
      }, SSE_HEARTBEAT_MS);

      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      cleanupRef?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
