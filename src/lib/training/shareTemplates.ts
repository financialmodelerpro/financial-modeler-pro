/**
 * Share Template System
 *
 * All share-button text across the Training Hub (certificates, achievement
 * cards, assessment passes, live-session shares) resolves through a single
 * admin-editable template stored in `share_templates`, plus two global
 * mention strings stored in `training_settings`.
 *
 * Placeholder syntax:
 *   {variable}   — substituted from the `vars` object
 *   {@brand}     — "@{settings.brand_mention}"   or "{settings.brand_mention}"
 *   {@founder}   — "@{settings.founder_mention}" or "{settings.founder_mention}"
 *
 * The @-prefix is added when the template's `mention_brand` / `mention_founder`
 * flag is on. The mention text itself (e.g. `FinancialModelerPro` or
 * `Ahmad Din, ACCA, FMVA®`) lives in training_settings so admins can rotate
 * LinkedIn handles without a code change. The API merges those settings
 * into the returned template object (`brand_mention` + `founder_mention`
 * fields), so call-site code stays the same.
 */

import { COURSES } from '@/src/config/courses';

/** Default mention text — fallback when training_settings hasn't been seeded yet. */
export const DEFAULT_BRAND_MENTION   = 'FinancialModelerPro';
export const DEFAULT_FOUNDER_MENTION = 'Ahmad Din, ACCA, FMVA®';

/**
 * Resolve a course identifier to its full display title. Accepts any of:
 *   - the course id (`'3sfm'`, `'bvm'`)
 *   - the short title (`'3SFM'`, `'BVM'`)
 *   - the full title (passthrough)
 * Returns the input unchanged when no match — lets live-session names and
 * other non-COURSES values pass through untouched.
 *
 * Every share call site goes through this via `renderShareTemplate`, so even
 * if a call site accidentally passes "3SFM" the share text comes out with
 * "3-Statement Financial Modeling" — matching what the admin sees in the
 * template preview.
 */
export function resolveCourseName(value: string | null | undefined): string {
  if (!value) return '';
  const v = String(value).trim();
  if (!v) return '';
  const vUpper = v.toUpperCase();
  const vLower = v.toLowerCase();
  for (const c of Object.values(COURSES)) {
    if (c.title === v) return c.title;
    if (c.shortTitle.toUpperCase() === vUpper) return c.title;
    if (c.id === vLower) return c.title;
  }
  return v;
}

/**
 * Canonical share-date format — matches the admin preview sample
 * ("20 March 2026"). All share call sites go through this so the output
 * is identical regardless of platform locale or call-site formatting quirks.
 */
export function formatShareDate(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  try {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return String(input);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return String(input);
  }
}

export interface ShareSettings {
  brand_mention:     string;
  founder_mention:   string;
  /** When true, `{@brand}` renders as `@<mention>`. When false, plain text. */
  brand_prefix_at:   boolean;
  /** When true, `{@founder}` renders as `@<mention>`. When false, plain text. */
  founder_prefix_at: boolean;
}

export const DEFAULT_SHARE_SETTINGS: ShareSettings = {
  brand_mention:     DEFAULT_BRAND_MENTION,
  founder_mention:   DEFAULT_FOUNDER_MENTION,
  brand_prefix_at:   false,
  founder_prefix_at: false,
};

export interface ShareTemplate {
  template_key:    string;
  title:           string;
  template_text:   string;
  hashtags:        string[];
  /** Legacy per-template flag. Deprecated in migration 116 — the `@` prefix
   *  is now controlled by the global `share_brand_prefix_at` setting. Field
   *  retained for schema compatibility; render engine no longer consults it. */
  mention_brand:   boolean;
  /** Legacy per-template flag. Superseded by `share_founder_prefix_at`. */
  mention_founder: boolean;
  active:          boolean;
  /** Resolved from training_settings.share_brand_mention at the API layer.
   *  Falls back to DEFAULT_BRAND_MENTION when unset. */
  brand_mention:   string;
  /** Resolved from training_settings.share_founder_mention at the API layer. */
  founder_mention: string;
  /** Resolved from training_settings.share_brand_prefix_at. */
  brand_prefix_at: boolean;
  /** Resolved from training_settings.share_founder_prefix_at. */
  founder_prefix_at: boolean;
}

export type ShareVars = Record<string, string | number | null | undefined>;

