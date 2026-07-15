/**
 * verify-article-announce.ts
 *
 * Proves the article "Announce" action: the union audience (students +
 * subscribers, modeling users opt-in), the two consent rules that protect
 * people who opted out, and the wiring that makes the button safe.
 *
 * planAudience is pure, so the consent rules are tested for real rather than
 * asserted via source text. The wiring around it is source-asserted.
 *
 * Pure + source-assertion tests; no DB and no network.
 *
 * Run: npx tsx scripts/verify-article-announce.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { planAudience, type SubscriberRowLike } from '../src/shared/newsletter/announceAudience';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const AUDIENCE  = read('src/shared/newsletter/announceAudience.ts');
const ROUTE     = read('app/api/admin/articles/[id]/announce/route.ts');
const BUTTON    = read('src/components/admin/AnnounceArticleButton.tsx');
const LIST      = read('app/admin/articles/page.tsx');

/** Build a subscriber-row map the way loadSubscriberRows would. */
function subs(rows: Array<{ email: string; hub?: string; status?: string; token?: string }>): Map<string, SubscriberRowLike[]> {
  const m = new Map<string, SubscriberRowLike[]>();
  for (const r of rows) {
    const row: SubscriberRowLike = {
      email: r.email, hub: r.hub ?? 'training',
      status: r.status ?? 'active', unsubscribe_token: r.token ?? 'tok-' + r.email,
    };
    const list = m.get(r.email);
    if (list) list.push(row); else m.set(r.email, [row]);
  }
  return m;
}
const S = (...e: string[]) => new Set(e);

console.log('=== 1. The union: students AND subscribers, each once ===');
{
  const plan = planAudience({
    subscriberRows: subs([{ email: 'sub@x.com' }, { email: 'both@x.com' }]),
    studentEmails:  S('stud@x.com', 'both@x.com'),
    modelingEmails: S(),
  });
  const t = new Set(plan.targets);
  check('a subscriber who is not a student is included', t.has('sub@x.com'));
  check('a student who is not a subscriber is included', t.has('stud@x.com'));
  check('someone who is both is included', t.has('both@x.com'));
  check('someone who is both is emailed ONCE (deduped)', plan.targets.filter(e => e === 'both@x.com').length === 1);
  check('total is the union, not the sum', plan.targets.length === 3, String(plan.targets.length));
  check('subscriber count reports active subscribers', plan.activeSubscriberCount === 2);
}

console.log('\n=== 2. Rule 1: an opt-out always wins ===');
{
  const plan = planAudience({
    // On the student roster forever, but they unsubscribed.
    subscriberRows: subs([{ email: 'quit@x.com', status: 'unsubscribed' }]),
    studentEmails:  S('quit@x.com', 'ok@x.com'),
    modelingEmails: S(),
  });
  check('an unsubscribed STUDENT is not emailed', !plan.targets.includes('quit@x.com'));
  check('they are reported as excluded', plan.optedOut.includes('quit@x.com'));
  check('other students are unaffected', plan.targets.includes('ok@x.com'));
  check('an opted-out person is never queued for a new row', !plan.needRow.includes('quit@x.com'));
}
{
  const plan = planAudience({
    subscriberRows: subs([{ email: 'quit@x.com', status: 'unsubscribed' }]),
    studentEmails:  S(),
    modelingEmails: S('quit@x.com'),
  });
  check('an unsubscribed MODELING user is not emailed', !plan.targets.includes('quit@x.com'));
}
{
  // Unsubscribed from one hub, still active on the other: matches the existing
  // loadActiveSubscribers rule (any active row = reachable).
  const plan = planAudience({
    subscriberRows: subs([
      { email: 'mixed@x.com', hub: 'training', status: 'unsubscribed' },
      { email: 'mixed@x.com', hub: 'modeling', status: 'active' },
    ]),
    studentEmails: S(), modelingEmails: S(),
  });
  check('active on any hub still counts as reachable', plan.targets.includes('mixed@x.com'));
  check('and is not counted as opted out', !plan.optedOut.includes('mixed@x.com'));
}

