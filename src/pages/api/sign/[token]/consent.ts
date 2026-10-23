import type { APIRoute } from 'astro';
import { ACTIVE, recordConsent } from '../../../../lib/docs';
import { clientInfo, json, notFound, unauthorized } from '../../../../lib/http';
import { resolveSigner } from '../../../../lib/signer-session';

export const POST: APIRoute = async ({ params, request }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx || !ACTIVE.includes(ctx.doc.status)) return notFound();
  if (!ctx.verified) return unauthorized();
  const { ip, ua } = clientInfo(request);
  await recordConsent(ctx, { name: ctx.signer.name, email: ctx.signer.email, ip, ua });
  return json({ ok: true });
};
