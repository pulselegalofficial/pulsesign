import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { buildSignedPdf, inspectPdf, wrapText, PdfError } from '../lib/pdf';
import type { DocumentRow, EventRow, FieldRow, SignerRow } from '../lib/types';

// 1x1 opaque PNG (black pixel).
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);

async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]).setRotation(degrees(90));
  return pdf.save();
}

const now = Date.UTC(2026, 9, 22, 7, 0, 0);
const doc: DocumentRow = {
  id: 'PS-2569-0001', owner_email: 'n@pulselegal.co', title: 'สัญญาว่าจ้างที่ปรึกษากฎหมาย – บจก. สยามฟู้ดส์ ฉบับที่มีชื่อยาวมากเพื่อทดสอบการตัดบรรทัด',
  file_name: 'a.pdf', file_key: 'k', file_size: 1, pages: 2, lang: 'th', status: 'completed', sequential: 1,
  subject: '', message: '', expiry_days: 14, hash_before: 'a'.repeat(64), hash_final: null, final_key: null, final_token_hash: null, final_token_expires: null,
  created_at: now, updated_at: now, sent_at: now, expires_at: now, completed_at: now + 60_000,
};
const signer = (position: number, name: string, email: string): SignerRow => ({
  id: `sgn_${position}abcdefgh`, doc_id: doc.id, position, name, email, lang: 'th', status: 'signed', token_hash: null, otp_hash: null,
  otp_expires_at: null, otp_attempts: 0, otp_sent_count: 1, otp_last_sent_at: now, session_hash: null, session_expires: null,
  otp_verified_at: now, consent_at: now, signed_at: now + 30_000, declined_at: null, decline_reason: null, ip: '49.228.47.112',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari/604.1',
});
const field = (id: string, type: FieldRow['type'], page: number): FieldRow => ({
  id, doc_id: doc.id, signer_pos: 0, type, page, x: 0.1, y: 0.7, w: 0.3, h: 0.06, value: 'x', filled_at: now,
});

describe('inspectPdf', () => {
  it('counts pages', async () => {
    expect(await inspectPdf(await samplePdf())).toEqual({ pages: 2 });
  });
  it('rejects files that are not PDFs', async () => {
    await expect(inspectPdf(new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(PdfError);
  });
});

describe('buildSignedPdf', () => {
  it('stamps fields, including on a rotated page, and appends the certificate', async () => {
    const signers = [signer(0, 'สมชาย ใจดี', 'somchai@siamfoods.co.th'), signer(1, 'ปู่ ญี่ปุ่น', 'p@example.com')];
    const events: EventRow[] = Array.from({ length: 40 }, (_, i) => ({
      id: i, doc_id: doc.id, at: now + i * 1000, type: (['created', 'sent', 'opened', 'otp_verified', 'consent', 'signed'] as const)[i % 6],
      actor_name: 'ณัฐพล วงศ์ใหญ่', actor_email: null, detail: 'สมชาย ใจดี', ip: '203.150.12.44', user_agent: null,
    }));
    const out = await buildSignedPdf(
      await samplePdf(),
      [
        { field: field('f1', 'sig', 1), image: PNG },
        { field: field('f2', 'name', 1), text: 'สมชาย ใจดี' },
        { field: field('f3', 'date', 2), text: '22 ต.ค. 2569' },
        { field: field('f4', 'initial', 2), image: PNG },
      ],
      { doc, signers, events, signatures: new Map([[0, PNG]]), senderName: 'ณัฐพล วงศ์ใหญ่', orgName: 'Pulse Legal', verifyUrl: 'https://sign.pulselegal.co/verify' }
    );
    const result = await PDFDocument.load(out);
    // 2 original pages + a certificate long enough to need 2 pages.
    expect(result.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(result.getPage(1).getRotation().angle).toBe(90);
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, out);
  });
});

describe('wrapText', () => {
  it('breaks Thai text between words, not mid-word', async () => {
    const pdf = await PDFDocument.create();
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    pdf.registerFontkit(fontkit);
    const { readFileSync } = await import('node:fs');
    const font = await pdf.embedFont(readFileSync(new URL('../assets/fonts/Sarabun-Regular.ttf', import.meta.url)));
    const lines = wrapText('ข้าพเจ้าตกลงใช้ลายมือชื่ออิเล็กทรอนิกส์ในการลงนามเอกสารนี้', font, 12, 120);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('ข้าพเจ้าตกลงใช้ลายมือชื่ออิเล็กทรอนิกส์ในการลงนามเอกสารนี้');
    for (const l of lines) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(120);
  });
});
