/**
 * Default per-course model-submission guidance copy.
 *
 * Single source of truth shared by:
 *   - the student submission card (ModelSubmissionCard), which falls back to
 *     this when no per-course guidance row is configured, and
 *   - the admin Training Settings page, which pre-fills the editable guidance
 *     textareas with this text so admins edit real copy in place rather than
 *     starting from a blank box.
 *
 * The required file-name convention is intentionally NOT included here: it is
 * rendered as a separate always-on block on the student card so it can never
 * be edited away. This copy is purely the "what to build" narrative.
 */
export const DEFAULT_MODEL_SUBMISSION_GUIDANCE: Record<'3SFM' | 'BVM', string> = {
  '3SFM':
    'Build your own 3-Statement Financial Model and upload it as an Excel file (.xlsx, .xls, .xlsm) or PDF. Our experts team will review it within 5 business days. Approval unlocks the Final Exam. Each rejection consumes one of your 3 attempts.',
  'BVM':
    'Build your own Business Valuation Model (DCF + Comps) using the case studies from the course and upload it as an Excel file (.xlsx, .xls, .xlsm) or PDF. Our experts team will review it within 5 business days. Approval unlocks the Final Exam. Each rejection consumes one of your 3 attempts.',
};
