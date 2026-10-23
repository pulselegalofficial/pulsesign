import type { APIRoute } from 'astro';
import { getFields, getSigners } from '../../../../lib/docs';
import { json, notFound, unauthorized } from '../../../../lib/http';
import { resolveSigner } from '../../../../lib/signer-session';

/**
 * After the OTP check: the fields this signer has to fill, plus what the
 * other signers have already put on the document (read-only) and who has
 * signed so far. Other signers' emails are not included.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx) return notFound();
  if (!ctx.verified) return unauthorized();
  const [all, signers] = await Promise.all([getFields(ctx.doc.id), getSigners(ctx.doc.id)]);
  const me = ctx.signer.position;
  const nameAt = new Map(signers.map((s) => [s.position, s.name]));
  const box = (f: (typeof all)[number]) => ({ id: f.id, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h });
  return json({
    fields: all.filter((f) => f.signer_pos === me).map(box),
    others: all
      .filter((f) => f.signer_pos !== me && f.value && f.filled_at)
      .map((f) => ({
        ...box(f),
        signer: nameAt.get(f.signer_pos) || '',
        // Name and date fields hold their text; images are fetched separately.
        text: f.type === 'name' || f.type === 'date' ? f.value : null,
      })),
    signers: signers.map((s) => ({ name: s.name, me: s.position === me, signed: s.status === 'signed', signedAt: s.signed_at })),
  });
};
