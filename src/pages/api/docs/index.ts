import type { APIRoute } from 'astro';
import { createDraft, MAX_UPLOAD_BYTES } from '../../../lib/docs';
import { clientInfo, fail, json, unauthorized } from '../../../lib/http';
import { PdfError } from '../../../lib/pdf';
import { displayName } from '../../../lib/auth';

/** Upload a PDF; creates a draft document. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return unauthorized();
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return fail('errTooLarge', 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail('errNotPdf');
  if (file.size > MAX_UPLOAD_BYTES) return fail('errTooLarge', 413);
  try {
    const { ip, ua } = clientInfo(request);
    const doc = await createDraft(user, file, locals.lang, { name: displayName(user), email: user.email, ip, ua });
    return json({ id: doc.id }, 201);
  } catch (e) {
    if (e instanceof PdfError) return fail(e.code);
    throw e;
  }
};
