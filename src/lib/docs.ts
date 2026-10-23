import { db, files, orgName, appUrl, pdfMode } from './env';
import { randomId, randomOtp, randomToken, safeEqual, sha256Hex } from './crypto';
import { buddhistYear, formatDate, formatFieldDate } from './format';
import { clampField } from './geometry';
import { isEmail } from './http';
import { dict, isLang, type Lang } from './i18n';
import type { FieldContent } from './pdf';
import { displayName } from './auth';
import * as mail from './mailers';
import {
  FIELD_TYPES,
  type DocStatus,
  type DocumentRow,
  type EventRow,
  type EventType,
  type FieldInput,
  type FieldRow,
  type SignerInput,
  type SignerRow,
  type User,
} from './types';

/**
 * Document lifecycle. Every state change happens here and writes its audit
 * event in the same place, so the trail cannot drift from what happened.
 *
 *   draft ─send→ sent ─(a signer opens)→ opened ─(all sign)→ completed
 *                  └──────────┴─→ declined | cancelled | expired
 *
 * A completed document gets its final PDF (fields stamped + certificate)
 * from `acceptFinal`. With PDF_MODE=browser the staff member's browser builds
 * it; with PDF_MODE=server `finalizeOnServer` does. pdf.ts is only imported
 * in server mode, so the Free-plan Worker never loads pdf-lib.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_SIGNERS = 10;
export const MAX_FIELDS = 200;
export const EXPIRY_CHOICES = [7, 14, 30];
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_GAP_MS = 45 * 1000;
const OTP_MAX_SENDS = 10;
const SIGNER_SESSION_MS = 2 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 1_500_000;
const DOWNLOAD_LINK_MS = 30 * 24 * 60 * 60 * 1000;

export const ACTIVE: DocStatus[] = ['sent', 'opened'];

export interface Actor {
  name: string;
  email?: string | null;
  ip?: string | null;
  ua?: string | null;
}

function eventStmt(docId: string, type: EventType, actor: Actor, detail: string | null = null, at = Date.now()) {
  return db()
    .prepare(
      'INSERT INTO events (doc_id, at, type, actor_name, actor_email, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(docId, at, type, actor.name, actor.email ?? null, detail, actor.ip ?? null, actor.ua ?? null);
}

export async function logEvent(docId: string, type: EventType, actor: Actor, detail: string | null = null) {
  await eventStmt(docId, type, actor, detail).run();
}

const systemActor = (lang: Lang): Actor => ({ name: dict(lang).system });
const docLang = (doc: DocumentRow): Lang => (isLang(doc.lang) ? doc.lang : 'th');

// ───────────────────────────── Reads ─────────────────────────────

export const getDoc = (id: string) =>
  db().prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<DocumentRow>();

export async function getSigners(docId: string): Promise<SignerRow[]> {
  const r = await db().prepare('SELECT * FROM signers WHERE doc_id = ? ORDER BY position').bind(docId).all<SignerRow>();
  return r.results;
}

export async function getFields(docId: string): Promise<FieldRow[]> {
  const r = await db().prepare('SELECT * FROM fields WHERE doc_id = ? ORDER BY page, y, x').bind(docId).all<FieldRow>();
  return r.results;
}

export async function getEvents(docId: string): Promise<EventRow[]> {
  const r = await db().prepare('SELECT * FROM events WHERE doc_id = ? ORDER BY id').bind(docId).all<EventRow>();
  return r.results;
}

export async function getUser(email: string): Promise<User> {
  const row = await db().prepare('SELECT email, name FROM users WHERE email = ?').bind(email).first<User>();
  return row || { email, name: '' };
}

export interface DocSummary extends DocumentRow {
  signers: Pick<SignerRow, 'name' | 'email' | 'status' | 'position'>[];
}

/** Every document in the firm, newest activity first. */
export async function listDocs(): Promise<DocSummary[]> {
  await expireDue();
  const [docs, signers] = await db().batch<DocumentRow | SignerRow>([
    db().prepare('SELECT * FROM documents ORDER BY updated_at DESC LIMIT 500'),
    db().prepare('SELECT doc_id, name, email, status, position FROM signers ORDER BY doc_id, position'),
  ]);
  const byDoc = new Map<string, DocSummary['signers']>();
  for (const s of signers.results as SignerRow[]) {
    const list = byDoc.get(s.doc_id) || [];
    list.push(s);
    byDoc.set(s.doc_id, list);
  }
  return (docs.results as DocumentRow[]).map((d) => ({ ...d, signers: byDoc.get(d.id) || [] }));
}

