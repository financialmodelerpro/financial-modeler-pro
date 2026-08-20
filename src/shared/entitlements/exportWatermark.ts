/**
 * exportWatermark.ts (2026-08-20)
 *
 * THE ONE RULE for whether an exported PDF carries a trial watermark, and what
 * it says. Pure: no database, no session, no pdf-lib. The server resolves a
 * decision with these functions and hands the decision to the builders; the
 * builders draw what they are told and decide nothing.
 *
 * WHY A PLAN LIST AND NOT `white_label_pdf`. There is already a firm-only
 * `white_label_pdf` feature, and inverting it would have been fewer moving
 * parts. It was rejected deliberately: that flag exists to let a firm remove
 * OUR branding from a document they send to their own client, and a watermark
 * that appeared as a side effect of it would mean one switch answering two
 * unrelated questions. The two are separate flags doing separate jobs, and a
 * change to either must not move the other.
 *
 * WHY THE PLAN AND NOT THE PERSON. The watermark describes what the DOCUMENT
 * represents (a model built on a trial), not what its author is permitted to
 * do. So it follows the resolved plan key and nothing else. An admin whose own
 * plan is in the list is watermarked too, which is the only way an admin can
 * check that the setting works before turning it on for customers.
 *
 * No em dashes in this file.
 */

/** The admin-editable settings. Stored as one JSON blob; see the API route. */
export interface WatermarkSettings {
  /** Master switch. Off means no export is watermarked, whatever the plans list
   *  says, so there is one thing to turn off in a hurry. */
  enabled: boolean;
  /** The diagonal text drawn across every page. */
  text: string;
  /** Plan keys the watermark applies to. Anything not listed is unmarked. */
  plans: string[];
}

/**
 * Default: on, for trial only.
 *
 * These are the values a database with no stored setting resolves to, which
 * means the watermark is live from the moment this ships rather than waiting
 * for somebody to visit the admin screen. A paid plan is unmarked by default,
 * as specified.
 */
export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = {
  enabled: true,
  text: 'TRIAL VERSION',
  plans: ['trial'],
};

/** cms_content coordinates. One row, so the settings cannot half-exist. */
export const WATERMARK_SECTION = 'exports';
export const WATERMARK_KEY = 'pdf_watermark';

/** Longest text we will draw. Past this the diagonal stops being legible and
 *  starts obscuring the figures underneath it, which is not what a watermark
 *  is for. */
export const WATERMARK_TEXT_MAX = 40;

/**
 * Read stored settings tolerantly.
 *
 * Every field falls back to its default INDIVIDUALLY rather than the object
 * falling back as a whole, so a row that has picked up a junk `text` still
 * honours a deliberate `plans` list. An empty text is treated as absent (the
 * way to turn the watermark off is `enabled: false`, not a blank string that
 * would draw nothing while reporting itself as on).
 */
export function parseWatermarkSettings(raw: unknown): WatermarkSettings {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const text = typeof o.text === 'string' && o.text.trim() !== ''
    ? o.text.trim().slice(0, WATERMARK_TEXT_MAX)
    : DEFAULT_WATERMARK_SETTINGS.text;
  const plans = Array.isArray(o.plans)
    ? o.plans.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim())
    : DEFAULT_WATERMARK_SETTINGS.plans;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_WATERMARK_SETTINGS.enabled,
    text,
    plans,
  };
}

/**
 * Does this plan get a watermark?
 *
 * Plan keys are compared case-insensitively and trimmed, because the list is
 * typed by an admin and 'Trial' meaning nothing while 'trial' works is the
 * kind of silent miss this whole pass exists to avoid.
 */
export function watermarkAppliesToPlan(planKey: string | null | undefined, s: WatermarkSettings): boolean {
  if (!s.enabled) return false;
  const k = (planKey ?? '').trim().toLowerCase();
  if (k === '') return false;
  return s.plans.some((p) => p.trim().toLowerCase() === k);
}

/** What the builders receive. `null` means draw nothing. */
export interface WatermarkSpec {
  /** Diagonal text across every page. */
  text: string;
  /** The line added to every page footer. Stated separately from `text`
   *  because a footer is read as a sentence and a watermark is read as a
   *  stamp; one string doing both would be wrong in one of the two places. */
  footer: string;
}

/**
 * Build the spec, or null.
 *
 * The footer names the plan in plain words rather than repeating the stamp,
 * because the two are read differently: the diagonal says at a glance that
 * this is not a final document, the footer says why to somebody who has been
 * handed the file with no context.
 */
export function resolveWatermarkSpec(
  planKey: string | null | undefined,
  s: WatermarkSettings,
): WatermarkSpec | null {
  if (!watermarkAppliesToPlan(planKey, s)) return null;
  return {
    text: s.text,
    footer: `${s.text} - exported from a trial account. Not for distribution.`,
  };
}
