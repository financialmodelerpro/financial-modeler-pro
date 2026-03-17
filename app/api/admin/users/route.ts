import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getServerClient } from '@/src/lib/supabase';

async function checkAdmin() {
  const session = await getServerSession();
  if (!session?.user || (session.user as any).role !== 'admin') return false;
  return true;
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = req.nextUrl;
    const page = parseInt(searchParams.get('page') ?? '0');
    const size = parseInt(searchParams.get('size') ?? '20');
    const search = searchParams.get('search') ?? '';
    const role = searchParams.get('role') ?? '';
    const sb = getServerClient();
    let q = sb.from('users').select('id, email, name, role, created_at', { count: 'exact' });
    if (search) q = q.ilike('email', `%${search}%`);
    if (role && role !== 'all') q = q.eq('role', role);
    q = q.order('created_at', { ascending: false }).range(page * size, (page + 1) * size - 1);
    const { data, count, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ users: data ?? [], total: count ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, role } = await req.json();
    if (!id || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    const sb = getServerClient();
    const { error } = await sb.from('users').update({ role }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