/** Marks documents whose links have passed their expiry date. */
export async function expireDue(now = Date.now()): Promise<void> {
  const expired = await db()
    .prepare(
      `UPDATE documents SET status = 'expired', updated_at = ?
       WHERE status IN ('sent', 'opened') AND expires_at IS NOT NULL AND expires_at < ? RETURNING id, lang, expires_at`
    )
    .bind(now, now)
    .all<{ id: string; lang: string; expires_at: number }>();
  if (!expired.results.length) return;
  await db().batch(
    expired.results.flatMap((d) => [
      eventStmt(d.id, 'expired', systemActor(isLang(d.lang) ? d.lang : 'th'), null, d.expires_at),
      db().prepare('UPDATE signers SET token_hash = NULL, session_hash = NULL WHERE doc_id = ?').bind(d.id),
    ])
  );
}

// ───────────────────────────── Drafts ─────────────────────────────

async function nextDocId(now: number): Promise<string> {
  const year = buddhistYear(now);
  const row = await db()
    .prepare(
      'INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value'
    )
    .bind(`doc:${year}`)
    .first<{ value: number }>();
  return `PS-${year}-${String(row!.value).padStart(4, '0')}`;
}

export function titleFromFileName(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 200) || 'Document';
}

export interface UploadMeta {
  fileName: string;
  /** Page count and SHA-256 measured by the browser (PDF_MODE=browser). */
  pages?: number;
  sha256?: string;
}

const isPdfHeader = (b: Uint8Array) => b.length > 8 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isHex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/**
 * Validates an upload and stores it. In browser mode the page count comes
 * from the browser (which opened the file with the same library that stamps
 * it later), and the browser's SHA-256 is handed to R2, which verifies it
 * against the bytes it received. Either way the Worker does no PDF parsing
 * or hashing of its own in browser mode.
 */
async function storePdf(key: string, bytes: Uint8Array, meta: UploadMeta): Promise<{ pages: number; hash: string }> {
  if (!isPdfHeader(bytes)) throw new DocError('errBadPdf');
  let pages: number;
  let hash: string;
  if (pdfMode() === 'server') {
    const { inspectPdf, PdfError } = await import('./pdf');
    try {
      pages = (await inspectPdf(bytes)).pages;
    } catch (e) {
      if (e instanceof PdfError) throw new DocError(e.code);
      throw e;
    }
    hash = await sha256Hex(bytes);
  } else {
    pages = Math.trunc(Number(meta.pages));
    if (!(pages >= 1 && pages <= 2000) || !isHex64(meta.sha256)) throw new DocError('errBadPdf');
    hash = meta.sha256;
  }
  try {
    await files().put(key, bytes, { httpMetadata: { contentType: 'application/pdf' }, sha256: hash });
  } catch {
    throw new DocError('hashMismatch');
  }
  return { pages, hash };
}

