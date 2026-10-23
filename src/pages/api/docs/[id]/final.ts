import type { APIRoute } from 'astro';
import { DocError, MAX_UPLOAD_BYTES, acceptFinal, getDoc } from '../../../../lib/docs';
import { fail, json, notFound, unauthorized } from '../../../../lib/http';

/**
 * Receives the final signed PDF built by a staff browser. The body is the raw
 * PDF; `x-sha256` is its hash, which R2 verifies against what it stores.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  if (Number(request.headers.get('content-length') || 0) > MAX_UPLOAD_BYTES * 2) return fail('errTooLarge', 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  try {
    await acceptFinal(doc, bytes, (request.headers.get('x-sha256') || '').toLowerCase(), request);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
