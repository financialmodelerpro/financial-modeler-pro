import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

// GET - merge manual testimonials + student_testimonials
export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const sb = getServerClient();
    const [{ data: manual }, { data: students }] = await Promise.all([
      sb.from('testimonials').select('*').order('created_at', { ascending: false }),
      sb.from('student_testimonials').select('*').order('created_at', { ascending: false }),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manualRows = (manual ?? []).map((t: any) => ({
      id:               t.id,
      source:           'manual',
      name:             t.name,
      role:             t.role  ?? '',
      company:          t.company ?? '',
      text:             t.text  ?? '',
      rating:           t.rating ?? null,
      status:           t.status,
      testimonial_type: 'manual',
      is_featured:      false,
      video_url:        null,
      job_title:        null,
      location:         null,
      linkedin_url:     null,
      course_name:      null,
      registration_id:  null,
      hub:              t.hub ?? 'modeling',
      show_on_landing:  t.show_on_landing ?? true,
      created_at:       t.created_at,
      approved_at:      t.approved_at,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const studentRows = (students ?? []).map((t: any) => ({
      id:               t.id,
      source:           'student',
      name:             t.student_name,
      role:             t.job_title ?? '',
      company:          t.company  ?? '',
      text:             t.written_content ?? '',
      rating:           t.rating ?? null,
      status:           t.status,
      testimonial_type: t.testimonial_type,
      is_featured:      t.is_featured ?? false,
      video_url:        t.video_url ?? null,
      job_title:        t.job_title ?? null,
      location:         t.location ?? null,
      linkedin_url:     t.linkedin_url ?? null,
      course_name:      t.course_name ?? null,
      registration_id:  t.registration_id ?? null,
      hub:              t.hub ?? 'training',
      show_on_landing:  t.show_on_landing ?? false,
      created_at:       t.created_at,
      approved_at:      t.approved_at,
    }));

    const all = [...manualRows, ...studentRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return NextResponse.json({ testimonials: all });
  } catch {
    return NextResponse.json({ testimonials: [] });
  }
}

// PATCH - update status, is_featured, hub, or show_on_landing, routes via source
export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, source, status, is_featured, hub, show_on_landing } = await req.json() as Record<string, string | boolean | undefined>;
    const sb = getServerClient();

    if (source === 'student') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: Record<string, any> = {};
      if (status !== undefined) {
        update.status = status;
        update.approved_at = status === 'approved' ? new Date().toISOString() : null;
      }
      if (is_featured !== undefined)    update.is_featured    = is_featured;
      if (hub !== undefined)            update.hub            = hub;
      if (show_on_landing !== undefined) update.show_on_landing = show_on_landing;
      await sb.from('student_testimonials').update(update).eq('id', id);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: Record<string, any> = {};
      if (status !== undefined) {
        update.status = status;
        update.approved_at = status === 'approved' ? new Date().toISOString() : null;
      }
      if (hub !== undefined)            update.hub            = hub;
      if (show_on_landing !== undefined) update.show_on_landing = show_on_landing;
      await sb.from('testimonials').update(update).eq('id', id);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// DELETE - routes to correct table via ?source=
export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const id     = searchParams.get('id');
    const source = searchParams.get('source') ?? 'manual';
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const sb = getServerClient();
    if (source === 'student') {
      await sb.from('student_testimonials').delete().eq('id', id);
    } else {
      await sb.from('testimonials').delete().eq('id', id);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
