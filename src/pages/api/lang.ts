import type { APIRoute } from 'astro';
import { isLang } from '../../lib/i18n';

/** Sets the language cookie and returns to the page the toggle was on. */
export const GET: APIRoute = ({ url }) => {
  const lang = url.searchParams.get('lang');
  const next = url.searchParams.get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const headers = new Headers({ location: safeNext });
  if (isLang(lang)) headers.append('set-cookie', `lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`);
  return new Response(null, { status: 303, headers });
};
