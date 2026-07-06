/**
 * Shared file-type + naming rules for model-submission files, used by the
 * student submit route, the admin review route (reviewed-model return), and the
 * download proxies, so the allowed types and sanitization never drift.
 *
 * No em dashes in this file.
 */

/** Allowed model file extensions -> canonical MIME type. */
export const ALLOWED_MODEL_EXT_TO_MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:  'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  pdf:  'application/pdf',
};

/** Reviewed models are admin-uploaded; a generous but bounded cap (25 MB). */
export const MAX_REVIEWED_MODEL_BYTES = 25 * 1024 * 1024;

/** Strip path separators + odd characters; keep the dot for the extension. */
export function safeModelFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/** The lowercased extension of a filename, or '' when none. */
export function fileExt(name: string): string {
  const lower = name.toLowerCase();
  return lower.includes('.') ? lower.split('.').pop() ?? '' : '';
}
