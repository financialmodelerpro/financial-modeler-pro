// Shared types and helper functions for the Training Dashboard

import { COURSES } from '@/src/hubs/training/config/courses';

export interface LiveSessionLink { tabKey: string; sessionName: string; description?: string; youtubeUrl: string; formUrl: string; videoDuration: number; isFinal: boolean; hasVideo: boolean; }
export type LiveLinksMap = Record<string, LiveSessionLink>;

export interface CourseDescription {
  tagline?: string;
  fullDescription?: string;
  whatYouLearn?: string[];
  prerequisites?: string;
  whoIsThisFor?: string;
  skillLevel?: string;
  durationHours?: number;
  language?: string;
  certificateDescription?: string;
}
export type CourseDescsMap = Record<string, CourseDescription>;

// ── Local types ───────────────────────────────────────────────────────────────

export interface SessionProgress {
  sessionId: string;
  passed: boolean;
  score: number;
  attempts: number;
  completedAt: string | null;
}

export interface StudentData {
  name: string;
  email: string;
  registrationId: string;
  course: string;
  registeredAt: string;
}

export interface ProgressData {
  student: StudentData;
  sessions: SessionProgress[];
  finalPassed: boolean;
  certificateIssued: boolean;
}

export interface Certificate {
  certificateId: string;
  studentName: string;
  email: string;
  /** Display-only full course title (e.g. "3-Statement Financial Modeling"). */
  course: string;
  /**
   * Canonical short code (e.g. "3SFM", "BVM"). Prefer this for any
   * client-side matching against COURSES configs; `course` above is
   * free-form prose on older cert rows and can't be relied on for
   * lookups.
   */
  courseCode?: string;
  issuedAt: string;
  certifierUrl: string;
  // Internal system fields (populated after migration to internal cert system)
  certPdfUrl?:     string;
  badgeUrl?:       string;
  transcriptUrl?:  string;
  verificationUrl?: string;
  grade?:          string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getEnrolledCourses(courseValue: string): string[] {
  if (courseValue === 'both') return ['3sfm', 'bvm'];
  if (courseValue === 'bvm') return ['bvm'];
  return ['3sfm'];
}

export function buildProgressMap(sessions: SessionProgress[]): Map<string, SessionProgress> {
  return new Map(sessions.map(s => [s.sessionId, s]));
}

export function allRegularSessionsPassed(courseId: string, progressMap: Map<string, SessionProgress>): boolean {
  const course = COURSES[courseId];
  if (!course) return false;
  return course.sessions
    .filter(s => !s.isFinal)
    .every(s => progressMap.get(s.id)?.passed === true);
}
