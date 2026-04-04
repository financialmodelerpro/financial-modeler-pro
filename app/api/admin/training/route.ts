import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { listAllStudents } from '@/src/lib/training/sheets';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as any).role === 'admin');
}

export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get('courseId');
  const sb = getServerClient();
  if (courseId) {
    const [{ data: course }, { data: lessons }] = await Promise.all([
      sb.from('courses').select('*').eq('id', courseId).single(),
      sb.from('lessons').select('*').eq('course_id', courseId).order('display_order'),
    ]);
    return NextResponse.json({ course, lessons: lessons ?? [] });
  }
  const { data: courses } = await sb.from('courses').select('*').order('display_order');
  if (!courses) return NextResponse.json({ courses: [], enrollments: null });
  const ids = courses.map((c: any) => c.id);
  const { data: counts } = await sb.from('lessons').select('course_id').in('course_id', ids);
  const countMap: Record<string, number> = {};
  if (counts) for (const l of counts as any[]) countMap[l.course_id] = (countMap[l.course_id] ?? 0) + 1;

  // Bundle enrollment count so the page doesn't need a second auth-gated fetch
  const studentsRes = await listAllStudents();
  const enrollments = studentsRes.success && Array.isArray(studentsRes.data) ? studentsRes.data.length : null;

  return NextResponse.json({ courses: courses.map((c: any) => ({ ...c, _lesson_count: countMap[c.id] ?? 0 })), enrollments });
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { title, description, category, thumbnail_url, status, display_order } = await req.json();
  const sb = getServerClient();
  const { data, error } = await sb.from('courses').insert({ title, description: description ?? '', category: category ?? 'General', thumbnail_url: thumbnail_url || null, status: status ?? 'draft', display_order: display_order ?? 0 }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ course: data });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { id, title, description, category, thumbnail_url, status, display_order,
    tagline, full_description, what_you_learn, prerequisites, who_is_this_for,
    skill_level, duration_hours, language, certificate_description } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const update: Record<string, unknown> = {};
  if (title !== undefined) update.title = title;
  if (description !== undefined) update.description = description;
  if (category !== undefined) update.category = category;
  if (thumbnail_url !== undefined) update.thumbnail_url = thumbnail_url || null;
  if (status !== undefined) update.status = status;
  if (display_order !== undefined) update.display_order = display_order;
  if (tagline !== undefined) update.tagline = tagline;
  if (full_description !== undefined) update.full_description = full_description;
  if (what_you_learn !== undefined) update.what_you_learn = what_you_learn;
  if (prerequisites !== undefined) update.prerequisites = prerequisites;
  if (who_is_this_for !== undefined) update.who_is_this_for = who_is_this_for;
  if (skill_level !== undefined) update.skill_level = skill_level;
  if (duration_hours !== undefined) update.duration_hours = duration_hours === '' ? null : Number(duration_hours);
  if (language !== undefined) update.language = language;
  if (certificate_description !== undefined) update.certificate_description = certificate_description;
  const sb = getServerClient();
  const { error } = await sb.from('courses').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('courses').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
