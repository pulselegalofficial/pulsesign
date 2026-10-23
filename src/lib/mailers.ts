import { appUrl, orgName } from './env';
import { renderEmail, sendEmail } from './email';
import { formatDate } from './format';
import { dict, fill, isLang, type Lang } from './i18n';
import type { DocumentRow, SignerRow, User } from './types';

/** The emails Pulse Sign sends. Chrome is in the document's language. */

const langOf = (doc: DocumentRow): Lang => (isLang(doc.lang) ? doc.lang : 'th');
/** A signer's own language, falling back to the document's. */
const signerLang = (doc: DocumentRow, signer: { lang?: string | null }): Lang => (isLang(signer.lang) ? signer.lang : langOf(doc));

/**
 * The sender's subject and message go out as written, except when they are
 * still the defaults the wizard filled in. Those are replaced with the
 * defaults in the signer's language, so a foreign signer does not get a
 * Thai subject the lawyer never chose.
 */
export function localizedSubject(doc: Pick<DocumentRow, 'subject' | 'title'>, lang: Lang): string {
  const subject = doc.subject.trim();
  const defaults = (['th', 'en'] as Lang[]).map((l) => fill(dict(l).defSubject, { title: doc.title }).trim());
  if (!subject || defaults.includes(subject)) return fill(dict(lang).defSubject, { title: doc.title });
  return subject;
}

export function localizedMessage(doc: Pick<DocumentRow, 'message'>, lang: Lang): string {
  const message = doc.message.trim();
  const defaults = (['th', 'en'] as Lang[]).map((l) => dict(l).defMsg.trim());
  if (defaults.includes(message)) return dict(lang).defMsg;
  return message;
}
const logo = (request: Request) => `${appUrl(request)}/email-logo.png`;

export async function signRequest(o: {
  doc: DocumentRow;
  signer: SignerRow;
  senderName: string;
  senderEmail: string;
  link: string;
  reminder: boolean;
  request: Request;
}) {
  const lang = signerLang(o.doc, o.signer);
  const t = dict(lang);
  const subject = (o.reminder ? t.emReminderPrefix : '') + localizedSubject(o.doc, lang);
  const expiry = o.doc.expires_at ? fill(t.emSignExpiry, { date: formatDate(o.doc.expires_at, lang) }) : '';
  const body = renderEmail({
    logoUrl: logo(o.request),
    heading: o.doc.title,
    paragraphs: [fill(t.emSignIntro, { sender: o.senderName, org: orgName() })],
    quote: localizedMessage(o.doc, lang) || undefined,
    button: { label: t.emSignBtn, url: o.link },
    footer: [expiry, t.linkPrivate, `${t.docId} ${o.doc.id}`].filter(Boolean),
  });
  await sendEmail({ to: o.signer.email, subject, replyTo: o.senderEmail, ...body });
}

export async function otp(o: { doc: DocumentRow; signer: SignerRow; code: string; request: Request }) {
  const t = dict(signerLang(o.doc, o.signer));
  const body = renderEmail({
    logoUrl: logo(o.request),
    heading: t.otpTitle,
    paragraphs: [fill(t.emOtpBody, { title: o.doc.title })],
    code: o.code,
    footer: [t.emOtpIgnore],
  });
  await sendEmail({ to: o.signer.email, subject: fill(t.emOtpSubject, { code: o.code }), ...body });
}

export async function completed(o: {
  doc: DocumentRow;
  /** Each in their own language; the sender's falls back to the document's. */
  recipients: { name: string; email: string; lang?: string | null }[];
  /** Time-limited link to the signed PDF; Resend attaches it from there. */
  downloadUrl: string;
  request: Request;
}) {
  const render = (t: ReturnType<typeof dict>) =>
    renderEmail({
      logoUrl: logo(o.request),
      heading: fill(t.emDoneSubject, { title: o.doc.title }),
      paragraphs: [fill(t.emDoneBody, { title: o.doc.title })],
      button: { label: t.emDownload, url: o.downloadUrl },
      footer: [t.emDownloadExpiry, `${t.docId} ${o.doc.id}`, `SHA-256 ${o.doc.hash_final}`, `${t.verifyLink}: ${appUrl(o.request)}/verify`],
    });
  const attachments = [{ filename: `${o.doc.id}_signed.pdf`, path: o.downloadUrl }];
  const seen = new Set<string>();
  for (const r of o.recipients) {
    if (seen.has(r.email)) continue;
    seen.add(r.email);
    try {
      const t = dict(signerLang(o.doc, r));
      await sendEmail({ to: r.email, subject: fill(t.emDoneSubject, { title: o.doc.title }), ...render(t), attachments });
    } catch (e) {
      // One bad address must not stop the others from getting their copy.
      console.error(e);
    }
  }
}

/** Browser mode: tells the sender to open the document so the PDF gets built. */
export async function allSigned(o: { doc: DocumentRow; owner: User; link: string; request: Request }) {
  const t = dict(langOf(o.doc));
  const body = renderEmail({
    logoUrl: logo(o.request),
    heading: fill(t.emAllSignedSubject, { title: o.doc.title }),
    paragraphs: [fill(t.emAllSignedBody, { title: o.doc.title })],
    button: { label: t.emViewDoc, url: o.link },
    footer: [`${t.docId} ${o.doc.id}`],
  });
  await sendEmail({ to: o.owner.email, subject: fill(t.emAllSignedSubject, { title: o.doc.title }), ...body });
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
