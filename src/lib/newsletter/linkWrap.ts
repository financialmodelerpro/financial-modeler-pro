/**
 * Link wrapping for click tracking + UTM injection.
 *
 * Every <a href="..."> in the rendered body is rewritten so the
 * destination is `/api/newsletter/click?msg={resend_message_id}&url={encoded}`.
 * The redirector records a click against the recipient log row, then
 * 302s to the original URL. Because the resend message id is per-recipient
 * (the batch.send response returns one id per item), each recipient gets
 * a uniquely-tagged set of links. We also append utm_source=newsletter +
 * utm_campaign=<campaign_id> to internal financialmodelerpro.com hosts
 * so analytics dashboards group by campaign without manual UTM work.
 *
 * Skips:
 *   - mailto:, tel:, javascript:, # anchors
 *   - the unsubscribe URL itself (must not be rewritten or it breaks
 *     the unsub flow when a click record fails)
 */

const MAIN_HOST_RE = /(^|\.)financialmodelerpro\.com$/i;
const TRACKING_BASE = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

interface WrapOpts {
  /** The campaign id; used for utm_campaign and the click-row lookup. */
  campaignId: string;
  /**
   * Optional resend message id placeholder. If you pass a literal `{msg}`
   * string the server can swap it out per recipient before send. If you
   * pass an empty string the click endpoint receives `msg=` and falls
   * back to email-keyed lookup.
   */
  msgIdPlaceholder?: string;
}

function appendUtm(url: string, campaignId: string): string {
  try {
    const u = new URL(url);
    if (!MAIN_HOST_RE.test(u.hostname)) return url;
    if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'newsletter');
    if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'email');
    if (!u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', campaignId);
    return u.toString();
  } catch {
    return url;
  }
}

function shouldSkip(href: string): boolean {
  const lower = href.trim().toLowerCase();
  if (lower.startsWith('mailto:')) return true;
  if (lower.startsWith('tel:')) return true;
  if (lower.startsWith('javascript:')) return true;
  if (lower.startsWith('#')) return true;
  if (lower.includes('/api/newsletter/unsubscribe')) return true;
  if (lower.includes('/api/newsletter/click')) return true;
  return false;
}

/**
 * Rewrite all href attributes in `body` for tracking + UTM. The placeholder
 * `{msg}` in the resulting URL stays in the body until per-recipient
 * substitution happens at send time (sender.ts does the swap once it has
 * the resend message id from the batch response).
 */
export function wrapLinks(body: string, opts: WrapOpts): string {
  const { campaignId, msgIdPlaceholder = '{msg}' } = opts;
  return body.replace(/href=(['"])([^'"]+)\1/gi, (full, quote, href) => {
    if (shouldSkip(href)) return full;
    const utmHref = appendUtm(href, campaignId);
    const tracked = `${TRACKING_BASE}/api/newsletter/click?msg=${encodeURIComponent(msgIdPlaceholder)}&campaign=${encodeURIComponent(campaignId)}&url=${encodeURIComponent(utmHref)}`;
    return `href=${quote}${tracked}${quote}`;
  });
}

/**
 * Per-recipient {msg} swap. After Resend returns message ids for the
 * batch, we rewrite the body once per recipient to embed their own id.
 * Cheap string replace; the placeholder lives only inside our own
 * URL-encoded `?msg=%7Bmsg%7D` segments.
 */
export function injectMessageId(body: string, messageId: string): string {
  return body.split('msg=%7Bmsg%7D').join(`msg=${encodeURIComponent(messageId)}`);
}
