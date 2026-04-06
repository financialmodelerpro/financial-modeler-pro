/**
 * certificateEngine.ts
 * Orchestrates certificate PDF + badge PNG generation for pending certificates.
 * Called by the cron job at /api/cron/certificates.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getPendingCertificates, updateCertificateUrls } from '@/src/lib/training/sheets';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { certificateIssuedTemplate } from '@/src/lib/email/templates/certificateIssued';

const LEARN_URL  = process.env.NEXT_PUBLIC_LEARN_URL  ?? 'https://learn.financialmodelerpro.com';
const QR_API     = 'https://api.qrserver.com/v1/create-qr-code';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PdfLayoutField {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string; // 'Helvetica' | 'Times-Roman' | 'Courier'
  width?: number;      // field box width in editor (1240×877) space
}

// Editor canvas dimensions — must match the certificate-editor page constants
const EDITOR_W = 1240;
const EDITOR_H = 877;

interface PdfLayout {
  studentName?:       PdfLayoutField;
  courseName?:        PdfLayoutField;
  courseSubheading?:  PdfLayoutField;
  courseDescription?: PdfLayoutField;
  issueDate?:         PdfLayoutField;
  certificateId?:     PdfLayoutField;
  qrCode?:            { x: number; y: number; width: number; height: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return { r: isNaN(r) ? 1 : r, g: isNaN(g) ? 1 : g, b: isNaN(b) ? 1 : b };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function deriveGrade(finalScore: number, avgScore: number): string {
  const combined = finalScore * 0.7 + avgScore * 0.3;
  if (combined >= 85) return 'Distinction';
  if (combined >= 70) return 'Merit';
  return 'Pass';
}

/** Generate sequential certificate ID: FMP-3SFM-2026-0001 */
async function generateCertificateId(courseCode: string): Promise<string> {
  const sb   = getServerClient();
  const year = new Date().getFullYear();
  const code = courseCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = `FMP-${code}-${year}-`;

  const { count } = await sb
    .from('student_certificates')
    .select('*', { count: 'exact', head: true })
    .like('certificate_id', `${prefix}%`);

  const seq = String((count ?? 0) + 1).padStart(4, '0');
  return `${prefix}${seq}`;
}

// ── PDF Generation ────────────────────────────────────────────────────────────

