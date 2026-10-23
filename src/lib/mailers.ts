import { appUrl, orgName } from './env';
import { renderEmail, sendEmail, toBase64 } from './email';
import { formatDate } from './format';
import { dict, fill, isLang, type Lang } from './i18n';
import type { DocumentRow, SignerRow, User } from './types';

/** The emails Pulse Sign sends. Chrome is in the document's language. */

const langOf = (doc: DocumentRow): Lang => (isLang(doc.lang) ? doc.lang : 'th');
const logo = (request: Request) => `${appUrl(request)}/email-logo.png`;
/** Resend's limit is 40 MB per email including encoding overhead. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export async function signRequest(o: {
  doc: DocumentRow;
  signer: SignerRow;
  senderName: string;
  senderEmail: string;
  link: string;
  reminder: boolean;
  request: Request;
}) {
  const t = dict(langOf(o.doc));
  const subject =
    (o.reminder ? t.emReminderPrefix : '') + (o.doc.subject.trim() || fill(t.emSignSubjectFallback, { title: o.doc.title }));
  const expiry = o.doc.expires_at ? fill(t.emSignExpiry, { date: formatDate(o.doc.expires_at, langOf(o.doc)) }) : '';
  const body = renderEmail({
    logoUrl: logo(o.request),
    heading: o.doc.title,
    paragraphs: [fill(t.emSignIntro, { sender: o.senderName, org: orgName() })],
    quote: o.doc.message.trim() || undefined,
    button: { label: t.emSignBtn, url: o.link },
    footer: [expiry, t.linkPrivate, `${t.docId} ${o.doc.id}`].filter(Boolean),
  });
  await sendEmail({ to: o.signer.email, subject, replyTo: o.senderEmail, ...body });
}

export async function otp(o: { doc: DocumentRow; signer: SignerRow; code: string; request: Request }) {
  const t = dict(langOf(o.doc));
  const body = renderEmail({
    logoUrl: logo(o.request),
    heading: t.otpTitle,
    paragraphs: [fill(t.emOtpBody, { title: o.doc.title })],
    code: o.code,
    footer: [t.emOtpIgnore],
  });
  await sendEmail({ to: o.signer.email, subject: fill(t.emOtpSubject, { code: o.code }), ...body });
}

export async function login(o: { email: string; link: string; lang: Lang; request: Request }) {
  const t = dict(o.lang);
  const body = renderEmail({
    logoUrl: logo(o.request),
    heading: t.emLoginSubject,
    paragraphs: [t.emLoginBody],
    button: { label: t.emLoginBtn, url: o.link },
    footer: [t.emOtpIgnore],
  });
  await sendEmail({ to: o.email, subject: t.emLoginSubject, ...body });
}

export async function completed(o: {
  doc: DocumentRow;
  recipients: { name: string; email: string }[];
  pdf: Uint8Array;
  request: Request;
}) {
  const t = dict(langOf(o.doc));
  const attach = o.pdf.length <= MAX_ATTACHMENT_BYTES;
  const filename = `${o.doc.id}_signed.pdf`;
  const content = attach ? toBase64(o.pdf) : '';
  const body = renderEmail({
    logoUrl: logo(o.request),
    heading: fill(t.emDoneSubject, { title: o.doc.title }),
    paragraphs: [fill(t.emDoneBody, { title: o.doc.title }), ...(attach ? [] : [t.emDoneTooLarge])],
    footer: [`${t.docId} ${o.doc.id}`, `SHA-256 ${o.doc.hash_final}`, `${t.verifyLink}: ${appUrl(o.request)}/verify`],
  });
  const seen = new Set<string>();
  for (const r of o.recipients) {
    if (seen.has(r.email)) continue;
    seen.add(r.email);
    try {
      await sendEmail({
        to: r.email,
        subject: fill(t.emDoneSubject, { title: o.doc.title }),
        ...body,
        attachments: attach ? [{ filename, content }] : undefined,
      });
    } catch (e) {
      // One bad address must not stop the others from getting their copy.
      console.error(e);
    }
  }
}

export async function declined(o: { doc: DocumentRow; signer: SignerRow; reason: string; owner: User; request: Request }) {
  const t = dict(langOf(o.doc));
  const body = renderEmail({
    logoUrl: logo(o.request),
    heading: fill(t.emDeclinedSubject, { title: o.doc.title }),
    paragraphs: [fill(t.emDeclinedBody, { name: o.signer.name, email: o.signer.email, title: o.doc.title })],
    quote: o.reason || undefined,
    button: { label: t.emViewDoc, url: `${appUrl(o.request)}/docs/${o.doc.id}` },
  });
  await sendEmail({
    to: o.owner.email,
    subject: fill(t.emDeclinedSubject, { title: o.doc.title }),
    replyTo: o.signer.email,
    ...body,
  });
}
