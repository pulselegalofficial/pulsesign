import type { APIRoute } from 'astro';
import { fieldImage } from '../../../../../lib/docs';
import { notFound, unauthorized } from '../../../../../lib/http';
import { resolveSigner } from '../../../../../lib/signer-session';

/** Another signer's signature, initials or seal on the same document, after the OTP check. */
export const GET: APIRoute = async ({ params, request }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx) return notFound();
  if (!ctx.verified) return unauthorized();
  const obj = await fieldImage(ctx.doc, params.fieldId!);
  if (!obj) return notFound();
  return new Response(obj.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } });
};
