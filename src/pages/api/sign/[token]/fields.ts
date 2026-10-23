import type { APIRoute } from 'astro';
import { getFields } from '../../../../lib/docs';
import { json, notFound, unauthorized } from '../../../../lib/http';
import { resolveSigner } from '../../../../lib/signer-session';

/** The fields this signer has to fill, after the OTP check. */
export const GET: APIRoute = async ({ params, request }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx) return notFound();
  if (!ctx.verified) return unauthorized();
  const fields = (await getFields(ctx.doc.id)).filter((f) => f.signer_pos === ctx.signer.position);
  return json({
    fields: fields.map((f) => ({ id: f.id, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h })),
  });
};
