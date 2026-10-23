import type { APIRoute } from 'astro';
import { DocError, declineSignature } from '../../../../lib/docs';
import { clientInfo, fail, json, notFound, readJson } from '../../../../lib/http';
import { resolveSigner } from '../../../../lib/signer-session';

/**
 * Declining does not require the OTP: someone who received a document they
 * should not sign must be able to say so without proving the address is theirs.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx || !['sent', 'opened'].includes(ctx.signer.status)) return notFound();
  const body = await readJson<{ reason?: string }>(request);
  const reason = String(body?.reason || '').trim();
  if (!reason) return fail('reason_required');
  const { ip, ua } = clientInfo(request);
  try {
    await declineSignature(ctx, reason, { name: ctx.signer.name, email: ctx.signer.email, ip, ua }, request);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
