/**
 * Newsletter recipient segments. Each segment resolves to a deduplicated
 * list of subscribers (email + hub + unsubscribe_token) that the send
 * route then converts into Resend batch payloads.
 *
 * Segments union the base "active newsletter subscribers" set with extra
 * filters from training_assessment_results, training_registrations_meta,
 * and student_certificates. They never include unsubscribed, bounced, or
 * complained rows - those are filtered out at the subscriber-fetch step.
 */
import { getServerClient } from '@/src/core/db/supabase';

export type SegmentKey =
  | 'all_active'
  | 'active_30_days'
  | 'passed_3sfm'
  | 'passed_bvm'
  | 'never_started'
  | 'has_certificate'
  | 'no_certificate';

export interface SegmentMeta {
  key: SegmentKey;
  label: string;
  description: string;
}

export const SEGMENTS: SegmentMeta[] = [
  { key: 'all_active',       label: 'All active subscribers',          description: 'Every subscriber with status=active' },
  { key: 'active_30_days',   label: 'Subscribed in last 30 days',      description: 'Newest subscribers - good for welcome series' },
  { key: 'passed_3sfm',      label: 'Passed 3SFM final exam',          description: 'Subscribers who completed 3-Statement Financial Modeling' },
  { key: 'passed_bvm',       label: 'Passed BVM final exam',           description: 'Subscribers who completed Business Valuation Modeling' },
  { key: 'never_started',    label: 'Joined but never started',         description: 'Subscribers with no session passes - re-engagement target' },
  { key: 'has_certificate',  label: 'Holds at least one certificate',  description: 'Earned 3SFM or BVM cert' },
  { key: 'no_certificate',   label: 'No certificate yet',              description: 'Subscribers without any issued cert' },
];

export interface ResolvedRecipient {
  email: string;
  hub: string;
  unsubscribe_token: string;
}

/**
 * Pull every active subscriber row, optionally filtered to a target_hub.
 * When `target_hub` is 'all', subscribers are deduplicated by email so
 * a person on both hubs gets one email (preferring the matching-hub
 * unsubscribe token when ambiguous, otherwise the first row).
 */
async function loadActiveSubscribers(targetHub: 'training' | 'modeling' | 'all'): Promise<ResolvedRecipient[]> {
  const sb = getServerClient();
  let q = sb.from('newsletter_subscribers').select('email, hub, unsubscribe_token').eq('status', 'active');
  if (targetHub !== 'all') q = q.eq('hub', targetHub);
  const { data } = await q;
  const rows = (data ?? []) as ResolvedRecipient[];

  if (targetHub !== 'all') return rows;

  // Dedupe by email, prefer the row whose hub matches if specified
  const seen = new Map<string, ResolvedRecipient>();
  for (const r of rows) {
    if (!seen.has(r.email)) seen.set(r.email, r);
  }
  return Array.from(seen.values());
}

/** Returns the set of emails (lowercased) that pass a SQL filter against assessment results. */
async function emailsWithFinalPassed(courseCode: '3SFM' | 'BVM'): Promise<Set<string>> {
  const sb = getServerClient();
  const { data } = await sb
    .from('certificate_eligibility_raw')
    .select('email')
    .eq('course_code', courseCode)
    .eq('final_passed', true);
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ email: string | null }>) {
    if (row.email) out.add(row.email.toLowerCase());
  }
  return out;
}

/** Emails of every student who has issued a certificate. */
async function emailsWithIssuedCert(): Promise<Set<string>> {
  const sb = getServerClient();
  const { data } = await sb
    .from('student_certificates')
    .select('email')
    .eq('cert_status', 'Issued');
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ email: string | null }>) {
    if (row.email) out.add(row.email.toLowerCase());
  }
  return out;
}

/** Emails of every student who has at least one passing assessment. */
async function emailsWithAnyPass(): Promise<Set<string>> {
  const sb = getServerClient();
  const { data } = await sb
    .from('training_assessment_results')
    .select('email')
    .eq('passed', true);
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ email: string | null }>) {
    if (row.email) out.add(row.email.toLowerCase());
  }
  return out;
}

/**
 * Resolve a segment to a recipient list. Segments compose the base
 * subscriber set with one or more filter sets from the training side.
 * Hub filter still applies on top of the segment.
 */
export async function resolveSegment(
  segment: SegmentKey,
  targetHub: 'training' | 'modeling' | 'all',
): Promise<ResolvedRecipient[]> {
  const subs = await loadActiveSubscribers(targetHub);

  if (segment === 'all_active') return subs;

  if (segment === 'active_30_days') {
    const sb = getServerClient();
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let q = sb.from('newsletter_subscribers').select('email').eq('status', 'active').gte('subscribed_at', cutoff);
    if (targetHub !== 'all') q = q.eq('hub', targetHub);
    const { data } = await q;
    const recent = new Set((data ?? []).map((r: { email: string }) => r.email.toLowerCase()));
    return subs.filter(s => recent.has(s.email.toLowerCase()));
  }

  if (segment === 'passed_3sfm') {
    const passed = await emailsWithFinalPassed('3SFM');
    return subs.filter(s => passed.has(s.email.toLowerCase()));
  }

  if (segment === 'passed_bvm') {
    const passed = await emailsWithFinalPassed('BVM');
    return subs.filter(s => passed.has(s.email.toLowerCase()));
  }

  if (segment === 'never_started') {
    const anyPass = await emailsWithAnyPass();
    return subs.filter(s => !anyPass.has(s.email.toLowerCase()));
  }

  if (segment === 'has_certificate') {
    const certs = await emailsWithIssuedCert();
    return subs.filter(s => certs.has(s.email.toLowerCase()));
  }

  if (segment === 'no_certificate') {
    const certs = await emailsWithIssuedCert();
    return subs.filter(s => !certs.has(s.email.toLowerCase()));
  }

  return subs;
}

/** Quick count for the admin UI's "this will go to N people" display. */
export async function countSegment(segment: SegmentKey, targetHub: 'training' | 'modeling' | 'all'): Promise<number> {
  const list = await resolveSegment(segment, targetHub);
  return list.length;
}
