/**
 * "Announce to everyone" audience for article announcements.
 *
 * The existing two paths each reach only half the people:
 *   - the live-session Announce button emails TRAINING STUDENTS only
 *     (training_registrations_meta); it never touches subscribers.
 *   - every newsletter segment (segments.ts) is a filter over
 *     newsletter_subscribers, so it reaches SUBSCRIBERS only.
 * Students who never subscribed are therefore unreachable by the newsletter,
 * and subscribers who never enrolled are unreachable by the announce button.
 * This resolver is the union of both, which is what an article announcement
 * wants: everyone who has a relationship with us, each emailed once.
 *
 * Modeling-hub users (the `users` table) are OPT-IN per announcement, since an
 * article is usually training-flavoured and the admin decides case by case.
 *
 * Two rules are load-bearing and must not be "simplified" away:
 *
 *  1. AN OPT-OUT ALWAYS WINS. A student who unsubscribed is still on the
 *     student roster forever, so resolving the union naively would email them
 *     again and undo their opt-out. Anyone whose subscriber rows exist but
 *     include no active row is dropped, whatever else they are.
 *
 *  2. NEVER RESURRECT A ROW. Recipients with no subscriber row at all are
 *     INSERTED (not upserted-with-status), because an upsert of
 *     status='active' onto an existing 'unsubscribed' row would silently
 *     re-subscribe someone who opted out. We only ever insert for emails that
 *     have no row on any hub, and pass ignoreDuplicates so a race is a no-op.
 *
 * Rule 2 exists because CAN-SPAM/GDPR-style rules require a working opt-out on
 * marketing mail, and sendCampaign builds the unsubscribe link from
 * `unsubscribe_token`. A student with no subscriber row has no token, so
 * without minting one their email would carry a dead unsubscribe link.
 */
import { getServerClient } from '@/src/core/db/supabase';
import type { ResolvedRecipient } from './segments';

export interface AnnounceAudienceCounts {
  /** Confirmed students on the training roster. */
  students: number;
  /** Active newsletter subscribers (any hub). */
  subscribers: number;
  /** Modeling-hub users pulled in by the toggle (0 when it is off). */
  modelingUsers: number;
  /** People in the source groups who opted out and were EXCLUDED. */
  optedOut: number;
  /** Recipients who had no subscriber row and were given one (for unsubscribe). */
  enrolled: number;
  /** Unique addresses that will actually be emailed. */
  total: number;
}

export interface AnnounceAudience {
  recipients: ResolvedRecipient[];
  counts: AnnounceAudienceCounts;
}

export interface AnnounceAudienceOptions {
  /** Include modeling-hub users (`users` table). Admin toggle, off by default. */
  includeModelingUsers?: boolean;
  /**
   * Count only: skips minting subscriber rows, so the admin preview cannot
   * mutate anything just by opening the dialog. A dry run returns no
   * recipients, only counts.
   */
  dryRun?: boolean;
}

const norm = (e: unknown): string => String(e ?? '').toLowerCase().trim();

/** Rejects empty / no-@ / no-domain inputs, which Brevo would 400 on. */
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export interface SubscriberRowLike { email: string | null; hub: string | null; status: string | null; unsubscribe_token: string | null }

export interface AudiencePlan {
  /** Addresses to email, after consent filtering. */
  targets: string[];
  /** Candidates dropped because they opted out. */
  optedOut: string[];
  /** Targets with no subscriber row on any hub; each needs one minted. */
  needRow: string[];
  /** Hub to file a newly minted row under, keyed by email. */
  hubFor: Map<string, 'training' | 'modeling'>;
  activeSubscriberCount: number;
}

/**
 * The consent decision, as a pure function so both rules are testable without a
 * database. IO lives in resolveAnnounceAudience; the rules live here.
 */
export function planAudience(input: {
  subscriberRows: Map<string, SubscriberRowLike[]>;
  studentEmails: Set<string>;
  modelingEmails: Set<string>;
}): AudiencePlan {
  const { subscriberRows, studentEmails, modelingEmails } = input;

  const activeSubscriberEmails = new Set<string>();
  const optedOutEmails = new Set<string>();
  for (const [email, rows] of subscriberRows) {
    // Match loadActiveSubscribers: one active row anywhere makes them active.
    // Only someone with rows but NO active row counts as opted out.
    if (rows.some(r => r.status === 'active')) activeSubscriberEmails.add(email);
    else optedOutEmails.add(email);
  }

  // Union of everyone with a relationship with us, before consent filtering.
  const candidates = new Set<string>([...studentEmails, ...activeSubscriberEmails, ...modelingEmails]);

  const optedOut: string[] = [];
  const targets: string[] = [];
  for (const email of candidates) {
    if (optedOutEmails.has(email)) { optedOut.push(email); continue; } // rule 1
    if (!looksLikeEmail(email)) continue;
    targets.push(email);
  }

  const needRow = targets.filter(e => !subscriberRows.has(e));
  const hubFor = new Map<string, 'training' | 'modeling'>();
  for (const email of needRow) {
    // A modeling-only address belongs to the modeling hub; everyone else came
    // from the training roster. This drives the unsubscribe link's hub.
    hubFor.set(email, (!studentEmails.has(email) && modelingEmails.has(email)) ? 'modeling' : 'training');
  }

  return { targets, optedOut, needRow, hubFor, activeSubscriberCount: activeSubscriberEmails.size };
}