console.log('\n=== 3. Rule 2: never resurrect a row (only mint for the row-less) ===');
{
  const plan = planAudience({
    subscriberRows: subs([
      { email: 'has@x.com' },
      { email: 'quit@x.com', status: 'unsubscribed' },
    ]),
    studentEmails: S('has@x.com', 'quit@x.com', 'new@x.com'),
    modelingEmails: S(),
  });
  check('a student with no subscriber row gets one minted', plan.needRow.includes('new@x.com'));
  check('an existing subscriber is NOT re-inserted', !plan.needRow.includes('has@x.com'));
  check('an unsubscribed row is NEVER re-inserted (no resurrect)', !plan.needRow.includes('quit@x.com'));
  check('exactly one row is minted here', plan.needRow.length === 1, JSON.stringify(plan.needRow));
}
{
  const plan = planAudience({
    subscriberRows: subs([]),
    studentEmails: S('stud@x.com'),
    modelingEmails: S('model@x.com'),
  });
  check('a student-sourced row is filed under the training hub', plan.hubFor.get('stud@x.com') === 'training');
  check('a modeling-only row is filed under the modeling hub', plan.hubFor.get('model@x.com') === 'modeling');
}
{
  const plan = planAudience({
    subscriberRows: subs([]),
    studentEmails: S('both@x.com'),
    modelingEmails: S('both@x.com'),
  });
  check('a student who is also a modeling user files under training', plan.hubFor.get('both@x.com') === 'training');
}
check('the insert uses ignoreDuplicates so a race cannot clobber a status', AUDIENCE.includes('ignoreDuplicates: true'));
check('the insert targets the (email,hub) unique key', AUDIENCE.includes("onConflict: 'email,hub'"));
check('minted rows are tagged with a source for traceability', AUDIENCE.includes("source: 'article_announce'"));

console.log('\n=== 4. The modeling-hub toggle ===');
{
  const off = planAudience({ subscriberRows: subs([]), studentEmails: S('s@x.com'), modelingEmails: S() });
  const on  = planAudience({ subscriberRows: subs([]), studentEmails: S('s@x.com'), modelingEmails: S('m@x.com') });
  check('toggle off excludes modeling users', !off.targets.includes('m@x.com'));
  check('toggle on includes modeling users', on.targets.includes('m@x.com'));
  check('students are included either way', off.targets.includes('s@x.com') && on.targets.includes('s@x.com'));
}
check('the resolver only loads modeling users when asked', AUDIENCE.includes('includeModeling ? loadModelingUserEmails()'));
check('the toggle defaults to OFF', AUDIENCE.includes('opts.includeModelingUsers ?? false'));
check('the route reads the toggle from the request body', ROUTE.includes('body.includeModelingUsers ?? false'));
check('the UI exposes the toggle', BUTTON.includes('announce-include-modeling'));
check('the UI states students+subscribers are always included', BUTTON.includes('always included'));

console.log('\n=== 5. Malformed addresses never reach the sender ===');
{
  const plan = planAudience({
    subscriberRows: subs([]),
    studentEmails: S('good@x.com', 'nope', '', 'no@domain'),
    modelingEmails: S(),
  });
  check('a valid address survives', plan.targets.includes('good@x.com'));
  check('an address with no @ is dropped', !plan.targets.includes('nope'));
  check('an address with no domain dot is dropped', !plan.targets.includes('no@domain'));
  check('an empty address is dropped', !plan.targets.includes(''));
}

console.log('\n=== 6. Only a published article can be announced ===');
check('the route rejects a non-published article', ROUTE.includes("article.status !== 'published'"));
check('the rejection explains the 404 consequence', /would 404/.test(ROUTE));
check('the button is disabled unless published', BUTTON.includes("const published = status === 'published'"));
check('the disabled button explains why via title', /Only a published article can be announced/.test(BUTTON));
check('the list passes the real status through', LIST.includes('status={a.status}'));

console.log('\n=== 7. Double-send protection ===');
check('a prior send returns 409 rather than silently re-emailing', ROUTE.includes('status: 409'));
check('409 is keyed on already_sent', ROUTE.includes("error: 'already_sent'"));
check('a resend requires an explicit force flag', ROUTE.includes('!body.force'));
check('failed campaigns do not block a retry', ROUTE.includes("h.status !== 'failed'"));
check('the warning says recipients get it a second time', /second time/.test(ROUTE));
check('the UI surfaces the resend warning', BUTTON.includes('announce-resend-warning'));
check('the UI requires a second click to force', BUTTON.includes('send(Boolean(confirmResend))'));

