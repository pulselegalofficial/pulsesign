import type { APIRoute } from 'astro';
import { finalizeInput, getDoc } from '../../../../lib/docs';
import { fail, json, notFound, unauthorized } from '../../../../lib/http';

/** Data for the staff browser to build the final PDF (see scripts/finalize.ts). */
export const GET: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  if (doc.status !== 'completed' || doc.final_key) return fail('not_needed', 409);
  return json(await finalizeInput(doc, request));
};
