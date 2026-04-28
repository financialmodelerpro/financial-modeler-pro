import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

export async function POST(req: NextRequest) {
  try {
    const { name, email, subject, message } = await req.json();
    if (!name?.trim() || !email?.trim() || !message?.trim()) return NextResponse.json({ error: 'Required fields missing' }, { status: 400 });
    const sb = getServerClient();
    await sb.from('contact_submissions').insert({ name: name.trim(), email: email.trim(), subject: subject?.trim() ?? '', message: message.trim() });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
