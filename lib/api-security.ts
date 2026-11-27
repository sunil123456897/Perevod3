/**
 * Server-side Security Perimeter & SSRF Guard:
 * 1) verifyStudioApiRequest — Host allowlist, CSRF Origin/Sec-Fetch-Site check, and optional Bearer token auth.
 * 2) sanitizeClientLlmConfig — Strict modelId allowlist and server gate for privileged CLI providers.
 * 3) validateSafeColabEndpointUrl — Strict IPv4/IPv6/CGNAT/loopback/metadata SSRF defense.
 */

import { createHmac } from 'node:crypto';
import type { GeminiThinkingLevel, LlmProviderConfig } from './pipeline-types.ts';
import { validateColabEndpointUrl } from './qa-linter.ts';

export const STUDIO_SESSION_COOKIE_NAME = 'studio_session';

const SAFE_MODEL_ID_REGEX = /^[a-zA-Z0-9._:-]{1,80}$/;
const ALLOWED_THINKING_LEVELS = new Set<GeminiThinkingLevel>([
  'low',
  'medium',
  'high',
  'xhigh',
  'auto_xhigh',
]);

export function constantTimeStringEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

export function createStudioSessionCookieValue(token: string): string {
  return createHmac('sha256', token).update('studio-session-v1').digest('hex');
}

function parseCookieValue(cookieHeader: string, cookieName: string): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const k = part.slice(0, eqIdx).trim();
    if (k === cookieName) {
      const raw = part.slice(eqIdx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return '';
}

function normalizeHostName(rawHost: string): string {
  const lower = rawHost.trim().toLowerCase();
  if (lower.startsWith('[')) {
    const endBracket = lower.indexOf(']');
    return endBracket > 0 ? lower.slice(0, endBracket + 1) : lower;
  }
  const colonIdx = lower.lastIndexOf(':');
  if (colonIdx > 0 && /^\d+$/.test(lower.slice(colonIdx + 1))) {
    return lower.slice(0, colonIdx);
  }
  return lower;
}

function isAllowedHostHeader(hostHeader: string): boolean {
  const hostName = normalizeHostName(hostHeader);
  if (hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '[::1]') {
    return true;
  }
  const extraHosts = (process.env.STUDIO_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => normalizeHostName(s))
    .filter(Boolean);
  return extraHosts.includes(hostName);
}

export interface ApiAuthCheckResult {
  ok: boolean;
  status: number;
  error?: string;
  authenticatedByToken: boolean;
}

export function verifyStudioApiRequest(
  req: Request,
  options?: {
    requireMutationOrigin?: boolean;
    allowUnauthenticated?: boolean;
  }
): ApiAuthCheckResult {
  const configuredToken = (process.env.STUDIO_API_TOKEN || '').trim();
  const authHeader = (req.headers.get('authorization') || '').trim();
  const xStudioToken = (req.headers.get('x-studio-token') || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const presentedToken = bearerToken || xStudioToken;
  const cookieHeader = req.headers.get('cookie') || '';
  const sessionCookie = parseCookieValue(cookieHeader, STUDIO_SESSION_COOKIE_NAME);
  const authenticatedByHeader =
    configuredToken.length > 0 &&
    presentedToken.length > 0 &&
    constantTimeStringEqual(presentedToken, configuredToken);
  const authenticatedByCookie =
    configuredToken.length > 0 &&
    sessionCookie.length > 0 &&
    constantTimeStringEqual(sessionCookie, createStudioSessionCookieValue(configuredToken));
  const authenticatedByToken = authenticatedByHeader || authenticatedByCookie;

  if (configuredToken.length > 0 && !authenticatedByToken && !options?.allowUnauthenticated) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized: valid STUDIO_API_TOKEN Bearer token or session cookie is required',
      authenticatedByToken: false,
    };
  }

  const hostHeader = (req.headers.get('host') || '').trim();
  if (hostHeader && !isAllowedHostHeader(hostHeader)) {
    return {
      ok: false,
      status: 403,
      error: `Forbidden Host header (${hostHeader})`,
      authenticatedByToken,
    };
  }

  const method = (req.method || 'GET').toUpperCase();
  const isMutation =
    options?.requireMutationOrigin ??
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isMutation) {
    const secFetchSite = (req.headers.get('sec-fetch-site') || '').trim().toLowerCase();
    if (secFetchSite === 'cross-site' && !authenticatedByToken) {
      return {
        ok: false,
        status: 403,
        error: 'Forbidden cross-site mutation request',
        authenticatedByToken,
      };
    }

    const originHeader = (req.headers.get('origin') || '').trim();
    if (originHeader) {
      try {
        const originUrl = new URL(originHeader);
        const originHostWithPort = originUrl.host.toLowerCase();
        const originHostName = normalizeHostName(originHostWithPort);
        const normalizedReqHost = hostHeader.toLowerCase();
        const extraOrigins = (process.env.STUDIO_ALLOWED_ORIGINS || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);

        const matchesHost =
          normalizedReqHost.length === 0
            ? originHostName === 'localhost' ||
              originHostName === '127.0.0.1' ||
              originHostName === '[::1]'
            : originHostWithPort === normalizedReqHost;

        if (!matchesHost && !extraOrigins.includes(originUrl.origin.toLowerCase())) {
          return {
            ok: false,
            status: 403,
            error: `Origin mismatch (${originUrl.origin})`,
            authenticatedByToken,
          };
        }
      } catch {
        return {
          ok: false,
          status: 403,
          error: 'Malformed Origin header',
          authenticatedByToken,
        };
      }
    }
  }

  return { ok: true, status: 200, authenticatedByToken };
}

