/**
 * The announcement queue (2026-11-10, founder, mig 255). An announcement goes
 * out within today's allowance (emailBudget.ts: the announcement cap left, and
 * never more than the daily limit left, so system emails always have room);
 * every recipient beyond it waits as a queued item and is sent on a later day,
 * OLDEST JOB FIRST, by the daily cron. Progress shows in admin.
 *
 * A job stores the rendered subject and HTML once, with {{name}} in place of
 * the recipient's name, so a queued email is identical to the first day's.
 * The sender and the allowance are injected, so the whole flow (including the
 * carry-over to the next day) runs in the verifier with no email sent.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const NAME_TOKEN = '{{name}}';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Ahmad Din" -> "Ahmad": announcements greet by first name. */
export function firstName(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** A stored template for one recipient, greeting by first name (escaped once). Pure. */
export function personalise(template: string, name: string): string {
  const first = firstName(name);
  return template.split(NAME_TOKEN).join(esc(first || 'there'));
}

export interface QueueSendItem { to: string; subject: string; html: string; from?: string }
export interface QueueDeps {
  /** Announcement emails that may go out now (emailBudget.announcementAllowance). */
  allowance(): Promise<number>;
  /** Sends and reports each outcome (sendEmailPerRecipient with kind 'announcement'). */
  send(items: QueueSendItem[]): Promise<{ ok: boolean; error?: string }[]>;
}

export interface NewJob {
  kind: 'session' | 'course';
  ref: string;
  label: string;
  audience: unknown;
  subject: string;
  html: string;
  from?: string | null;
  createdBy?: string | null;
}

/**
 * Store a job and all its recipients as pending. Returns null (and sends
 * nothing) when the queue tables do not exist yet (mig 255 not applied), so the
 * caller can fall back to sending today's allowance directly.
 */
export async function enqueueJob(sb: SupabaseClient, job: NewJob, recipients: { email: string; name: string }[]): Promise<{ jobId: string } | null> {
  const unique = [...new Map(recipients.map((r) => [r.email.trim().toLowerCase(), r])).values()];
  const { data, error } = await sb.from('announcement_jobs').insert({
    kind: job.kind, ref: job.ref, label: job.label, audience: job.audience ?? {}, subject: job.subject, html: job.html,
    from_address: job.from ?? null, created_by: job.createdBy ?? null, total: unique.length, status: unique.length ? 'queued' : 'done',
  }).select('id').single();
  if (error || !data) return null;
  const jobId = (data as { id: string }).id;
  for (let i = 0; i < unique.length; i += 500) {
    const { error: e } = await sb.from('announcement_job_items').insert(unique.slice(i, i + 500).map((r) => ({ job_id: jobId, email: r.email.trim().toLowerCase(), name: r.name || null, status: 'pending' })));
    if (e) throw new Error(`queueing recipients failed: ${e.message}`);
  }
  return { jobId };
}

export interface ProcessResult { sent: number; failed: number; remaining: number; allowance: number }

/** Send queued items within today's allowance, oldest job first. */
export async function processAnnouncementQueue(sb: SupabaseClient, deps: QueueDeps, now: Date = new Date()): Promise<ProcessResult> {
  let allowance = await deps.allowance();
  const start = allowance;
  let sent = 0, failed = 0;
  const { data: jobs, error } = await sb.from('announcement_jobs').select('id, subject, html, from_address, created_at').eq('status', 'queued').order('created_at', { ascending: true });
  if (error) return { sent, failed, remaining: 0, allowance: start };
  for (const job of (jobs ?? []) as { id: string; subject: string; html: string; from_address: string | null }[]) {
    while (allowance > 0) {
      const { data: items } = await sb.from('announcement_job_items').select('id, email, name').eq('job_id', job.id).eq('status', 'pending').order('id', { ascending: true }).limit(Math.min(allowance, 100));
      const batch = (items ?? []) as { id: number; email: string; name: string | null }[];
      if (!batch.length) break;
      const outcomes = await deps.send(batch.map((it) => ({ to: it.email, subject: personalise(job.subject, it.name ?? ''), html: personalise(job.html, it.name ?? ''), from: job.from_address ?? undefined })));
      for (let i = 0; i < batch.length; i++) {
        const ok = !!outcomes[i]?.ok;
        await sb.from('announcement_job_items').update(ok ? { status: 'sent', sent_at: now.toISOString() } : { status: 'failed', error: outcomes[i]?.error ?? 'send failed' }).eq('id', batch[i].id);
        if (ok) sent++; else failed++;
      }
      allowance -= batch.length;
    }
    await refreshJob(sb, job.id, now);
    if (allowance <= 0) break;
  }
  const { count } = await sb.from('announcement_job_items').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  return { sent, failed, remaining: count ?? 0, allowance: start };
}

/** Recount a job's progress; done when nothing is pending. */
async function refreshJob(sb: SupabaseClient, jobId: string, now: Date): Promise<void> {
  const cnt = async (status: string) => (await sb.from('announcement_job_items').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', status)).count ?? 0;
  const [s, f, p] = await Promise.all([cnt('sent'), cnt('failed'), cnt('pending')]);
  await sb.from('announcement_jobs').update({ sent: s, failed: f, ...(p === 0 ? { status: 'done', completed_at: now.toISOString() } : {}) }).eq('id', jobId);
}

/** Jobs for the admin progress list (queued first, then the latest done). */
export async function listJobs(sb: SupabaseClient, limit: number = 20): Promise<{ id: string; created_at: string; kind: string; label: string; total: number; sent: number; failed: number; status: string }[]> {
  const { data, error } = await sb.from('announcement_jobs').select('id, created_at, kind, label, total, sent, failed, status').order('created_at', { ascending: false }).limit(limit);
  return error ? [] : (data ?? []) as never;
}

/**
 * Send an announcement: queue it, then send today's share at once. Without
 * the queue tables (mig 255 pending) it sends today's allowance directly and
 * reports the rest as not sent. Returns what happened, for the admin.
 */
export async function dispatchAnnouncement(sb: SupabaseClient, deps: QueueDeps, job: NewJob, recipients: { email: string; name: string }[], now: Date = new Date()):
  Promise<{ total: number; sentNow: number; failedNow: number; queued: number; notSent: number; queueAvailable: boolean }> {
  const queuedJob = await enqueueJob(sb, job, recipients);
  if (queuedJob) {
    const r = await processAnnouncementQueue(sb, deps, now);
    const { count } = await sb.from('announcement_job_items').select('id', { count: 'exact', head: true }).eq('job_id', queuedJob.jobId).eq('status', 'pending');
    return { total: recipients.length, sentNow: r.sent, failedNow: r.failed, queued: count ?? 0, notSent: 0, queueAvailable: true };
  }
  const allowance = await deps.allowance();
  const now1 = recipients.slice(0, allowance);
  const outcomes = await deps.send(now1.map((r) => ({ to: r.email, subject: personalise(job.subject, r.name), html: personalise(job.html, r.name), from: job.from ?? undefined })));
  const ok = outcomes.filter((o) => o.ok).length;
  return { total: recipients.length, sentNow: ok, failedNow: now1.length - ok, queued: 0, notSent: recipients.length - now1.length, queueAvailable: false };
}