export interface RenderedShare {
  text:     string;
  hashtags: string[];
}

/**
 * Render a template against a variables object. Pure function — safe to call
 * on server or client, never throws. Unknown placeholders remain literal so
 * they're obvious during development. `\n` in the stored template is already
 * a real newline (Postgres E-strings).
 */
export function renderShareTemplate(template: ShareTemplate, vars: ShareVars): RenderedShare {
  const brandText   = template.brand_mention   || DEFAULT_BRAND_MENTION;
  const founderText = template.founder_mention || DEFAULT_FOUNDER_MENTION;
  // Global `share_brand_prefix_at` / `share_founder_prefix_at` settings
  // (seeded false in migration 116) decide whether to prefix `@`. The
  // legacy per-template `mention_brand` / `mention_founder` booleans are
  // ignored — admin controls everything from the Global Mention Settings
  // card.
  const brand   = template.brand_prefix_at   ? `@${brandText}`   : brandText;
  const founder = template.founder_prefix_at ? `@${founderText}` : founderText;

  // Normalize well-known variables so the output always matches the admin
  // template preview: `course` ⇒ full title (resolves short codes like "3SFM"),
  // date-ish keys ⇒ canonical "20 March 2026" format.
  const normalizedVars: ShareVars = { ...vars };
  if (typeof normalizedVars.course === 'string') {
    normalizedVars.course = resolveCourseName(normalizedVars.course);
  }

  let text = template.template_text
    .split('{@brand}').join(brand)
    .split('{@founder}').join(founder);

  for (const [k, v] of Object.entries(normalizedVars)) {
    if (v === undefined || v === null) continue;
    const token = `{${k}}`;
    // split/join avoids regex-escaping issues for odd variable names.
    text = text.split(token).join(String(v));
  }

  return { text, hashtags: template.hashtags ?? [] };
}

/** Sample values used by the admin preview pane. */
export const SAMPLE_VARS: ShareVars = {
  studentName:        'Jordan Lee',
  course:             '3-Statement Financial Modeling',
  grade:              'A',
  date:               '20 March 2026',
  certId:             'FMP-3SFM-2026-0001',
  verifyUrl:          'https://learn.financialmodelerpro.com/verify/FMP-3SFM-2026-0001',
  sessionName:        'Session 1 — Financial Statement Structure',
  score:              95,
  regId:              'REG-2026-00042',
  sessionDescription: 'Mastering the mechanics of integrated 3-statement financial models.',
  sessionUrl:         'https://learn.financialmodelerpro.com/training-sessions/sample-id',
  // Daily roundup sample — multi-line strings so the admin preview reads
  // identically to what the /admin/training-hub/daily-roundup page will
  // produce for a real cohort.
  count:              3,
  studentList:
    '✅ Ahmad Din, ACCA, FMVA® — 3-Statement Financial Modeling\n' +
    '✅ Jane Doe — Business Valuation Modeling\n' +
    '✅ John Smith — 3-Statement Financial Modeling',
  verifyLinks:
    '• https://learn.financialmodelerpro.com/verify/FMP-3SFM-2026-0001\n' +
    '• https://learn.financialmodelerpro.com/verify/FMP-BVM-2026-0002\n' +
    '• https://learn.financialmodelerpro.com/verify/FMP-3SFM-2026-0003',
};

/**
 * Known variables per template key — drives the admin variable-picker chips.
 * Extra variables in a template_text won't break anything, but they won't be
 * suggested in the UI.
 */
export const TEMPLATE_VARIABLES: Record<string, string[]> = {
  certificate_earned:           ['studentName', 'course', 'grade', 'date', 'certId', 'verifyUrl'],
  assessment_passed:            ['studentName', 'sessionName', 'score', 'course', 'date', 'regId'],
  achievement_card:             ['studentName', 'sessionName', 'score', 'course', 'date', 'regId'],
  live_session_watched:         ['studentName', 'sessionName', 'course', 'date'],
  session_shared:               ['sessionName', 'sessionDescription', 'sessionUrl'],
  daily_certifications_roundup: ['studentList', 'verifyLinks', 'count', 'date'],
};

type TemplateSeed = Omit<ShareTemplate, 'brand_mention' | 'founder_mention' | 'brand_prefix_at' | 'founder_prefix_at'>;

