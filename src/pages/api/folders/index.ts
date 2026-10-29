import type { APIRoute } from 'astro';
import { DocError, createFolder, listFolders } from '../../../lib/docs';
import { fail, json, readJson, unauthorized } from '../../../lib/http';

/** Folders for organising completed documents (dashboard only). */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return unauthorized();
  return json({ folders: (await listFolders()).map((f) => ({ id: f.id, name: f.name })) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return unauthorized();
  const body = await readJson<{ name?: unknown }>(request);
  if (!body) return fail('invalid_json');
  try {
    const f = await createFolder(body.name, locals.user);
    return json({ id: f.id, name: f.name }, 201);
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
