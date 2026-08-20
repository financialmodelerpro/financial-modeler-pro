import { sendEmail, FROM } from './sendEmail';
import { newRegistrationAlertTemplate, type NewRegistrationAlertData } from './templates/newRegistrationAlert';

/**
 * THE ONE PLACE A NEW-REGISTRATION ALERT IS SENT.
 *
 * Both hubs call this. It exists so there is a single sending path rather than
 * a fetch here and a fetch there: the sender, the recipient, the failure
 * behaviour and the logging are decided once.
 *
 * ── IT NEVER THROWS ──────────────────────────────────────────────────────────
 *
 * A registration that succeeded must not be reported as failed because an
 * email did not go out. The person has an account either way, and the only
 * thing lost is a notification. So every failure is caught, logged with enough
 * detail to find it (`[reg-alert]`, matching the `[sub-email]` convention the
 * subscription lifecycle already uses), and swallowed.
 *
 * That is also why callers should not await it. `void sendNewRegistrationAlert(...)`
 * keeps the signup response off the Brevo round trip.
 *
 * ── SENDER AND RECIPIENT ─────────────────────────────────────────────────────
 *
 * From no-reply, to support. Both come from the shared `FROM` constants and the
 * env override below, so neither address is hardcoded in a template.
 *
 * No em dashes in this file.
 */

/** Where signup alerts go. Overridable so a staging deploy can point them
 *  somewhere harmless without a code change. */
const ALERT_TO = process.env.EMAIL_SIGNUP_ALERT_TO ?? 'support@financialmodelerpro.com';

export async function sendNewRegistrationAlert(data: NewRegistrationAlertData): Promise<void> {
  try {
    const { subject, html } = await newRegistrationAlertTemplate(data);
    const res = await sendEmail({
      to: ALERT_TO,
      subject,
      html,
      from: FROM.noreply,
    });
    // Log the Brevo message id, so a "did support get it" question is answered
    // from the logs rather than from a mailbox search.
    console.log(`[reg-alert] sent hub=${data.hub} user=${data.email} to=${ALERT_TO} id=${res.id}`);
  } catch (err) {
    // Logged, never rethrown. See the contract above.
    console.error(`[reg-alert] FAILED hub=${data.hub} user=${data.email}: ${
      err instanceof Error ? err.message : String(err)}`);
  }
}
