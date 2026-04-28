import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { getStudentRoster } from '@/src/hubs/training/lib/appsScript/studentRoster';

export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();
  const { data: cohort } = await sb.from('training_cohorts').select('*').eq('id', id).single();
  if (!cohort) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: members } = await sb.from('training_cohort_members')
    .select('registration_id,joined_at')
    .eq('cohort_id', id);

  // Enrich with student data from Supabase
  const allStudents = await getStudentRoster();
  const memberMap = new Map(allStudents.map(s => [s.registrationId, s]));

  const enriched = (members ?? []).map((m: { registration_id: string; joined_at: string }) => {
    const s = memberMap.get(m.registration_id);
    return {
      registrationId: m.registration_id,
      joinedAt: m.joined_at,
      name:   s?.name ?? m.registration_id,
      email:  s?.email ?? '',
      course: s?.course ?? '',
      sessionsPassedCount: s?.sessionsPassedCount ?? 0,
      totalSessions: s?.totalSessions ?? 17,
      finalPassed: s?.finalPassed ?? false,
      certificateIssued: s?.certificateIssued ?? false,
    };
  });

  // Cohort stats
  const memberCount = enriched.length;
  const avgCompletion = memberCount > 0
    ? Math.round(enriched.reduce((sum, m) => sum + (m.totalSessions > 0 ? (m.sessionsPassedCount / m.totalSessions) * 100 : 0), 0) / memberCount)
    : 0;
  const certified = enriched.filter(m => m.finalPassed || m.certificateIssued).length;
  const scores = enriched.filter(m => m.sessionsPassedCount > 0);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((s, m) => s + ((m.sessionsPassedCount / m.totalSessions) * 100), 0) / scores.length) : 0;

  return NextResponse.json({
    cohort,
    members: enriched,
    stats: { memberCount, avgCompletion, certified, avgScore },
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();

  const updates: Record<string, unknown> = {};
  if (body.name)        updates.name        = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.courseCode)  updates.course_code = body.courseCode;
  if (body.startDate !== undefined)   updates.start_date  = body.startDate || null;
  if (body.endDate !== undefined)     updates.end_date    = body.endDate || null;
  if (body.isActive !== undefined)    updates.is_active   = body.isActive;

  const { error } = await sb.from('training_cohorts').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();
  const { error } = await sb.from('training_cohorts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ── Member management (via sub-actions in query) ──────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as { action: string; registrationId: string };
  const sb = getServerClient();

  if (body.action === 'addMember') {
    const { error } = await sb.from('training_cohort_members').insert({
      cohort_id: id, registration_id: body.registrationId,
    });
    if (error && !error.message.includes('unique')) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'removeMember') {
    await sb.from('training_cohort_members')
      .delete()
      .eq('cohort_id', id)
      .eq('registration_id', body.registrationId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
