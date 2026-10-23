import type { APIRoute } from 'astro';
import { ACTIVE, DocError, verifyOtp } from '../../../../lib/docs';
import { clientInfo, fail, json, notFound, readJson } from '../../../../lib/http';
import { resolveSigner, signerCookie } from '../../../../lib/signer-session';

export const POST: APIRoute = async ({ params, request, url }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx || !ACTIVE.includes(ctx.doc.status) || !['sent', 'opened'].includes(ctx.signer.status)) return notFound();
  const body = await readJson<{ code?: string }>(request);
  const { ip, ua } = clientInfo(request);
  try {
    const session = await verifyOtp(ctx, String(body?.code || '').trim(), { name: ctx.signer.name, email: ctx.signer.email, ip, ua });
    return json({ ok: true }, 200, { 'set-cookie': signerCookie(ctx.signer.id, session, url.protocol === 'https:') });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
