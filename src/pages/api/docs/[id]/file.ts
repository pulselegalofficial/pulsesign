import type { APIRoute } from 'astro';
import { DocError, getDoc, replaceDraftFile } from '../../../../lib/docs';
import { files } from '../../../../lib/env';
import { fail, json, notFound, pdfResponse, unauthorized } from '../../../../lib/http';
import { readUpload } from '../../../../lib/upload';

/** The original upload. */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const obj = await files().get(doc.file_key);
  if (!obj) return notFound();
  return pdfResponse(obj.body, doc.file_name);
};

/** Replace the PDF of a draft (raw body, see lib/upload.ts). */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const upload = await readUpload(request);
  if ('error' in upload) return fail(upload.error, upload.status);
  try {
    await replaceDraftFile(doc, upload.bytes, upload.meta);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
