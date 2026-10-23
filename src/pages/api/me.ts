import type { APIRoute } from 'astro';
import { db } from '../../lib/env';
import { json, readJson, unauthorized } from '../../lib/http';

export const PATCH: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return unauthorized();
  const body = await readJson<{ name?: string }>(request);
  const name = String(body?.name ?? '').trim().slice(0, 120);
  await db()
    .prepare('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name')
    .bind(locals.user.email, name, Date.now())
    .run();
  return json({ ok: true });
};
