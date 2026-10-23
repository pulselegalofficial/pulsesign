import type { APIRoute } from 'astro';
import { SESSION_COOKIE, clearedSessionCookie, endSession, readCookie } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, url }) => {
  await endSession(readCookie(request, SESSION_COOKIE));
  return new Response(null, {
    status: 303,
    headers: { location: '/login', 'set-cookie': clearedSessionCookie(url.protocol === 'https:') },
  });
};
