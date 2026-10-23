/**
 * PDF work that runs in the staff member's browser, so the Worker stays within
 * the Cloudflare Free plan's 10 ms of CPU per request (PDF_MODE=browser).
 * It uses the same code the Worker would (src/lib/pdf.ts), loaded on demand.
 */
import { api } from './ui';
import type { DocumentRow, EventRow, FieldRow, SignerRow } from '../lib/types';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class UploadCheckError extends Error {
  constructor(public code: 'errBadPdf' | 'errEncrypted') {
    super(code);
  }
}

/**
 * Opens a PDF with the library that will later stamp it, so a file accepted
 * here is one the final step can process. Returns what the upload sends.
 */
export async function inspectUpload(file: File): Promise<{ bytes: Uint8Array; pages: number; sha256: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { inspectPdf, PdfError } = await import('../lib/pdf');
  try {
    const { pages } = await inspectPdf(bytes);
    return { bytes, pages, sha256: await sha256Hex(bytes) };
  } catch (e) {
    if (e instanceof PdfError) throw new UploadCheckError(e.code);
    throw e;
  }
}

/** Sends a checked PDF as the raw request body (see src/lib/upload.ts). */
export function uploadInit(file: File, checked: { bytes: Uint8Array; pages: number; sha256: string }): RequestInit {
  return {
    method: 'POST',
    body: checked.bytes as BodyInit,
    headers: {
      'content-type': 'application/pdf',
      'x-file-name': encodeURIComponent(file.name),
      'x-pages': String(checked.pages),
      'x-sha256': checked.sha256,
    },
  };
}

interface FinalizeData {
  doc: Pick<DocumentRow, 'id' | 'title' | 'pages' | 'lang' | 'hash_before' | 'created_at' | 'completed_at'>;
  signers: Pick<SignerRow, 'id' | 'position' | 'name' | 'email' | 'signed_at' | 'otp_verified_at' | 'ip' | 'user_agent'>[];
  events: Pick<EventRow, 'type' | 'at' | 'actor_name' | 'detail' | 'ip'>[];
  fields: (Pick<FieldRow, 'id' | 'signer_pos' | 'type' | 'page' | 'x' | 'y' | 'w' | 'h'> & { value: string | null })[];
  senderName: string;
  orgName: string;
  verifyUrl: string;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Builds the final signed PDF of a completed document (fields stamped,
 * certificate appended) and uploads it. The server stores it, records its
 * hash and emails everyone. Safe to run from two tabs at once: the first
 * upload wins and the other gets `not_needed`.
 */
export async function finalizeDocument(id: string): Promise<void> {
  const data = await api<FinalizeData>(`/api/docs/${id}/finalize-data`);
  const [{ buildSignedPdf }, original] = await Promise.all([import('../lib/pdf'), fetchBytes(`/api/docs/${id}/file`)]);
  const contents = [];
  const signatures = new Map<number, Uint8Array>();
  for (const f of data.fields) {
    const field = { ...f, doc_id: id, filled_at: null } as FieldRow;
    if (f.type === 'sig' || f.type === 'initial') {
      const image = await fetchBytes(`/api/docs/${id}/field-image/${encodeURIComponent(f.id)}`);
      contents.push({ field, image });
      if (f.type === 'sig' && !signatures.has(f.signer_pos)) signatures.set(f.signer_pos, image);
    } else if (f.value) {
      contents.push({ field, text: f.value });
    }
  }
  const bytes = await buildSignedPdf(original, contents, {
    doc: data.doc as DocumentRow,
    signers: data.signers as SignerRow[],
    events: data.events as EventRow[],
    signatures,
    senderName: data.senderName,
    orgName: data.orgName,
    verifyUrl: data.verifyUrl,
  });
  await api(`/api/docs/${id}/final`, {
    method: 'POST',
    body: bytes as BodyInit,
    headers: { 'content-type': 'application/pdf', 'x-sha256': await sha256Hex(bytes) },
  });
}
