/**
 * campaigns.ts (SERVER ONLY)
 *
 * Admin email campaigns to Modeling Hub users. ONE definition of each rule:
 *
 *   * RECIPIENTS: resolveCampaignRecipients is the only place a campaign
 *     audience is decided. Admins are excluded unless their ids were picked
 *     EXPLICITLY, and unsubscribed users are excluded always (and reported,
 *     so the count a sender sees is the count that will actually receive it).
 *   * MERGE: renderCampaign is the only place a template becomes an email.
 *     Every user-supplied value is escaped there, once.
 *   * SENDING: sendEmailPerRecipient (the shared Brevo path with its wave
 *     pacing). No second sender, no second rate limit.
 *   * UNSUBSCRIBE: an HMAC of the user id, so a link needs no stored token and
 *     cannot be forged for someone else.
 *
 * Every send is logged one row per recipient, including the ones that failed
 * and the ones skipped as unsubscribed: a campaign that partly failed must be
 * legible afterwards, not a single "sent" with a lie in it.
 *
 * No em dashes in this file.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmailPerRecipient, FROM } from './sendEmail';
import { fmpLayout, button, escapeHtml } from './templates/_base';

/** Replies go to a person, while the send stays FROM no-reply. */
export const CAMPAIGN_REPLY_TO = 'Ahmad Din <ahmad.din@financialmodelerpro.com>';

/**
 * The booking page every campaign points at by default, so an admin does not
 * paste it each time and an empty field cannot produce a dead link. It is the
 * SAME page the founder and contact pages link to (/book-a-meeting), stated
 * once here. Editable per campaign; this is only the default.
 */
export const DEFAULT_MEETING_LINK = 'https://financialmodelerpro.com/book-a-meeting';

/** The campaign link, falling back to the booking page when left blank. */
export function resolveMeetingLink(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  return v === '' ? DEFAULT_MEETING_LINK : v;
}

export interface CampaignFilters {
  /** Explicitly chosen user ids. When present, the filters below are ignored
   *  and exactly these users are the audience (this is the ONLY way an admin
   *  account can be a recipient). */
  userIds?: string[];
  planKeys?: string[];
  statuses?: string[];
  /** 'yes' | 'no' | 'unknown' | 'all' against works_in_real_estate, which
   *  since 2026-08-30 means real estate OR hospitality. */
  industry?: 'yes' | 'no' | 'unknown' | 'all';
}

export interface CampaignRecipient {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  role: string | null;
}

export interface RecipientResolution {
  recipients: CampaignRecipient[];
  /** Unsubscribed users who matched the filters but will NOT be emailed. */
  unsubscribed: CampaignRecipient[];
  /** Admin accounts filtered out because they were not explicitly chosen. */
  adminsExcluded: number;
}

const USER_COLS = 'id, email, name, company, role, subscription_plan, subscription_status, works_in_real_estate, campaign_unsubscribed_at';

/**
 * THE audience rule. Explicit ids win over filters; admins are only ever
 * included when explicitly chosen; unsubscribed users are always separated
 * out rather than silently dropped.
 */
export async function resolveCampaignRecipients(
  sb: SupabaseClient,
  filters: CampaignFilters,
): Promise<RecipientResolution> {
  const explicit = (filters.userIds ?? []).filter(Boolean);
  let q = sb.from('users').select(USER_COLS);

  if (explicit.length > 0) {
    q = q.in('id', explicit);
  } else {
    if (filters.planKeys && filters.planKeys.length > 0) q = q.in('subscription_plan', filters.planKeys);
    if (filters.statuses && filters.statuses.length > 0) q = q.in('subscription_status', filters.statuses);
    if (filters.industry === 'yes') q = q.eq('works_in_real_estate', true);
    if (filters.industry === 'no') q = q.eq('works_in_real_estate', false);
    if (filters.industry === 'unknown') q = q.is('works_in_real_estate', null);
  }

  const { data, error } = await q.range(0, 4999);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const recipients: CampaignRecipient[] = [];
  const unsubscribed: CampaignRecipient[] = [];
  let adminsExcluded = 0;

  for (const r of rows) {
    const email = String(r.email ?? '').trim();
    if (!email) continue;
    const person: CampaignRecipient = {
      id: r.id as string,
      email,
      name: (r.name as string | null) ?? null,
      company: (r.company as string | null) ?? null,
      role: (r.role as string | null) ?? null,
    };
    // Admins are never swept in by a filter. Only an explicit pick includes one.
    if (person.role === 'admin' && explicit.length === 0) { adminsExcluded++; continue; }
    if (r.campaign_unsubscribed_at != null) { unsubscribed.push(person); continue; }
    recipients.push(person);
  }
  return { recipients, unsubscribed, adminsExcluded };
}

// ── Unsubscribe links (HMAC, nothing stored) ───────────────────────────────

function unsubscribeSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? 'fmp-campaign-unsubscribe';
}

export function unsubscribeToken(userId: string): string {
  return createHmac('sha256', unsubscribeSecret()).update(`campaign:${userId}`).digest('hex');
}

