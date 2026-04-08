/**
 * POST /api/admin/badge-preview
 *
 * Generates a badge PNG preview with Certificate ID and Issue Date overlay.
 * Uses badge layout from cms_content (or accepts layout override from editor).
 * Returns the PNG bytes directly (no storage upload).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import sharp from 'sharp';
import {
  loadBadgeLayout,
  DEFAULT_BADGE_LAYOUT,
  buildBadgeSvgOverlay,
  type BadgeLayout,
} from '@/src/lib/training/certificateEngine';

const SAMPLE_CERT_ID = 'FMP-3SFM-2026-0001';
const SAMPLE_DATE    = '15 January 2026';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { course?: string; layout?: BadgeLayout };
    const course = (body.course ?? '3sfm').toLowerCase();
    const sb     = getServerClient();

    // Load badge template PNG from storage
    const templatePath = `templates/${course}-badge.png`;
    const { data: badgeFile, error } = await sb.storage
      .from('badges')
      .download(templatePath);

    if (error || !badgeFile) {
      return NextResponse.json(
        { error: 'Badge template not found. Upload a PNG badge template first.' },
        { status: 404 },
      );
    }

    const badgeBytes = Buffer.from(await badgeFile.arrayBuffer());
    const meta       = await sharp(badgeBytes).metadata();
    const bw         = meta.width  ?? 600;
    const bh         = meta.height ?? 600;

    // Use layout override from editor, or load from DB, or use defaults
    let layout: BadgeLayout;
    if (body.layout) {
      layout = {
        certificateId: { ...DEFAULT_BADGE_LAYOUT.certificateId, ...body.layout.certificateId },
        issueDate:     { ...DEFAULT_BADGE_LAYOUT.issueDate,     ...body.layout.issueDate },
      };
    } else {
      layout = await loadBadgeLayout();
    }

    // Build SVG text overlay with embedded font (Vercel has no system fonts)
    const svgOverlay = await buildBadgeSvgOverlay(bw, bh, layout, SAMPLE_CERT_ID, SAMPLE_DATE);

    // Composite overlay onto badge (SVG is full-size with absolute coords — use top-left gravity)
    const outBuffer = await sharp(badgeBytes)
      .composite([{ input: svgOverlay, gravity: 'northwest' }])
      .png()
      .toBuffer();

    return new NextResponse(outBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'image/png',
        'Content-Disposition': `inline; filename="badge-preview-${course}.png"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (e) {
    console.error('[badge-preview]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
