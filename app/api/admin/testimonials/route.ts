import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';

export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('testimonials').select('*').order('created_at', { ascending: false });
    return NextResponse.json({ testimonials: data ?? [] });
  } catch {
    return NextResponse.json({ testimonials: [] });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    const sb = getServerClient();
    await sb.from('testimonials').update({ status, approved_at: status === 'approved' ? new Date().toISOString() : null }).eq('id', id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const sb = getServerClient();
    await sb.from('testimonials').delete().eq('id', id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
