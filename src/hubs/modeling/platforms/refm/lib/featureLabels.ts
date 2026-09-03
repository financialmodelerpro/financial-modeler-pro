/**
 * featureLabels.ts
 *
 * Human-readable names for entitlement feature keys, used by the in-app
 * upgrade prompts so a locked feature is named accurately.
 *
 * MODULE KEYS ARE DELIBERATELY ABSENT (2026-09-03). A module's name and number
 * are DERIVED from the live platform_modules registry, through the same nav
 * list the sidebar renders, and `lockedFeatureLabel` in RealEstatePlatform is
 * the one place that resolves them. This map answers for everything else.
 *
 * There were two hand-written module maps and they disagreed inside a single
 * modal: this file's header used to say the shared UpgradePrompt's map was
 * "marketing-oriented and partly stale", and it was right (that map had
 * module_4 and module_5 swapped, and module_6 and module_7 swapped, against
 * the registry, ever since migration 157 moved reports and scenarios). The
 * answer to a second copy that drifts is not a third copy that is currently
 * correct: it is to stop copying. See docs/TRAPS.md 8.2.
 *
 * No em dashes in this file.
 */
export const FEATURE_DISPLAY_LABELS: Record<string, string> = {
  pdf_export: 'PDF Export',
  excel_snapshot: 'Excel Export (snapshot)',
  excel_formula: 'Excel Export (formula linked)',
  white_label_pdf: 'White Label PDF',
  sensitivity: 'Sensitivity Analysis',
  versioning: 'Version History & Save',
  branding: 'Custom Branding',
  projects: 'Saved Projects',
};

/** The name for a NON-MODULE feature key. A module key returns the key itself,
 *  because this map no longer owns module names: resolve those through
 *  `lockedFeatureLabel`, which reads the live registry. */
export function featureLabel(key: string): string {
  return FEATURE_DISPLAY_LABELS[key] ?? key;
}
