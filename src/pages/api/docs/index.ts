import type { APIRoute } from 'astro';
import { DocError, createDraft } from '../../../lib/docs';
import { clientInfo, fail, json, unauthorized } from '../../../lib/http';
import { readUpload } from '../../../lib/upload';
import { displayName } from '../../../lib/auth';

/** Upload a PDF (raw body, see lib/upload.ts); creates a draft document. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return unauthorized();
  const upload = await readUpload(request);
  if ('error' in upload) return fail(upload.error, upload.status);
  try {
    const { ip, ua } = clientInfo(request);
    const doc = await createDraft(user, upload.bytes, upload.meta, locals.lang, { name: displayName(user), email: user.email, ip, ua });
    return json({ id: doc.id }, 201);
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
