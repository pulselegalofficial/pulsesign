import { MAX_UPLOAD_BYTES, type UploadMeta } from './docs';

/**
 * Reads a PDF upload. The browser sends the raw file as the request body, with
 * its name, page count and SHA-256 in headers. A raw body avoids multipart
 * parsing, which would cost CPU time the Free plan doesn't have.
 */
export async function readUpload(request: Request): Promise<{ bytes: Uint8Array; meta: UploadMeta } | { error: string; status: number }> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_UPLOAD_BYTES) return { error: 'errTooLarge', status: 413 };
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return { error: 'errNotPdf', status: 400 };
  if (bytes.length > MAX_UPLOAD_BYTES) return { error: 'errTooLarge', status: 413 };
  let fileName = 'document.pdf';
  try {
    fileName = decodeURIComponent(request.headers.get('x-file-name') || '') || fileName;
  } catch {
    /* keep the default */
  }
  return {
    bytes,
    meta: {
      fileName,
      pages: Number(request.headers.get('x-pages') || 0) || undefined,
      sha256: (request.headers.get('x-sha256') || '').toLowerCase() || undefined,
    },
  };
}
