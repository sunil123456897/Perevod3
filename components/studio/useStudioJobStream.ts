'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PipelineJobEvent, PipelineJobRecord } from '@/lib/pipeline-types';
import type { NovelProject } from '@/lib/seed-data';
import {
  defaultProjectRepository,
  fetchChapterFromServer,
} from '@/lib/storage-idb';

interface ToastLike {
  error: (message: string, title?: string) => void;
  warn: (message: string, title?: string) => void;
}

interface UseStudioJobStreamParams {
  novelsRef: MutableRefObject<NovelProject[]>;
  skipNextAutosaveRef: MutableRefObject<boolean>;
  setNovels: Dispatch<SetStateAction<NovelProject[]>>;
  setActiveJob: Dispatch<SetStateAction<PipelineJobRecord | null>>;
  setRunningChapterId: Dispatch<SetStateAction<string | null>>;
  setActivePhaseStep: Dispatch<SetStateAction<number>>;
  setIsRunningPipeline: Dispatch<SetStateAction<boolean>>;
  appendLog: (phase: string, message: string, level?: 'info' | 'success' | 'warn') => void;
  parsePhaseStepFromEvent: (phase?: string) => number;
  toast: ToastLike;
}

export function useStudioJobStream({
  novelsRef,
  skipNextAutosaveRef,
  setNovels,
  setActiveJob,
  setRunningChapterId,
  setActivePhaseStep,
  setIsRunningPipeline,
  appendLog,
  parsePhaseStepFromEvent,
  toast,
}: UseStudioJobStreamParams) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const jobWaitersRef = useRef<Array<(novel: NovelProject | null) => void>>([]);

  const refreshProjectsFromServer = useCallback(async (): Promise<NovelProject[] | null> => {
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data?.ok || !Array.isArray(data.novels) || data.novels.length === 0) {
        return null;
      }
      if (typeof data.updatedAt === 'string') {
        defaultProjectRepository.lastKnownDiskUpdatedAt = data.updatedAt;
      }
      skipNextAutosaveRef.current = true;
      setNovels(data.novels as NovelProject[]);
      return data.novels as NovelProject[];
    } catch {
      return null;
    }
  }, [setNovels, skipNextAutosaveRef]);

  const syncSingleChapterFromServer = useCallback(
    async (novelId: string, chapterId?: string): Promise<boolean> => {
      if (!chapterId) return false;
      const fetched = await fetchChapterFromServer(novelId, chapterId);
      if (!fetched.ok || !fetched.chapter) return false;
      const syncedChapter = fetched.chapter;
      skipNextAutosaveRef.current = true;
      setNovels((prev) =>
        prev.map((n) =>
          n.id === novelId
            ? {
                ...n,
                chapters: n.chapters.map((c) =>
                  c.id === syncedChapter.id ? syncedChapter : c
                ),
              }
            : n
        )
      );
      return true;
    },
    [setNovels, skipNextAutosaveRef]
  );

  const closeActiveEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        // Ignore close errors
      }
      eventSourceRef.current = null;
    }
  }, []);

  const resolveJobWaiters = useCallback((novel: NovelProject | null) => {
    if (jobWaitersRef.current.length === 0) return;
    const waiters = jobWaitersRef.current.splice(0, jobWaitersRef.current.length);
    waiters.forEach((resolve) => resolve(novel));
  }, []);

  const subscribeToJobEvents = useCallback(
    (jobId: string, expectedNovelId: string) => {
      closeActiveEventSource();
      if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
        resolveJobWaiters(null);
        return;
      }

      const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
      eventSourceRef.current = es;
      let settled = false;

      const finishJobStream = async (
        terminalType: 'completed' | 'failed' | 'cancelled',
        message?: string
      ) => {
        if (settled) return;
        settled = true;
        closeActiveEventSource();
        const freshNovels = await refreshProjectsFromServer();
        const updatedNovel =
          (freshNovels || novelsRef.current).find((n) => n.id === expectedNovelId) || null;
        setActiveJob(null);
        setRunningChapterId(null);
        setActivePhaseStep(0);
        setIsRunningPipeline(false);
        if (terminalType === 'completed') {
          appendLog('ГОТОВО', message || 'Фоновая задача перевода завершена.', 'success');
        } else if (terminalType === 'cancelled') {
          appendLog('СТОП', message || 'Фоновая задача отменена.', 'warn');
        } else {
          appendLog('ОШИБКА', message || 'Фоновая задача завершилась с ошибкой.', 'warn');
          if (message) {
            toast.error(message, 'Ошибка фоновой задачи');
          }
        }
        resolveJobWaiters(updatedNovel);
      };

      es.onmessage = async (msg) => {
        let evt: PipelineJobEvent | null = null;
        try {
          evt = JSON.parse(msg.data) as PipelineJobEvent;
        } catch {
          return;
        }
        if (!evt) return;

        if (evt.job) {
          setActiveJob(evt.job);
        }

        const step = parsePhaseStepFromEvent(evt.phase);
        if (step > 0) {
          setActivePhaseStep(step);
        }

        if (evt.chapterId) {
          setRunningChapterId(evt.chapterId);
        } else if (typeof evt.chapterNumber === 'number') {
          const currentNovel = novelsRef.current.find((n) => n.id === expectedNovelId);
          const matchingCh = currentNovel?.chapters.find(
            (c) => c.number === evt.chapterNumber
          );
          if (matchingCh) {
            setRunningChapterId(matchingCh.id);
          }
        }

        switch (evt.type) {
          case 'snapshot': {
            if (evt.job && (evt.job.status === 'running' || evt.job.status === 'queued')) {
              setIsRunningPipeline(true);
            }
            break;
          }
          case 'phase': {
            if (evt.message) {
              appendLog(evt.phase || 'ФАЗА', evt.message, 'info');
            }
            break;
          }
          case 'chapter_done': {
            appendLog(
              'ГЛАВА',
              evt.message || `Глава ${evt.chapterNumber ?? ''} завершена.`,
              'success'
            );
            const synced = await syncSingleChapterFromServer(expectedNovelId, evt.chapterId);
            if (!synced) {
              await refreshProjectsFromServer();
            }
            break;
          }
          case 'chapter_quarantined': {
            const qMsg =
              evt.message || `Глава ${evt.chapterNumber ?? ''} помещена в карантин QA.`;
            appendLog('КАРАНТИН', qMsg, 'warn');
            toast.warn(qMsg, 'Карантин главы');
            const synced = await syncSingleChapterFromServer(expectedNovelId, evt.chapterId);
            if (!synced) {
              await refreshProjectsFromServer();
            }
            break;
          }
          case 'completed': {
            await finishJobStream('completed', evt.message);
            break;
          }
          case 'failed': {
            await finishJobStream('failed', evt.message);
            break;
          }
          case 'cancelled': {
            await finishJobStream('cancelled', evt.message);
            break;
          }
          case 'heartbeat':
          default:
            break;
        }
      };

      es.onerror = async () => {
        if (settled) return;
        // Re-check job state before giving up so transient SSE hiccups or closed terminal streams settle cleanly
        try {
          const checkRes = await fetch(
            `/api/jobs?jobId=${encodeURIComponent(jobId)}`,
            { cache: 'no-store' }
          );
          if (checkRes.ok) {
            const checkData = await checkRes.json().catch(() => null);
            const j = checkData?.job as PipelineJobRecord | undefined;
            if (j) {
              if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') {
                await finishJobStream(j.status, j.errorText || undefined);
                return;
              }
              setActiveJob(j);
              return;
            }
          }
        } catch {
          // Ignore network probe error
        }
        if (es.readyState === EventSource.CLOSED) {
          await finishJobStream('failed', 'Поток событий SSE закрыт до завершения задачи.');
        }
      };
    },
    [
      appendLog,
      closeActiveEventSource,
      novelsRef,
      parsePhaseStepFromEvent,
      refreshProjectsFromServer,
      resolveJobWaiters,
      setActiveJob,
      setActivePhaseStep,
      setIsRunningPipeline,
      setRunningChapterId,
      syncSingleChapterFromServer,
      toast,
    ]
  );

  useEffect(() => {
    return () => {
      closeActiveEventSource();
    };
  }, [closeActiveEventSource]);

  return {
    jobWaitersRef,
    refreshProjectsFromServer,
    closeActiveEventSource,
    resolveJobWaiters,
    subscribeToJobEvents,
  };
}
