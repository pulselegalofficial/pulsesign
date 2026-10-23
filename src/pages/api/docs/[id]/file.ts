import type { APIRoute } from 'astro';
import { DocError, getDoc, MAX_UPLOAD_BYTES, replaceDraftFile } from '../../../../lib/docs';
import { files } from '../../../../lib/env';
import { fail, json, notFound, pdfResponse, unauthorized } from '../../../../lib/http';
import { PdfError } from '../../../../lib/pdf';

/** The original upload. */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const obj = await files().get(doc.file_key);
  if (!obj) return notFound();
  return pdfResponse(obj.body, doc.file_name);
};

/** Replace the PDF of a draft. */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail('errNotPdf');
  if (file.size > MAX_UPLOAD_BYTES) return fail('errTooLarge', 413);
  try {
    await replaceDraftFile(doc, file);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof PdfError || e instanceof DocError) return fail(e instanceof PdfError ? e.code : e.code, 400);
    throw e;
  }
};
