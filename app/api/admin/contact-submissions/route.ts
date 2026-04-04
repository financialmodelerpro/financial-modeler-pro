import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('contact_submissions').select('*').order('created_at', { ascending: false });
    return NextResponse.json({ submissions: data ?? [] });
  } catch {
    return NextResponse.json({ submissions: [] });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, read } = await req.json();
    const sb = getServerClient();
    await sb.from('contact_submissions').update({ read }).eq('id', id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
