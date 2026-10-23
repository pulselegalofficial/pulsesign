import {
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  StandardFonts,
  beginText,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  type RGB,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sarabunRegularUrl from '../assets/fonts/Sarabun-Regular.ttf?inline';
import sarabunSemiBoldUrl from '../assets/fonts/Sarabun-SemiBold.ttf?inline';
import { fitContain, placeField, type Box } from './geometry';
import { formatDate, describeUserAgent } from './format';
import { dict, fill, type Lang } from './i18n';
import type { DocumentRow, EventRow, FieldRow, SignerRow } from './types';

/** Thrown for uploads that are not usable PDFs; `code` is an i18n key. */
export class PdfError extends Error {
  constructor(public code: 'errBadPdf' | 'errEncrypted') {
    super(code);
  }
}

/** Reads an upload far enough to reject unusable files and count pages. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pages: number }> {
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new PdfError('errBadPdf'); // must start with %PDF
  }
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (e instanceof Error && /encrypt/i.test(e.message)) throw new PdfError('errEncrypted');
    throw new PdfError('errBadPdf');
  }
  if (pdf.isEncrypted) throw new PdfError('errEncrypted');
  const pages = pdf.getPageCount();
  if (pages < 1) throw new PdfError('errBadPdf');
  return { pages };
}

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const INK = rgb(0x12 / 255, 0x26 / 255, 0x1d / 255);
const FOREST = rgb(0, 0x41 / 255, 0x2f / 255);
const PULSE = rgb(1, 0x7a / 255, 0x12 / 255);
const MUTED = rgb(0x4f / 255, 0x63 / 255, 0x59 / 255);
const FAINT = rgb(0x7e / 255, 0x8c / 255, 0x84 / 255);
const MINT = rgb(0xee / 255, 0xf5 / 255, 0xf0 / 255);
const LINE = rgb(0xe1 / 255, 0xeb / 255, 0xe5 / 255);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

/**
 * pdf-lib writes glyph widths (/W) only for glyphs reachable from the cmap.
 * Thai shaping substitutes tone marks with alternates (uni0E48.small and
 * .narrow, for stacking over upper vowels) that are not in the cmap, so they
 * got the default 1000-unit width: a visible gap and a misplaced mark.
 * Writing widths for every glyph in the font fixes it.
 */
function writeAllGlyphWidths(font: PDFFont) {
  const embedder = (font as unknown as { embedder: { font: { numGlyphs: number; getGlyph(id: number): { advanceWidth: number } }; scale: number; computeWidths: () => unknown[] } }).embedder;
  const fk = embedder.font;
  embedder.computeWidths = () => {
    const widths: number[] = [];
    for (let id = 0; id < fk.numGlyphs; id++) widths.push(Math.round(fk.getGlyph(id).advanceWidth * embedder.scale));
    return [0, widths];
  };
}

interface ShapingFont {
  unitsPerEm: number;
  layout(text: string, features?: unknown): {
    glyphs: { id: number; advanceWidth: number }[];
    positions: { xAdvance: number; xOffset: number; yOffset: number }[];
  };
}

/**
 * Draws text with the glyph positioning from the font's GPOS table applied.
 *
 * pdf-lib's drawText uses shaped glyphs but drops their offsets, which for
 * Thai means a tone mark after a lower vowel (ปู่, ปุ่น) lands on the
 * consonant's tall stem and disappears. Here each mark is shifted with the
 * TJ operator's per-glyph adjustments instead.
 */
function drawShaped(
  page: PDFPage,
  text: string,
  o: { x: number; y: number; size: number; font: PDFFont; color: RGB; rotate?: number }
) {
  const embedder = (o.font as unknown as { embedder?: { font: ShapingFont; fontFeatures?: unknown } }).embedder;
  if (!embedder?.font?.layout) {
    // Standard 14 fonts have no shaping; let pdf-lib draw them.
    page.drawText(text, { x: o.x, y: o.y, size: o.size, font: o.font, color: o.color, rotate: degrees(o.rotate || 0) });
    return;
  }
  const fk = embedder.font;
  const scale = 1000 / fk.unitsPerEm;
  const run = fk.layout(text, embedder.fontFeatures);
  const items: (PDFHexString | PDFNumber)[] = [];
  let hex = '';
  const flush = () => {
    if (hex) items.push(PDFHexString.of(hex));
    hex = '';
  };
  const shift = (thousandths: number) => {
    if (!thousandths) return;
    flush();
    // In TJ a positive number moves the next glyph left.
    items.push(PDFNumber.of(Math.round(-thousandths * 100) / 100));
  };
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    const dx = pos.xOffset * scale;
    shift(dx);
    hex += g.id.toString(16).padStart(4, '0');
    shift(-dx);
    shift((pos.xAdvance - g.advanceWidth) * scale);
  });
  flush();
  if (!items.length) return;
  const key = page.node.newFontDictionary(o.font.name, o.font.ref);
  const rad = ((o.rotate || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFillingColor(o.color),
    setFontAndSize(key, o.size),
    setTextMatrix(cos, sin, -sin, cos, o.x, o.y),
    PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [page.doc.context.obj(items)]),
    endText(),
    popGraphicsState()
  );
}

