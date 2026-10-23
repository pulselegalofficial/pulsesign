import { env } from './env';
import { randomToken, safeEqual, sha256Hex } from './crypto';

/**
 * Staff sign-in with Google (OpenID Connect, authorization code flow with
 * PKCE). Only the email Google vouches for matters: it must be verified and
 * allowed by STAFF_EMAILS.
 *
 * The ID token is taken straight from Google's token endpoint over TLS, in
 * exchange for the client secret, so its signature does not need checking
 * (OpenID Connect Core §3.1.3.7). Its claims still are.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const OAUTH_COOKIE = 'ps_oauth';
const OAUTH_TTL_SECONDS = 10 * 60;

/** Endpoints can be pointed at a local fake for development and tests. */
function endpoints() {
  const e = env();
  return { auth: e.GOOGLE_AUTH_URL || AUTH_URL, token: e.GOOGLE_TOKEN_URL || TOKEN_URL };
}

// Trimmed: a secret pasted into the dashboard with a stray space or newline
// would otherwise fail with an opaque invalid_client.
const clientId = () => (env().GOOGLE_CLIENT_ID || '').trim();
const clientSecret = () => (env().GOOGLE_CLIENT_SECRET || '').trim();

export function googleConfigured(): boolean {
  return !!(clientId() && clientSecret());
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export interface OAuthStart {
  url: string;
  /** Value of the short-lived cookie that ties the callback to this browser. */
  cookieValue: string;
}

export async function startGoogleLogin(redirectUri: string, next: string): Promise<OAuthStart> {
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return {
    url: `${endpoints().auth}?${params}`,
    cookieValue: [state, verifier, encodeURIComponent(next)].join('.'),
  };
}

export function oauthCookie(value: string, secure: boolean): string {
  // Lax so it comes back on the top-level redirect from Google; scoped to the callback.
  return [`${OAUTH_COOKIE}=${value}`, 'Path=/api/auth/google', 'HttpOnly', secure ? 'Secure' : '', 'SameSite=Lax', `Max-Age=${OAUTH_TTL_SECONDS}`]
    .filter(Boolean)
    .join('; ');
}

export function clearedOauthCookie(secure: boolean): string {
  return oauthCookie('', secure).replace(`Max-Age=${OAUTH_TTL_SECONDS}`, 'Max-Age=0');
}

export interface GoogleClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

/** Decodes the payload of a JWT without verifying it (see the note above). */
export function decodeJwtPayload(jwt: string): GoogleClaims | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replaceAll('-', '+').replaceAll('_', '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Which check an ID token fails, or null if it passes. */
export function claimProblem(c: GoogleClaims | null, clientId: string, now = Date.now()): string | null {
  if (!c) return 'no_id_token';
  if (!c.iss || !ISSUERS.includes(c.iss)) return 'issuer';
  if (c.aud !== clientId) return 'audience';
  if (!c.exp || c.exp * 1000 < now) return 'expired';
  if (c.email_verified !== true && c.email_verified !== 'true') return 'email_not_verified';
  if (!c.email) return 'no_email';
  return null;
}

/** The verified email in a Google ID token, or null if any check fails. */
export function emailFromClaims(c: GoogleClaims | null, clientId: string, now = Date.now()): { email: string; name: string } | null {
  if (claimProblem(c, clientId, now) || !c?.email) return null;
  return { email: c.email.trim().toLowerCase(), name: (c.name || '').trim().slice(0, 120) };
}

/**
 * `detail` says which step failed (for the sign-in page and the logs). It
 * holds only Google's error codes, never tokens or secrets.
 */
export type CallbackResult =
  | { ok: true; email: string; name: string; next: string }
  | { ok: false; error: 'google' | 'state'; detail: string };

/** Checks state against the cookie, exchanges the code, and reads the email. */
export async function finishGoogleLogin(
  params: URLSearchParams,
  cookieValue: string | undefined,
  redirectUri: string
): Promise<CallbackResult> {
  const [state, verifier, ...rest] = (cookieValue || '').split('.');
  const nextRaw = rest.join('.');
  const got = params.get('state') || '';
  if (!state || !verifier || !got || !safeEqual(await sha256Hex(state), await sha256Hex(got))) {
    return { ok: false, error: 'state', detail: !cookieValue ? 'state:no_cookie' : 'state:mismatch' };
  }
  const code = params.get('code');
  const denied = params.get('error');
  if (denied || !code) return { ok: false, error: 'google', detail: `authorize:${(denied || 'no_code').slice(0, 60)}` };

  const res = await fetch(endpoints().token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID!,
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Google token exchange failed', res.status, text);
    let code = `http_${res.status}`;
    try {
      code = (JSON.parse(text) as { error?: string }).error || code;
    } catch {
      /* keep the status */
    }
    return { ok: false, error: 'google', detail: `token:${code.slice(0, 60)}` };
  }
  const body = (await res.json()) as { id_token?: string };
  const claims = decodeJwtPayload(body.id_token || '');
  const problem = claimProblem(claims, clientId());
  const who = emailFromClaims(claims, clientId());
  if (problem || !who) {
    console.error('Google ID token rejected:', problem, { iss: claims?.iss, aud: claims?.aud });
    return { ok: false, error: 'google', detail: `id_token:${problem}` };
  }

  let next = '/';
  try {
    next = decodeURIComponent(nextRaw || '') || '/';
  } catch {
    /* default */
  }
  if (!next.startsWith('/') || next.startsWith('//')) next = '/';
  return { ok: true, ...who, next };
}
