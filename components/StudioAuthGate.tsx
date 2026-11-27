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
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#0D0D0F] px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-[#F2EFE9]/[0.12] bg-[#141418] p-6 sm:p-7 shadow-[0_24px_64px_rgba(0,0,0,0.75)] space-y-5">
        <div className="flex items-start gap-3.5 border-b border-[#F2EFE9]/[0.08] pb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#D69E36]/35 bg-[#D69E36]/12 text-[#D69E36]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-lg font-semibold text-[#F2EFE9]">
              Доступ к студии «Канон Сянься»
            </h1>
            <p className="text-[13px] leading-relaxed text-[#B8B4AC]">
              На сервере включена защита{' '}
              <code className="font-mono text-[#E3AE48]">STUDIO_API_TOKEN</code>.
              Авторизация установит защищённую{' '}
              <code className="font-mono">HttpOnly</code>-сессию в браузере.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="studio-api-token-input"
              className="flex items-center gap-1.5 text-[13px] font-medium text-[#F2EFE9]"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#D69E36]" aria-hidden="true" />
              <span>Токен доступа (STUDIO_API_TOKEN)</span>
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
                className="w-full rounded-xl border border-[#F2EFE9]/[0.14] bg-[#101014] py-2.5 pl-3.5 pr-11 font-mono text-sm text-[#F2EFE9] placeholder:text-[#8E8A82] focus:border-[#D69E36] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex min-h-7 min-w-7 items-center justify-center rounded-md text-[#8E8A82] hover:text-[#F2EFE9]"
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-[13px] text-[#FDA4AF]"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#D69E36] px-4 py-2.5 text-sm font-semibold text-[#11100D] transition-colors duration-150 hover:bg-[#E3AE48] disabled:opacity-50"
          >
            <span>{submitting ? 'Проверка токена...' : 'Открыть студию'}</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </main>
  );
}
