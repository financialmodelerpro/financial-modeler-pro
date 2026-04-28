/**
 * POST /api/admin/badge-preview
 *
 * Generates a badge PNG preview with Certificate ID and Issue Date text.
 * Uses sharp to composite text rendered as separate PNG layers.
 * Returns the PNG bytes directly (no storage upload).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import sharp from 'sharp';
import {
  loadBadgeLayout,
  DEFAULT_BADGE_LAYOUT,
  renderBadgeWithText,
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

    const outBuffer = await renderBadgeWithText(badgeBytes, layout, SAMPLE_CERT_ID, SAMPLE_DATE);

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
