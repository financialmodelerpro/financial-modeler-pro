/**
 * scripts/diagnose_brevo_events.ts
 *
 * Read-only probe of Brevo's transactional delivery for a single address.
 * Tells us what Brevo ACTUALLY did with the announce emails (the API
 * returns a messageId even when it then drops the mail), and whether the
 * address is on Brevo's transactional blocklist.
 *
 * Usage (needs the real Brevo key):
 *   npx tsx --env-file=.env.local scripts/diagnose_brevo_events.ts meetahmadch@gmail.com
 *
 * If BREVO_API_KEY is not in .env.local, pull it from Vercel first, e.g.
 *   vercel env pull .env.local      (if the Vercel CLI is installed)
 * or paste it inline:
 *   BREVO_API_KEY=xkeysib-... npx tsx scripts/diagnose_brevo_events.ts you@example.com
 *
 * Required env: BREVO_API_KEY.
 */

const email = (process.argv[2] ?? '').trim();
const key = process.env.BREVO_API_KEY ?? '';

if (!email) { console.error('Pass an email: ... diagnose_brevo_events.ts you@example.com'); process.exit(1); }
if (!key)   { console.error('BREVO_API_KEY not set. Add it to .env.local or pass inline.'); process.exit(1); }

async function brevo(path: string) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    headers: { 'api-key': key, accept: 'application/json' },
  });
  const text = await res.text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, json };
}

async function main() {
  // 1. Per-event transactional log for this address (last 30 days).
  //    event values: requests, delivered, hardBounces, softBounces, blocked,
  //    spam, invalid, deferred, opened, clicks, unsubscribed, error
  console.log(`\n=== Transactional events for ${email} (last 30 days) ===`);
  const ev = await brevo(`/smtp/statistics/events?email=${encodeURIComponent(email)}&limit=50&sort=desc`);
  if (ev.status !== 200) {
    console.log('  events query HTTP', ev.status, JSON.stringify(ev.json).slice(0, 400));
  } else {
    const events = (ev.json as { events?: Array<Record<string, unknown>> }).events ?? [];
    if (events.length === 0) console.log('  (no events found for this address)');
    const counts: Record<string, number> = {};
    for (const e of events) {
      const ename = String(e.event ?? 'unknown');
      counts[ename] = (counts[ename] ?? 0) + 1;
    }
    console.log('  event counts:', counts);
    for (const e of events.slice(0, 12)) {
      console.log(`   ${String(e.date ?? '').padEnd(26)} ${String(e.event ?? '').padEnd(12)} subj="${String(e.subject ?? '').slice(0, 40)}" reason=${e.reason ?? '-'}`);
    }
  }

  // 2. Is this contact blocklisted for transactional / marketing?
  console.log(`\n=== Contact record for ${email} ===`);
  const c = await brevo(`/contacts/${encodeURIComponent(email)}`);
  if (c.status === 404) {
    console.log('  not a Brevo contact (fine for transactional; means never blocklisted via contact).');
  } else if (c.status === 200) {
    const cj = c.json as { emailBlacklisted?: boolean; smsBlacklisted?: boolean; attributes?: Record<string, unknown> };
    console.log(`  emailBlacklisted=${cj.emailBlacklisted}  smsBlacklisted=${cj.smsBlacklisted}`);
    if (cj.emailBlacklisted) console.log('  >> BLOCKLISTED: Brevo will accept (return messageId) but DROP every send to this address until you un-blocklist it.');
  } else {
    console.log('  contact query HTTP', c.status, JSON.stringify(c.json).slice(0, 300));
  }

  // 3. Account + sender authentication sanity (DKIM/DMARC affect inbox vs spam).
  console.log(`\n=== Senders / domain authentication ===`);
  const s = await brevo('/senders');
  if (s.status === 200) {
    const senders = (s.json as { senders?: Array<{ email: string; active: boolean }> }).senders ?? [];
    for (const sn of senders) console.log(`  sender ${sn.email} active=${sn.active}`);
  } else {
    console.log('  senders query HTTP', s.status);
  }
  const d = await brevo('/senders/domains');
  if (d.status === 200) {
    const domains = (d.json as { domains?: Array<{ domain_name?: string; authenticated?: boolean; verified?: boolean }> }).domains ?? [];
    for (const dm of domains) console.log(`  domain ${dm.domain_name} authenticated(DKIM)=${dm.authenticated} verified(SPF)=${dm.verified}`);
  } else {
    console.log('  domains query HTTP', d.status, '(endpoint may differ by plan)');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
