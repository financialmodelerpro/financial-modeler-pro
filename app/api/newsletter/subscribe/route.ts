import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

export async function POST(req: NextRequest) {
  try {
    const { email, hubs } = await req.json() as { email?: string; hubs?: string[] };

    if (!email?.trim() || !email.includes('@') || !email.includes('.')) {
      return NextResponse.json({ ok: false, message: 'Please enter a valid email address.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const validHubs = (hubs ?? []).filter(h => h === 'training' || h === 'modeling');
    if (validHubs.length === 0) {
      return NextResponse.json({ ok: false, message: 'Please select at least one newsletter.' });
    }

    const sb = getServerClient();

    // Basic rate limit: check if same email subscribed in last 60s
    const { data: recent } = await sb
      .from('newsletter_subscribers')
      .select('id')
      .eq('email', cleanEmail)
      .gte('subscribed_at', new Date(Date.now() - 60000).toISOString())
      .limit(1);
    if (recent && recent.length > 0) {
      return NextResponse.json({ ok: true, subscribed: validHubs, message: "You're subscribed!" });
    }

    const subscribed: string[] = [];
    for (const hub of validHubs) {
      // Upsert: if unsubscribed, reactivate; if active, skip
      const { data: existing } = await sb
        .from('newsletter_subscribers')
        .select('id, status')
        .eq('email', cleanEmail)
        .eq('hub', hub)
        .maybeSingle();

      if (existing && existing.status === 'active') {
        subscribed.push(hub);
        continue;
      }
      if (existing && existing.status === 'unsubscribed') {
        await sb.from('newsletter_subscribers').update({
          status: 'active',
          subscribed_at: new Date().toISOString(),
          unsubscribed_at: null,
          unsubscribe_token: crypto.randomUUID(),
        }).eq('id', existing.id);
        subscribed.push(hub);
        continue;
      }
      // New subscriber
      const { error } = await sb.from('newsletter_subscribers').insert({
        email: cleanEmail,
        hub,
        source: req.headers.get('origin') ?? undefined,
      });
      if (!error) subscribed.push(hub);
    }

    return NextResponse.json({ ok: true, subscribed, message: "You're subscribed!" });
  } catch {
    return NextResponse.json({ ok: false, message: 'Something went wrong. Please try again.' });
  }
}
