import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as any).role === 'admin');
}

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const { data, error } = await sb
    .from('training_admin_actions')
    .select('*')
    .eq('is_active', true)
    .order('actioned_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ actions: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json() as {
    registration_id: string;
    email: string;
    action_type: 'block' | 'revoke_certificate';
    course?: string;
    reason?: string;
  };
  const { registration_id, email, action_type, course, reason } = body;
  if (!registration_id || !email || !action_type) {
    return NextResponse.json({ error: 'registration_id, email and action_type required' }, { status: 400 });
  }
  const sb = getServerClient();
  const { data, error } = await sb
    .from('training_admin_actions')
    .insert({ registration_id, email, action_type, course: course ?? null, reason: reason ?? null, is_active: true })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ action: data });
}
