import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { serverClient } from '@/src/lib/shared/supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user)               return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Admin only' },   { status: 403 });

  const { searchParams } = new URL(req.url);
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const { data, error, count } = await serverClient
    .from('admin_audit_log')
    .select(`
      id, action, before_value, after_value, reason, created_at,
      admin:admin_id(email, name),
      target:target_user_id(email, name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [], total: count ?? 0 });
}
