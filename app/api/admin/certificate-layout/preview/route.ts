/**
 * POST /api/admin/certificate-layout/preview
 *
 * Generates a certificate PDF with sample data using the supplied pdfLayout,
 * returning the bytes directly (no storage upload).
 * Used by the Certificate Editor "Preview PDF" button.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

// ── Types (mirrored from certificate editor) ──────────────────────────────────

interface PdfField {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string;
  width?: number; // field box width in editor (1240×877) space
}

// Coordinates are stored in PDF points - no editor-to-PDF scaling needed.

interface PdfLayout {
  studentName?:   PdfField;
  issueDate?:     PdfField;
  certificateId?: PdfField;
  qrCode?:        { x: number; y: number; width: number; height: number };
}

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE: Record<keyof Omit<PdfLayout, 'qrCode'>, string> = {
  studentName:   'Ahmad Din',
  issueDate:     '15 January 2026',
  certificateId: 'FMP-3SFM-2026-0001',
};

const SAMPLE_VERIFY_URL = 'https://financialmodelerpro.com/verify/FMP-3SFM-2026-0001';
const QR_API = 'https://api.qrserver.com/v1/create-qr-code';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return {
    r: isNaN(r) ? 0 : r,
    g: isNaN(g) ? 0 : g,
    b: isNaN(b) ? 0 : b,
  };
}

function selectFont(
  fonts: Record<string, PDFFont>,
  family?: string,
  weight?: string,
): PDFFont {
  const bold = weight === 'bold';
  if (family === 'Times-Roman') return bold ? fonts.TimesBold    : fonts.TimesRoman;
  if (family === 'Courier')     return bold ? fonts.CourierBold  : fonts.Courier;
  return bold ? fonts.HelveticaBold : fonts.Helvetica;
}

/**
 * pdf-lib drawText y = baseline (text extends upward from there).
 * The editor shows text with its visual TOP at pos.y.
 * To align text top with pos.y we subtract the font's ascent from drawY.
 * Ascent ratios: Helvetica ~0.718, Times-Roman ~0.683, Courier ~0.627.
 */
function fontAscent(family?: string): number {
  if (family === 'Times-Roman') return 0.683;
  if (family === 'Courier')     return 0.627;
  return 0.718; // Helvetica / default
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth guard - admin only
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { pdfLayout?: PdfLayout; course?: string };
    const layout = body.pdfLayout ?? {};
    const course = (body.course ?? '3sfm').toLowerCase();

    // 1. Try to load PDF template from Supabase storage
    const sb = getServerClient();
    const templatePath = `templates/${course}-template.pdf`;
    let pdfDoc: PDFDocument;

    const { data: templateFile } = await sb.storage
      .from('certificates')
      .download(templatePath);

    if (templateFile) {
      const bytes = await templateFile.arrayBuffer();
      pdfDoc = await PDFDocument.load(bytes);
    } else {
      // Blank white A4 landscape fallback
      pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([841.89, 595.28]);
    }

    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();

    // Coordinates are already in PDF points - scale is 1:1
    const scaleX = 1;
    const scaleY = 1;

    // 2. Embed all font variants upfront
    const fonts: Record<string, PDFFont> = {
      Helvetica:     await pdfDoc.embedFont(StandardFonts.Helvetica),
      HelveticaBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      TimesRoman:    await pdfDoc.embedFont(StandardFonts.TimesRoman),
      TimesBold:     await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
      Courier:       await pdfDoc.embedFont(StandardFonts.Courier),
      CourierBold:   await pdfDoc.embedFont(StandardFonts.CourierBold),
    };

    // 3. Draw text fields
    const fields = (
      Object.entries(SAMPLE) as Array<[keyof typeof SAMPLE, string]>
    );

    for (const [key, value] of fields) {
      const pos = layout[key];
      if (!pos || !value) continue;

      const font      = selectFont(fonts, pos.fontFamily, pos.fontWeight);
      const fontSize  = (pos.fontSize ?? 14) * scaleY;
      const fieldW    = (pos.width ?? width) * scaleX;
      const { r, g, b } = hexToRgb(pos.color ?? '#000000');

      // Scale anchor x from editor space, then adjust for text alignment
      const anchorX   = pos.x * scaleX;
      const textWidth = font.widthOfTextAtSize(value, fontSize);
      let drawX = anchorX;
      if (pos.textAlign === 'center') drawX = anchorX - textWidth / 2;
      if (pos.textAlign === 'right')  drawX = anchorX - textWidth;

      // pdf-lib origin is bottom-left; editor uses top-left origin.
      // Subtract ascent so the text's visual TOP aligns with pos.y (not the baseline).
      const ascent = fontAscent(pos.fontFamily);
      const drawY  = height - pos.y * scaleY - fontSize * ascent;

      page.drawText(value, {
        x:        drawX,
        y:        drawY,
        size:     fontSize,
        font,
        color:    rgb(r, g, b),
        maxWidth: fieldW,
      });
    }

    // 4. QR code (best-effort)
    const qrPos = layout.qrCode;
    if (qrPos) {
      try {
        const qrW    = Math.round((qrPos.width  ?? 120) * scaleX);
        const qrH    = Math.round((qrPos.height ?? 120) * scaleY);
        const qrRes  = await fetch(
          `${QR_API}/?size=${qrW}x${qrH}&data=${encodeURIComponent(SAMPLE_VERIFY_URL)}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (qrRes.ok) {
          const qrBytes = await qrRes.arrayBuffer();
          const qrImage = await pdfDoc.embedPng(qrBytes);
          page.drawImage(qrImage, {
            x:      qrPos.x * scaleX,
            y:      height - qrPos.y * scaleY - qrH,
            width:  qrW,
            height: qrH,
          });
        }
      } catch {
        // QR is optional - skip silently
      }
    }

    // 5. Return PDF bytes
    const pdfBytes = await pdfDoc.save();
    // Wrap in Buffer so TypeScript BodyInit constraint is satisfied
    const pdfBuf = Buffer.from(pdfBytes.buffer as ArrayBuffer, pdfBytes.byteOffset, pdfBytes.byteLength);

    return new NextResponse(pdfBuf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="certificate-preview-${course}.pdf"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (e) {
    console.error('[cert-preview]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
