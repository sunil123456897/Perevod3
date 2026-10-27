'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warn' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  durationMs?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string, title?: string, durationMs?: number) => void;
  removeToast: (id: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warn: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, title?: string, durationMs = 3800) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: ToastItem = { id, type, message, title, durationMs };

      setToasts((prev) => [...prev.slice(-4), item]);

      if (durationMs > 0) {
        setTimeout(() => {
          removeToast(id);
        }, durationMs);
      }
    },
    [removeToast]
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

  const value = useMemo(
    () => ({
      toasts,
      addToast,
      removeToast,
      success,
      error,
      warn,
      info,
    }),
    [toasts, addToast, removeToast, success, error, warn, info]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((t) => {
          const isSuccess = t.type === 'success';
          const isError = t.type === 'error';
          const isWarn = t.type === 'warn';

          const borderColor = isSuccess
            ? 'border-emerald-500/50 bg-[#061510]/95 text-emerald-100 shadow-emerald-950/40'
            : isError
            ? 'border-rose-500/50 bg-[#19090c]/95 text-rose-100 shadow-rose-950/40'
            : isWarn
            ? 'border-amber-500/50 bg-[#181106]/95 text-amber-100 shadow-amber-950/40'
            : 'border-cyan-500/40 bg-[#08131d]/95 text-cyan-100 shadow-cyan-950/40';

          const IconComponent = isSuccess
            ? CheckCircle2
            : isError
            ? XCircle
            : isWarn
            ? AlertTriangle
            : Info;

          const iconColor = isSuccess
            ? 'text-emerald-400'
            : isError
            ? 'text-rose-400'
            : isWarn
            ? 'text-amber-400'
            : 'text-cyan-400';

          return (
            <div
              key={t.id}
              role="alert"
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border backdrop-blur-md shadow-2xl transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 ${borderColor}`}
            >
              <IconComponent className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
              <div className="flex-1 min-w-0 pr-1">
                {t.title && (
                  <div className="text-xs font-semibold uppercase tracking-wider mb-0.5 opacity-90">
                    {t.title}
                  </div>
                )}
                <div className="text-sm leading-snug break-words font-medium">{t.message}</div>
              </div>
              <button
                onClick={() => removeToast(t.id)}
                className="shrink-0 p-1 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Закрыть уведомление"
              >
                <X className="w-4 h-4" />
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
