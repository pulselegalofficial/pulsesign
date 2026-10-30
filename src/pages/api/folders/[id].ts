import type { APIRoute } from 'astro';
import { DocError, deleteFolder, renameFolder } from '../../../lib/docs';
import { fail, json, readJson, unauthorized } from '../../../lib/http';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return unauthorized();
  const body = await readJson<{ name?: unknown }>(request);
  if (!body) return fail('invalid_json');
  try {
    await renameFolder(params.id!, body.name);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};

/** Deletes the folder only; its documents become unfiled. */
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return unauthorized();
  await deleteFolder(params.id!);
  return json({ ok: true });
};
