import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';

export async function GET(req: NextRequest) {
  const registrationId = req.nextUrl.searchParams.get('registrationId');
  if (!registrationId) return NextResponse.json({ profile: null }, { status: 400 });
  const sb = getServerClient();
  const { data } = await sb.from('student_profiles').select('*').eq('registration_id', registrationId).maybeSingle();
  return NextResponse.json({ profile: data ?? null });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      registrationId: string;
      jobTitle?: string;
      company?: string;
      location?: string;
      linkedinUrl?: string;
      notifyMilestones?: boolean;
      notifyReminders?: boolean;
    };
    if (!body.registrationId) return NextResponse.json({ ok: false }, { status: 400 });
    const sb = getServerClient();
    await sb.from('student_profiles').upsert({
      registration_id:   body.registrationId,
      job_title:         body.jobTitle ?? null,
      company:           body.company ?? null,
      location:          body.location ?? null,
      linkedin_url:      body.linkedinUrl ?? null,
      notify_milestones: body.notifyMilestones ?? true,
      notify_reminders:  body.notifyReminders ?? true,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'registration_id' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
