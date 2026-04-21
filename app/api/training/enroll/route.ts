/**
 * POST /api/training/enroll
 *
 * Authed student action. Creates an enrollment row in training_enrollments
 * for the signed-in student + requested course. Idempotent on the
 * (registration_id, course_code) UNIQUE index from migration 132.
 *
 * Body: { course_code: '3SFM' | 'BVM' }
 *
 * Replaces the old Apps-Script-time course selection at signup. Students
 * now register without picking a course; after sign-in the dashboard
 * prompts them to enroll via this endpoint.
 *
 * GET /api/training/enroll returns the student's current enrollments so
 * the dashboard can decide whether to show the enroll prompt or the
 * normal course UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';

export const runtime = 'nodejs';

const ALLOWED_COURSES = ['3SFM', 'BVM'] as const;

export async function GET() {
  const session = await getTrainingCookieSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getServerClient();
  const { data, error } = await sb
    .from('training_enrollments')
    .select('course_code, enrolled_at')
    .eq('registration_id', session.registrationId)
    .order('enrolled_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ enrollments: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getTrainingCookieSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { course_code?: string };
  try { body = await req.json() as { course_code?: string }; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const raw = (body.course_code ?? '').trim().toUpperCase();
  if (!ALLOWED_COURSES.includes(raw as typeof ALLOWED_COURSES[number])) {
    return NextResponse.json({ error: 'Unknown course_code' }, { status: 400 });
  }

  const sb = getServerClient();

  // Idempotent: if the row already exists, return it unchanged.
  const { data: existing } = await sb
    .from('training_enrollments')
    .select('id, course_code, enrolled_at')
    .eq('registration_id', session.registrationId)
    .eq('course_code', raw)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ enrollment: existing, alreadyEnrolled: true });
  }

  const { data: created, error } = await sb
    .from('training_enrollments')
    .insert({
      registration_id: session.registrationId,
      course_code:     raw,
    })
    .select('id, course_code, enrolled_at')
    .single();

  if (error) {
    console.error('[training/enroll] insert failed', {
      reg_id: session.registrationId, course_code: raw, error: error.message,
    });
    return NextResponse.json({ error: 'Enrollment failed' }, { status: 500 });
  }
  return NextResponse.json({ enrollment: created });
}
