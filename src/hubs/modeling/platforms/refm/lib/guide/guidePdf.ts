/**
 * guidePdf.ts
 *
 * Renders a GuideDoc (the auto-updating platform walkthrough) to a downloadable
 * PDF, reusing the same embedded Inter font as the project report. Pure prose
 * layout: a clean cover, then headings + word-wrapped paragraphs + bullets,
 * with section nesting. Because it renders the SAME GuideDoc the in-platform
 * view + the Markdown download use, the downloadable PDF never drifts from
 * what the platform shows.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import INTER_REGULAR_B64 from '../pdf/fonts/interRegular';
import INTER_BOLD_B64 from '../pdf/fonts/interBold';
import type { GuideDoc, GuideSection } from './platformGuide';

function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const NAVY = rgb(0x1b / 255, 0x4f / 255, 0x8a / 255);
const NAVY_DARK = rgb(0x1b / 255, 0x3a / 255, 0x6b / 255);
const TEXT = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.42, 0.46, 0.52);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const BOTTOM = 56;

interface Ctx { doc: PDFDocument; font: PDFFont; bold: PDFFont; pages: PDFPage[]; page: PDFPage; y: number }

function addPage(ctx: Ctx): void {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(page);
  ctx.page = page;
  ctx.y = PAGE_H - MARGIN;
}
function ensure(ctx: Ctx, need: number): void {
  if (ctx.y - need < BOTTOM) addPage(ctx);
}
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function paragraph(ctx: Ctx, text: string, opts: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont; indent?: number; gap?: number } = {}): void {
  const size = opts.size ?? 10.5;
  const font = opts.font ?? ctx.font;
  const color = opts.color ?? TEXT;
  const indent = opts.indent ?? 0;
  const lineH = size * 1.45;
  for (const ln of wrap(text, font, size, CONTENT_W - indent)) {
    ensure(ctx, lineH);
    ctx.y -= lineH;
    ctx.page.drawText(ln, { x: MARGIN + indent, y: ctx.y, size, font, color });
  }
  ctx.y -= opts.gap ?? 6;
}
function heading(ctx: Ctx, text: string, depth: number): void {
  const size = depth <= 2 ? 16 : depth === 3 ? 13 : 11.5;
  ensure(ctx, size * 2.2);
  ctx.y -= size * 1.6;
  if (depth <= 2) {
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: 26, height: 3, color: NAVY });
    ctx.y -= 10;
  }
  ctx.page.drawText(text, { x: MARGIN, y: ctx.y, size, font: ctx.bold, color: NAVY_DARK });
  ctx.y -= 8;
}
function bullet(ctx: Ctx, text: string): void {
  const size = 10;
  const lineH = size * 1.4;
  const lines = wrap(text, ctx.font, size, CONTENT_W - 16);
  lines.forEach((ln, i) => {
    ensure(ctx, lineH);
    ctx.y -= lineH;
    if (i === 0) ctx.page.drawText('•', { x: MARGIN + 2, y: ctx.y, size, font: ctx.bold, color: NAVY });
    ctx.page.drawText(ln, { x: MARGIN + 16, y: ctx.y, size, font: ctx.font, color: TEXT });
  });
  ctx.y -= 3;
}
function renderSection(ctx: Ctx, s: GuideSection, depth: number): void {
  heading(ctx, s.title, depth);
  for (const p of s.paragraphs) paragraph(ctx, p);
  for (const b of s.bullets ?? []) bullet(ctx, b);
  ctx.y -= 4;
  for (const c of s.children ?? []) renderSection(ctx, c, depth + 1);
}

export async function generateGuidePdf(doc: GuideDoc, dateLabel?: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(b64ToBytes(INTER_REGULAR_B64), { subset: false });
  const bold = await pdf.embedFont(b64ToBytes(INTER_BOLD_B64), { subset: false });
  const ctx: Ctx = { doc: pdf, font, bold, pages: [], page: null as unknown as PDFPage, y: 0 };

  // Cover.
  addPage(ctx);
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: NAVY });
  const cy = PAGE_H / 2 + 40;
  const drawCentered = (t: string, y: number, size: number, f: PDFFont, color: ReturnType<typeof rgb>): void => {
    const w = f.widthOfTextAtSize(t, size);
    ctx.page.drawText(t, { x: (PAGE_W - w) / 2, y, size, font: f, color });
  };
  drawCentered(doc.title, cy, 24, bold, NAVY_DARK);
  drawCentered(doc.subtitle, cy - 30, 14, font, MUTED);
  ctx.page.drawRectangle({ x: PAGE_W / 2 - 50, y: cy - 46, width: 100, height: 2, color: NAVY });
  if (dateLabel) drawCentered(`Updated ${dateLabel}`, cy - 70, 10, font, TEXT);
  drawCentered('Financial Modeler Pro', BOTTOM + 30, 11, bold, NAVY);
  // Wrap the generated-note across the cover footer.
  const noteLines = wrap(doc.generatedNote, font, 8.5, CONTENT_W - 80);
  let ny = BOTTOM + 14;
  for (const ln of noteLines.reverse()) { drawCentered(ln, ny, 8.5, font, MUTED); ny += 11; }

  // Body.
  addPage(ctx);
  for (const s of doc.sections) renderSection(ctx, s, 2);

  // Footer page numbers.
  const total = ctx.pages.length;
  ctx.pages.forEach((page, i) => {
    page.drawText(`Page ${i + 1} of ${total}  ·  Financial Modeler Pro`, { x: MARGIN, y: 30, size: 8, font, color: MUTED });
  });

  return pdf.save();
}
