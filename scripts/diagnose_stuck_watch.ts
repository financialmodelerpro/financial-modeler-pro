/**
 * scripts/diagnose_stuck_watch.ts
 *
 * Read-only diagnosis of students stuck under the watch threshold because
 * of the pre-146 tracker bug. Buckets every in_progress watch row into
 * one of:
 *
 *   AUTO_UNBLOCK   -- watch_percentage >= 30, updated_at older than 7 days
 *                     -- legitimate watcher whose tracker undershot. Safe
 *                     to flip status='completed' in a recovery sweep.
 *   ADMIN_REVIEW   -- watch_percentage < 30, updated_at older than 14 days
 *                     -- never finished. Worth a per-student look before
 *                     unblocking.
 *   RECENTLY_ACTIVE -- updated_at within last 7 days. The migration 146
 *                      fix already covers them on their next play, so
 *                      we just notify them to try again.
 *   COMPLETED      -- already passed -- excluded from the buckets, just
 *                      counted for totals so we know the denominator.
 *
 * Cross-references certification_watch_history (3SFM / BVM cert sessions)
 * AND session_watch_history (live-session recordings) so a student stuck
 * across multiple sessions counts once per (email, tab_key) pair but only
 * once in the distinct-students total.
 *
 * Read-only. Issues no writes. Outputs a structured JSON dump to
 * supabase/backups/stuck_watch_<date>.json plus a human-readable summary
 * to stdout.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/diagnose_stuck_watch.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getServerClient } from '../src/core/db/supabase';

const THRESHOLD = 70;            // current default; mirrors training_settings.watch_enforcement_threshold
const AUTO_FLOOR = 30;           // watch% >= this AND stuck > 7d -> auto-unblock candidate
const STUCK_DAYS_AUTO = 7;
const STUCK_DAYS_REVIEW = 14;

const BACKUP_DIR = path.join(process.cwd(), 'supabase', 'backups');
const OUT_FILE = path.join(BACKUP_DIR, `stuck_watch_${new Date().toISOString().split('T')[0]}.json`);

type Bucket = 'AUTO_UNBLOCK' | 'ADMIN_REVIEW' | 'RECENTLY_ACTIVE' | 'COMPLETED' | 'OTHER';

interface StuckRow {
  source: 'cert' | 'live';
  email: string;
  key: string;                // tab_key (cert) or session_id (live)
  status: string;
  watch_percentage: number;
  watch_seconds: number;
  total_seconds: number;
  updated_at: string;
  days_since_update: number;
  bucket: Bucket;
  intervals_count: number;    // 0 = pre-migration row, n>0 = already populated
}

function daysSince(iso: string): number {
  if (!iso) return -1;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function bucketize(pct: number, status: string, days: number): Bucket {
  if (status === 'completed') return 'COMPLETED';
  if (days >= 0 && days < STUCK_DAYS_AUTO) return 'RECENTLY_ACTIVE';
  if (pct >= AUTO_FLOOR && days >= STUCK_DAYS_AUTO) return 'AUTO_UNBLOCK';
  if (pct < AUTO_FLOOR && days >= STUCK_DAYS_REVIEW) return 'ADMIN_REVIEW';
  return 'OTHER';
}

async function main() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const sb = getServerClient();

  console.log('Diagnosing watch-tracker bug fallout...\n');
  console.log(`Threshold: ${THRESHOLD}%  |  Auto-floor: ${AUTO_FLOOR}%  |  Stuck-auto: ${STUCK_DAYS_AUTO}d  |  Stuck-review: ${STUCK_DAYS_REVIEW}d\n`);

  // ── Cert sessions (3SFM / BVM) ─────────────────────────────────────────
  const { data: certRows, error: certErr } = await sb
    .from('certification_watch_history')
    .select('student_email, tab_key, status, watch_seconds, total_seconds, watch_percentage, updated_at, watch_intervals');
  if (certErr) throw certErr;

  // ── Live sessions ──────────────────────────────────────────────────────
  const { data: liveRows, error: liveErr } = await sb
    .from('session_watch_history')
    .select('student_email, session_id, status, watch_seconds, total_seconds, watch_percentage, updated_at, watch_intervals');
  if (liveErr) throw liveErr;

  const all: StuckRow[] = [];

  for (const r of certRows ?? []) {
    const pct = Number(r.watch_percentage ?? 0);
    const days = daysSince(r.updated_at as string);
    const intervals = Array.isArray(r.watch_intervals) ? (r.watch_intervals as unknown[]).length : 0;
    all.push({
      source: 'cert',
      email: String(r.student_email).toLowerCase(),
      key: String(r.tab_key),
      status: String(r.status ?? ''),
      watch_percentage: pct,
      watch_seconds: Number(r.watch_seconds ?? 0),
      total_seconds: Number(r.total_seconds ?? 0),
      updated_at: String(r.updated_at ?? ''),
      days_since_update: days,
      bucket: bucketize(pct, String(r.status ?? ''), days),
      intervals_count: intervals,
    });
  }
  for (const r of liveRows ?? []) {
    const pct = Number(r.watch_percentage ?? 0);
    const days = daysSince(r.updated_at as string);
    const intervals = Array.isArray(r.watch_intervals) ? (r.watch_intervals as unknown[]).length : 0;
    all.push({
      source: 'live',
      email: String(r.student_email).toLowerCase(),
      key: String(r.session_id),
      status: String(r.status ?? ''),
      watch_percentage: pct,
      watch_seconds: Number(r.watch_seconds ?? 0),
      total_seconds: Number(r.total_seconds ?? 0),
      updated_at: String(r.updated_at ?? ''),
      days_since_update: days,
      bucket: bucketize(pct, String(r.status ?? ''), days),
      intervals_count: intervals,
    });
  }

  // ── Bucket summary ─────────────────────────────────────────────────────
  const counts: Record<Bucket, number> = {
    AUTO_UNBLOCK: 0,
    ADMIN_REVIEW: 0,
    RECENTLY_ACTIVE: 0,
    COMPLETED: 0,
    OTHER: 0,
  };
  const distinctEmails: Record<Bucket, Set<string>> = {
    AUTO_UNBLOCK: new Set(),
    ADMIN_REVIEW: new Set(),
    RECENTLY_ACTIVE: new Set(),
    COMPLETED: new Set(),
    OTHER: new Set(),
  };
  for (const r of all) {
    counts[r.bucket]++;
    distinctEmails[r.bucket].add(r.email);
  }

  console.log('=== ROW-LEVEL BUCKETS (cert + live combined) ===');
  for (const b of ['AUTO_UNBLOCK', 'ADMIN_REVIEW', 'RECENTLY_ACTIVE', 'OTHER', 'COMPLETED'] as Bucket[]) {
    console.log(`  ${b.padEnd(16)}  ${String(counts[b]).padStart(4)} rows   ${String(distinctEmails[b].size).padStart(4)} distinct students`);
  }
  console.log(`  ${'TOTAL'.padEnd(16)}  ${String(all.length).padStart(4)} rows`);

  // ── Distinct-student totals ────────────────────────────────────────────
  const allEmails = new Set(all.map(r => r.email));
  const blockedEmails = new Set(
    all.filter(r => r.bucket === 'AUTO_UNBLOCK' || r.bucket === 'ADMIN_REVIEW' || r.bucket === 'RECENTLY_ACTIVE')
       .map(r => r.email),
  );
  console.log(`\nDistinct students seen anywhere in watch history: ${allEmails.size}`);
  console.log(`Distinct students currently BLOCKED somewhere:     ${blockedEmails.size}`);

  // ── Top blocked students (worst case = most blocked rows) ──────────────
  const perStudent = new Map<string, StuckRow[]>();
  for (const r of all) {
    if (r.bucket === 'COMPLETED') continue;
    if (!perStudent.has(r.email)) perStudent.set(r.email, []);
    perStudent.get(r.email)!.push(r);
  }
  const top = [...perStudent.entries()]
    .map(([email, rows]) => ({
      email,
      blocked: rows.filter(r => r.bucket !== 'OTHER').length,
      max_pct: Math.max(...rows.map(r => r.watch_percentage)),
      buckets: rows.map(r => r.bucket),
    }))
    .filter(e => e.blocked > 0)
    .sort((a, b) => b.blocked - a.blocked)
    .slice(0, 15);

  console.log('\n=== TOP 15 STUDENTS BY BLOCKED-ROW COUNT ===');
  for (const t of top) {
    const breakdown = t.buckets.join(',');
    console.log(`  ${t.email.padEnd(45)} blocked=${t.blocked}  maxPct=${t.max_pct}%  ${breakdown}`);
  }

  // ── AUTO_UNBLOCK preview (these are the ones a recovery sweep would flip) ──
  const auto = all.filter(r => r.bucket === 'AUTO_UNBLOCK')
    .sort((a, b) => b.watch_percentage - a.watch_percentage);
  console.log(`\n=== AUTO_UNBLOCK CANDIDATES (top 25 of ${auto.length}) ===`);
  for (const r of auto.slice(0, 25)) {
    console.log(`  ${r.email.padEnd(45)} ${r.source}/${r.key.padEnd(14)} pct=${String(r.watch_percentage).padStart(3)}%  days=${String(r.days_since_update).padStart(3)}  intervals=${r.intervals_count}`);
  }

  // ── ADMIN_REVIEW preview ───────────────────────────────────────────────
  const review = all.filter(r => r.bucket === 'ADMIN_REVIEW')
    .sort((a, b) => b.watch_percentage - a.watch_percentage);
  console.log(`\n=== ADMIN_REVIEW CANDIDATES (top 25 of ${review.length}) ===`);
  for (const r of review.slice(0, 25)) {
    console.log(`  ${r.email.padEnd(45)} ${r.source}/${r.key.padEnd(14)} pct=${String(r.watch_percentage).padStart(3)}%  days=${String(r.days_since_update).padStart(3)}  intervals=${r.intervals_count}`);
  }

  // ── Migration 146 sanity: how many rows already have intervals? ───────
  const withIntervals = all.filter(r => r.intervals_count > 0).length;
  const withoutIntervals = all.length - withIntervals;
  console.log(`\n=== MIGRATION 146 STATE ===`);
  console.log(`  Rows with intervals JSONB populated:   ${withIntervals}`);
  console.log(`  Rows still on legacy scalar baseline:  ${withoutIntervals}`);
  console.log(`  (legacy rows seed intervals on next POST; migration backfill is unnecessary)`);

  // ── Fakhri spot-check (FMP-2026-0035 by email lookup if reachable) ────
  const FAKHRI_HINT = 'fakhri';
  const fakhri = all.filter(r => r.email.includes(FAKHRI_HINT));
  if (fakhri.length > 0) {
    console.log(`\n=== FAKHRI SPOT-CHECK (rows matching "${FAKHRI_HINT}") ===`);
    for (const r of fakhri) {
      console.log(`  ${r.source}/${r.key.padEnd(14)} pct=${String(r.watch_percentage).padStart(3)}%  status=${r.status.padEnd(11)}  days=${String(r.days_since_update).padStart(3)}  bucket=${r.bucket}  intervals=${r.intervals_count}`);
    }
  } else {
    console.log(`\n(No rows matched "${FAKHRI_HINT}" in student_email -- substring search.)`);
  }

  // ── Persist full dump ──────────────────────────────────────────────────
  const dump = {
    generated_at: new Date().toISOString(),
    threshold: THRESHOLD,
    auto_floor: AUTO_FLOOR,
    stuck_days_auto: STUCK_DAYS_AUTO,
    stuck_days_review: STUCK_DAYS_REVIEW,
    counts,
    distinct_emails: Object.fromEntries(
      Object.entries(distinctEmails).map(([k, v]) => [k, [...v].sort()]),
    ),
    rows: all,
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(dump, null, 2));
  console.log(`\nFull dump written to: ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch(e => {
  console.error('Diagnosis failed:', e);
  process.exit(1);
});
