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
  type BadgeLayout,
} from '@/src/lib/training/certificateEngine';

const SAMPLE_CERT_ID = 'FMP-3SFM-2026-0001';
const SAMPLE_DATE    = '15 January 2026';

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgAnchor(align?: string): string {
  if (align === 'left')  return 'start';
  if (align === 'right') return 'end';
  return 'middle';
}

function svgTextX(align: string | undefined, x: number, bw: number): number {
  if (align === 'left')  return x;
  if (align === 'right') return bw - x;
  return bw / 2 + x;
}

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

    const { certificateId: cidField, issueDate: dateField } = layout;

    // Build SVG text overlay
    const svgParts: string[] = [];

    if (cidField.visible) {
      const cidY = bh - cidField.y;
      svgParts.push(
        `<text x="${svgTextX(cidField.textAlign, cidField.x, bw)}" y="${cidY}" text-anchor="${svgAnchor(cidField.textAlign)}"
          font-family="${cidField.fontFamily ?? 'Arial'},Helvetica,sans-serif" font-size="${cidField.fontSize}" fill="${cidField.color}">
          ${escapeXml(SAMPLE_CERT_ID)}
        </text>`
      );
    }

    if (dateField.visible) {
      const dateY = bh - dateField.y;
      svgParts.push(
        `<text x="${svgTextX(dateField.textAlign, dateField.x, bw)}" y="${dateY}" text-anchor="${svgAnchor(dateField.textAlign)}"
          font-family="${dateField.fontFamily ?? 'Arial'},Helvetica,sans-serif" font-size="${dateField.fontSize}" fill="${dateField.color}">
          ${escapeXml(SAMPLE_DATE)}
        </text>`
      );
    }

    const svgOverlay = Buffer.from(
      `<svg width="${bw}" height="${bh}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>`
    );

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
