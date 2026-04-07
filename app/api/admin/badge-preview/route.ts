/**
 * POST /api/admin/badge-preview
 *
 * Generates a badge PNG preview with sample Certificate ID and Issue Date overlay.
 * Mirrors the logic in certificateEngine.generateBadgePng() exactly.
 * Returns the PNG bytes directly (no storage upload).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import sharp from 'sharp';

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
    const body   = (await req.json()) as { course?: string };
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

    // Build SVG text overlay — identical to certificateEngine.generateBadgePng()
    const lineHeight = 22;
    const textY1     = bh - 44;
    const textY2     = bh - 22;

    const svgOverlay = Buffer.from(`
      <svg width="${bw}" height="${bh}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="${textY1 - 6}" width="${bw}" height="${lineHeight * 2 + 12}" fill="rgba(0,0,0,0.55)" />
        <text x="${bw / 2}" y="${textY1 + 12}" text-anchor="middle"
          font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#ffffff">
          ${SAMPLE_CERT_ID}
        </text>
        <text x="${bw / 2}" y="${textY2 + 10}" text-anchor="middle"
          font-family="Arial,Helvetica,sans-serif" font-size="11" fill="rgba(255,255,255,0.8)">
          ${SAMPLE_DATE}
        </text>
      </svg>
    `);

    // Composite overlay onto badge
    const outBuffer = await sharp(badgeBytes)
      .composite([{ input: svgOverlay, gravity: 'southeast' }])
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
