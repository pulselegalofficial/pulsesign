import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from './cloudflare-workers.stub';
import { decodeJwtPayload, emailFromClaims, finishGoogleLogin, startGoogleLogin } from '../lib/google';

const CLIENT = 'client-123.apps.googleusercontent.com';
const utf8b64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const jwt = (claims: object) => ['e30', utf8b64url(JSON.stringify(claims)), 'sig'].join('.');
const good = { iss: 'https://accounts.google.com', aud: CLIENT, exp: Date.now() / 1000 + 600, email: 'Pulse.Legal.Official@gmail.com', email_verified: true, name: 'Pulse Legal' };

beforeEach(() => {
  env.GOOGLE_CLIENT_ID = CLIENT;
  env.GOOGLE_CLIENT_SECRET = 'secret';
});
afterEach(() => vi.unstubAllGlobals());

describe('emailFromClaims', () => {
  it('accepts a verified Google email and lower-cases it', () => {
    expect(emailFromClaims(good, CLIENT)).toEqual({ email: 'pulse.legal.official@gmail.com', name: 'Pulse Legal' });
  });
  it.each([
    ['another issuer', { iss: 'https://evil.example' }],
    ['a token for another app', { aud: 'someone-else' }],
    ['an expired token', { exp: Date.now() / 1000 - 1 }],
    ['an unverified email', { email_verified: false }],
    ['no email', { email: undefined }],
  ])('rejects %s', (_, change) => {
    expect(emailFromClaims({ ...good, ...change }, CLIENT)).toBeNull();
  });
  it('decodes UTF-8 names', () => {
    expect(decodeJwtPayload(jwt({ name: 'ณัฐพล' }))?.name).toBe('ณัฐพล');
  });
});

describe('Google sign-in round trip', () => {
  it('builds a PKCE request and accepts the matching callback', async () => {
    const start = await startGoogleLogin('https://sign.example/api/auth/google/callback', '/docs/PS-2569-0001');
    const url = new URL(start.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe(CLIENT);
    const state = url.searchParams.get('state')!;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id_token: jwt(good) })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await finishGoogleLogin(new URLSearchParams({ state, code: 'abc' }), start.cookieValue, 'https://sign.example/api/auth/google/callback');
    expect(r).toEqual({ ok: true, email: 'pulse.legal.official@gmail.com', name: 'Pulse Legal', next: '/docs/PS-2569-0001' });
    const body = new URLSearchParams(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('client_secret')).toBe('secret');
  });

  it('refuses a callback whose state does not match this browser', async () => {
    const start = await startGoogleLogin('https://x/cb', '/');
    vi.stubGlobal('fetch', vi.fn());
    const r = await finishGoogleLogin(new URLSearchParams({ state: 'forged', code: 'abc' }), start.cookieValue, 'https://x/cb');
    expect(r).toEqual({ ok: false, error: 'state' });
    expect(await finishGoogleLogin(new URLSearchParams({ state: 'x', code: 'abc' }), undefined, 'https://x/cb')).toEqual({ ok: false, error: 'state' });
  });

  it('never redirects off-site after sign-in', async () => {
    const start = await startGoogleLogin('https://x/cb', '//evil.example/');
    const state = new URL(start.url).searchParams.get('state')!;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id_token: jwt(good) }))));
    const r = await finishGoogleLogin(new URLSearchParams({ state, code: 'c' }), start.cookieValue, 'https://x/cb');
    expect(r.ok && r.next).toBe('/');
  });

  it('fails when Google rejects the code', async () => {
    const start = await startGoogleLogin('https://x/cb', '/');
    const state = new URL(start.url).searchParams.get('state')!;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await finishGoogleLogin(new URLSearchParams({ state, code: 'c' }), start.cookieValue, 'https://x/cb')).toEqual({ ok: false, error: 'google' });
  });
});
