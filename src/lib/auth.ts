import { db, env } from './env';
import { randomToken, sha256Hex } from './crypto';
import type { User } from './types';

/**
 * Staff authentication: passwordless sign-in links.
 *
 * Only SHA-256 hashes of link tokens and session tokens are stored, so a copy
 * of the database cannot be used to sign in. Who may sign in is decided by
 * STAFF_EMAILS; rows in `users` only hold display names.
 */

export const SESSION_COOKIE = 'ps_session';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
/** Minimum gap between two sign-in emails to the same address. */
const LOGIN_EMAIL_GAP_MS = 30 * 1000;

export function isStaffEmail(email: string, allowList = env().STAFF_EMAILS || ''): boolean {
  const e = email.trim().toLowerCase();
  return allowList
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => (rule.startsWith('@') ? e.endsWith(rule) : e === rule));
}

/** Creates a sign-in token, or null when one was issued moments ago. */
export async function createLoginToken(email: string, now = Date.now()): Promise<string | null> {
  const recent = await db()
    .prepare('SELECT 1 FROM login_tokens WHERE email = ? AND expires_at > ? LIMIT 1')
    .bind(email, now + LOGIN_TOKEN_TTL_MS - LOGIN_EMAIL_GAP_MS)
    .first();
  if (recent) return null;
  const token = randomToken();
  await db()
    .prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), email, now + LOGIN_TOKEN_TTL_MS)
    .run();
  return token;
}

/** Consumes a sign-in token and returns a new session token. */
export async function redeemLoginToken(token: string, now = Date.now()): Promise<string | null> {
  const hash = await sha256Hex(token);
  // Single statement, so two concurrent clicks cannot both succeed.
  const row = await db()
    .prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email')
    .bind(now, hash, now)
    .first<{ email: string }>();
  if (!row || !isStaffEmail(row.email)) return null;

  const session = randomToken();
  await db().batch([
    db().prepare('INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(session), row.email, now + SESSION_TTL_MS),
    db().prepare('INSERT OR IGNORE INTO users (email, name, created_at) VALUES (?, ?, ?)').bind(row.email, '', now),
    db().prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - 24 * 60 * 60 * 1000),
    db().prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ]);
  return session;
}

export async function userFromSession(token: string | undefined, now = Date.now()): Promise<User | null> {
  if (!token) return null;
  const row = await db()
    .prepare(
      `SELECT s.email AS email, COALESCE(u.name, '') AS name FROM sessions s
       LEFT JOIN users u ON u.email = s.email WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .bind(await sha256Hex(token), now)
    .first<User>();
  // Removing someone from STAFF_EMAILS revokes their sessions immediately.
  if (!row || !isStaffEmail(row.email)) return null;
  return row;
}

export async function endSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db().prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export function sessionCookie(token: string, secure: boolean): string {
  return cookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000, secure);
}

export function clearedSessionCookie(secure: boolean): string {
  return cookie(SESSION_COOKIE, '', 0, secure);
}

/** Lax, not Strict, so the first click from the sign-in email carries the cookie. */
export function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean, path = '/'): string {
  return [`${name}=${value}`, `Path=${path}`, 'HttpOnly', secure ? 'Secure' : '', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
    .filter(Boolean)
    .join('; ');
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/** Display name, falling back to the part of the email before the @. */
export const displayName = (u: { name: string; email: string }) => u.name.trim() || u.email.split('@')[0];
