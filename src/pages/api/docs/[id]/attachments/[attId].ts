import type { APIRoute } from 'astro';
import { attachmentInline, deleteAttachment, getAttachment, getDoc, updateAttachmentNote } from '../../../../../lib/docs';
import { files } from '../../../../../lib/env';
import { fail, json, notFound, readJson, unauthorized } from '../../../../../lib/http';

/**
 * Opens or downloads an attachment. Only PDFs, images and plain text open in
 * the browser; anything else is always a download, and the response is
 * sandboxed so an uploaded file can never run script on this origin.
 */
export const GET: APIRoute = async ({ params, locals, url }) => {
  if (!locals.user) return unauthorized();
  const att = await getAttachment(params.id!, params.attId!);
  if (!att) return notFound();
  const obj = await files().get(att.r2_key);
  if (!obj) return notFound();
  const inline = attachmentInline(att.content_type) && !url.searchParams.has('download');
  const ascii = att.name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return new Response(obj.body, {
    headers: {
      'content-type': att.content_type === 'text/plain' ? 'text/plain; charset=utf-8' : att.content_type,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(att.name)}`,
      'cache-control': 'private, no-store',
      // Chrome will not show PDFs under a sandbox CSP; its viewer is isolated anyway.
      ...(att.content_type === 'application/pdf' ? {} : { 'x-sandbox': '1' }),
    },
  });
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const att = await getAttachment(params.id!, params.attId!);
  if (!att) return notFound();
  const body = await readJson<{ note?: unknown }>(request);
  if (!body) return fail('invalid_json');
  await updateAttachmentNote(att, body.note);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const att = await getAttachment(doc.id, params.attId!);
  if (!att) return notFound();
  await deleteAttachment(att);
  return json({ ok: true });
};
