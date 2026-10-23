import type { APIRoute } from 'astro';
import { appUrl } from '../../../../lib/env';
import { googleConfigured, oauthCookie, startGoogleLogin } from '../../../../lib/google';

/** Sends the browser to Google's account chooser. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!googleConfigured()) return Response.redirect(new URL('/login?error=not_configured', url), 303);
  const next = url.searchParams.get('next') || '/';
  const start = await startGoogleLogin(`${appUrl(request)}/api/auth/google/callback`, next);
  return new Response(null, {
    status: 303,
    headers: { location: start.url, 'set-cookie': oauthCookie(start.cookieValue, url.protocol === 'https:') },
  });
};
