import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export async function GET(req: NextRequest) {
  // The student is the SIGNED session (2026-09-26); any identity in the request is ignored.
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  void req;
  const registrationId = sess.registrationId;
  if (!registrationId) return NextResponse.json({ profile: null }, { status: 400 });
  const sb = getServerClient();
  const { data } = await sb.from('student_profiles').select('*').eq('registration_id', registrationId).maybeSingle();
  return NextResponse.json({ profile: data ?? null });
}

export async function PUT(req: NextRequest) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  try {
    const body = await req.json() as {
      registrationId?: string;
      jobTitle?: string;
      company?: string;
      location?: string;
      linkedinUrl?: string;
      notifyMilestones?: boolean;
      notifyReminders?: boolean;
      displayName?: string;
      avatarUrl?: string;
    };

    const sb = getServerClient();
    await sb.from('student_profiles').upsert({
      registration_id:   sess.registrationId,
      job_title:         body.jobTitle ?? null,
      company:           body.company ?? null,
      location:          body.location ?? null,
      linkedin_url:      body.linkedinUrl ?? null,
      notify_milestones: body.notifyMilestones ?? true,
      notify_reminders:  body.notifyReminders ?? true,
      display_name:      body.displayName ?? null,
      avatar_url:        body.avatarUrl ?? null,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'registration_id' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
