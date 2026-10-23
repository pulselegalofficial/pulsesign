import { env } from './env';

/**
 * Outgoing email through Resend (https://resend.com). Without RESEND_API_KEY
 * (local development) messages are printed to the console instead, including
 * the links and one-time codes, so the whole flow can be exercised offline.
 */

export interface Attachment {
  filename: string;
  /** Base64 content. */
  content: string;
}

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: Attachment[];
}

export async function sendEmail(message: Email): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = env();
  if (!RESEND_API_KEY) {
    console.log(
      `\n──── email (not sent: RESEND_API_KEY unset) ────\nTo: ${message.to}\nSubject: ${message.subject}\n` +
        `${message.text}\n${(message.attachments || []).map((a) => `[attachment ${a.filename}]`).join('\n')}\n────────────────\n`
    );
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM || 'Pulse Sign <sign@pulselegal.co>',
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo,
      attachments: message.attachments,
    }),
  });
  if (!res.ok) {
    throw new Error(`Email to ${message.to} failed: ${res.status} ${await res.text()}`);
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Layout {
  heading: string;
  /** Paragraphs of plain text (escaped here). */
  paragraphs: string[];
  /** Optional quoted block, e.g. the sender's message. */
  quote?: string;
  button?: { label: string; url: string };
  code?: string;
  footer?: string[];
  /** Absolute URL of the PNG logo (SVG is blocked by most mail clients). */
  logoUrl?: string;
}

/** One table-based template for every email; renders in all major clients. */
export function renderEmail(l: Layout): { html: string; text: string } {
  const p = (t: string) =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#33473D">${esc(t).replace(/\n/g, '<br>')}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#EEF5F0;font-family:Sarabun,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF5F0;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 16px;font-size:16px;font-weight:600;color:#00412F">
${l.logoUrl ? `<img src="${esc(l.logoUrl)}" width="28" height="28" alt="" style="vertical-align:middle;margin-right:8px;border:0">` : ''}<span style="vertical-align:middle">Pulse Sign</span></td></tr>
<tr><td style="background:#FFFFFF;border-radius:20px;padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#12261D">${esc(l.heading)}</h1>
${l.paragraphs.map(p).join('')}
${l.quote ? `<div style="background:#F6FAF7;border-radius:12px;padding:14px 16px;margin:0 0 16px">${p(l.quote).replace('margin:0 0 14px', 'margin:0')}</div>` : ''}
${l.code ? `<div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:32px;letter-spacing:8px;font-weight:600;color:#00412F;background:#EEF5F0;border-radius:12px;padding:16px;text-align:center;margin:0 0 16px">${esc(l.code)}</div>` : ''}
${l.button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px"><tr><td style="background:#00412F;border-radius:999px"><a href="${esc(l.button.url)}" style="display:inline-block;padding:13px 28px;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none">${esc(l.button.label)}</a></td></tr></table>` : ''}
${(l.footer || []).map((f) => `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#7E8C84">${esc(f)}</p>`).join('')}
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    l.heading,
    '',
    ...l.paragraphs,
    l.quote ? `\n"${l.quote}"\n` : '',
    l.code ? `\n${l.code}\n` : '',
    l.button ? `${l.button.label}: ${l.button.url}` : '',
    '',
    ...(l.footer || []),
  ]
    .filter((x) => x !== undefined)
    .join('\n');
  return { html, text };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
