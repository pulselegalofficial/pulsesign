import type { APIRoute } from 'astro';
import { DocError, submitSignature, type StampInput } from '../../../../lib/docs';
import { clientInfo, fail, json, notFound, readJson, unauthorized } from '../../../../lib/http';
import { resolveSigner } from '../../../../lib/signer-session';

export const POST: APIRoute = async ({ params, request }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx) return notFound();
  if (!ctx.verified) return unauthorized();
  const body = await readJson<{ images?: Record<string, string>; stamp?: StampInput }>(request);
  if (!body?.images || typeof body.images !== 'object') return fail('missing_field');
  const { ip, ua } = clientInfo(request);
  try {
    const result = await submitSignature(ctx, body.images, { name: ctx.signer.name, email: ctx.signer.email, ip, ua }, request, body.stamp || {});
    return json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
