/**
 * GET /api/campaigns/unsubscribe?u=<userId>&t=<token>
 *
 * The per-user opt-out every campaign email links to. PUBLIC by necessity: it
 * is clicked from an inbox, with no session. What makes that safe is the
 * token, an HMAC of the user id checked in constant time, so the link cannot
 * be forged for somebody else and no token has to be stored.
 *
 * Idempotent: clicking twice is a second confirmation, not an error. It only
 * ever SETS the flag; resubscribing is deliberately not a link (that would let
 * anyone holding an old email silently re-enrol a person who opted out).
 *
 * Returns a small HTML page rather than JSON, because a human is reading it.
 *
 * No em dashes in this file.
 */
import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { verifyUnsubscribeToken } from '@/src/shared/email/campaigns';

function page(title: string, message: string, ok: boolean): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title></head>
<body style="margin:0;font-family:Inter,system-ui,sans-serif;background:#F4F7FC;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;">
  <div style="background:#fff;border:1px solid #E8F0FB;border-radius:14px;padding:32px 36px;max-width:460px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
    <div style="font-size:32px;margin-bottom:10px;">${ok ? '&#10003;' : '&#9888;'}</div>
    <h1 style="font-size:18px;font-weight:800;color:#0D2E5A;margin:0 0 8px;">${title}</h1>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0;">${message}</p>
  </div>
</body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('u') ?? '';
  const token = req.nextUrl.searchParams.get('t') ?? '';

  if (!userId || !token || !verifyUnsubscribeToken(userId, token)) {
    return page(
      'This unsubscribe link is not valid',
      'The link may be incomplete. Please use the link in the most recent email, or reply to that email and we will remove you.',
      false,
    );
  }

  try {
    const sb = getServerClient();
    const { error } = await sb
      .from('users')
      .update({ campaign_unsubscribed_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) {
      console.error('[campaign-unsubscribe] write failed:', error.message);
      return page(
        'We could not complete that just now',
        'Please try the link again in a few minutes, or reply to the email and we will remove you manually.',
        false,
      );
    }
  } catch {
    return page(
      'We could not complete that just now',
      'Please try the link again in a few minutes, or reply to the email and we will remove you manually.',
      false,
    );
  }

  return page(
    'You have been unsubscribed',
    'You will not receive further campaign emails from Financial Modeler Pro. Emails about your own account, such as billing and password resets, are not affected.',
    true,
  );
}
