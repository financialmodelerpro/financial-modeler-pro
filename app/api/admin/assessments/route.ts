import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get('courseId');
  if (!courseId) return NextResponse.json({ error: 'courseId required' }, { status: 400 });
  const sb = getServerClient();
  const { data, error } = await sb
    .from('assessments')
    .select('*, assessment_questions(*)')
    .eq('course_id', courseId)
    .order('display_order', { referencedTable: 'assessment_questions', ascending: true })
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json() as {
    courseId: string;
    title: string;
    description?: string;
    pass_score?: number;
    time_limit?: number | null;
    max_attempts?: number;
    visible?: boolean;
  };
  const sb = getServerClient();
  const { data, error } = await sb
    .from('assessments')
    .insert({
      course_id: body.courseId,
      title: body.title,
      description: body.description ?? '',
      pass_score: body.pass_score ?? 70,
      time_limit: body.time_limit ?? null,
      max_attempts: body.max_attempts ?? 3,
      visible: body.visible ?? true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json() as { id: string; [key: string]: unknown };
  const { id, ...updates } = body;
  const sb = getServerClient();
  const { data, error } = await sb
    .from('assessments')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
