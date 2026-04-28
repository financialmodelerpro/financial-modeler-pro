/**
 * appsScript.ts - re-exports certificate-specific Apps Script functions.
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
} from '@/src/hubs/training/lib/appsScript/sheets';

export type { PendingCertificate, SubmitAssessmentScoredParams } from '@/src/hubs/training/lib/appsScript/sheets';
