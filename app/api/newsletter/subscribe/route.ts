import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function POST(req: NextRequest) {
  try {
    const { email, name, source } = await req.json() as { email: string; name?: string; source?: string };
    if (!email?.trim() || !email.includes('@')) {
      return NextResponse.json({ success: false, message: 'Please enter a valid email address.' });
    }

    const sb = getServerClient();
    const { error } = await sb.from('newsletter_subscribers').insert({
      email: email.trim().toLowerCase(),
      name: name?.trim() || null,
      source: source || 'articles',
    });

    if (error?.code === '23505') {
      return NextResponse.json({ success: true, message: "You're already subscribed!" });
    }
    if (error) {
      return NextResponse.json({ success: false, message: 'Something went wrong. Please try again.' });
    }

    return NextResponse.json({ success: true, message: "You're subscribed! We'll send you the latest insights." });
  } catch {
    return NextResponse.json({ success: false, message: 'Something went wrong.' });
  }
}