export async function createDraft(user: User, bytes: Uint8Array, meta: UploadMeta, lang: Lang, actor: Actor): Promise<DocumentRow> {
  const now = Date.now();
  const id = await nextDocId(now);
  const fileKey = `docs/${id}/original.pdf`;
  const { pages, hash } = await storePdf(fileKey, bytes, meta);
  const fileName = meta.fileName.slice(0, 200) || 'document.pdf';
  await db().batch([
    db()
      .prepare(
        `INSERT INTO documents (id, owner_email, title, file_name, file_key, file_size, pages, lang, status, hash_before, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
      )
      .bind(id, user.email, titleFromFileName(fileName), fileName, fileKey, bytes.length, pages, lang, hash, now, now),
    eventStmt(id, 'created', actor, null, now),
  ]);
  return (await getDoc(id))!;
}

export interface DraftInput {
  title?: string;
  signers?: SignerInput[];
  fields?: FieldInput[];
  sequential?: boolean;
  subject?: string;
  message?: string;
  expiryDays?: number;
}

export class DocError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

/** Replaces the editable parts of a draft. Signers and fields are rewritten. */
export async function saveDraft(doc: DocumentRow, input: DraftInput): Promise<void> {
  if (doc.status !== 'draft') throw new DocError('not_draft', 409);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const title = (input.title ?? doc.title).trim().slice(0, 200) || doc.title;
  const expiry = EXPIRY_CHOICES.includes(Number(input.expiryDays)) ? Number(input.expiryDays) : doc.expiry_days;
  stmts.push(
    db()
      .prepare('UPDATE documents SET title = ?, sequential = ?, subject = ?, message = ?, expiry_days = ?, updated_at = ? WHERE id = ?')
      .bind(
        title,
        input.sequential === undefined ? doc.sequential : input.sequential ? 1 : 0,
        (input.subject ?? doc.subject).slice(0, 300),
        (input.message ?? doc.message).slice(0, 5000),
        expiry,
        now,
        doc.id
      )
  );
  let signerCount: number | undefined;
  if (input.signers) {
    const signers = input.signers.slice(0, MAX_SIGNERS);
    signerCount = signers.length;
    stmts.push(db().prepare('DELETE FROM signers WHERE doc_id = ?').bind(doc.id));
    signers.forEach((s, position) => {
      stmts.push(
        db()
          .prepare('INSERT INTO signers (id, doc_id, position, name, email, lang) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(
            randomId('sgn'),
            doc.id,
            position,
            String(s.name || '').trim().slice(0, 200),
            String(s.email || '').trim().toLowerCase().slice(0, 254),
            isLang(s.lang) ? s.lang : docLang(doc)
          )
      );
    });
  }
  if (input.fields) {
    stmts.push(db().prepare('DELETE FROM fields WHERE doc_id = ?').bind(doc.id));
    for (const raw of input.fields.slice(0, MAX_FIELDS)) {
      if (!FIELD_TYPES.includes(raw.type)) continue;
      const page = Math.trunc(Number(raw.page));
      const signer = Math.trunc(Number(raw.signer));
      if (!(page >= 1 && page <= doc.pages)) continue;
      if (!(signer >= 0 && signer < (signerCount ?? MAX_SIGNERS))) continue;
      const nums = [raw.x, raw.y, raw.w, raw.h].map(Number);
      if (nums.some((n) => !Number.isFinite(n))) continue;
      const f = clampField({ x: nums[0], y: nums[1], w: nums[2], h: nums[3] });
      stmts.push(
        db()
          .prepare('INSERT INTO fields (id, doc_id, signer_pos, type, page, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(randomId('fld'), doc.id, signer, raw.type, page, f.x, f.y, f.w, f.h)
      );
    }
  }
  await db().batch(stmts);
}

/** Swaps the PDF of a draft. Fields beyond the new page count are dropped. */
export async function replaceDraftFile(doc: DocumentRow, bytes: Uint8Array, meta: UploadMeta): Promise<void> {
  if (doc.status !== 'draft') throw new DocError('not_draft', 409);
  const { pages, hash } = await storePdf(doc.file_key, bytes, meta);
  const fileName = meta.fileName.slice(0, 200) || 'document.pdf';
  const now = Date.now();
  await db().batch([
    db()
      .prepare('UPDATE documents SET file_name = ?, file_size = ?, pages = ?, hash_before = ?, title = ?, updated_at = ? WHERE id = ?')
      .bind(fileName, bytes.length, pages, hash, titleFromFileName(fileName), now, doc.id),
    db().prepare('DELETE FROM fields WHERE doc_id = ? AND page > ?').bind(doc.id, pages),
  ]);
}

/**
 * Permanently deletes a document in any status: every file in R2 (original,
 * signature images, signed PDF) and every row in D1 (signers, fields, audit
 * trail). Nothing is kept. Anything other than a draft must be confirmed by
 * passing its document number.
 *
 * Order matters so a failure can simply be retried: signing links are revoked
 * first, then files are removed, and the database rows go last, so a
 * half-finished delete still shows up in the dashboard to try again.
 */
export async function deleteDocument(doc: DocumentRow, confirmId: string | null): Promise<void> {
  if (doc.status !== 'draft' && confirmId !== doc.id) throw new DocError('confirm_required', 400);
  await db()
    .prepare('UPDATE signers SET token_hash = NULL, session_hash = NULL WHERE doc_id = ?')
    .bind(doc.id)
    .run();
  await db().prepare('UPDATE documents SET final_token_hash = NULL WHERE id = ?').bind(doc.id).run();

  const prefix = `docs/${doc.id}/`;
  const keys = new Set([doc.file_key, ...(doc.final_key ? [doc.final_key] : [])]);
  let cursor: string | undefined;
  do {
    const page = await files().list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) keys.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const all = [...keys];
  for (let i = 0; i < all.length; i += 1000) await files().delete(all.slice(i, i + 1000));

  await db().batch([
    db().prepare('DELETE FROM events WHERE doc_id = ?').bind(doc.id),
    db().prepare('DELETE FROM fields WHERE doc_id = ?').bind(doc.id),
    db().prepare('DELETE FROM signers WHERE doc_id = ?').bind(doc.id),
    db().prepare('DELETE FROM documents WHERE id = ?').bind(doc.id),
  ]);
}

/** Why a draft cannot be sent yet, or null when it can. */
export function draftProblem(doc: DocumentRow, signers: SignerRow[], fields: FieldRow[]): string | null {
  if (!signers.length) return 'needSigners';
  if (signers.some((s) => !s.name.trim() || !isEmail(s.email))) return 'needSigners';
  if (new Set(signers.map((s) => s.email)).size !== signers.length) return 'duplicate_signer';
  for (const s of signers) {
    if (!fields.some((f) => f.signer_pos === s.position && f.type === 'sig')) return 'needSig';
  }
  if (doc.status !== 'draft') return 'not_draft';
  return null;
}

// ───────────────────────────── Sending ─────────────────────────────

/** Issues a fresh signing link for a signer and emails it. */
async function inviteSigner(
  doc: DocumentRow,
  signer: SignerRow,
  sender: User,
  kind: 'sent' | 'reminded',
  actor: Actor,
  request: Request
): Promise<void> {
  const token = randomToken();
  const status = signer.status === 'waiting' ? 'sent' : signer.status;
  await db().batch([
    db().prepare('UPDATE signers SET token_hash = ?, status = ? WHERE id = ?').bind(await sha256Hex(token), status, signer.id),
    eventStmt(doc.id, kind, actor, signer.name),
  ]);
  await mail.signRequest({
    doc,
    signer,
    senderName: displayName(sender),
    senderEmail: sender.email,
    link: `${appUrl(request)}/s/${token}`,
    reminder: kind === 'reminded',
    request,
  });
}

export async function sendDoc(doc: DocumentRow, user: User, actor: Actor, request: Request): Promise<void> {
  const [signers, fields] = await Promise.all([getSigners(doc.id), getFields(doc.id)]);
  const problem = draftProblem(doc, signers, fields);
  if (problem) throw new DocError(problem, 400);
  const now = Date.now();
  // Claim the transition so a double click cannot send twice.
  const claimed = await db()
    .prepare(
      `UPDATE documents SET status = 'sent', sent_at = ?, expires_at = ?, updated_at = ?, owner_email = ?
       WHERE id = ? AND status = 'draft' RETURNING *`
    )
    .bind(now, now + doc.expiry_days * 24 * 60 * 60 * 1000, now, user.email, doc.id)
    .first<DocumentRow>();
  if (!claimed) throw new DocError('not_draft', 409);
  const first = claimed.sequential ? signers.slice(0, 1) : signers;
  for (const s of first) await inviteSigner(claimed, s, user, 'sent', actor, request);
}

/** Sends a new link to every signer whose turn it is. Old links stop working. */
export async function remind(doc: DocumentRow, user: User, actor: Actor, request: Request): Promise<number> {
  if (!ACTIVE.includes(doc.status)) throw new DocError('not_active', 409);
  const signers = (await getSigners(doc.id)).filter((s) => s.status === 'sent' || s.status === 'opened');
  const sender = await getUser(doc.owner_email);
  for (const s of signers) await inviteSigner(doc, s, sender.email ? sender : user, 'reminded', actor, request);
  await db().prepare('UPDATE documents SET updated_at = ? WHERE id = ?').bind(Date.now(), doc.id).run();
  return signers.length;
}

export async function cancelDoc(doc: DocumentRow, actor: Actor): Promise<void> {
  const now = Date.now();
  const claimed = await db()
    .prepare(`UPDATE documents SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('sent', 'opened') RETURNING id`)
    .bind(now, doc.id)
    .first();
  if (!claimed) throw new DocError('not_active', 409);
  await db().batch([
    db().prepare('UPDATE signers SET token_hash = NULL, session_hash = NULL WHERE doc_id = ?').bind(doc.id),
    eventStmt(doc.id, 'cancelled', actor, null, now),
  ]);
}

// ───────────────────────────── Signer side ─────────────────────────────

export interface SignerContext {
  doc: DocumentRow;
  signer: SignerRow;
}

/** Resolves a signing link. Cancelled and expired documents have no links. */
export async function bySignerToken(token: string): Promise<SignerContext | null> {
  if (!token || token.length > 100) return null;
  await expireDue();
  const signer = await db().prepare('SELECT * FROM signers WHERE token_hash = ?').bind(await sha256Hex(token)).first<SignerRow>();
  if (!signer) return null;
  const doc = await getDoc(signer.doc_id);
  if (!doc) return null;
  return { doc, signer };
}

export function hasSignerSession(signer: SignerRow, cookieValue: string | undefined, hashOfCookie: string | null): boolean {
  if (!cookieValue || !signer.session_hash || !hashOfCookie) return false;
  if (!signer.session_expires || signer.session_expires < Date.now()) return false;
  return safeEqual(signer.session_hash, hashOfCookie);
}

/** Records the first time a signer opens their link. */
export async function markOpened({ doc, signer }: SignerContext, actor: Actor): Promise<void> {
  if (signer.status !== 'sent' || !ACTIVE.includes(doc.status)) return;
  const now = Date.now();
  await db().batch([
    db().prepare(`UPDATE signers SET status = 'opened' WHERE id = ? AND status = 'sent'`).bind(signer.id),
    db().prepare(`UPDATE documents SET status = 'opened', updated_at = ? WHERE id = ? AND status = 'sent'`).bind(now, doc.id),
    eventStmt(doc.id, 'opened', actor, null, now),
  ]);
}

const otpHash = (signerId: string, code: string) => sha256Hex(`${signerId}:${code}`);

export async function sendOtp({ doc, signer }: SignerContext, actor: Actor, request: Request): Promise<void> {
  const now = Date.now();
  if (signer.otp_last_sent_at && now - signer.otp_last_sent_at < OTP_RESEND_GAP_MS) throw new DocError('otpWait', 429);
  if (signer.otp_sent_count >= OTP_MAX_SENDS) throw new DocError('tooManyRequests', 429);
  const code = randomOtp();
  await db().batch([
    db()
      .prepare(
        `UPDATE signers SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, otp_sent_count = otp_sent_count + 1, otp_last_sent_at = ? WHERE id = ?`
      )
      .bind(await otpHash(signer.id, code), now + OTP_TTL_MS, now, signer.id),
    eventStmt(doc.id, 'otp_sent', actor, null, now),
  ]);
  await mail.otp({ doc, signer, code, request });
}

/** Checks a code. On success returns a browser session token for this signer. */
export async function verifyOtp({ doc, signer }: SignerContext, code: string, actor: Actor): Promise<string> {
  const now = Date.now();
  if (!signer.otp_hash || !signer.otp_expires_at) throw new DocError('otpExpired', 400);
  if (signer.otp_attempts >= OTP_MAX_ATTEMPTS) throw new DocError('otpLocked', 429);
  if (signer.otp_expires_at < now) throw new DocError('otpExpired', 400);
  const ok = /^\d{6}$/.test(code) && safeEqual(signer.otp_hash, await otpHash(signer.id, code));
  if (!ok) {
    await db().batch([
      db().prepare('UPDATE signers SET otp_attempts = otp_attempts + 1 WHERE id = ?').bind(signer.id),
      eventStmt(doc.id, 'otp_failed', actor, null, now),
    ]);
    throw new DocError(signer.otp_attempts + 1 >= OTP_MAX_ATTEMPTS ? 'otpLocked' : 'otpWrong', 400);
  }
  const session = randomToken();
  await db().batch([
    db()
      .prepare(
        'UPDATE signers SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, otp_verified_at = ?, session_hash = ?, session_expires = ? WHERE id = ?'
      )
      .bind(now, await sha256Hex(session), now + SIGNER_SESSION_MS, signer.id),
    eventStmt(doc.id, 'otp_verified', actor, null, now),
  ]);
  return session;
}

export async function recordConsent({ doc, signer }: SignerContext, actor: Actor): Promise<void> {
  if (signer.consent_at) return;
  const now = Date.now();
  await db().batch([
    db().prepare('UPDATE signers SET consent_at = ? WHERE id = ?').bind(now, signer.id),
    eventStmt(doc.id, 'consent', actor, null, now),
  ]);
}

function decodeDataUrlPng(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) return null;
  try {
    const bin = atob(value.slice('data:image/png;base64,'.length));
    if (bin.length > MAX_IMAGE_BYTES || bin.length < 60) return null;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    // PNG signature.
    if (out[0] !== 0x89 || out[1] !== 0x50 || out[2] !== 0x4e || out[3] !== 0x47) return null;
    return out;
  } catch {
    return null;
  }
}

export interface SubmitResult {
  completed: boolean;
  nextSigner: string | null;
  signedAt: number;
}

/**
 * Records a signer's signature. `images` maps field id → PNG data URL for
 * their signature and initials fields; names and dates are filled in here from
 * the signer record and the server clock, so they cannot be back-dated.
 */
export async function submitSignature(
  ctx: SignerContext,
  images: Record<string, string>,
  actor: Actor,
  request: Request
): Promise<SubmitResult> {
  const { doc, signer } = ctx;
  if (!ACTIVE.includes(doc.status)) throw new DocError('not_active', 409);
  if (signer.status === 'signed') throw new DocError('alreadySigned', 409);
  if (!signer.consent_at) throw new DocError('consent_required', 400);

  const mine = (await getFields(doc.id)).filter((f) => f.signer_pos === signer.position);
  const now = Date.now();
  const lang = docLang(doc);
  const stillOpen = `(SELECT status FROM signers WHERE id = ?) IN ('sent', 'opened')
    AND (SELECT status FROM documents WHERE id = ?) IN ('sent', 'opened')`;
  const stmts: D1PreparedStatement[] = [];
  const uploads: [string, Uint8Array][] = [];
  for (const f of mine) {
    let value: string;
    if (f.type === 'sig' || f.type === 'initial') {
      const png = decodeDataUrlPng(images[f.id]);
      if (!png) throw new DocError('missing_field', 400);
      value = `docs/${doc.id}/fields/${f.id}.png`;
      uploads.push([value, png]);
    } else if (f.type === 'name') {
      value = signer.name;
    } else {
      value = formatFieldDate(now);
    }
    stmts.push(
      db().prepare(`UPDATE fields SET value = ?, filled_at = ? WHERE id = ? AND ${stillOpen}`).bind(value, now, f.id, signer.id, doc.id)
    );
  }
  await Promise.all(uploads.map(([key, png]) => files().put(key, png, { httpMetadata: { contentType: 'image/png' } })));

  // One transaction. If another request signed or the request was cancelled
  // in the meantime, every statement is a no-op and nothing is recorded.
  const signerUpdate = db()
    .prepare(`UPDATE signers SET status = 'signed', signed_at = ?, ip = ?, user_agent = ? WHERE id = ? AND ${stillOpen}`)
    .bind(now, actor.ip ?? null, actor.ua ?? null, signer.id, signer.id, doc.id);
  const results = await db().batch([...stmts, signerUpdate]);
  if (!results[results.length - 1].meta.changes) throw new DocError('alreadySigned', 409);
  await db().batch([
    eventStmt(doc.id, 'signed', actor, null, now),
    db().prepare('UPDATE documents SET updated_at = ? WHERE id = ?').bind(now, doc.id),
  ]);

  const signers = await getSigners(doc.id);
  const pending = signers.filter((s) => s.status !== 'signed');
  if (!pending.length) {
    await complete(doc.id, request);
    return { completed: true, nextSigner: null, signedAt: now };
  }
  let nextSigner: string | null = null;
  if (doc.sequential) {
    const next = signers.find((s) => s.status === 'waiting');
    if (next && !signers.some((s) => s.status === 'sent' || s.status === 'opened')) {
      const owner = await getUser(doc.owner_email);
      await inviteSigner(doc, next, owner, 'sent', systemActor(lang), request);
      nextSigner = next.name;
    }
  }
  return { completed: false, nextSigner, signedAt: now };
}

export async function declineSignature(ctx: SignerContext, reason: string, actor: Actor, request: Request): Promise<void> {
  const { doc, signer } = ctx;
  const now = Date.now();
  const claimed = await db()
    .prepare(`UPDATE documents SET status = 'declined', updated_at = ? WHERE id = ? AND status IN ('sent', 'opened') RETURNING id`)
    .bind(now, doc.id)
    .first();
  if (!claimed) throw new DocError('not_active', 409);
  const text = reason.trim().slice(0, 1000);
  await db().batch([
    db().prepare(`UPDATE signers SET status = 'declined', declined_at = ?, decline_reason = ?, ip = ?, user_agent = ? WHERE id = ?`)
      .bind(now, text, actor.ip ?? null, actor.ua ?? null, signer.id),
    // Everyone else's link stops working; the decliner keeps theirs to see the result.
    db().prepare('UPDATE signers SET token_hash = NULL, session_hash = NULL WHERE doc_id = ? AND id != ?').bind(doc.id, signer.id),
    eventStmt(doc.id, 'declined', actor, text || null, now),
  ]);
  const owner = await getUser(doc.owner_email);
  await mail.declined({ doc, signer, reason: text, owner, request });
}

// ───────────────────────────── Completion ─────────────────────────────

async function readR2(key: string): Promise<Uint8Array> {
  const obj = await files().get(key);
  if (!obj) throw new Error(`Missing file ${key}`);
  return new Uint8Array(await obj.arrayBuffer());
}

/**
 * Every party has signed. Records completion, then either builds the final
 * PDF here (server mode) or tells the sender to open the document so their
 * browser builds it (browser mode).
 */
async function complete(docId: string, request: Request): Promise<void> {
  const now = Date.now();
  const doc = await db()
    .prepare(
      `UPDATE documents SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('sent', 'opened') RETURNING *`
    )
    .bind(now, now, docId)
    .first<DocumentRow>();
  if (!doc) return;
  await eventStmt(doc.id, 'completed', systemActor(docLang(doc)), null, now).run();
  if (pdfMode() === 'server') {
    try {
      await finalizeOnServer(doc, request);
      return;
    } catch (e) {
      // The signature is recorded; a staff browser can still build the PDF.
      console.error(e);
    }
  }
  const owner = await getUser(doc.owner_email);
  await mail.allSigned({ doc, owner, link: `${appUrl(request)}/docs/${doc.id}`, request });
}

/** Everything a browser needs to build the final PDF, minus the binaries. */
export async function finalizeInput(doc: DocumentRow, request: Request) {
  const [signers, fields, events, owner] = await Promise.all([getSigners(doc.id), getFields(doc.id), getEvents(doc.id), getUser(doc.owner_email)]);
  return {
    doc: {
      id: doc.id,
      title: doc.title,
      pages: doc.pages,
      lang: doc.lang,
      hash_before: doc.hash_before,
      created_at: doc.created_at,
      completed_at: doc.completed_at,
    },
    signers: signers.map((s) => ({
      id: s.id,
      position: s.position,
      name: s.name,
      email: s.email,
      signed_at: s.signed_at,
      otp_verified_at: s.otp_verified_at,
      ip: s.ip,
      user_agent: s.user_agent,
    })),
    events: events.map((e) => ({ type: e.type, at: e.at, actor_name: e.actor_name, detail: e.detail, ip: e.ip })),
    fields: fields
      .filter((f) => f.value)
      .map((f) => ({
        id: f.id,
        signer_pos: f.signer_pos,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        // Text for name/date; images are fetched separately.
        value: f.type === 'sig' || f.type === 'initial' ? null : f.value,
      })),
    senderName: displayName(owner),
    orgName: orgName(),
    verifyUrl: `${appUrl(request)}/verify`,
  };
}

/** A signature or initials image, for building the final PDF. */
export async function fieldImage(doc: DocumentRow, fieldId: string): Promise<R2ObjectBody | null> {
  const f = await db().prepare('SELECT value, type FROM fields WHERE id = ? AND doc_id = ?').bind(fieldId, doc.id).first<{ value: string | null; type: string }>();
  if (!f?.value || (f.type !== 'sig' && f.type !== 'initial')) return null;
  return files().get(f.value);
}

/**
 * Stores the final signed PDF, records its hash and emails everyone. Called
 * with the browser's PDF in browser mode and the Worker's in server mode.
 * R2 checks the bytes against `sha256`. The first PDF to arrive wins.
 */
export async function acceptFinal(doc: DocumentRow, bytes: Uint8Array, sha256: string, request: Request): Promise<void> {
  if (doc.status !== 'completed' || doc.final_key) throw new DocError('not_needed', 409);
  if (!isPdfHeader(bytes) || !isHex64(sha256)) throw new DocError('errBadPdf');
  const key = `docs/${doc.id}/signed-${sha256.slice(0, 16)}.pdf`;
  try {
    await files().put(key, bytes, { httpMetadata: { contentType: 'application/pdf' }, sha256 });
  } catch {
    throw new DocError('hashMismatch');
  }
  const token = randomToken();
  const now = Date.now();
  const updated = await db()
    .prepare(
      `UPDATE documents SET hash_final = ?, final_key = ?, final_token_hash = ?, final_token_expires = ?, updated_at = ?
       WHERE id = ? AND status = 'completed' AND final_key IS NULL RETURNING *`
    )
    .bind(sha256, key, await sha256Hex(token), now + DOWNLOAD_LINK_MS, now, doc.id)
    .first<DocumentRow>();
  if (!updated) {
    // Another browser got there first. Remove this copy unless it is the same file.
    const current = await getDoc(doc.id);
    if (current?.final_key !== key) await files().delete(key);
    throw new DocError('not_needed', 409);
  }
  const [signers, owner] = await Promise.all([getSigners(doc.id), getUser(doc.owner_email)]);
  await mail.completed({
    doc: updated,
    recipients: [...signers.map((s) => ({ name: s.name, email: s.email, lang: s.lang })), { name: displayName(owner), email: owner.email }],
    downloadUrl: `${appUrl(request)}/dl/${doc.id}?t=${token}`,
    request,
  });
}

/** Server mode: stamps every field and appends the certificate in the Worker. */
async function finalizeOnServer(doc: DocumentRow, request: Request): Promise<void> {
  const { buildSignedPdf } = await import('./pdf');
  const input = await finalizeInput(doc, request);
  const fields = await getFields(doc.id);
  const contents: FieldContent[] = [];
  const signatures = new Map<number, Uint8Array>();
  for (const f of fields) {
    if (!f.value) continue;
    if (f.type === 'sig' || f.type === 'initial') {
      const image = await readR2(f.value);
      contents.push({ field: f, image });
      if (f.type === 'sig' && !signatures.has(f.signer_pos)) signatures.set(f.signer_pos, image);
    } else {
      contents.push({ field: f, text: f.value });
    }
  }
  const bytes = await buildSignedPdf(await readR2(doc.file_key), contents, {
    doc,
    signers: await getSigners(doc.id),
    events: await getEvents(doc.id),
    signatures,
    senderName: input.senderName,
    orgName: input.orgName,
    verifyUrl: input.verifyUrl,
  });
  await acceptFinal(doc, bytes, await sha256Hex(bytes), request);
}

/** Resolves the download link from the completion email. */
export async function byDownloadToken(docId: string, token: string): Promise<DocumentRow | null> {
  if (!token || token.length > 100) return null;
  const doc = await getDoc(docId);
  if (!doc?.final_key || !doc.final_token_hash || !doc.final_token_expires) return null;
  if (doc.final_token_expires < Date.now()) return null;
  return safeEqual(doc.final_token_hash, await sha256Hex(token)) ? doc : null;
}

export function signedFileName(doc: DocumentRow): string {
  return `${doc.id}_${doc.file_name.replace(/\.pdf$/i, '')}_signed.pdf`;
}

/** Looks up a completed document by the SHA-256 of a downloaded copy. */
export async function findByHash(hash: string) {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const doc = await db()
    .prepare(`SELECT * FROM documents WHERE hash_final = ? AND status = 'completed'`)
    .bind(hash)
    .first<DocumentRow>();
  if (!doc) return null;
  return { doc, signers: await getSigners(doc.id) };
}