console.log('\n=== 7b. Send a test to myself ===');
{
  // The whole point of the test button: check the mail before 175 people get it.
  const previewIdx  = ROUTE.indexOf('if (body.preview)');
  const historyIdx  = ROUTE.indexOf('const history = await loadHistory(id)');
  const audienceIdx = ROUTE.indexOf('await resolveAnnounceAudience({ includeModelingUsers })');
  const campaignIdx = ROUTE.indexOf("from('newsletter_campaigns')\n    .insert(");
  check('the route has a preview branch', previewIdx > -1);
  check('preview runs BEFORE the already-sent 409 (an announced article can still be tested)',
    previewIdx > -1 && historyIdx > -1 && previewIdx < historyIdx);
  check('preview runs BEFORE audience resolution (mints no subscriber rows for anyone)',
    previewIdx > -1 && audienceIdx > -1 && previewIdx < audienceIdx);
  check('preview returns before any campaign row is inserted (cannot count as announced)',
    previewIdx > -1 && campaignIdx > -1 && previewIdx < campaignIdx);
  check('preview goes only to the signed-in admin, not a caller-supplied address',
    ROUTE.includes('toEmail:          user.email'));
  check('preview uses sendTestEmail (no campaign, no recipient log, [TEST] prefix)',
    ROUTE.includes('await sendTestEmail({'));
  check('preview uses a synthetic unsub token, so a test click cannot unsubscribe a real person',
    ROUTE.includes("unsubscribeToken: '00000000-0000-0000-0000-000000000000'"));
  check('preview never calls sendCampaign', ROUTE.slice(previewIdx, historyIdx).indexOf('sendCampaign') === -1);
  check('a preview failure is surfaced, not swallowed', ROUTE.includes("error: sent.error ?? 'Test send failed'"));
  check('an admin with no email address gets a clear error', ROUTE.includes('no email address to send to'));
}
check('the test and the real send render from ONE shared function (cannot drift)',
  (ROUTE.match(/renderArticleEmail\(article\)/g) ?? []).length === 2);
check('the UI exposes the test button', BUTTON.includes('announce-preview"'));
check('the UI confirms where the test landed', BUTTON.includes('announce-preview-sent'));
check('the UI states the test contacts nobody else', BUTTON.includes('Nobody else is contacted'));
check('the test button posts preview:true', BUTTON.includes("JSON.stringify({ preview: true })"));

console.log('\n=== 8. The preview is side-effect free ===');
check('a dry run returns before minting any row', AUDIENCE.includes('if (opts.dryRun) return { recipients: [], counts }'));
check('the GET preview runs a dry run', ROUTE.includes('dryRun: true'));
check('the POST send does NOT dry run', /resolveAnnounceAudience\(\{ includeModelingUsers \}\)/.test(ROUTE));

console.log('\n=== 9. Unsubscribe integrity ===');
check('a recipient with no token is skipped, never emailed', AUDIENCE.includes('no unsubscribe token, skipping'));
check('rows are re-read so minted tokens are picked up', AUDIENCE.includes('Re-read so freshly minted rows'));
check('an active row is preferred when choosing the token', AUDIENCE.includes("rows.find(r => r.status === 'active') ?? rows[0]"));
check('sendCampaign builds the unsubscribe link per recipient', read('src/shared/newsletter/sender.ts').includes('unsubscribeToken: r.unsubscribe_token'));

console.log('\n=== 10. Reuse: the newsletter stack, not a second sender ===');
check('the route hands the explicit audience to sendCampaign', ROUTE.includes('recipients, // explicit union audience'));
check('no bespoke email loop in the route', !ROUTE.includes('sendEmailBatch'));
check('content renders from the shared event template', ROUTE.includes("renderForEvent(AUTO_SOURCE_TYPE"));
check('there is a fallback when no template row exists', ROUTE.includes('?? fallbackContent(a)'));
check('the campaign is logged against the article', ROUTE.includes('source_id:     article.id'));
check("campaign_type is 'manual' so re-announce is not blocked by the auto unique index", ROUTE.includes("campaign_type: 'manual'"));
check('history surfaces auto sends too, so nobody is double-emailed unknowingly', ROUTE.includes('AUTO_SOURCE_TYPE'));
check('the send route is admin-guarded', ROUTE.includes("user?.role === 'admin'"));
check('long batches are not killed mid-send', ROUTE.includes('maxDuration = 300'));

console.log('\n=== 11. Scale: no silent 1000-row truncation ===');
check('sources are paged explicitly', AUDIENCE.includes('.range(from, from + PAGE - 1)'));
check('the page size matches the PostgREST cap', AUDIENCE.includes('const PAGE = 1000'));
check('paging stops on a short page', AUDIENCE.includes('if (rows.length < PAGE) break'));
check('students are paged', AUDIENCE.includes("selectAllRows<{ email: string | null }>(\n    'training_registrations_meta'"));
check('subscribers are paged', AUDIENCE.includes("'newsletter_subscribers',\n    'email, hub, status, unsubscribe_token',"));

console.log('\n=== 12. Confirmed-status rules match the existing stacks ===');
check('students: null email_confirmed still counts (pre-mig-027 rows)', AUDIENCE.includes("'email_confirmed.eq.true,email_confirmed.is.null'"));
check('modeling users: only an explicit false blocks', AUDIENCE.includes('r.email_confirmed === false'));

console.log('\n=== 13. House style ===');
for (const [name, src] of [['announceAudience', AUDIENCE], ['route', ROUTE], ['button', BUTTON]] as const) {
  check(`${name} has no em dashes`, !src.includes('—'));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:'); for (const f of fails) console.log('  - ' + f); process.exit(1); }
