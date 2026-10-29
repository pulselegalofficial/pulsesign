import type { APIRoute } from 'astro';
import { DocError, getDoc, moveToFolder } from '../../../../lib/docs';
import { fail, json, notFound, readJson, unauthorized } from '../../../../lib/http';

/** Files a completed document in a folder; `folderId: null` unfiles it. */
export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  const body = await readJson<{ folderId?: unknown }>(request);
  if (!body) return fail('invalid_json');
  const folderId = typeof body.folderId === 'string' && body.folderId ? body.folderId : null;
  try {
    await moveToFolder(doc, folderId);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
