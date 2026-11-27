'use client';

import React, { useState } from 'react';
import { ShieldCheck, KeyRound, Eye, EyeOff, ArrowRight } from 'lucide-react';

interface StudioAuthGateProps {
  onAuthenticated: () => void;
  initialError?: string | null;
}

export default function StudioAuthGate({
  onAuthenticated,
  initialError = null,
}: StudioAuthGateProps) {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Введите токен доступа STUDIO_API_TOKEN.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.authenticated) {
        setError(
          (typeof data?.error === 'string' && data.error) ||
            (res.status === 401
              ? 'Неверный STUDIO_API_TOKEN. Проверьте значение в .env.local.'
              : res.status === 403
                ? 'Запрос отклонён проверкой Origin / Host.'
                : `Ошибка авторизации (HTTP ${res.status}).`)
        );
        return;
      }

      setToken('');
      onAuthenticated();
    } catch {
      setError('Не удалось связаться с сервером /api/auth.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-auth-gate-title"
      className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-[#090A0F]/95 px-4 py-8 backdrop-blur-md"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0D1017] p-6 sm:p-7 shadow-[0_24px_64px_rgba(0,0,0,0.75)] space-y-5">
        <div className="flex items-start gap-3.5 border-b border-white/[0.07] pb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#D99B26]/35 bg-[#D99B26]/15 text-[#D99B26]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h1
              id="studio-auth-gate-title"
              className="font-display text-base font-bold text-[#F1F5F9]"
            >
              Доступ к студии «Канон Сянься»
            </h1>
            <p className="text-xs leading-relaxed text-[#94A3B8]">
              На сервере включена защита <code className="font-mono text-[#D99B26]">STUDIO_API_TOKEN</code>.
              Авторизация установит защищённую <code className="font-mono">HttpOnly</code>-сессию в браузере.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="studio-api-token-input"
              className="flex items-center gap-1.5 text-xs font-medium text-[#CBD5E1]"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#D99B26]" />
              Токен доступа (STUDIO_API_TOKEN)
            </label>
            <div className="relative">
              <input
                id="studio-api-token-input"
                type={showToken ? 'text' : 'password'}
                autoFocus
                autoComplete="current-password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Вставьте токен доступа..."
                className="w-full rounded-xl border border-white/[0.12] bg-[#161B26] py-2.5 pl-3.5 pr-10 font-mono text-xs text-[#F1F5F9] placeholder:text-[#64748B] focus:border-[#D99B26] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D99B26]/30"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#64748B] hover:text-[#F1F5F9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D99B26]/40"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#D99B26] px-4 py-2.5 text-xs font-semibold text-[#090A0F] transition-colors hover:bg-[#E3A836] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D99B26]/50"
          >
            <span>{submitting ? 'Проверка токена...' : 'Открыть студию'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
