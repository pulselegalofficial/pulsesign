import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, readCookie, userFromSession } from './lib/auth';
import { detectLang } from './lib/i18n';

/** Paths anyone may open. Everything else requires a staff session. */
const PUBLIC = [/^\/login$/, /^\/api\/auth\//, /^\/s\//, /^\/api\/sign\//, /^\/verify$/, /^\/api\/verify$/, /^\/api\/lang$/, /^\/dl\//];

const SECURITY_HEADERS: Record<string, string> = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  // same-origin, not no-referrer: with no-referrer browsers send `Origin: null`
  // on form posts, which the CSRF check below rejects. Signing-link tokens in
  // URLs still never leave the site.
  'referrer-policy': 'same-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

function withHeaders(response: Response, extra: Record<string, string> = {}): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(k, v);
  // Staff-uploaded attachments: never let one run script on this origin.
  if (headers.get('x-sandbox')) {
    headers.delete('x-sandbox');
    headers.set('content-security-policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  }
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Cross-site request forgery: state-changing requests must come from our own pages.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) {
      return withHeaders(new Response('Forbidden', { status: 403 }));
    }
  }

  context.locals.lang = detectLang(request);
  context.locals.user = await userFromSession(readCookie(request, SESSION_COOKIE));

  if (!context.locals.user && !PUBLIC.some((re) => re.test(path)) && !path.startsWith('/_')) {
    if (path.startsWith('/api/')) {
      return withHeaders(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }));
    }
    const back = path === '/' ? '' : `?next=${encodeURIComponent(url.pathname + url.search)}`;
    return withHeaders(context.redirect(`/login${back}`, 302));
  }

  return withHeaders(await next());
});
