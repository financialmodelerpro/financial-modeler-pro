/**
 * scripts/model_submission_notice_broadcast.ts
 *
 * One-shot broadcast that emails every confirmed Training Hub student a
 * heads-up that the model-submission requirement is coming for the
 * Final Exam. Built for migration 148's notice period: send this at
 * least `model_submission_notice_days` before flipping
 * `model_submission_required_<course>` ON.
 *
 * Idempotency:
 *   - Per-scope flag in training_settings:
 *       model_submission_notice_broadcast_<scope>_at = ISO timestamp
 *     Set after a successful run. Re-running is a no-op unless --force
 *     is passed.
 *   - The flag is per-scope ('3sfm', 'bvm', 'all'), so admins can
 *     announce one course independently from another.
 *
 * Why a script and not an HTTP endpoint:
 *   This is one-shot maintenance work that needs the service-role key,
 *   batches against Resend's rate limit, and runs to completion in a
 *   long-lived process. Wrapping it in a Vercel serverless function
 *   would need streaming + auth gymnastics that buy nothing for a
 *   ceremony admins only run once or twice.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/model_submission_notice_broadcast.ts \
 *     --scope all          # 3SFM | BVM | all  (default 'all')
 *     --dry-run            # print recipient count + sample, no email
 *     --force              # bypass the per-scope idempotency flag
 *     --limit 20           # cap recipients (debugging)
 *
 * Reads training_settings keys:
 *   model_submission_max_attempts            (default '3')
 *   model_submission_review_sla_days         (default '5')
 *   model_submission_notice_days             (default '7')
 *   model_submission_notice_broadcast_<scope>_at (idempotency)
 */

import { getServerClient } from '../src/core/db/supabase';
import { sendEmailBatch, FROM, type BatchEmailItem } from '../src/shared/email/sendEmail';
import { modelSubmissionNoticeBroadcastTemplate } from '../src/shared/email/templates/modelSubmissionNoticeBroadcast';

type Scope = '3SFM' | 'BVM' | 'all';

interface CliOptions {
  scope: Scope;
  dryRun: boolean;
  force: boolean;
  limit: number | null;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { scope: 'all', dryRun: false, force: false, limit: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--scope') {
      const v = args[++i];
      if (v === '3SFM' || v === 'BVM' || v === 'all') opts.scope = v;
      else throw new Error(`--scope must be 3SFM, BVM, or all (got '${v}')`);
    }
    else if (a === '--limit') {
      const n = parseInt(args[++i], 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error('--limit must be a positive integer');
      opts.limit = n;
    }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: tsx scripts/model_submission_notice_broadcast.ts [--scope 3SFM|BVM|all] [--dry-run] [--force] [--limit N]');
      process.exit(0);
    }
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

interface StudentRow {
  email: string;
  name: string | null;
  email_confirmed: boolean | null;
}

async function readSettings(sb: ReturnType<typeof getServerClient>): Promise<Record<string, string>> {
  const { data } = await sb.from('training_settings').select('key, value');
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { key: string; value: string }[]) out[r.key] = r.value;
  return out;
}

