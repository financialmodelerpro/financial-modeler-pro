import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';

async function checkAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json() as {
    assessment_id: string;
    question: string;
    options: Array<{ text: string; is_correct: boolean }>;
    explanation?: string;
    points?: number;
    display_order?: number;
  };
  const sb = getServerClient();
  const { data, error } = await sb
    .from('assessment_questions')
    .insert({
      assessment_id: body.assessment_id,
      question: body.question,
      options: body.options,
      explanation: body.explanation ?? '',
      points: body.points ?? 1,
      display_order: body.display_order ?? 0,
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
    .from('assessment_questions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('assessment_questions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
