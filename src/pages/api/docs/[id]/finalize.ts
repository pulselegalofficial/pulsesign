import type { APIRoute } from 'astro';
import { finalize, getDoc } from '../../../../lib/docs';
import { fail, json, notFound, unauthorized } from '../../../../lib/http';

/** Retries producing the signed PDF if it failed when the last signer signed. */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  if (doc.status !== 'completed' || doc.final_key) return fail('not_needed', 409);
  await finalize(doc.id, request);
  return json({ ok: true });
};