export async function generateCertificatePdf(data: {
  certificateId:     string;
  studentName:       string;
  courseName:        string;
  courseSubheading:  string;
  courseDescription: string;
  issueDate:         string;
  grade:             string;
  verificationUrl:   string;
  courseCode:        string;
}): Promise<string> {
  const sb = getServerClient();

  // 1. Load PDF template from storage
  const templatePath = `templates/${data.courseCode.toLowerCase()}-template.pdf`;
  const { data: templateFile, error: templateError } = await sb.storage
    .from('certificates')
    .download(templatePath);

  let pdfDoc: PDFDocument;
  if (templateError || !templateFile) {
    // No template — create blank white A4 PDF
    pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([841.89, 595.28]); // A4 landscape
  } else {
    const templateBytes = await templateFile.arrayBuffer();
    pdfDoc = await PDFDocument.load(templateBytes);
  }

  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();

  // Scale factors: convert editor coords (1240×877) → PDF page points
  const scaleX = width  / EDITOR_W;
  const scaleY = height / EDITOR_H;

  // 2. Load PDF layout from cms_content
  let layout: PdfLayout = {};
  try {
    const { data: cms } = await sb
      .from('cms_content')
      .select('value')
      .eq('section', 'certificate_layout')
      .eq('key', 'pdf_layout_json')
      .maybeSingle();
    if (cms?.value) layout = JSON.parse(cms.value) as PdfLayout;
  } catch { /* use defaults */ }

  // 3. Embed all font variants
  const embeddedFonts = {
    Helvetica:     await pdfDoc.embedFont(StandardFonts.Helvetica),
    HelveticaBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    TimesRoman:    await pdfDoc.embedFont(StandardFonts.TimesRoman),
    TimesBold:     await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
    Courier:       await pdfDoc.embedFont(StandardFonts.Courier),
    CourierBold:   await pdfDoc.embedFont(StandardFonts.CourierBold),
  };

  function selectFont(family?: string, weight?: string) {
    const bold = weight === 'bold';
    if (family === 'Times-Roman') return bold ? embeddedFonts.TimesBold    : embeddedFonts.TimesRoman;
    if (family === 'Courier')     return bold ? embeddedFonts.CourierBold  : embeddedFonts.Courier;
    return bold ? embeddedFonts.HelveticaBold : embeddedFonts.Helvetica;
  }

  // 4. Draw text fields
  const fields: Array<{ key: keyof Omit<PdfLayout, 'qrCode'>; value: string }> = [
    { key: 'studentName',       value: data.studentName },
    { key: 'courseName',        value: data.courseName },
    { key: 'courseSubheading',  value: data.courseSubheading },
    { key: 'courseDescription', value: data.courseDescription },
    { key: 'issueDate',         value: formatDate(data.issueDate) },
    { key: 'certificateId',     value: data.certificateId },
  ];

  for (const { key, value } of fields) {
    if (!value) continue;
    const pos = layout[key];
    if (!pos) continue;
    const { r, g, b } = hexToRgb(pos.color ?? '#000000');
    const font      = selectFont(pos.fontFamily, pos.fontWeight);
    const fontSize  = (pos.fontSize ?? 14) * scaleY;
    const fieldW    = (pos.width ?? EDITOR_W) * scaleX;

    // Scale anchor x, then adjust for text alignment
    const anchorX   = pos.x * scaleX;
    const textWidth = font.widthOfTextAtSize(value, fontSize);
    let drawX = anchorX;
    if (pos.textAlign === 'center') drawX = anchorX - textWidth / 2;
    if (pos.textAlign === 'right')  drawX = anchorX - textWidth;

    page.drawText(value, {
      x:        drawX,
      y:        height - pos.y * scaleY,  // pdf-lib origin is bottom-left
      size:     fontSize,
      font,
      color:    rgb(r, g, b),
      maxWidth: fieldW,
    });
  }

  // 5. QR Code
  const qrPos = layout.qrCode;
  if (qrPos) {
    try {
      const qrW   = Math.round((qrPos.width  ?? 150) * scaleX);
      const qrH   = Math.round((qrPos.height ?? 150) * scaleY);
      const qrRes = await fetch(
        `${QR_API}/?size=${qrW}x${qrH}&data=${encodeURIComponent(data.verificationUrl)}`
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
    } catch { /* QR optional */ }
  }

  // 6. Save + upload
  const pdfBytes = await pdfDoc.save();
  const filePath = `issued/${data.certificateId}.pdf`;

  await sb.storage.from('certificates').upload(filePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: true,
  });

  const { data: { publicUrl } } = sb.storage.from('certificates').getPublicUrl(filePath);
  return publicUrl;
}

// ── Badge Generation ──────────────────────────────────────────────────────────

