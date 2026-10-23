import type { APIRoute } from 'astro';
import { DocError, deleteDocument, getDoc, getFields, getSigners, saveDraft, type DraftInput } from '../../../../lib/docs';
import { fail, json, notFound, readJson, unauthorized } from '../../../../lib/http';

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const [signers, fields] = await Promise.all([getSigners(doc.id), getFields(doc.id)]);
  return json({
    doc: {
      id: doc.id,
      title: doc.title,
      fileName: doc.file_name,
      fileSize: doc.file_size,
      pages: doc.pages,
      status: doc.status,
      sequential: !!doc.sequential,
      subject: doc.subject,
      message: doc.message,
      expiryDays: doc.expiry_days,
    },
    signers: signers.map((s) => ({ name: s.name, email: s.email, lang: s.lang })),
    fields: fields.map((f) => ({ signer: f.signer_pos, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h })),
  });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const body = await readJson<DraftInput>(request);
  if (!body) return fail('invalid_json');
  try {
    await saveDraft(doc, body);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};

/**
 * Permanently deletes a document and all its files. Anything other than a
 * draft needs `?confirm=<document number>`.
 */
export const DELETE: APIRoute = async ({ params, locals, url }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  try {
    await deleteDocument(doc, url.searchParams.get('confirm'));
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
