/**
 * certificateEngine.ts
 * Orchestrates certificate PDF + badge PNG generation for pending certificates.
 * Called by the cron job at /api/cron/certificates.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getPendingCertificates, updateCertificateUrls, type PendingCertificate } from '@/src/lib/training/sheets';
import { verifyWatchThresholdMet } from '@/src/lib/training/watchThresholdVerifier';
import { findAllEligibleFromSupabase, type EligibilityResult } from '@/src/lib/training/certificateEligibility';
import { COURSES } from '@/src/config/courses';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { certificateIssuedTemplate } from '@/src/lib/email/templates/certificateIssued';

const MAIN_URL   = process.env.NEXT_PUBLIC_MAIN_URL   ?? 'https://financialmodelerpro.com';
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

// Coordinates are stored in PDF points - no editor-to-PDF scaling needed.

interface PdfLayout {
  studentName?:   PdfLayoutField;
  issueDate?:     PdfLayoutField;
  certificateId?: PdfLayoutField;
  qrCode?:        { x: number; y: number; width: number; height: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ascent ratio: fraction of fontSize that text extends above baseline. */
function fontAscent(family?: string): number {
  if (family === 'Times-Roman') return 0.683;
  if (family === 'Courier')     return 0.627;
  return 0.718; // Helvetica / default
}

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
  certificateId:   string;
  studentName:     string;
  issueDate:       string;
  grade:           string;
  verificationUrl: string;
  courseCode:      string;
}): Promise<string> {
  const sb = getServerClient();

  // 1. Load PDF template from storage
  const templatePath = `templates/${data.courseCode.toLowerCase()}-template.pdf`;
  const { data: templateFile, error: templateError } = await sb.storage
    .from('certificates')
    .download(templatePath);

  let pdfDoc: PDFDocument;
  if (templateError || !templateFile) {
    // No template - create blank white A4 PDF
    pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([841.89, 595.28]); // A4 landscape
  } else {
    const templateBytes = await templateFile.arrayBuffer();
    pdfDoc = await PDFDocument.load(templateBytes);
  }

  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();

  // Coordinates are already in PDF points - scale is 1:1
  const scaleX = 1;
  const scaleY = 1;

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
    { key: 'studentName',   value: data.studentName },
    { key: 'issueDate',     value: formatDate(data.issueDate) },
    { key: 'certificateId', value: data.certificateId },
  ];

  for (const { key, value } of fields) {
    if (!value) continue;
    const pos = layout[key];
    if (!pos) continue;
    const { r, g, b } = hexToRgb(pos.color ?? '#000000');
    const font      = selectFont(pos.fontFamily, pos.fontWeight);
    const fontSize  = (pos.fontSize ?? 14) * scaleY;
    const fieldW    = (pos.width ?? width) * scaleX;

    // Scale anchor x, then adjust for text alignment
    const anchorX   = pos.x * scaleX;
    const textWidth = font.widthOfTextAtSize(value, fontSize);
    let drawX = anchorX;
    if (pos.textAlign === 'center') drawX = anchorX - textWidth / 2;
    if (pos.textAlign === 'right')  drawX = anchorX - textWidth;

    // pdf-lib origin is bottom-left; subtract ascent so text TOP aligns with editor pos.y
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

// ── Badge Layout Types ───────────────────────────────────────────────────────

export interface BadgeTextField {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  visible: boolean;
}

export interface BadgeLayout {
  certificateId: BadgeTextField;
  issueDate:     BadgeTextField;
}

export const DEFAULT_BADGE_LAYOUT: BadgeLayout = {
  certificateId: { x: 0, y: 44, fontSize: 14, color: '#ffffff', textAlign: 'center', visible: true },
  issueDate:     { x: 0, y: 22, fontSize: 12, color: '#ffffff', textAlign: 'center', visible: true },
};

/** Load badge layout from cms_content, falling back to defaults */
export async function loadBadgeLayout(): Promise<BadgeLayout> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_content')
      .select('value')
      .eq('section', 'badge_layout')
      .eq('key', 'layout_json')
      .maybeSingle();
    if (data?.value) {
      const parsed = JSON.parse(data.value) as Partial<BadgeLayout>;
      return {
        certificateId: { ...DEFAULT_BADGE_LAYOUT.certificateId, ...parsed.certificateId },
        issueDate:     { ...DEFAULT_BADGE_LAYOUT.issueDate,     ...parsed.issueDate },
      };
    }
  } catch { /* use defaults */ }
  return DEFAULT_BADGE_LAYOUT;
}

