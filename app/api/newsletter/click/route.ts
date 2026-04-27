/**
 * GET /api/newsletter/click?msg=<resend_id>&campaign=<id>&url=<encoded>
 *
 * Records a click against the matching newsletter_recipient_log row, then
 * 302-redirects to the decoded URL. Public route - no auth.
 *
 * Lookup precedence:
 *   1. resend_message_id (per-recipient, set by webhook injection)
 *   2. campaign_id alone - falls back to "first matching pending row" but
 *      we never want to misattribute, so we just record campaign-level
 *      click via the aggregate counter without touching a specific row.
 *
 * Always 302s, even on internal failures, so a tracking blip never breaks
 * the user-facing click. We only return an error response when the URL
 * is missing entirely (nothing to redirect to).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

function isSafeRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const url       = params.get('url') ?? '';
  const messageId = params.get('msg') ?? '';
  const campaign  = params.get('campaign') ?? '';

  if (!url || !isSafeRedirect(url)) {
    return NextResponse.json({ error: 'Missing or invalid url' }, { status: 400 });
  }

  // Best-effort tracking; never block the redirect.
  const sb = getServerClient();
  const now = new Date().toISOString();
  void (async () => {
    try {

      if (messageId && messageId !== '{msg}' && !messageId.includes('%7Bmsg%7D')) {
        await sb.from('newsletter_recipient_log')
          .update({ clicked_at: now, status: 'clicked' })
          .eq('resend_message_id', messageId)
          .is('clicked_at', null);
        return;
      }
      // Fallback (msg= placeholder still unfilled): the Resend webhook is
      // the canonical click-tracking path, so we just redirect without
      // recording. campaign id is kept in the URL for analytics tools that
      // parse it from the access log.
      void campaign;
    } catch (err) {
      console.error('[newsletter-click] tracking failed:', err);
    }
  })();

  return NextResponse.redirect(url, 302);
}