/** Constant-time check, so a token cannot be probed byte by byte. */
export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = unsubscribeToken(userId);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(token ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function unsubscribeUrl(userId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';
  return `${base}/api/campaigns/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`;
}

// ── Rendering ──────────────────────────────────────────────────────────────

export interface MergeContext {
  name: string | null;
  company: string | null;
  meetingLink: string;
  unsubscribeUrl: string;
}

/** The merge fields a template may use, documented for the admin screen. */
export const MERGE_FIELDS = [
  { token: '{{name}}', label: 'Recipient first name (falls back to "there")' },
  { token: '{{company}}', label: 'Recipient company (falls back to "your team")' },
  { token: '{{company_clause}}', label: 'Reads " at Acme" when a company is known, otherwise nothing' },
  { token: '{{meeting_button}}', label: 'A styled Book-a-meeting button (use this, not a hand-written link)' },
  { token: '{{meeting_link}}', label: 'The raw meeting URL, for your own href' },
] as const;

/**
 * Substitute the merge fields. EVERY value here comes from the user record or
 * the admin's campaign input, so every one is escaped: a recipient called
 * `<script>` must not become markup in anyone's inbox.
 */
export function mergeBody(bodyHtml: string, ctx: MergeContext): string {
  const first = (ctx.name ?? '').trim().split(/\s+/)[0] || 'there';
  const company = (ctx.company ?? '').trim();
  // The link falls back to the booking page, so a blank field can never render
  // href="" (which most clients show as unclickable plain text: that is exactly
  // how the first real campaign shipped a dead "Book your walkthrough").
  const link = resolveMeetingLink(ctx.meetingLink);
  const values: Record<string, string> = {
    '{{name}}': escapeHtml(first),
    '{{company}}': escapeHtml(company || 'your team'),
    '{{company_clause}}': company ? ` at ${escapeHtml(company)}` : '',
    // The button uses the SHARED button() helper, so campaign CTAs look like
    // every other platform email and the styling lives in one place.
    '{{meeting_button}}': `<div style="text-align:center;">${button('Book your walkthrough', escapeHtml(link))}</div>`,
    '{{meeting_link}}': escapeHtml(link),
    '{{unsubscribe_url}}': escapeHtml(ctx.unsubscribeUrl),
  };
  let out = bodyHtml;
  for (const [token, value] of Object.entries(values)) out = out.split(token).join(value);
  return out;
}

/** Wrap a merged body in the SHARED branded layout, with the unsubscribe line
 *  every campaign carries. */
export async function renderCampaign(bodyHtml: string, ctx: MergeContext): Promise<string> {
  const merged = mergeBody(bodyHtml, ctx);
  // The "why you are receiving this" line lives in the shared FMP footer now,
  // so this block carries only the opt-out itself.
  const footer = `<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
    <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#2E75B6;">Unsubscribe from these emails</a>.
  </div>`;
  // fmpLayout, NOT the bare layout: the shared email_branding row carries
  // Training Hub copy, and a campaign is a Modeling Hub email. That mismatch
  // is exactly what shipped on the first real campaign.
  return fmpLayout(`${merged}\n${footer}`);
}

// ── Sending ────────────────────────────────────────────────────────────────

export interface SendCampaignInput {
  adminId: string;
  templateId: string | null;
  templateName: string | null;
  subject: string;
  bodyHtml: string;
  meetingLink: string;
  recipients: CampaignRecipient[];
  /** Matched the filters but opted out: logged as skipped, never emailed. */
  unsubscribed?: CampaignRecipient[];
}

export interface SendCampaignResult {
  campaignId: string;
  sent: number;
  failed: number;
  skipped: number;
  errors: Array<{ email: string; error: string }>;
}

export async function sendCampaign(
  sb: SupabaseClient,
  input: SendCampaignInput,
): Promise<SendCampaignResult> {
  const campaignId = crypto.randomUUID();
  const items = await Promise.all(input.recipients.map(async (r) => ({
    to: r.email,
    subject: input.subject,
    from: FROM.noreply,
    replyTo: CAMPAIGN_REPLY_TO,
    html: await renderCampaign(input.bodyHtml, {
      name: r.name, company: r.company,
      meetingLink: input.meetingLink,
      unsubscribeUrl: unsubscribeUrl(r.id),
    }),
  })));

  // One failure never stops the rest: every item has its own outcome.
  const outcomes = await sendEmailPerRecipient(items);

  const logRows = input.recipients.map((r, i) => ({
    campaign_id: campaignId,
    admin_id: input.adminId,
    template_id: input.templateId,
    template_name: input.templateName,
    subject: input.subject,
    recipient_user_id: r.id,
    recipient_email: r.email,
    status: outcomes[i]?.ok ? 'sent' : 'failed',
    error: outcomes[i]?.ok ? null : (outcomes[i]?.error ?? 'unknown error'),
    message_id: outcomes[i]?.id ?? null,
  }));

  // Opted-out matches are recorded too, so the log explains the difference
  // between who matched and who received.
  for (const u of input.unsubscribed ?? []) {
    logRows.push({
      campaign_id: campaignId, admin_id: input.adminId,
      template_id: input.templateId, template_name: input.templateName,
      subject: input.subject, recipient_user_id: u.id, recipient_email: u.email,
      status: 'skipped_unsubscribed', error: null, message_id: null,
    });
  }

  try {
    if (logRows.length > 0) await sb.from('admin_campaign_sends').insert(logRows);
  } catch (e) {
    console.error('[campaign] log write failed:', e instanceof Error ? e.message : String(e));
  }

  const failed = outcomes.filter((o) => !o.ok);
  return {
    campaignId,
    sent: outcomes.filter((o) => o.ok).length,
    failed: failed.length,
    skipped: (input.unsubscribed ?? []).length,
    errors: input.recipients
      .map((r, i) => ({ email: r.email, error: outcomes[i]?.error ?? '' }))
      .filter((e) => e.error),
  };
}
