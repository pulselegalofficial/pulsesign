import { db, env } from './env';
import { randomToken, sha256Hex } from './crypto';
import type { User } from './types';

/**
 * Staff authentication. Staff sign in with Google (see google.ts); this file
 * holds the allow-list and the sessions that follow a successful sign-in.
 *
 * Only SHA-256 hashes of session tokens are stored, so a copy of the database
 * cannot be used to sign in. Who may sign in is decided by STAFF_EMAILS;
 * rows in `users` only hold display names.
 */

export const SESSION_COOKIE = 'ps_session';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function isStaffEmail(email: string, allowList = env().STAFF_EMAILS || ''): boolean {
  const e = email.trim().toLowerCase();
  return allowList
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => (rule.startsWith('@') ? e.endsWith(rule) : e === rule));
}

/**
 * Starts a session for a staff member Google has vouched for. The display
 * name is taken from Google the first time only; after that it is theirs to
 * edit in the app.
 */
export async function createSession(email: string, name: string, now = Date.now()): Promise<string | null> {
  if (!isStaffEmail(email)) return null;
  const session = randomToken();
  await db().batch([
    db().prepare('INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(session), email, now + SESSION_TTL_MS),
    db().prepare(`INSERT INTO users (email, name, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = CASE WHEN users.name = '' THEN excluded.name ELSE users.name END`).bind(email, name, now),
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
