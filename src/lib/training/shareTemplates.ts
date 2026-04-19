/**
 * Share Template System
 *
 * All share-button text across the Training Hub (certificates, achievement
 * cards, assessment passes, live-session shares) resolves through a single
 * admin-editable template stored in `share_templates`. This module provides:
 *
 *   - `ShareTemplate` type
 *   - `renderShareTemplate(template, vars)` — pure substitution
 *   - `SAMPLE_VARS` + `TEMPLATE_VARIABLES` — admin preview + variable picker
 *   - `DEFAULT_TEMPLATES` — offline fallback mirroring the migration seed,
 *     so a failed fetch never breaks a share button.
 *
 * Placeholder syntax:
 *   {variable}   — substituted from the `vars` object
 *   {@brand}     — "@FinancialModelerPro" or "Financial Modeler Pro"
 *   {@founder}   — "@Ahmad Din, ACCA, FMVA®" or "Ahmad Din, ACCA, FMVA®"
 *
 * The @-prefixed tokens swap based on the template's `mention_brand` and
 * `mention_founder` flags. When a flag is off, the LinkedIn @-mention is
 * dropped but the surrounding sentence still reads naturally.
 */

export const BRAND_HANDLE   = '@FinancialModelerPro';
export const BRAND_PLAIN    = 'Financial Modeler Pro';
export const FOUNDER_HANDLE = '@Ahmad Din, ACCA, FMVA®';
export const FOUNDER_PLAIN  = 'Ahmad Din, ACCA, FMVA®';

export interface ShareTemplate {
  template_key:    string;
  title:           string;
  template_text:   string;
  hashtags:        string[];
  mention_brand:   boolean;
  mention_founder: boolean;
  active:          boolean;
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
  const brand   = template.mention_brand   ? BRAND_HANDLE   : BRAND_PLAIN;
  const founder = template.mention_founder ? FOUNDER_HANDLE : FOUNDER_PLAIN;

  let text = template.template_text
    .split('{@brand}').join(brand)
    .split('{@founder}').join(founder);

  for (const [k, v] of Object.entries(vars)) {
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
};

/**
 * Known variables per template key — drives the admin variable-picker chips.
 * Extra variables in a template_text won't break anything, but they won't be
 * suggested in the UI.
 */
export const TEMPLATE_VARIABLES: Record<string, string[]> = {
  certificate_earned:   ['studentName', 'course', 'grade', 'date', 'certId', 'verifyUrl'],
  assessment_passed:    ['studentName', 'sessionName', 'score', 'course', 'date', 'regId'],
  achievement_card:     ['studentName', 'sessionName', 'score', 'course', 'date', 'regId'],
  live_session_watched: ['studentName', 'sessionName', 'course', 'date'],
  session_shared:       ['sessionName', 'sessionDescription', 'sessionUrl'],
};

/**
 * Offline fallback — mirrors the migration seed. Used when the
 * `/api/share-templates/[key]` fetch fails or the admin has disabled a
 * template. Keeps share buttons functional no matter what.
 */
export const DEFAULT_TEMPLATES: Record<string, ShareTemplate> = {
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
};

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
