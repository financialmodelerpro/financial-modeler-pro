/**
 * scripts/verify_announce_delivery.ts
 *
 * End-to-end verification of the live-session announce send path AFTER the
 * sendEmailBatch throttle fix. Uses the REAL building blocks the notify
 * route uses (liveSessionNotificationTemplate + sendEmailBatch), sends to
 * the two test addresses, then polls Brevo's transactional event log to
 * confirm each one reaches `delivered` (not merely accepted with a id).
 *
 * Usage:
 *   npx tsx --env-file=.vercel/.env.production.local scripts/verify_announce_delivery.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY.
 */

import { getServerClient } from '../src/core/db/supabase';
import { sendEmailBatch, FROM, type BatchEmailItem } from '../src/shared/email/sendEmail';
import { liveSessionNotificationTemplate } from '../src/shared/email/templates/liveSessionNotification';

const SESSION_ID = '1b9a9e3f-78b7-4012-86dc-be5d93645622';
const TARGETS = ['meetahmadch@gmail.com', 'ahmaddin.ch@gmail.com'];
const key = process.env.BREVO_API_KEY ?? '';

async function brevo(path: string) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, { headers: { 'api-key': key, accept: 'application/json' } });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) as unknown }; }
  catch { return { status: res.status, json: text as unknown }; }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const startedAt = Date.now();
  const sb = getServerClient();

  const { data: ls } = await sb.from('live_sessions').select('*').eq('id', SESSION_ID).single();
  if (!ls) { console.error('session not found'); process.exit(1); }

  const dt = ls.scheduled_datetime ? new Date(ls.scheduled_datetime) : null;
  const sessionDate = dt ? dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const sessionTime = dt ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
  const learnUrl    = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
  const sessionUrl  = `${learnUrl}/training/live-sessions/${SESSION_ID}`;

  const items: BatchEmailItem[] = [];
  for (const email of TARGETS) {
    const { subject, html } = await liveSessionNotificationTemplate({
      name: email, sessionTitle: ls.title, sessionDate, sessionTime,
      timezone: ls.timezone ?? 'Asia/Riyadh', sessionUrl,
      joinUrl: ls.live_url ?? undefined, description: ls.description ?? undefined,
      attachments: [], isReminder: false, registrationCount: 0,
    });
    items.push({ to: email, subject, html, from: FROM.training });
  }

  console.log(`Sending real announce to ${TARGETS.join(', ')} via sendEmailBatch (throttled)...`);
  const result = await sendEmailBatch(items);
  console.log('sendEmailBatch result:', JSON.stringify(result));
  if (!result.ok) { console.error('Batch did not accept all items.'); process.exit(1); }

  // Poll Brevo events until both addresses show a `delivered` event newer
  // than our send start, or timeout.
  const deadline = startedAt + 180_000; // 3 min
  const delivered = new Set<string>();
  while (Date.now() < deadline && delivered.size < TARGETS.length) {
    await sleep(15_000);
    for (const email of TARGETS) {
      if (delivered.has(email)) continue;
      const ev = await brevo(`/smtp/statistics/events?email=${encodeURIComponent(email)}&limit=10&sort=desc`);
      const events = ((ev.json as { events?: Array<{ event?: string; date?: string }> }).events) ?? [];
      const fresh = events.filter(e => e.date && new Date(e.date).getTime() >= startedAt - 5_000);
      const got = fresh.find(e => e.event === 'delivered');
      const blocked = fresh.find(e => e.event === 'blocked' || e.event === 'hardBounce' || e.event === 'softBounce' || e.event === 'spam');
      if (got)      { delivered.add(email); console.log(`  [${email}] DELIVERED @ ${got.date}`); }
      else if (blocked) console.log(`  [${email}] !! ${blocked.event} @ ${blocked.date}`);
      else console.log(`  [${email}] still pending (fresh events: ${fresh.map(e => e.event).join(',') || 'none yet'})`);
    }
  }

  console.log('\n=== VERIFICATION RESULT ===');
  for (const email of TARGETS) {
    console.log(`  ${email}: ${delivered.has(email) ? 'DELIVERED (Brevo-confirmed)' : 'NOT confirmed delivered within timeout'}`);
  }
  process.exit(delivered.size === TARGETS.length ? 0 : 2);
}

main().catch(e => { console.error(e); process.exit(1); });
