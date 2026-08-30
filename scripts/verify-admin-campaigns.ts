/**
 * scripts/verify-admin-campaigns.ts
 *
 * Pins the 2026-08-30 admin campaign feature and the broadened signup
 * question. The audience and merge rules are tested BEHAVIOURALLY against a
 * fake client, because they are the ones with real consequences: emailing an
 * admin who was never chosen, emailing someone who opted out, or putting a
 * recipient's name into HTML unescaped.
 *
 *   A. Audience: admins excluded unless EXPLICITLY picked; unsubscribed users
 *      always excluded and reported; filters compose.
 *   B. Merge + escaping: every user-supplied value escaped, sensible fallbacks.
 *   C. Unsubscribe: HMAC verified in constant time, cannot be forged.
 *   D. Sending shape (source): the shared Brevo path, per-recipient outcomes,
 *      one failure never stops the rest, every recipient logged, reply-to set.
 *   E. Safety (source): preview, confirm, count re-checked at send.
 *   F. Migration 225 additive; the seed template exists.
 *   G. The signup question reads real estate OR hospitality, and the audience
 *      notice is on the form.
 *
 * Runs OFFLINE. Run: npx tsx scripts/verify-admin-campaigns.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveCampaignRecipients, mergeBody, unsubscribeToken, verifyUnsubscribeToken,
  CAMPAIGN_REPLY_TO, MERGE_FIELDS,
} from '../src/shared/email/campaigns';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

interface Row { [k: string]: unknown }
function fakeDb(rows: Row[]) {
  const state: { ids?: string[]; eqs: Array<[string, unknown]>; isNull?: string } = { eqs: [] };
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.in = (col: string, vals: string[]) => { if (col === 'id') state.ids = vals; else state.eqs.push([col, vals]); return b; };
  b.eq = (col: string, v: unknown) => { state.eqs.push([col, v]); return b; };
  b.is = (col: string) => { state.isNull = col; return b; };
  b.range = () => {
    let out = rows;
    if (state.ids) out = out.filter((r) => state.ids!.includes(String(r.id)));
    for (const [col, v] of state.eqs) {
      out = Array.isArray(v) ? out.filter((r) => (v as unknown[]).includes(r[col])) : out.filter((r) => r[col] === v);
    }
    if (state.isNull) out = out.filter((r) => r[state.isNull!] == null);
    return Promise.resolve({ data: out, error: null });
  };
  return { from: () => b } as unknown as SupabaseClient;
}

const USERS: Row[] = [
  { id: 'u1', email: 'dev@a.com', name: 'Dana Dev', company: 'Acme', role: 'user', subscription_plan: 'pro', subscription_status: 'active', works_in_real_estate: true, campaign_unsubscribed_at: null },
  { id: 'u2', email: 'trial@b.com', name: 'Tariq', company: null, role: 'user', subscription_plan: 'trial', subscription_status: 'trial', works_in_real_estate: false, campaign_unsubscribed_at: null },
  { id: 'u3', email: 'gone@c.com', name: 'Opted Out', company: 'Zed', role: 'user', subscription_plan: 'pro', subscription_status: 'active', works_in_real_estate: true, campaign_unsubscribed_at: '2026-08-01T00:00:00Z' },
  { id: 'a1', email: 'boss@fmp.com', name: 'Admin', company: 'FMP', role: 'admin', subscription_plan: 'firm', subscription_status: 'active', works_in_real_estate: true, campaign_unsubscribed_at: null },
];

async function main() {
  console.log('A. Audience');
  {
    const r = await resolveCampaignRecipients(fakeDb(USERS), {});
    check('A1 an unfiltered campaign reaches the ordinary users only',
      r.recipients.map((x) => x.id).sort().join(',') === 'u1,u2');
    check('A2 the admin is excluded and the exclusion is reported', r.adminsExcluded === 1);
    check('A3 the unsubscribed user is excluded and reported, not silently dropped',
      r.unsubscribed.length === 1 && r.unsubscribed[0].id === 'u3');
  }
  {
    const r = await resolveCampaignRecipients(fakeDb(USERS), { userIds: ['a1', 'u1'] });
    check('A4 an admin IS included when explicitly picked',
      r.recipients.map((x) => x.id).sort().join(',') === 'a1,u1' && r.adminsExcluded === 0);
  }
  {
    const r = await resolveCampaignRecipients(fakeDb(USERS), { userIds: ['u3'] });
    check('A5 an explicit pick still cannot email someone who unsubscribed',
      r.recipients.length === 0 && r.unsubscribed.length === 1);
  }
  {
    const byPlan = await resolveCampaignRecipients(fakeDb(USERS), { planKeys: ['pro'] });
    check('A6 the plan filter applies (and still drops the unsubscribed pro user)',
      byPlan.recipients.map((x) => x.id).join(',') === 'u1');
    const byInd = await resolveCampaignRecipients(fakeDb(USERS), { industry: 'no' });
    check('A7 the industry filter applies', byInd.recipients.map((x) => x.id).join(',') === 'u2');
  }

  console.log('B. Merge fields and escaping');
  {
    const body = 'Hi {{name}}, at {{company}}{{company_clause}} link {{meeting_link}}';
    const out = mergeBody(body, { name: '<script>alert(1)</script> Eve', company: 'A & B "Ltd"', meetingLink: 'https://x.test/a?b=1&c=2', unsubscribeUrl: 'https://u' });
    check('B1 a hostile name is escaped, never rendered as markup',
      !out.includes('<script>') && out.includes('&lt;script&gt;'));
    check('B2 a company with & and quotes is escaped', out.includes('A &amp; B &quot;Ltd&quot;'));
    check('B3 the meeting link is escaped too', out.includes('https://x.test/a?b=1&amp;c=2'));
    const plain = mergeBody('Hi {{name}}{{company_clause}}.', { name: 'Dana Dev', company: 'Acme', meetingLink: '', unsubscribeUrl: '' });
    check('B4 the first name is used and the company clause reads naturally', plain === 'Hi Dana at Acme.');
    const none = mergeBody('Hi {{name}}{{company_clause}}, {{company}}.', { name: null, company: null, meetingLink: '', unsubscribeUrl: '' });
    check('B5 missing values fall back without leaving a token behind',
      none === 'Hi there, your team.' && !none.includes('{{'));
    check('B6 the merge-field list is published for the editor', MERGE_FIELDS.length >= 3);
  }

  console.log('C. Unsubscribe token');
  {
    const t = unsubscribeToken('u1');
    check('C1 a valid token verifies', verifyUnsubscribeToken('u1', t));
    check('C2 the token of one user does NOT unsubscribe another', !verifyUnsubscribeToken('u2', t));
    check('C3 a wrong-length token is rejected without throwing', !verifyUnsubscribeToken('u1', 'short'));
    check('C4 an empty token is rejected', !verifyUnsubscribeToken('u1', ''));
    const route = src('app/api/campaigns/unsubscribe/route.ts');
    check('C5 the public route verifies before writing anything',
      route.indexOf('verifyUnsubscribeToken') < route.indexOf("update({ campaign_unsubscribed_at"));
  }

  console.log('D. Sending');
  const camp = src('src/shared/email/campaigns.ts');
  const sendMod = src('src/shared/email/sendEmail.ts');
  check('D1 campaigns use the SHARED Brevo path, no second sender',
    /sendEmailPerRecipient/.test(camp) && !/BrevoClient|sendTransacEmail/.test(camp));
  check('D2 per-recipient sending reuses the SAME wave pacing as the batch sender',
    /export async function sendEmailPerRecipient/.test(sendMod)
    && /BATCH_WAVE_SIZE/.test(sendMod.split('sendEmailPerRecipient')[1] ?? '')
    && /INTER_WAVE_DELAY_MS/.test(sendMod.split('sendEmailPerRecipient')[1] ?? ''));
  check('D3 one failure cannot stop the rest (settled per item, outcome each)',
    /Promise\.allSettled/.test(sendMod.split('sendEmailPerRecipient')[1] ?? ''));
  check('D4 every recipient is logged, including failures and skips',
    /status: outcomes\[i\]\?\.ok \? 'sent' : 'failed'/.test(camp)
    && /skipped_unsubscribed/.test(camp));
  check('D5 the log write cannot break a send that already happened', /log write failed/.test(camp));
  check('D6 sent from no-reply with a human reply-to',
    /from: FROM\.noreply/.test(camp) && /replyTo: CAMPAIGN_REPLY_TO/.test(camp)
    && /ahmad\.din@financialmodelerpro\.com/.test(CAMPAIGN_REPLY_TO));
  check('D7 the shared branded layout is used, not a bespoke one',
    /baseLayoutBranded/.test(camp));
  check('D8 every campaign carries an unsubscribe link', /Unsubscribe from these emails/.test(camp));

  console.log('E. Safety rails');
  const sendRoute = src('app/api/admin/campaigns/send/route.ts');
  check('E1 the send refuses without an explicit confirm', /body\.confirm !== true/.test(sendRoute));
  check('E2 the audience is re-resolved server-side, never taken from the client',
    /resolveCampaignRecipients\(sb, body\.filters/.test(sendRoute));
  check('E3 a count that moved since the preview REFUSES rather than sending',
    /COUNT_CHANGED/.test(sendRoute) && /expectedCount !== resolution\.recipients\.length/.test(sendRoute));
  check('E4 an empty audience is refused', /NO_RECIPIENTS/.test(sendRoute));
  check('E5 the send is audited', /action: 'campaign_sent'/.test(sendRoute));
  const page = src('app/admin/campaigns/page.tsx');
  // The confirm button names the count through a template literal, so the
  // assertion matches the interpolation rather than a JSX brace.
  check('E6 the UI previews the rendered email and names the count in the confirm',
    /campaign-preview/.test(page) && /campaign-recipient-count/.test(page)
    && /Yes, send to \$\{preview\.recipientCount\}/.test(page)
    && /campaign-confirm-send/.test(page));
  check('E7 every admin route is admin-guarded',
    ['templates', 'preview', 'send', 'log'].every((r) =>
      /role\?: string \}\)\.role !== 'admin'/.test(src(`app/api/admin/campaigns/${r}/route.ts`))));

  console.log('F. Migration 225');
  const mig = src('supabase/migrations/225_admin_campaigns.sql');
  const migCode = mig.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''").replace(/E'[^']*'/g, "''");
  check('F1 two new tables plus one nullable column, additive',
    /CREATE TABLE IF NOT EXISTS admin_campaign_templates/.test(mig)
    && /CREATE TABLE IF NOT EXISTS admin_campaign_sends/.test(mig)
    && /ADD COLUMN IF NOT EXISTS campaign_unsubscribed_at timestamptz/.test(mig));
  check('F2 no drop, no destructive statement',
    !/DROP |TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET/i.test(migCode));
  check('F3 the recipient is a raw copy, so the log survives the user',
    /recipient_user_id uuid,/.test(mig) && !/recipient_user_id[^,]*REFERENCES/.test(mig));
  check('F4 the walkthrough template is seeded, idempotently',
    /Walkthrough invitation/.test(mig) && /ON CONFLICT \(name\) DO NOTHING/.test(mig));
  check('F5 the seed uses the merge fields', /\{\{name\}\}/.test(mig) && /\{\{meeting_link\}\}/.test(mig));

  console.log('G. The broadened question and the audience notice');
  const form = src('app/modeling/register/RegisterForm.tsx');
  check('G1 the question asks about real estate OR hospitality',
    /ARE YOU ACTIVELY WORKING IN REAL ESTATE OR HOSPITALITY\?/.test(form));
  check('G2 the stored field name is unchanged', /works_in_real_estate: worksInRe/.test(form));
  check('G3 the who-this-is-for notice is on the form, above the fields',
    /register-audience-notice/.test(form)
    && form.indexOf('register-audience-notice') < form.indexOf('<form onSubmit'));
  // JSX wraps prose across lines, so the copy is compared whitespace-normalised.
  const formFlat = form.replace(/\s+/g, ' ');
  check('G4 the notice says what the platform is and is not',
    /real estate and hospitality professionals/.test(formFlat)
    && /It is not a training tool or a general finance calculator/.test(formFlat)
    && /unlikely to fit your work/.test(formFlat));
  check('G5 the admin column and labels widened too',
    /RE \/ Hospitality/.test(src('app/admin/users/page.tsx'))
    && /IN RE \/ HOSPITALITY/.test(src('src/shared/admin/signupProfile.ts')));
  check('G6 no stale "real estate industry" question text remains',
    !/REAL ESTATE INDUSTRY\?/i.test(strip(form)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
