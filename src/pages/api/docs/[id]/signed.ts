import type { APIRoute } from 'astro';
import { getDoc, signedFileName } from '../../../../lib/docs';
import { files } from '../../../../lib/env';
import { notFound, pdfResponse, unauthorized } from '../../../../lib/http';

/** The final signed PDF with its certificate. `?download` forces a download. */
export const GET: APIRoute = async ({ params, locals, url }) => {
  if (!locals.user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc?.final_key) return notFound();
  const obj = await files().get(doc.final_key);
  if (!obj) return notFound();
  return pdfResponse(obj.body, signedFileName(doc), !url.searchParams.has('download'));
};
