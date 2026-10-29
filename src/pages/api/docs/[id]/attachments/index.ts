import type { APIRoute } from 'astro';
import { DocError, MAX_ATTACHMENT_BYTES, addAttachment, getDoc, listAttachments } from '../../../../../lib/docs';
import { fail, json, notFound, unauthorized } from '../../../../../lib/http';

/** Staff-only reference files kept beside a document (not in the signed PDF). */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const atts = await listAttachments(doc.id);
  return json({
    attachments: atts.map((a) => ({ id: a.id, name: a.name, size: a.size, type: a.content_type, sha256: a.sha256, note: a.note, by: a.uploaded_by, at: a.created_at })),
  });
};

/**
 * Upload one file as the raw request body (no multipart parsing, which would
 * cost CPU the Free plan doesn't have). Name, note and the browser's SHA-256
 * come in headers; R2 checks the hash against the bytes it receives.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  if (Number(request.headers.get('content-length') || 0) > MAX_ATTACHMENT_BYTES) return fail('attTooLarge', 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  const header = (name: string) => {
    try {
      return decodeURIComponent(request.headers.get(name) || '');
    } catch {
      return '';
    }
  };
  try {
    const a = await addAttachment(
      doc,
      bytes,
      {
        name: header('x-file-name'),
        note: header('x-note'),
        contentType: request.headers.get('content-type'),
        sha256: (request.headers.get('x-sha256') || '').toLowerCase(),
      },
      user
    );
    return json({ id: a.id }, 201);
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