async function embedFonts(pdf: PDFDocument): Promise<Fonts> {
  pdf.registerFontkit(fontkit);
  // Full embedding: the alternates above are only reachable through shaping,
  // and pdf-lib's subsetter keeps only cmap glyphs.
  const [regular, bold, mono] = await Promise.all([
    pdf.embedFont(dataUrlBytes(sarabunRegularUrl), { subset: false }),
    pdf.embedFont(dataUrlBytes(sarabunSemiBoldUrl), { subset: false }),
    pdf.embedFont(StandardFonts.Courier),
  ]);
  writeAllGlyphWidths(regular);
  writeAllGlyphWidths(bold);
  return { regular, bold, mono };
}

/**
 * Splits text into lines no wider than `maxWidth`. Thai has no spaces between
 * words, so break opportunities come from Intl.Segmenter; a single segment
 * wider than the line is broken by character.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let segments: string[];
    try {
      segments = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(paragraph)].map((s) => s.segment);
    } catch {
      segments = paragraph.split(/(\s+)/);
    }
    let line = '';
    for (const seg of segments) {
      if (width(line + seg) <= maxWidth) {
        line += seg;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = seg.trimStart();
      while (width(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && width(line.slice(0, cut)) > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Font size at which `text` fits the box: at most 62% of its height. */
function fitTextSize(text: string, font: PDFFont, boxW: number, boxH: number): number {
  let size = Math.min(boxH * 0.62, 14);
  while (size > 5 && font.widthOfTextAtSize(text, size) > boxW * 0.94) size -= 0.5;
  return size;
}

export interface FieldContent {
  field: FieldRow;
  /** PNG bytes for signature and initials. */
  image?: Uint8Array;
  /** Text for name and date. */
  text?: string;
}

async function stampFields(pdf: PDFDocument, contents: FieldContent[], fonts: Fonts): Promise<void> {
  const pages = pdf.getPages();
  for (const { field, image, text } of contents) {
    const page = pages[field.page - 1];
    if (!page) continue;
    const crop = page.getCropBox();
    const box: Box = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
    const p = placeField(field, box, page.getRotation().angle);
    if (image) {
      const png = await pdf.embedPng(image);
      const fit = fitContain(png.width, png.height, p.width, p.height);
      drawRotated(page, p, fit.dx, fit.dy, (x, y) =>
        page.drawImage(png, { x, y, width: fit.width, height: fit.height, rotate: degrees(p.rotate) })
      );
    } else if (text) {
      const size = fitTextSize(text, fonts.regular, p.width, p.height);
      const dy = (p.height - size) / 2 + size * 0.18;
      drawRotated(page, p, 2, dy, (x, y) =>
        drawShaped(page, text, { x, y, size, font: fonts.regular, color: INK, rotate: p.rotate })
      );
    }
  }
}

