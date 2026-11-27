import { NextRequest, NextResponse } from 'next/server';
import {
  STUDIO_SESSION_COOKIE_NAME,
  constantTimeStringEqual,
  createStudioSessionCookieValue,
  verifyStudioApiRequest,
} from '@/lib/api-security';

function isHttpsRequest(req: NextRequest): boolean {
  const fwdProto = (req.headers.get('x-forwarded-proto') || '').toLowerCase();
  return req.url.startsWith('https://') || fwdProto.split(',')[0]?.trim() === 'https';
}

export async function GET(req: NextRequest) {
  const auth = verifyStudioApiRequest(req, {
    requireMutationOrigin: false,
    allowUnauthenticated: true,
  });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Forbidden' },
      { status: auth.status }
    );
  }

  const configuredToken = (process.env.STUDIO_API_TOKEN || '').trim();
  const authRequired = configuredToken.length > 0;
  return NextResponse.json({
    ok: true,
    authRequired,
    authenticated: !authRequired || auth.authenticatedByToken,
  });
}

export async function POST(req: NextRequest) {
  const auth = verifyStudioApiRequest(req, {
    requireMutationOrigin: true,
    allowUnauthenticated: true,
  });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Forbidden' },
      { status: auth.status }
    );
  }

  const configuredToken = (process.env.STUDIO_API_TOKEN || '').trim();
  if (!configuredToken) {
    return NextResponse.json({ ok: true, authRequired: false, authenticated: true });
  }

  let submittedToken = '';
  try {
    const body = await req.json();
    submittedToken = typeof body?.token === 'string' ? body.token.trim() : '';
  } catch {
    submittedToken = '';
  }

  if (!submittedToken || !constantTimeStringEqual(submittedToken, configuredToken)) {
    return NextResponse.json(
      { ok: false, error: 'Неверный STUDIO_API_TOKEN.' },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ ok: true, authRequired: true, authenticated: true });
  res.cookies.set(STUDIO_SESSION_COOKIE_NAME, createStudioSessionCookieValue(configuredToken), {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttpsRequest(req),
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  const auth = verifyStudioApiRequest(req, {
    requireMutationOrigin: true,
    allowUnauthenticated: true,
  });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Forbidden' },
      { status: auth.status }
    );
  }

  const res = NextResponse.json({ ok: true, authenticated: false });
  res.cookies.set(STUDIO_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttpsRequest(req),
    path: '/',
    maxAge: 0,
  });
  return res;
}