export async function generateBadgePng(data: {
  certificateId: string;
  issueDate:     string;
  courseCode:    string;
}): Promise<string> {
  const sb = getServerClient();

  // 1. Load base badge PNG
  const templatePath = `templates/${data.courseCode.toLowerCase()}-badge.png`;
  const { data: badgeFile, error: badgeError } = await sb.storage
    .from('badges')
    .download(templatePath);

  if (badgeError || !badgeFile) {
    // No badge template — return empty string (badge generation skipped)
    return '';
  }

  const badgeBytes  = Buffer.from(await badgeFile.arrayBuffer());
  const meta        = await sharp(badgeBytes).metadata();
  const bw          = meta.width  ?? 600;
  const bh          = meta.height ?? 600;

  // 2. Build SVG text overlay (Certificate ID + Issue Date at bottom)
  const lineHeight = 22;
  const textY1     = bh - 44;
  const textY2     = bh - 22;

  const svgOverlay = Buffer.from(`
    <svg width="${bw}" height="${bh}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${textY1 - 6}" width="${bw}" height="${lineHeight * 2 + 12}" fill="rgba(0,0,0,0.55)" />
      <text x="${bw / 2}" y="${textY1 + 12}" text-anchor="middle"
        font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#ffffff">
        ${data.certificateId}
      </text>
      <text x="${bw / 2}" y="${textY2 + 10}" text-anchor="middle"
        font-family="Arial,Helvetica,sans-serif" font-size="11" fill="rgba(255,255,255,0.8)">
        ${formatDate(data.issueDate)}
      </text>
    </svg>
  `);

  // 3. Composite overlay onto badge
  const outBuffer = await sharp(badgeBytes)
    .composite([{ input: svgOverlay, gravity: 'southeast' }])
    .png()
    .toBuffer();

  // 4. Upload
  const filePath = `issued/${data.certificateId}-badge.png`;
  await sb.storage.from('badges').upload(filePath, outBuffer, {
    contentType: 'image/png',
    upsert: true,
  });

  const { data: { publicUrl } } = sb.storage.from('badges').getPublicUrl(filePath);
  return publicUrl;
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

export async function processPendingCertificates(): Promise<{
  processed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processed = 0;
  const sb = getServerClient();

  // 1. Fetch pending from Apps Script
  let pending;
  try {
    pending = await getPendingCertificates();
  } catch (e) {
    return { processed: 0, errors: [`Failed to fetch pending certificates: ${String(e)}`] };
  }

  for (const cert of pending) {
    try {
      const certificateId  = await generateCertificateId(cert.courseCode);
      const verificationUrl = `${LEARN_URL}/verify/${certificateId}`;
      const grade           = cert.grade || deriveGrade(cert.finalScore ?? 0, cert.avgScore ?? 0);
      const issueDate       = cert.completionDate || new Date().toISOString();

      // 2. Generate certificate PDF
      const certPdfUrl = await generateCertificatePdf({
        certificateId,
        studentName:       cert.studentName,
        courseName:        cert.courseName,
        courseSubheading:  cert.courseSubheading ?? '',
        courseDescription: cert.courseDescription ?? '',
        issueDate,
        grade,
        verificationUrl,
        courseCode:        cert.courseCode,
      });

      // 3. Generate badge PNG
      const badgeUrl = await generateBadgePng({
        certificateId,
        issueDate,
        courseCode: cert.courseCode,
      });

      // 4. Update Apps Script
      await updateCertificateUrls({
        certificateId,
        certPdfUrl,
        badgeUrl,
        transcriptUrl: '', // transcript URL set separately by student
        status: 'Issued',
      });

      // 5. Upsert student_certificates in Supabase
      await sb.from('student_certificates').upsert(
        {
          certificate_id:     certificateId,
          registration_id:    cert.registrationId,
          full_name:          cert.studentName,
          email:              cert.email,
          course:             cert.courseName,
          course_code:        cert.courseCode,
          grade,
          final_score:        cert.finalScore ?? null,
          avg_score:          cert.avgScore ?? null,
          cert_pdf_url:       certPdfUrl,
          badge_url:          badgeUrl || null,
          verification_url:   verificationUrl,
          cert_status:        'Issued',
          issued_at:          new Date().toISOString(),
          issued_date:        new Date().toISOString().split('T')[0],
          course_subheading:  cert.courseSubheading ?? null,
          course_description: cert.courseDescription ?? null,
        },
        { onConflict: 'registration_id' },
      );

      // 6. Send certificate email
      try {
        const { subject, html } = certificateIssuedTemplate({
          studentName:     cert.studentName,
          courseName:      cert.courseName,
          certPdfUrl,
          badgeUrl,
          verificationUrl,
          certificateId,
          grade,
        });
        await sendEmail({ to: cert.email, subject, html, from: FROM.training });
      } catch (emailErr) {
        // Non-fatal — log but don't fail the whole cert
        console.error(`[certEngine] Email failed for ${cert.email}:`, emailErr);
      }

      processed++;
    } catch (e) {
      const msg = `Failed to process cert for ${cert.email}: ${String(e)}`;
      console.error('[certEngine]', msg);
      errors.push(msg);
    }
  }

  return { processed, errors };
}
