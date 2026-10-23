import type { APIRoute } from 'astro';
import { redeemLoginToken, sessionCookie } from '../../../lib/auth';

/**
 * Exchanges a sign-in token for a session. This is a POST from the /auth page
 * rather than the emailed GET link itself, because mail scanners (Outlook Safe
 * Links and the like) open links in emails and would use up the token.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const form = await request.formData();
  const token = String(form.get('token') || '');
  const next = String(form.get('next') || '/');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const session = token ? await redeemLoginToken(token) : null;
  if (!session) {
    return new Response(null, { status: 303, headers: { location: '/auth?invalid=1' } });
  }
  return new Response(null, {
    status: 303,
    headers: { location: safeNext, 'set-cookie': sessionCookie(session, url.protocol === 'https:') },
  });
};