/**
 * PostgREST caps a response at 1000 rows, silently. Every source here grows
 * without bound (rosters, subscribers), so a plain select would quietly stop
 * emailing people the moment a table crosses the cap. Page explicitly.
 */
async function selectAllRows<T>(
  table: string,
  columns: string,
  /** Optional PostgREST `or` filter, e.g. 'a.eq.true,b.is.null'. A string
   *  rather than a builder callback: the builder's generics do not survive
   *  being reassigned through one, and `or` is the only filter needed here. */
  orFilter?: string,
): Promise<T[]> {
  const sb = getServerClient();
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = sb.from(table).select(columns).range(from, from + PAGE - 1);
    const { data, error } = await (orFilter ? page.or(orFilter) : page);
    if (error) {
      console.error(`[announce-audience] ${table} query failed:`, error.message);
      break;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface SubscriberRow { email: string | null; hub: string | null; status: string | null; unsubscribe_token: string | null }

/** Every subscriber row, keyed by email. One email can hold a row per hub. */
async function loadSubscriberRows(): Promise<Map<string, SubscriberRow[]>> {
  const rows = await selectAllRows<SubscriberRow>(
    'newsletter_subscribers',
    'email, hub, status, unsubscribe_token',
  );
  const byEmail = new Map<string, SubscriberRow[]>();
  for (const r of rows) {
    const key = norm(r.email);
    if (!key) continue;
    const list = byEmail.get(key);
    if (list) list.push(r); else byEmail.set(key, [r]);
  }
  return byEmail;
}

async function loadStudentEmails(): Promise<Set<string>> {
  // email_confirmed is null for pre-migration-027 students; those count as
  // confirmed, matching the live-session announce and the training auth stack.
  const rows = await selectAllRows<{ email: string | null }>(
    'training_registrations_meta',
    'email',
    'email_confirmed.eq.true,email_confirmed.is.null',
  );
  const out = new Set<string>();
  for (const r of rows) { const e = norm(r.email); if (e) out.add(e); }
  return out;
}

async function loadModelingUserEmails(): Promise<Set<string>> {
  const rows = await selectAllRows<{ email: string | null; email_confirmed: boolean | null }>(
    'users',
    'email, email_confirmed',
  );
  const out = new Set<string>();
  for (const r of rows) {
    // Mirror the modeling auth rule: only an explicit false blocks.
    if (r.email_confirmed === false) continue;
    const e = norm(r.email);
    if (e) out.add(e);
  }
  return out;
}

/**
 * Resolve every address an article announcement should reach, with a usable
 * unsubscribe token attached to each.
 */
export async function resolveAnnounceAudience(
  opts: AnnounceAudienceOptions = {},
): Promise<AnnounceAudience> {
  const includeModeling = opts.includeModelingUsers ?? false;

  const [subsByEmail, studentEmails, modelingEmails] = await Promise.all([
    loadSubscriberRows(),
    loadStudentEmails(),
    includeModeling ? loadModelingUserEmails() : Promise.resolve(new Set<string>()),
  ]);

  const { targets, optedOut, needRow, hubFor, activeSubscriberCount } = planAudience({
    subscriberRows: subsByEmail,
    studentEmails,
    modelingEmails,
  });

  const counts: AnnounceAudienceCounts = {
    students:      studentEmails.size,
    subscribers:   activeSubscriberCount,
    modelingUsers: modelingEmails.size,
    optedOut:      optedOut.length,
    enrolled:      needRow.length,
    total:         targets.length,
  };

  // The admin preview must be side-effect free: report what WOULD happen.
  if (opts.dryRun) return { recipients: [], counts };

  if (needRow.length > 0) {
    const sb = getServerClient();
    const rows = needRow.map(email => ({
      email,
      hub:    hubFor.get(email) ?? 'training',
      status: 'active',
      source: 'article_announce',
    }));
    // ignoreDuplicates: a concurrent signup must not have its status clobbered
    // back to 'active' by this insert (rule 2).
    const { error } = await sb
      .from('newsletter_subscribers')
      .upsert(rows, { onConflict: 'email,hub', ignoreDuplicates: true });
    if (error) console.error('[announce-audience] minting subscriber rows failed:', error.message);
  }

  // Re-read so freshly minted rows come back with their generated tokens.
  const finalRows = await loadSubscriberRows();

  const recipients: ResolvedRecipient[] = [];
  for (const email of targets) {
    const rows = finalRows.get(email) ?? [];
    // Prefer an active row; its token is the one an unsubscribe should revoke.
    const row = rows.find(r => r.status === 'active') ?? rows[0];
    if (!row?.unsubscribe_token) {
      // No token means no working opt-out, so we do not email them at all.
      console.error('[announce-audience] no unsubscribe token, skipping:', email);
      continue;
    }
    recipients.push({
      email,
      hub: row.hub === 'modeling' ? 'modeling' : 'training',
      unsubscribe_token: row.unsubscribe_token,
    });
  }

  return { recipients, counts: { ...counts, total: recipients.length } };
}
