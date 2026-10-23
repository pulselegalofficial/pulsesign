import type { APIRoute } from 'astro';
import { fieldImage, getDoc } from '../../../../../lib/docs';
import { notFound, unauthorized } from '../../../../../lib/http';

/** A signer's signature or initials PNG, for building the final PDF. */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const obj = await fieldImage(doc, params.fieldId!);
  if (!obj) return notFound();
  return new Response(obj.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } });
};
