import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { name, role, company, text, rating } = await req.json();
    if (!name?.trim() || !text?.trim()) return NextResponse.json({ error: 'Name and text required' }, { status: 400 });
    const sb = getServerClient();
    await sb.from('testimonials').insert({ name: name.trim(), role: role?.trim() ?? '', company: company?.trim() ?? '', text: text.trim(), rating: Math.min(5, Math.max(1, Number(rating) || 5)), status: 'pending', source: 'form' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
