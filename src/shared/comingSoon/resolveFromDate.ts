/**
 * resolveFromDate.ts (2026-08-20)
 *
 * THE LAUNCH DATE IS THE SINGLE SOURCE. ONE INTENTION, NOT TWO SETTINGS THAT
 * CAN DISAGREE.
 *
 * ── WHAT WENT WRONG ──────────────────────────────────────────────────────────
 *
 * A hub's Coming Soon state used to live in a stored flag, and a launch date
 * lived beside it doing nothing unless a THIRD setting, `*_auto_launch`, told a
 * nightly cron it was allowed to flip the flag. On 2026-08-20 the modeling
 * launch date arrived, auto-launch was off, and so:
 *
 *   - the public launch banner switched to its "launched" message, because it
 *     derives from the DATE and deliberately ignores the flag;
 *   - the workspace stayed shut, because the guard read the FLAG;
 *   - every trial user who clicked Open Platform was bounced back to the
 *     platform selector, and the entitlement gate never ran.
 *
 * Two settings, one intention, and the site told two stories about itself.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 *
 *   no launch date        the stored flag decides, exactly as before. A hub
 *                         with no date is unaffected by any of this.
 *   date in the future    coming soon, whatever the flag says.
 *   date has passed       live, whatever the flag says.
 *
 * The date OUTRANKS the flag whenever a date is set. That is the point: a
 * launch date that does not launch anything is a lie, and a flag that survives
 * its own launch date is the bug above.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 * It does not delete anything. `*_auto_launch` is retired rather than removed
 * (the row stays in `training_settings`, and the Training Hub still uses its
 * own copy through the cron), and the stored flag is still read and still
 * written, because it is the whole mechanism for a hub with no date.
 *
 * Pure: no I/O, no clock of its own. The caller passes `nowMs`, so a test can
 * sit on either side of a boundary without waiting for one.
 *
 * No em dashes in this file.
 */

export type ComingSoonSource =
  /** No usable launch date, so the stored flag decided. */
  | 'flag'
  /** A launch date is set and has not arrived. */
  | 'date_pending'
  /** A launch date is set and has passed. */
  | 'date_passed';

export interface ComingSoonResolution {
  /** True when the hub should be gated. */
  enabled: boolean;
  source: ComingSoonSource;
  /** One sentence for an admin screen, so the reason is never guessed at. */
  reason: string;
}

export interface ResolveComingSoonInput {
  /** The stored `*_coming_soon` value. */
  flag: boolean;
  /** The stored `*_launch_date`, ISO or empty. */
  launchDate: string | null | undefined;
  nowMs: number;
}

export function resolveComingSoonFromDate(i: ResolveComingSoonInput): ComingSoonResolution {
  const raw = (i.launchDate ?? '').trim();
  const at = raw === '' ? NaN : Date.parse(raw);

  // An UNPARSEABLE date is treated as no date, not as a launch. A typo must
  // never open a gated hub, and it must never close an open one either: it
  // falls back to whatever the flag already said, which is the last state
  // somebody actually chose.
  if (Number.isNaN(at)) {
    return {
      enabled: i.flag,
      source: 'flag',
      reason: i.flag
        ? 'No launch date is set, and the hub is switched to Coming Soon.'
        : 'No launch date is set, and the hub is live.',
    };
  }

  const when = new Date(at).toISOString().slice(0, 10);
  if (i.nowMs < at) {
    return {
      enabled: true,
      source: 'date_pending',
      reason: `Coming Soon until the launch date, ${when}.`,
    };
  }
  return {
    enabled: false,
    source: 'date_passed',
    reason: `Live since the launch date, ${when}.`,
  };
}
