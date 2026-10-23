import type { APIRoute } from 'astro';
import { createSession, readCookie, sessionCookie } from '../../../../lib/auth';
import { appUrl } from '../../../../lib/env';
import { OAUTH_COOKIE, clearedOauthCookie, finishGoogleLogin, googleConfigured } from '../../../../lib/google';

/** Google sends the browser back here with a one-time code. */
export const GET: APIRoute = async ({ request, url }) => {
  const secure = url.protocol === 'https:';
  const fail = (error: string) => {
    const headers = new Headers({ location: `/login?error=${error}` });
    headers.append('set-cookie', clearedOauthCookie(secure));
    return new Response(null, { status: 303, headers });
  };
  if (!googleConfigured()) return fail('not_configured');

  const result = await finishGoogleLogin(url.searchParams, readCookie(request, OAUTH_COOKIE), `${appUrl(request)}/api/auth/google/callback`);
  if (!result.ok) return fail(result.error);
  const session = await createSession(result.email, result.name);
  if (!session) {
    console.log(`Sign-in refused for ${result.email}: not in STAFF_EMAILS`);
    return fail('not_allowed');
  }
  const headers = new Headers({ location: result.next });
  headers.append('set-cookie', clearedOauthCookie(secure));
  headers.append('set-cookie', sessionCookie(session, secure));
  return new Response(null, { status: 303, headers });
};
