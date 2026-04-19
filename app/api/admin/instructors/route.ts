import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

async function checkAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const { data, error } = await sb
    .from('instructors')
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ instructors: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await req.json()) as Record<string, unknown>;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const sb = getServerClient();
  const isDefault = body.is_default === true;

  // Only one default at a time — unset the current one first.
  if (isDefault) {
    await sb.from('instructors').update({ is_default: false }).eq('is_default', true);
  }

  const { data, error } = await sb
    .from('instructors')
    .insert({
      name,
      title,
      bio: (body.bio as string | undefined) ?? null,
      photo_url: (body.photo_url as string | undefined) ?? null,
      email: (body.email as string | undefined) ?? null,
      linkedin_url: (body.linkedin_url as string | undefined) ?? null,
      credentials: (body.credentials as string | undefined) ?? null,
      display_order: typeof body.display_order === 'number' ? body.display_order : 0,
      is_default: isDefault,
      active: body.active === false ? false : true,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ instructor: data });
}