async function main() {
  const opts = parseArgs();
  const sb = getServerClient();

  console.log(`\n=== Model Submission Notice Broadcast ===`);
  console.log(`scope:   ${opts.scope}`);
  console.log(`dryRun:  ${opts.dryRun}`);
  console.log(`force:   ${opts.force}`);
  if (opts.limit) console.log(`limit:   ${opts.limit}`);
  console.log('');

  const settings = await readSettings(sb);
  const maxAttempts = Math.max(1, Math.min(10, parseInt(settings.model_submission_max_attempts ?? '3', 10) || 3));
  const reviewSlaDays = Math.max(1, Math.min(30, parseInt(settings.model_submission_review_sla_days ?? '5', 10) || 5));
  const noticeDays    = Math.max(1, Math.min(60, parseInt(settings.model_submission_notice_days ?? '7', 10) || 7));

  const flagKey = `model_submission_notice_broadcast_${opts.scope.toLowerCase()}_at`;
  const previousRunAt = (settings[flagKey] ?? '').trim();
  if (previousRunAt && !opts.force && !opts.dryRun) {
    console.error(`ABORT: ${flagKey} already set to ${previousRunAt}.`);
    console.error(`Re-run with --force to broadcast again, or --dry-run to print recipients without emailing.`);
    process.exit(1);
  }
  if (previousRunAt) {
    console.log(`(scope flag previously set: ${previousRunAt})\n`);
  }

  // Recipient set: every confirmed Training Hub student. Email confirmed
  // is treated as null=confirmed per the existing platform convention
  // (pre-migration-027 students have null and are still active).
  const { data: rows, error } = await sb
    .from('training_registrations_meta')
    .select('email, name, email_confirmed')
    .order('email', { ascending: true });
  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }
  let students = ((rows ?? []) as StudentRow[]).filter(r => r.email_confirmed !== false && r.email);
  if (opts.limit) students = students.slice(0, opts.limit);
  console.log(`Recipients: ${students.length}`);

  if (students.length === 0) {
    console.log('Nothing to send.');
    process.exit(0);
  }

  if (opts.dryRun) {
    console.log('\nSample (first 5):');
    students.slice(0, 5).forEach(s => console.log(`  - ${s.name ?? '(no name)'} <${s.email}>`));
    console.log('\nDRY RUN. No emails sent. Exiting.');
    process.exit(0);
  }

  // Build per-recipient email payloads. Each student gets a personalised
  // greeting via studentName. Resend batch.send is capped at 100 per
  // request; chunk + stagger 200ms between batches to stay below the
  // per-second rate slot.
  console.log('\nBuilding email payloads...');
  const payloads: BatchEmailItem[] = [];
  for (const s of students) {
    const { subject, html, text } = await modelSubmissionNoticeBroadcastTemplate({
      studentName: s.name?.trim() || null,
      scope: opts.scope,
      noticeDays,
      reviewSlaDays,
      maxAttempts,
    });
    payloads.push({ to: s.email, subject, html, text, from: FROM.training });
  }

  const BATCH_SIZE = 100;
  const STAGGER_MS = 250;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const chunk = payloads.slice(i, i + BATCH_SIZE);
    const result = await sendEmailBatch(chunk);
    if (result.ok) {
      sent += chunk.length;
      console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: ok (${chunk.length} emails)`);
    } else {
      failed += chunk.length;
      console.error(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: FAILED (${chunk.length} emails) - ${result.error ?? 'unknown'}`);
    }
    if (i + BATCH_SIZE < payloads.length) {
      await new Promise(r => setTimeout(r, STAGGER_MS));
    }
  }

  console.log(`\nSummary: sent=${sent} failed=${failed}`);

  // Set the idempotency flag only on full success. A partial failure
  // means we'd want to investigate before flipping the gate, so leaving
  // the flag clear forces a deliberate --force re-run.
  if (failed === 0) {
    const stamp = new Date().toISOString();
    const { error: upsertErr } = await sb
      .from('training_settings')
      .upsert({ key: flagKey, value: stamp }, { onConflict: 'key' });
    if (upsertErr) {
      console.error(`Warning: failed to write idempotency flag (${flagKey}):`, upsertErr.message);
    } else {
      console.log(`Wrote ${flagKey} = ${stamp}`);
    }
  } else {
    console.log(`(idempotency flag NOT written because failed=${failed} > 0; investigate then re-run with --force)`);
  }

  // Also write an audit row so the broadcast is captured next to the
  // gate-flip events in admin_audit_log.
  await sb.from('admin_audit_log').insert({
    admin_id: null,
    action: 'model_submission_notice_broadcast',
    before_value: { scope: opts.scope, sent: 0, failed: 0 },
    after_value: { scope: opts.scope, sent, failed, recipient_count: students.length, force: opts.force },
  }).then(({ error: auditErr }) => {
    if (auditErr) console.error('Audit insert failed (non-fatal):', auditErr.message);
  });

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