/** Offsets (dx, dy) along the displayed axes, converted to page space. */
function drawRotated(
  _page: PDFPage,
  p: { x: number; y: number; rotate: number },
  dx: number,
  dy: number,
  draw: (x: number, y: number) => void
) {
  const rad = (p.rotate * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  draw(p.x + dx * cos - dy * sin, p.y + dx * sin + dy * cos);
}

export interface CertificateInput {
  doc: DocumentRow;
  signers: SignerRow[];
  events: EventRow[];
  /** Signature image per signer position, shown next to their details. */
  signatures: Map<number, Uint8Array>;
  senderName: string;
  orgName: string;
  verifyUrl: string;
}

/**
 * Produces the final document: the original with every field stamped, plus
 * the certificate of completion appended as the last page(s).
 */
export async function buildSignedPdf(original: Uint8Array, contents: FieldContent[], cert: CertificateInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  const fonts = await embedFonts(pdf);
  await stampFields(pdf, contents, fonts);
  await appendCertificate(pdf, fonts, cert);
  pdf.setProducer('Pulse Sign');
  pdf.setModificationDate(new Date(cert.doc.completed_at || Date.now()));
  return pdf.save();
}

const A4: [number, number] = [595.28, 841.89];
const M = 48;

async function appendCertificate(pdf: PDFDocument, fonts: Fonts, c: CertificateInput) {
  const lang = (c.doc.lang === 'en' ? 'en' : 'th') as Lang;
  const other: Lang = lang === 'th' ? 'en' : 'th';
  const t = dict(lang);
  const { regular, bold, mono } = fonts;
  const W = A4[0] - M * 2;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
  };
  const ensure = (h: number) => {
    if (y - h < M + 28) {
      newPage();
      text(`${t.certTitle} · ${c.doc.id}`, M, y, 9, regular, FAINT);
      y -= 24;
    }
  };
  // Courier is a standard font with no Thai glyphs; fall back for Thai dates.
  const pick = (s: string, font: PDFFont) => (font === mono && /[^\x20-\x7E]/.test(s) ? regular : font);
  const text = (s: string, x: number, yy: number, size: number, font: PDFFont, color: RGB = INK) =>
    drawShaped(page, s, { x, y: yy, size, font: pick(s, font), color });
  const para = (s: string, x: number, size: number, font: PDFFont, maxW: number, color: RGB = INK, lh = 1.45) => {
    for (const line of wrapText(s, font, size, maxW)) {
      ensure(size * lh);
      text(line, x, y - size, size, font, color);
      y -= size * lh;
    }
  };
  const label = (s: string, x: number, yy: number) => text(s, x, yy, 8.5, regular, MUTED);
  const fmt = (ts: number | null) => (ts ? formatDate(ts, lang, { time: true, seconds: true }) : '—');

  newPage();

  // Header: logo, wordmark, title.
  page.drawCircle({ x: M + 16, y: y - 16, size: 16, color: FOREST });
  page.drawSvgPath('M3 22 L14 22 L18 8 L25 32 L29 22 L37 22', {
    x: M + 6,
    y: y - 6,
    scale: 0.5,
    borderColor: PULSE,
    borderWidth: 3.2,
    borderLineCap: 1,
  });
  text('Pulse Sign', M + 40, y - 15, 15, bold, FOREST);
  text(new URL(c.verifyUrl).host, M + 40, y - 28, 8.5, regular, MUTED);
  const title = t.certTitle;
  const sub = dict(other).certTitle;
  text(title, M + W - bold.widthOfTextAtSize(title, 17), y - 16, 17, bold);
  text(sub, M + W - regular.widthOfTextAtSize(sub, 9.5), y - 30, 9.5, regular, MUTED);
  y -= 44;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1.5, color: FOREST });
  y -= 14;

  // Completed banner.
  page.drawRectangle({ x: M, y: y - 30, width: W, height: 30, color: MINT });
  page.drawCircle({ x: M + 17, y: y - 15, size: 8, color: FOREST });
  page.drawSvgPath('M0 4 L3.5 7.5 L10 0', { x: M + 12, y: y - 11, borderColor: rgb(1, 1, 1), borderWidth: 1.6 });
  text(t.certStatus, M + 32, y - 19, 11, bold, FOREST);
  const done = fmt(c.doc.completed_at);
  text(done, M + W - 10 - pick(done, mono).widthOfTextAtSize(done, 8.5), y - 18, 8.5, mono, INK);
  y -= 46;

  // Document facts.
  label(t.colDoc, M, y);
  y -= 4;
  para(c.doc.title, M, 12.5, bold, W);
  y -= 6;
  const col = W / 3;
  const facts: [string, string, PDFFont][] = [
    [t.docId, c.doc.id, mono],
    [t.certPages, `${c.doc.pages} ${t.pagesUnit}`, regular],
    [t.sentBy, `${c.senderName} · ${c.orgName}`, regular],
    [t.certCreated, fmt(c.doc.created_at), mono],
    [t.completedAt, fmt(c.doc.completed_at), mono],
    [t.certTz, 'Asia/Bangkok (GMT+7)', regular],
  ];
  for (let row = 0; row < 2; row++) {
    ensure(34);
    for (let i = 0; i < 3; i++) {
      const [k, v, f] = facts[row * 3 + i];
      label(k, M + col * i, y - 9);
      const size = f === mono ? 8.5 : 9.5;
      const lines = wrapText(v, pick(v, f), size, col - 10);
      text(lines[0], M + col * i, y - 23, size, f);
    }
    y -= 36;
  }

  // Original hash.
  ensure(44);
  page.drawRectangle({ x: M, y: y - 38, width: W, height: 38, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1) });
  label(t.hashBefore, M + 10, y - 13);
  text(c.doc.hash_before, M + 10, y - 28, 8.2, mono, INK);
  y -= 54;

  // Signers.
  ensure(30);
  text(t.certSigners, M, y - 12, 12, bold);
  y -= 22;
  for (const s of c.signers) {
    const rowH = 74;
    ensure(rowH);
    const top = y;
    page.drawCircle({ x: M + 10, y: top - 22, size: 10, color: MINT });
    const n = String(s.position + 1);
    text(n, M + 10 - bold.widthOfTextAtSize(n, 9) / 2, top - 25.5, 9, bold, FOREST);
    text(wrapText(s.name, bold, 10.5, 150)[0], M + 28, top - 18, 10.5, bold);
    text(wrapText(s.email, regular, 8.5, 150)[0], M + 28, top - 31, 8.5, regular, MUTED);

    // Signature image box.
    const bx = M + 190;
    const bw = 112;
    const bh = 52;
    page.drawRectangle({ x: bx, y: top - 8 - bh, width: bw, height: bh, borderColor: LINE, borderWidth: 0.8, borderDashArray: [3, 2] });
    const sig = c.signatures.get(s.position);
    if (sig) {
      const img = await pdf.embedPng(sig);
      const fit = fitContain(img.width, img.height, bw - 8, bh - 14);
      page.drawImage(img, { x: bx + 4 + fit.dx, y: top - 8 - bh + 10 + fit.dy, width: fit.width, height: fit.height });
    }
    text(`SIG-${s.id.slice(-8).toUpperCase()}`, bx + 4, top - 8 - bh + 3, 6, mono, FAINT);

    // Evidence.
    const ex = M + 312;
    const rows: [string, string][] = [
      [t.signedAt, fmt(s.signed_at)],
      // Sarabun has no ✓ glyph.
      [t.identity, s.otp_verified_at ? `${t.otpVerified.replace('✓', '').trim()} · ${formatDate(s.otp_verified_at, lang, { time: true })}` : '—'],
      ['IP', s.ip || '—'],
      [t.device, describeUserAgent(s.user_agent)],
    ];
    rows.forEach(([k, v], i) => {
      text(k, ex, top - 14 - i * 13, 7.5, regular, MUTED);
      text(wrapText(v, regular, 7.5, W - (ex - M) - 62)[0], ex + 62, top - 14 - i * 13, 7.5, regular, INK);
    });
    y = top - rowH;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: M + W, y: y + 6 }, thickness: 0.6, color: LINE });
  }
  y -= 10;

  // Audit trail.
  ensure(40);
  text(t.audit, M, y - 12, 12, bold);
  y -= 26;
  const cx = [M, M + 120, M + 320, M + 430];
  const head = () => {
    [t.certTime, t.certEvent, t.certBy, 'IP'].forEach((h, i) => text(h, cx[i], y, 7.5, bold, MUTED));
    y -= 12;
  };
  head();
  for (const ev of c.events) {
    const evLabel = fill((t as Record<string, string>)[`ev_${ev.type}`] || ev.type, { name: ev.detail || '' });
    const lines = wrapText(evLabel, regular, 7.8, 192);
    const h = Math.max(lines.length, 1) * 10.5 + 4;
    if (y - h < M + 28) {
      ensure(h + 40);
      head();
    }
    text(formatDate(ev.at, lang, { time: true, seconds: true }), cx[0], y - 1, 7, mono);
    lines.forEach((l, i) => text(l, cx[1], y - 1 - i * 10.5, 7.8, regular));
    text(wrapText(ev.actor_name, regular, 7.8, 104)[0], cx[2], y - 1, 7.8, regular);
    text(ev.ip || '—', cx[3], y - 1, 7, mono);
    y -= h;
  }
  y -= 10;

  // Legal note.
  page = pages[pages.length - 1];
  ensure(60);
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: LINE });
  y -= 8;
  para(fill(t.certLegal, { url: c.verifyUrl }), M, 7.8, regular, W, MUTED, 1.5);

  // Footers with page numbers across the whole file.
  const total = pdf.getPageCount();
  const first = total - pages.length + 1;
  pages.forEach((p, i) => {
    const footer = `Pulse Sign · ${t.certTitle} · ${c.doc.id}`;
    drawShaped(p, footer, { x: M, y: 26, size: 7.5, font: regular, color: FAINT });
    const num = `${first + i} / ${total}`;
    p.drawText(num, { x: A4[0] - M - mono.widthOfTextAtSize(num, 7.5), y: 26, size: 7.5, font: mono, color: FAINT });
  });
}