// ── Badge text rendering (satori + sharp SVG-to-PNG) ─────────────────────────
// Uses satori to render text as SVG with embedded font,
// then sharp to convert SVG to PNG and composite onto badge.

import satori from 'satori';

// Cache font data in memory after first fetch
let _fontData: ArrayBuffer | null = null;
const FONT_URL = 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf';

async function getFontData(): Promise<ArrayBuffer> {
  if (_fontData) return _fontData;
  const res = await fetch(FONT_URL);
  _fontData = await res.arrayBuffer();
  return _fontData;
}

/**
 * Render badge with text overlays using satori + resvg + sharp composite.
 * Renders a full-size transparent text layer, then composites onto the badge.
 */
export async function renderBadgeWithText(
  badgeBytes: Buffer,
  layout: BadgeLayout,
  certId: string,
  issueDate: string,
): Promise<Buffer> {
  const meta = await sharp(badgeBytes).metadata();
  const bw   = meta.width  ?? 600;
  const bh   = meta.height ?? 600;

  // Font size multiplier: editor fontSize 14 → render at 35px to match Live Preview
  const SCALE = 2.5;

  const children: Record<string, unknown>[] = [];

  function makeTextDiv(f: BadgeTextField, text: string) {
    const renderSize = Math.round(f.fontSize * SCALE);
    const top = bh - f.y - renderSize;
    // Satori uses flexbox for alignment - justifyContent for horizontal
    const justify = f.textAlign === 'left' ? 'flex-start' : f.textAlign === 'right' ? 'flex-end' : 'center';
    return {
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          top,
          left: 0,
          width: bw,
          display: 'flex',
          justifyContent: justify,
          fontSize: renderSize,
          color: f.color,
          fontFamily: 'Inter',
          fontWeight: 600,
          paddingLeft: f.textAlign === 'left' ? f.x : 0,
          paddingRight: f.textAlign === 'right' ? f.x : 0,
        },
        children: text,
      },
    };
  }

  if (layout.certificateId.visible && certId) {
    children.push(makeTextDiv(layout.certificateId, certId));
  }

  if (layout.issueDate.visible && issueDate) {
    children.push(makeTextDiv(layout.issueDate, issueDate));
  }

  if (children.length === 0) return badgeBytes;

  const fontData = await getFontData();

  const element = {
    type: 'div',
    props: {
      style: {
        position: 'relative',
        width: bw,
        height: bh,
        display: 'flex',
      },
      children,
    },
  };

  const svg = await satori(
    element as unknown as React.ReactNode,
    {
      width: bw,
      height: bh,
      fonts: [{ name: 'Inter', data: fontData, weight: 400, style: 'normal' as const }],
    },
  );

  // Convert satori SVG to PNG using sharp (no resvg native dependency needed)
  const textLayer = await sharp(Buffer.from(svg))
    .resize(bw, bh)
    .png()
    .toBuffer();

  return sharp(badgeBytes)
    .composite([{ input: textLayer, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// ── Badge Generation (for certificate issuance) ──────────────────────────────

export async function generateBadgePng(data: {
  certificateId: string;
  issueDate:     string;
  courseCode:    string;
}, layoutOverride?: BadgeLayout): Promise<string> {
  const sb = getServerClient();

  const templatePath = `templates/${data.courseCode.toLowerCase()}-badge.png`;
  const { data: badgeFile, error: badgeError } = await sb.storage
    .from('badges')
    .download(templatePath);

  if (badgeError || !badgeFile) return '';

  const badgeBytes = Buffer.from(await badgeFile.arrayBuffer());
  const layout     = layoutOverride ?? await loadBadgeLayout();
  const outBuffer  = await renderBadgeWithText(badgeBytes, layout, data.certificateId, formatDate(data.issueDate));

  const filePath = `issued/${data.certificateId}-badge.png`;
  await sb.storage.from('badges').upload(filePath, outBuffer, {
    contentType: 'image/png',
    upsert: true,
  });

  const { data: { publicUrl } } = sb.storage.from('badges').getPublicUrl(filePath);
  return publicUrl;
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

/**
 * Generate a cert + badge + DB upsert + email for a single student.
 * Exported so:
 *   - processPendingCertificates can call it in a loop (Apps Script + Supabase sources)
 *   - /api/admin/certificates/force-issue can call it directly to bypass the
 *     eligibility gate for one student
 *
 * `options.force` skips the watch-threshold verification — use only when an
 * admin has explicitly chosen to override (audit trail recorded by caller).
 */
export async function issueCertificateForPending(
  cert: PendingCertificate,
  options: { force?: boolean; issuedVia?: 'auto' | 'forced' | 'apps_script'; forcedByAdmin?: string } = {},
): Promise<{ ok: true; certificateId: string; certPdfUrl: string; badgeUrl: string; verificationUrl: string } | { ok: false; error: string }> {
  const sb = getServerClient();

  if (!options.force) {
    const verify = await verifyWatchThresholdMet(cert.email, cert.courseCode);
    if (!verify.ok) {
      const list = verify.failed.map(f => `${f.tabKey}(${f.pct}%)`).join(', ');
      return { ok: false, error: `watch_threshold_not_met: ${list}` };
    }
  }

  try {
    const certificateId   = await generateCertificateId(cert.courseCode);
    const verificationUrl = `${MAIN_URL}/verify/${certificateId}`;
    const grade           = cert.grade || deriveGrade(cert.finalScore ?? 0, cert.avgScore ?? 0);
    const issueDate       = cert.completionDate || new Date().toISOString();

    const certPdfUrl = await generateCertificatePdf({
      certificateId, studentName: cert.studentName, issueDate, grade, verificationUrl, courseCode: cert.courseCode,
    });
    const badgeUrl = await generateBadgePng({ certificateId, issueDate, courseCode: cert.courseCode });

    // Best-effort sync back to Apps Script (still the source of truth for
    // legacy admin UIs). Failures here don't block issuance.
    try {
      await updateCertificateUrls({ certificateId, certPdfUrl, badgeUrl, transcriptUrl: '', status: 'Issued' });
    } catch (e) {
      console.warn('[certEngine] Apps Script updateCertificateUrls failed (non-fatal):', e);
    }

    /**
     * Persist the row to `student_certificates`.
     *
     * Previous version used `.upsert({...}, { onConflict: 'registration_id' })`
     * and never inspected the returned error. Supabase does NOT throw when a
     * DB-level error occurs — it returns `{ data: null, error }`. If the
     * `student_certificates` table lacks a UNIQUE constraint on
     * `registration_id`, Postgres rejects the statement with
     *   "there is no unique or exclusion constraint matching the ON CONFLICT..."
     * That error was silently swallowed and the admin UI reported success
     * while the DB row was never written. (Matches the observed "zero rows
     * ever" symptom.)
     *
     * Fixed by:
     *  1. Explicit select → update|insert so we're constraint-agnostic.
     *  2. Every supabase call is error-checked and the helper RETURNS the
     *     real error string on failure — the force-issue route already
     *     surfaces `result.error` to the admin UI as a 500.
     */
    const row: Record<string, unknown> = {
      certificate_id:     certificateId,
      registration_id:    cert.registrationId,
      full_name:          cert.studentName,
      email:              cert.email.toLowerCase(),
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
      issued_via:         options.issuedVia ?? (options.force ? 'forced' : 'auto'),
      issued_by_admin:    options.forcedByAdmin ?? null,
    };

    // Natural-key lookup: (email, course_code). Works regardless of which
    // columns the DB has unique-indexed.
    const { data: existing, error: selectErr } = await sb
      .from('student_certificates')
      .select('id')
      .ilike('email', row.email as string)
      .eq('course_code', row.course_code as string)
      .maybeSingle();

    if (selectErr) {
      console.error('[certEngine] student_certificates SELECT failed:', selectErr);
      return { ok: false, error: `DB select failed: ${selectErr.message}` };
    }

    const writeRes = existing?.id
      ? await sb.from('student_certificates').update(row).eq('id', existing.id)
      : await sb.from('student_certificates').insert(row);

    if (writeRes.error) {
      console.error('[certEngine] student_certificates WRITE failed:', {
        message: writeRes.error.message,
        details: (writeRes.error as { details?: string }).details,
        hint:    (writeRes.error as { hint?: string }).hint,
        code:    (writeRes.error as { code?: string }).code,
        email:   cert.email,
        courseCode: cert.courseCode,
        certificateId,
      });
      return { ok: false, error: `DB write failed: ${writeRes.error.message}` };
    }

    console.log('[certEngine] student_certificates row written', {
      operation: existing?.id ? 'update' : 'insert',
      certificateId, email: row.email, courseCode: row.course_code,
    });

    try {
      const { subject, html } = await certificateIssuedTemplate({
        studentName: cert.studentName, courseName: cert.courseName,
        certPdfUrl, badgeUrl, verificationUrl, certificateId, grade,
      });
      await sendEmail({ to: cert.email, subject, html, from: FROM.training });
    } catch (emailErr) {
      console.error(`[certEngine] Email failed for ${cert.email}:`, emailErr);
    }

    return { ok: true, certificateId, certPdfUrl, badgeUrl, verificationUrl };
  } catch (e) {
    const msg = `Failed to process cert for ${cert.email}: ${String(e)}`;
    console.error('[certEngine]', msg);
    return { ok: false, error: msg };
  }
}

/** Build a PendingCertificate from a Supabase eligibility result + student meta. */
async function pendingFromEligibility(result: EligibilityResult): Promise<PendingCertificate | null> {
  const sb = getServerClient();
  const { data: meta } = await sb
    .from('training_registrations_meta')
    .select('registration_id, name')
    .eq('email', result.email)
    .maybeSingle();
  if (!meta) return null;
  const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === result.course.toUpperCase());
  if (!course) return null;
  return {
    registrationId:    meta.registration_id ?? '',
    email:             result.email,
    studentName:       meta.name ?? '',
    courseName:        course.title,
    courseCode:        course.shortTitle.toUpperCase(),
    courseSubheading:  '',
    courseDescription: course.description ?? '',
    finalScore:        result.finalScore ?? 0,
    avgScore:          result.avgScore ?? 0,
    grade:             '',
    completionDate:    new Date().toISOString(),
  };
}

/**
 * Processes every pending certificate from BOTH sources (deduped):
 *  - Apps Script `getPendingCertificates` (legacy flag)
 *  - Supabase eligibility view + course-config check (native)
 *
 * This makes issuance self-healing: a student who passed all requirements
 * but was never flagged by Apps Script will still be picked up on the next
 * cron tick.
 */
export async function processPendingCertificates(): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  // 1. Apps Script pending list (best-effort — failure here doesn't block the Supabase pass)
  let appsPending: PendingCertificate[] = [];
  try {
    appsPending = await getPendingCertificates();
  } catch (e) {
    errors.push(`apps_script_fetch_failed: ${String(e)}`);
  }

  // 2. Supabase-first scan — finds eligible students the Apps Script flag missed.
  let supabasePending: PendingCertificate[] = [];
  try {
    const eligible = await findAllEligibleFromSupabase();
    for (const e of eligible) {
      if (!e.eligible) continue;
      const pc = await pendingFromEligibility(e);
      if (pc) supabasePending.push(pc);
    }
  } catch (e) {
    errors.push(`supabase_scan_failed: ${String(e)}`);
  }

  // Dedup by (email|courseCode) — Apps Script wins first.
  const seen = new Set<string>();
  const combined: PendingCertificate[] = [];
  for (const p of [...appsPending, ...supabasePending]) {
    const key = `${p.email.toLowerCase()}|${p.courseCode.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(p);
  }

  for (const cert of combined) {
    const result = await issueCertificateForPending(cert, { issuedVia: 'auto' });
    if (result.ok) processed++;
    else errors.push(result.error);
  }

  return { processed, errors };
}
