import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 401 });
  }

  const sb = getServerClient();
  const { data, error } = await sb
    .from('instructors')
    .select('id, name, title, photo_url, credentials, is_default, display_order, active')
    .eq('active', true)
    .order('display_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ instructors: data ?? [] });
}
