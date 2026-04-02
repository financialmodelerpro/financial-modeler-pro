/**
 * Transcript shareable link API
 *
 * Run this migration in Supabase SQL editor before use:
 * ─────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS transcript_links (
 *   id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
 *   token           text    UNIQUE NOT NULL,
 *   registration_id text    NOT NULL,
 *   email           text    NOT NULL,
 *   course_id       text    NOT NULL,
 *   created_at      timestamptz DEFAULT now(),
 *   view_count      integer DEFAULT 0,
 *   is_active       boolean DEFAULT true,
 *   UNIQUE (registration_id, course_id)
 * );
 * CREATE INDEX IF NOT EXISTS idx_transcript_links_token ON transcript_links(token);
 * ─────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';
import { cookies } from 'next/headers';
import crypto from 'crypto';

function generateToken(): string {
  return crypto.randomBytes(18).toString('base64url'); // 24-char URL-safe token
}

function getAppUrl(req: NextRequest): string {
  // Always derive from request headers so the URL auto-shifts when any domain connects.
  const host  = req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

// ── GET — fetch existing link for this student + course ───────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const regId    = searchParams.get('regId')?.trim();
  const courseId = searchParams.get('courseId')?.trim();

  if (!regId || !courseId) {
    return NextResponse.json({ error: 'regId and courseId required' }, { status: 400 });
  }

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('transcript_links')
      .select('token, created_at, view_count')
      .eq('registration_id', regId)
      .eq('course_id', courseId)
      .eq('is_active', true)
      .maybeSingle();

    if (!data) return NextResponse.json({ link: null });

    const base = getAppUrl(req);
    return NextResponse.json({
      link: { token: data.token, url: `${base}/t/${data.token}`, createdAt: data.created_at, viewCount: data.view_count },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── POST — create or return existing link ─────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { regId?: string; email?: string; courseId?: string };
    const regId    = body.regId?.trim();
    const email    = body.email?.trim().toLowerCase();
    const courseId = body.courseId?.trim().toLowerCase();

    if (!regId || !email || !courseId) {
      return NextResponse.json({ error: 'regId, email, and courseId are required' }, { status: 400 });
    }

    const sb = getServerClient();

    // Check if a link already exists for this student + course
    const { data: existing } = await sb
      .from('transcript_links')
      .select('token, view_count, created_at')
      .eq('registration_id', regId)
      .eq('course_id', courseId)
      .maybeSingle();

    const base = getAppUrl(req);

    if (existing) {
      return NextResponse.json({
        token:      existing.token,
        url:        `${base}/t/${existing.token}`,
        viewCount:  existing.view_count,
        createdAt:  existing.created_at,
        isNew:      false,
      });
    }

    // Create a new link
    const token = generateToken();
    const { error } = await sb.from('transcript_links').insert({
      token,
      registration_id: regId,
      email,
      course_id: courseId,
      is_active: true,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      token,
      url:       `${base}/t/${token}`,
      viewCount: 0,
      createdAt: new Date().toISOString(),
      isNew:     true,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── DELETE — revoke a link ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { token } = await req.json() as { token?: string };
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

    // Validate the session cookie to ensure the owner is revoking
    const cookieStore = await cookies();
    const raw = cookieStore.get('training_session')?.value;
    if (!raw) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { registrationId } = JSON.parse(raw) as { registrationId: string };
    const sb = getServerClient();

    await sb.from('transcript_links')
      .update({ is_active: false })
      .eq('token', token)
      .eq('registration_id', registrationId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