export function sanitizeClientLlmConfig(
  rawConfig: Partial<LlmProviderConfig> | undefined,
  auth?: ApiAuthCheckResult
): LlmProviderConfig {
  const allowedClientProviders = new Set<LlmProviderConfig['provider']>([
    'colab_ollama',
    'gemini_api',
  ]);
  const allowAgyCli =
    process.env.ENABLE_CLIENT_AGY_CLI === '1' &&
    process.env.DISABLE_CLIENT_AGY_CLI !== '1' &&
    (!process.env.STUDIO_API_TOKEN || Boolean(auth?.authenticatedByToken));

  if (allowAgyCli) {
    allowedClientProviders.add('antigravity_cli');
  }

  let provider: LlmProviderConfig['provider'] =
    rawConfig?.provider && allowedClientProviders.has(rawConfig.provider)
      ? rawConfig.provider
      : 'gemini_api';

  if (rawConfig?.provider === 'deterministic') {
    provider = 'gemini_api';
  }

  const isGeminiApi = provider === 'gemini_api';
  const defaultPrimaryModel =
    provider === 'antigravity_cli'
      ? 'gemini-3.8-flash-high'
      : isGeminiApi
        ? 'gemini-4-hydrogen'
        : 'gemma4:26b-a4b';

  const pickSafeModel = (
    candidate: unknown,
    fallback: string,
    disallowColon = false,
    disallowAgyOnly = false
  ): string => {
    if (typeof candidate !== 'string') return fallback;
    const trimmed = candidate.trim();
    if (!SAFE_MODEL_ID_REGEX.test(trimmed)) return fallback;
    if (disallowColon && trimmed.includes(':')) return fallback;
    if (disallowAgyOnly && /^(?:gemini-4-argon|claude-)/i.test(trimmed)) return fallback;
    return trimmed;
  };

  let safeColabEndpointUrl = '';
  if (typeof rawConfig?.colabEndpointUrl === 'string' && rawConfig.colabEndpointUrl.trim()) {
    const check = validateSafeColabEndpointUrl(rawConfig.colabEndpointUrl);
    if (check.ok) {
      safeColabEndpointUrl = check.normalizedUrl;
    }
  }

  const tempRaw = Number(rawConfig?.temperature);
  const safeTemperature =
    Number.isFinite(tempRaw) && tempRaw >= 0 && tempRaw <= 1.5 ? tempRaw : 0.3;

  const numCtxRaw = Number(rawConfig?.numCtx);
  const safeNumCtx =
    Number.isFinite(numCtxRaw) && numCtxRaw >= 1024 && numCtxRaw <= 262144
      ? Math.round(numCtxRaw)
      : 16384;

  const safeThinkingLevel: GeminiThinkingLevel | undefined =
    typeof rawConfig?.thinkingLevel === 'string' &&
    ALLOWED_THINKING_LEVELS.has(rawConfig.thinkingLevel as GeminiThinkingLevel)
      ? (rawConfig.thinkingLevel as GeminiThinkingLevel)
      : provider === 'gemini_api'
        ? 'auto_xhigh'
        : undefined;

  const safeUseDecisionEngine: boolean | undefined =
    typeof rawConfig?.useDecisionEngine === 'boolean'
      ? rawConfig.useDecisionEngine
      : isGeminiApi
        ? true
        : undefined;

  const disallowColon = provider !== 'colab_ollama';
  const modelId = pickSafeModel(
    rawConfig?.modelId,
    defaultPrimaryModel,
    disallowColon,
    isGeminiApi
  );
  const scoutModelId = pickSafeModel(
    rawConfig?.scoutModelId,
    isGeminiApi
      ? 'gemini-3.1-flash-lite'
      : provider === 'antigravity_cli'
        ? 'gemini-3.8-flash-low'
        : modelId,
    disallowColon,
    isGeminiApi
  );
  const criticModelId = pickSafeModel(
    rawConfig?.criticModelId,
    isGeminiApi
      ? 'gemini-3.8-flash'
      : provider === 'antigravity_cli'
        ? 'gemini-4-argon-medium'
        : modelId,
    disallowColon,
    isGeminiApi
  );
  const stylistDefault = isGeminiApi
    ? 'gemini-3.8-flash'
    : provider === 'antigravity_cli'
      ? 'claude-sonnet-5-5-high'
      : criticModelId;
  const stylistModelId = pickSafeModel(
    rawConfig?.stylistModelId,
    stylistDefault,
    disallowColon,
    isGeminiApi
  );

  return {
    provider,
    colabEndpointUrl: safeColabEndpointUrl,
    modelId,
    scoutModelId,
    criticModelId,
    stylistModelId,
    ...(safeThinkingLevel ? { thinkingLevel: safeThinkingLevel } : {}),
    ...(safeUseDecisionEngine !== undefined
      ? { useDecisionEngine: safeUseDecisionEngine }
      : {}),
    temperature: safeTemperature,
    numCtx: safeNumCtx,
  };
}

/**
 * Single source of truth for Colab / Ollama SSRF URL validation, shared between UI and API routes.
 */
export function validateSafeColabEndpointUrl(rawUrl: string): {
  ok: boolean;
  normalizedUrl: string;
  error?: string;
} {
  return validateColabEndpointUrl(rawUrl);
}
