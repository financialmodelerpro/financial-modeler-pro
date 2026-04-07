/**
 * appsScript.ts — re-exports certificate-specific Apps Script functions.
 * All actual API logic lives in sheets.ts (single source of truth for Apps Script calls).
 */

export {
  getPendingCertificates,
  updateCertificateUrls,
  getCertificateById,
  getStudentProgress,
  getCourseDetails,
  getAssessmentQuestions,
  submitAssessment,
  submitAssessmentToAppsScript,
  registerStudent,
  getCertificatesByEmail,
} from '@/src/lib/training/sheets';

export type { PendingCertificate, SubmitAssessmentScoredParams } from '@/src/lib/training/sheets';
