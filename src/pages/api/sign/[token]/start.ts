import type { APIRoute } from 'astro';
import { ACTIVE, DocError, markOpened, sendOtp } from '../../../../lib/docs';
import { clientInfo, fail, json, notFound } from '../../../../lib/http';
import { resolveSigner } from '../../../../lib/signer-session';

/**
 * The signer pressed Start (or Resend): records the open and emails a code.
 * Opening is recorded here rather than on page load, because mail scanners
 * fetch links in emails and would otherwise mark documents as opened.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx || !ACTIVE.includes(ctx.doc.status) || !['sent', 'opened'].includes(ctx.signer.status)) return notFound();
  const { ip, ua } = clientInfo(request);
  const actor = { name: ctx.signer.name, email: ctx.signer.email, ip, ua };
  await markOpened(ctx, actor);
  if (ctx.verified) return json({ ok: true, verified: true });
  try {
    await sendOtp(ctx, actor, request);
    return json({ ok: true, verified: false });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
