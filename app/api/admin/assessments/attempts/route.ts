import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';

async function checkAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const assessmentId = req.nextUrl.searchParams.get('assessmentId');
  if (!assessmentId) return NextResponse.json({ error: 'assessmentId required' }, { status: 400 });
  const sb = getServerClient();
  const { data, error } = await sb
    .from('assessment_attempts')
    .select('*, users(full_name, email)')
    .eq('assessment_id', assessmentId)
    .order('submitted_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
