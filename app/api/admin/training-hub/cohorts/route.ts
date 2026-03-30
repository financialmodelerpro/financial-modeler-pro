import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getServerClient } from '@/src/lib/supabase';

export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();
  const { data: cohorts } = await sb.from('training_cohorts')
    .select('*')
    .order('created_at', { ascending: false });

  // Get member counts
  const { data: members } = await sb.from('training_cohort_members')
    .select('cohort_id');

  const countMap: Record<string, number> = {};
  for (const m of members ?? []) countMap[m.cohort_id] = (countMap[m.cohort_id] ?? 0) + 1;

  const result = (cohorts ?? []).map((c: { id: string }) => ({
    ...c,
    memberCount: countMap[c.id] ?? 0,
  }));

  return NextResponse.json({ cohorts: result });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    name: string; description?: string; courseCode: string;
    startDate?: string; endDate?: string;
  };

  if (!body.name || !body.courseCode) {
    return NextResponse.json({ error: 'name and courseCode required' }, { status: 400 });
  }

  const sb = getServerClient();
  const { data, error } = await sb.from('training_cohorts').insert({
    name:        body.name,
    description: body.description ?? null,
    course_code: body.courseCode,
    start_date:  body.startDate ?? null,
    end_date:    body.endDate ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cohort: data });
}
