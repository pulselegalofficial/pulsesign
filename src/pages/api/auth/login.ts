import type { APIRoute } from 'astro';
import { createLoginToken, isStaffEmail } from '../../../lib/auth';
import { appUrl } from '../../../lib/env';
import { json, readJson, isEmail, fail } from '../../../lib/http';
import * as mail from '../../../lib/mailers';

/**
 * Emails a sign-in link. Always answers the same way whether or not the
 * address may sign in, so the endpoint cannot be used to discover staff.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJson<{ email?: string; next?: string }>(request);
  const email = String(body?.email || '').trim().toLowerCase();
  if (!isEmail(email)) return fail('invalid_email');
  if (isStaffEmail(email)) {
    const token = await createLoginToken(email);
    if (token) {
      const next = body?.next && body.next.startsWith('/') && !body.next.startsWith('//') ? body.next : '';
      const link = `${appUrl(request)}/auth?token=${encodeURIComponent(token)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
      await mail.login({ email, link, lang: locals.lang, request });
    }
  }
  return json({ ok: true });
};
