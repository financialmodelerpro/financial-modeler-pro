/**
 * THE YouTube subscribe link and copy for the live course (founder,
 * 2026-11-13). Every subscribe call to action on a session card, a completion
 * screen, the recording page and the course emails reads this one rule.
 *
 * The channel comes from NEXT_PUBLIC_YOUTUBE_CHANNEL_ID, the same value the
 * dashboard's Subscribe button and the subscribe popup already use, with
 * ?sub_confirmation=1 appended so YouTube opens its subscribe prompt.
 *
 * SUBSCRIBING IS NEVER A CONDITION for a certificate, a session card or any
 * progress: nothing reads whether a student clicked it. Pure.
 */

/** The channel's public handle, used only when the channel id is not configured. */
export const YOUTUBE_HANDLE_URL = 'https://www.youtube.com/@FinancialModelerPro';

/** The subscribe prompt for the course's channel. */
export function youtubeSubscribeUrl(channelId: string | null | undefined = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID): string {
  const id = (channelId ?? '').trim();
  const base = id ? `https://www.youtube.com/channel/${encodeURIComponent(id)}` : YOUTUBE_HANDLE_URL;
  return `${base}?sub_confirmation=1`;
}

/** The line on a session card and on the completion screen. */
export const NEXT_RECORDING_SUBSCRIBE_TEXT = 'Next session recording goes on YouTube. Subscribe to get notified.';

/** The line in the course emails (recording ready, certificate issued). */
export const EMAIL_SUBSCRIBE_TEXT = 'Session recordings and new lessons go on our YouTube channel. Subscribe to get notified when the next one is up.';

/** Stated wherever the call to action appears, so nobody reads it as a requirement. */
export const SUBSCRIBE_OPTIONAL_NOTE = 'Optional: subscribing has no effect on your progress or certificate.';

/** The email block (inline styles only). Escaping is not needed: every value is a constant. */
export function subscribeEmailHtml(url: string = youtubeSubscribeUrl()): string {
  return `
    <div style="background:#FEF2F2;border-left:4px solid #DC2626;border-radius:6px;padding:14px 18px;margin:18px 0;">
      <p style="margin:0 0 10px;font-size:13px;color:#7F1D1D;">${EMAIL_SUBSCRIBE_TEXT}</p>
      <a href="${url}" style="display:inline-block;padding:9px 18px;background:#DC2626;color:#fff;text-decoration:none;font-size:13px;font-weight:700;border-radius:6px;">Subscribe on YouTube</a>
      <p style="margin:10px 0 0;font-size:11px;color:#9CA3AF;">${SUBSCRIBE_OPTIONAL_NOTE}</p>
    </div>`;
}
