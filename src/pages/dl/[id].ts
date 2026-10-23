import type { APIRoute } from 'astro';
import { byDownloadToken, signedFileName } from '../../lib/docs';
import { files } from '../../lib/env';
import { notFound, pdfResponse } from '../../lib/http';

/**
 * The download link in the completion email (30 days). Resend also fetches
 * the attachment from here when sending.
 */
export const GET: APIRoute = async ({ params, url }) => {
  const doc = await byDownloadToken(params.id!, url.searchParams.get('t') || '');
  if (!doc) return notFound();
  const obj = await files().get(doc.final_key!);
  if (!obj) return notFound();
  return pdfResponse(obj.body, signedFileName(doc), !url.searchParams.has('download'));
};
