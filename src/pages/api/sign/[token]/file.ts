import type { APIRoute } from 'astro';
import { files } from '../../../../lib/env';
import { notFound, pdfResponse, unauthorized } from '../../../../lib/http';
import { resolveSigner } from '../../../../lib/signer-session';
import { signedFileName } from '../../../../lib/docs';

/**
 * The document for the signer: the original while signing, the final signed
 * copy once everyone has signed. Only after the OTP check.
 */
export const GET: APIRoute = async ({ params, request, url }) => {
  const ctx = await resolveSigner(request, params.token!);
  if (!ctx) return notFound();
  if (!ctx.verified) return unauthorized();
  const signed = !!ctx.doc.final_key && ctx.doc.status === 'completed';
  const obj = await files().get(signed ? ctx.doc.final_key! : ctx.doc.file_key);
  if (!obj) return notFound();
  return pdfResponse(obj.body, signed ? signedFileName(ctx.doc) : ctx.doc.file_name, !url.searchParams.has('download'));
};
