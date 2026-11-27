'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warn' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warn' | 'info';
  title?: string;
  message: string;
  durationMs?: number;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string, title?: string, durationMs?: number) => void;
  dismissToast: (id: string) => void;
  removeToast: (id: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warn: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, title?: string, durationMs = 3800) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const normalizedType: ToastItem['type'] = type === 'warning' ? 'warn' : type;
      const item: ToastItem = { id, type: normalizedType, message, title, durationMs };

      setToasts((prev) => [...prev.slice(-4), item]);

      if (durationMs > 0) {
        const timer = setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => {
            const next = prev.filter((t) => t.id !== id);
            return next.length === prev.length ? prev : next;
          });
        }, durationMs);
        timersRef.current.set(id, timer);
      }
    },
    []
  );

  const success = useCallback(
    (message: string, title?: string) => addToast('success', message, title),
    [addToast]
  );
  const error = useCallback(
    (message: string, title?: string) => addToast('error', message, title, 5000),
    [addToast]
  );
  const warn = useCallback(
    (message: string, title?: string) => addToast('warn', message, title, 4500),
    [addToast]
  );
  const info = useCallback(
    (message: string, title?: string) => addToast('info', message, title),
    [addToast]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      addToast,
      dismissToast,
      removeToast: dismissToast,
      success,
      error,
      warn,
      warning: warn,
      info,
    }),
    [addToast, dismissToast, success, error, warn, info]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => {
          const isSuccess = t.type === 'success';
          const isError = t.type === 'error';
          const isWarn = t.type === 'warn';

          const surfaceColor = isSuccess
            ? 'border-emerald-500/35 bg-[#1B1B21]/95 text-[#F2EFE9]'
            : isError
              ? 'border-rose-500/45 bg-[#1B1B21]/95 text-[#F2EFE9]'
              : isWarn
                ? 'border-[#D69E36]/45 bg-[#1B1B21]/95 text-[#F2EFE9]'
                : 'border-[#F2EFE9]/[0.14] bg-[#1B1B21]/95 text-[#F2EFE9]';

          const IconComponent = isSuccess
            ? CheckCircle2
            : isError
              ? XCircle
              : isWarn
                ? AlertTriangle
                : Info;

          const iconColor = isSuccess
            ? 'text-[#6EE7B7]'
            : isError
              ? 'text-[#FDA4AF]'
              : isWarn
                ? 'text-[#E3AE48]'
                : 'text-[#B8B4AC]';

          return (
            <div
              key={t.id}
              role={isError ? 'alert' : 'status'}
              aria-live={isError ? 'assertive' : 'polite'}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 backdrop-blur-md shadow-[0_18px_40px_rgba(0,0,0,0.72)] transition-[opacity,transform] duration-200 ${surfaceColor}`}
            >
              <IconComponent className={`h-5 w-5 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
              <div className="flex-1 min-w-0 pr-1">
                {t.title && (
                  <div className="text-sm font-semibold text-[#F2EFE9] mb-0.5">
                    {t.title}
                  </div>
                )}
                <div className="text-[13px] leading-relaxed break-words text-[#B8B4AC]">
                  {t.message}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-lg text-[#8E8A82] hover:bg-[#F2EFE9]/[0.07] hover:text-[#F2EFE9] transition-colors duration-150"
                aria-label="Закрыть уведомление"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