const TEMPLATE_SEEDS: Record<string, TemplateSeed> = {
  certificate_earned: {
    template_key:    'certificate_earned',
    title:           'Certificate Earned',
    template_text:
      'I just earned my {course} Certification from {@brand}!\n\n' +
      '✅ Grade: {grade}\n' +
      '📅 Issued: {date}\n' +
      '🎯 Certificate ID: {certId}\n\n' +
      'Verify the credential →\n' +
      '{verifyUrl}\n\n' +
      'Huge thanks to {@founder} and the team for structured, practitioner-led training in real-world financial modeling.',
    hashtags:        ['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    mention_brand:   true,
    mention_founder: true,
    active:          true,
  },
  assessment_passed: {
    template_key:    'assessment_passed',
    title:           'Assessment Passed',
    template_text:
      'Just passed "{sessionName}" on the {@brand} Training Hub!\n\n' +
      '📊 Score: {score}%\n' +
      '📘 Course: {course}\n' +
      '📅 Date: {date}\n\n' +
      'Another milestone on the way to {course} Certification with {@founder}.',
    hashtags:        ['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    mention_brand:   true,
    mention_founder: true,
    active:          true,
  },
  achievement_card: {
    template_key:    'achievement_card',
    title:           'Achievement Card (Session Completed)',
    template_text:
      'Just completed "{sessionName}" on the {@brand} Training Hub!\n\n' +
      '📊 Score: {score}%\n' +
      '📘 {course}\n\n' +
      'Thanks to {@founder} for the practitioner-led curriculum.',
    hashtags:        ['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    mention_brand:   true,
    mention_founder: true,
    active:          true,
  },
  live_session_watched: {
    template_key:    'live_session_watched',
    title:           'Live Session Watched',
    template_text:
      'Just finished watching "{sessionName}" — part of FMP Real-World Financial Modeling from {@brand}.\n\n' +
      'Practitioner-led, built on real deal work with {@founder}.',
    hashtags:        ['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    mention_brand:   true,
    mention_founder: true,
    active:          true,
  },
  session_shared: {
    template_key:    'session_shared',
    title:           'Session / Course Shared (Generic)',
    template_text:
      'Check out "{sessionName}" on the {@brand} Training Hub.\n\n' +
      '{sessionDescription}\n\n' +
      '{sessionUrl}',
    hashtags:        ['FinancialModeling', 'FinancialModelerPro'],
    mention_brand:   true,
    mention_founder: false,
    active:          true,
  },
  daily_certifications_roundup: {
    template_key:    'daily_certifications_roundup',
    title:           'Daily Certifications Roundup',
    template_text:
      'Congratulations to today\'s newly certified professionals at {@brand}!\n\n' +
      '{studentList}\n\n' +
      'Proud of the dedication and hard work from {count} students under the guidance of {@founder}.\n\n' +
      'View their credentials:\n' +
      '{verifyLinks}\n\n' +
      'Structured Modeling. Real-World Finance.',
    hashtags:        ['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    mention_brand:   true,
    mention_founder: true,
    active:          true,
  },
};

/**
 * Offline fallback — mirrors the migration seed. Used when the
 * `/api/share-templates/[key]` fetch fails or the admin has disabled a
 * template. Keeps share buttons functional no matter what.
 *
 * Brand/founder mention fields are populated with the DEFAULT_SHARE_SETTINGS
 * values; the API overwrites them with the admin-edited values at fetch time.
 */
export const DEFAULT_TEMPLATES: Record<string, ShareTemplate> = Object.fromEntries(
  Object.entries(TEMPLATE_SEEDS).map(([key, seed]) => [
    key,
    {
      ...seed,
      brand_mention:     DEFAULT_BRAND_MENTION,
      founder_mention:   DEFAULT_FOUNDER_MENTION,
      brand_prefix_at:   false,
      founder_prefix_at: false,
    },
  ]),
);

/**
 * Render helper combining fetch-or-fallback + substitution in one call.
 * Useful for server components (verify page) that can fetch at render time.
 */
export function renderWithFallback(
  template: ShareTemplate | null | undefined,
  key: string,
  vars: ShareVars,
): RenderedShare {
  const t = template && template.active ? template : DEFAULT_TEMPLATES[key];
  if (!t) return { text: '', hashtags: [] };
  return renderShareTemplate(t, vars);
}
