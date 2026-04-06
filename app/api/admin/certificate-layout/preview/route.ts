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
}

interface PdfLayout {
  studentName?:       PdfField;
  courseName?:        PdfField;
  courseSubheading?:  PdfField;
  courseDescription?: PdfField;
  issueDate?:         PdfField;
  certificateId?:     PdfField;
  qrCode?:            { x: number; y: number; width: number; height: number };
}

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE: Record<keyof Omit<PdfLayout, 'qrCode'>, string> = {
  studentName:       'Ahmad Din',
  courseName:        '3-Statement Financial Modeling',
  courseSubheading:  'Corporate Finance Track',
  courseDescription: 'Successfully completed with Distinction',
  issueDate:         '15 January 2026',
  certificateId:     'FMP-3SFM-2026-0001',
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

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth guard — admin only
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

    // 2. Embed all font variants upfront
    const fonts: Record<string, PDFFont> = {
      Helvetica:    await pdfDoc.embedFont(StandardFonts.Helvetica),
      HelveticaBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      TimesRoman:   await pdfDoc.embedFont(StandardFonts.TimesRoman),
      TimesBold:    await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
      Courier:      await pdfDoc.embedFont(StandardFonts.Courier),
      CourierBold:  await pdfDoc.embedFont(StandardFonts.CourierBold),
    };

    // 3. Draw text fields
    const fields = (
      Object.entries(SAMPLE) as Array<[keyof typeof SAMPLE, string]>
    );

    for (const [key, value] of fields) {
      const pos = layout[key];
      if (!pos || !value) continue;

      const font     = selectFont(fonts, pos.fontFamily, pos.fontWeight);
      const fontSize = pos.fontSize ?? 14;
      const { r, g, b } = hexToRgb(pos.color ?? '#000000');

      // X position adjusted for alignment
      const textWidth = font.widthOfTextAtSize(value, fontSize);
      let drawX = pos.x;
      if (pos.textAlign === 'center') drawX = pos.x - textWidth / 2;
      if (pos.textAlign === 'right')  drawX = pos.x - textWidth;

      // pdf-lib origin is bottom-left; layout uses top-left
      const drawY = height - pos.y;

      page.drawText(value, {
        x:        drawX,
        y:        drawY,
        size:     fontSize,
        font,
        color:    rgb(r, g, b),
        maxWidth: width - drawX - 20,
      });
    }

    // 4. QR code (best-effort)
    const qrPos = layout.qrCode;
    if (qrPos) {
      try {
        const qrSize = qrPos.width ?? 120;
        const qrRes  = await fetch(
          `${QR_API}/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(SAMPLE_VERIFY_URL)}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (qrRes.ok) {
          const qrBytes = await qrRes.arrayBuffer();
          const qrImage = await pdfDoc.embedPng(qrBytes);
          page.drawImage(qrImage, {
            x:      qrPos.x,
            y:      height - qrPos.y - (qrPos.height ?? 120),
            width:  qrPos.width  ?? 120,
            height: qrPos.height ?? 120,
          });
        }
      } catch {
        // QR is optional — skip silently
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
