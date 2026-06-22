/**
 * featureLabels.ts
 *
 * Human-readable names for entitlement feature keys, used by the in-app
 * upgrade prompts so a locked feature is named accurately (the shared
 * UpgradePrompt's own label map is marketing-oriented and partly stale).
 *
 * No em dashes in this file.
 */
export const FEATURE_DISPLAY_LABELS: Record<string, string> = {
  module_1: 'Project Setup',
  module_2: 'Revenue & Sales',
  module_3: 'Operating Expenses',
  module_4: 'Financial Statements',
  module_5: 'Returns & Valuation',
  module_6: 'Scenario Analysis',
  module_7: 'Reports & Visualizations',
  module_8: 'Portfolio',
  module_9: 'Market Data',
  module_10: 'Collaborate',
  module_11: 'API Access',
  pdf_export: 'PDF Export',
  excel_snapshot: 'Excel Export (snapshot)',
  excel_formula: 'Excel Export (formula linked)',
  white_label_pdf: 'White Label PDF',
  sensitivity: 'Sensitivity Analysis',
  versioning: 'Version History & Save',
  branding: 'Custom Branding',
  projects: 'Saved Projects',
};

export function featureLabel(key: string): string {
  return FEATURE_DISPLAY_LABELS[key] ?? key;
}
