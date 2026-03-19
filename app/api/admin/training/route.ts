import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getServerClient } from '@/src/lib/supabase';

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
  if (!courses) return NextResponse.json({ courses: [] });
  const ids = courses.map((c: any) => c.id);
  const { data: counts } = await sb.from('lessons').select('course_id').in('course_id', ids);
  const countMap: Record<string, number> = {};
  if (counts) for (const l of counts as any[]) countMap[l.course_id] = (countMap[l.course_id] ?? 0) + 1;
  return NextResponse.json({ courses: courses.map((c: any) => ({ ...c, _lesson_count: countMap[c.id] ?? 0 })) });
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
  const { id, title, description, category, thumbnail_url, status, display_order } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const update: Record<string, unknown> = {};
  if (title !== undefined) update.title = title;
  if (description !== undefined) update.description = description;
  if (category !== undefined) update.category = category;
  if (thumbnail_url !== undefined) update.thumbnail_url = thumbnail_url || null;
  if (status !== undefined) update.status = status;
  if (display_order !== undefined) update.display_order = display_order;
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
