/**
 * sheets.ts — Server-side only. Never import this from client components.
 * All functions proxy to the Google Apps Script Web App via APPS_SCRIPT_URL.
 *
 * URL resolution order:
 *   1. APPS_SCRIPT_URL env var (fast, no DB round-trip)
 *   2. training_settings.apps_script_url row in Supabase
 */

import { getServerClient } from '@/src/lib/shared/supabase';

export async function getAppsScriptUrl(): Promise<string> {
  if (process.env.APPS_SCRIPT_URL) {
    console.log('[sheets] APPS_SCRIPT_URL from env:', process.env.APPS_SCRIPT_URL.slice(0, 80) + '…');
    return process.env.APPS_SCRIPT_URL;
  }
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('value')
      .eq('key', 'apps_script_url')
      .single();
    const url = data?.value ?? '';
    console.log('[sheets] APPS_SCRIPT_URL from DB:', url ? url.slice(0, 80) + '…' : '(not set)');
    return url;
  } catch {
    console.log('[sheets] APPS_SCRIPT_URL: DB lookup failed');
    return '';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SheetStudent {
  name: string;
  email: string;
  registrationId: string;
  course: string;
  registeredAt: string;
}

export interface SessionProgress {
  sessionId: string;
  passed: boolean;
  score: number;
  attempts: number;
  completedAt: string | null;
}

export interface StudentProgress {
  student: SheetStudent;
  sessions: SessionProgress[];
  finalPassed: boolean;
  certificateIssued: boolean;
}

export interface SheetCertificate {
  certificateId: string;
  studentName: string;
  email: string;
  course: string;
  issuedAt: string;
  certifierUrl: string;
}

interface ScriptResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duplicate?: boolean;  // register: email already registered in Sheets
  notFound?: boolean;   // resend: email not found in Sheets
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function callScript<T>(params: Record<string, string>): Promise<ScriptResponse<T>> {
  console.log('[DEBUG] callScript called with:', JSON.stringify(params));
  const APPS_SCRIPT_URL = await getAppsScriptUrl();
  if (!APPS_SCRIPT_URL) {
    return { success: false, error: 'APPS_SCRIPT_URL not configured' };
  }
  try {
    const url = new URL(APPS_SCRIPT_URL);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    console.log('[DEBUG] callScript URL resolved:', url.toString());
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      // No caching — always fresh data from Sheets
      cache: 'no-store',
    });
    if (!res.ok) {
      return { success: false, error: `Script responded with HTTP ${res.status}` };
    }
    const json = await res.json() as ScriptResponse<T>;
    return json;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function callScriptPostJson<T>(body: Record<string, unknown>): Promise<ScriptResponse<T>> {
  const APPS_SCRIPT_URL = await getAppsScriptUrl();
  if (!APPS_SCRIPT_URL) {
    return { success: false, error: 'APPS_SCRIPT_URL not configured' };
  }
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { success: false, error: `Script responded with HTTP ${res.status}` };
    }
    const json = await res.json() as ScriptResponse<T>;
    return json;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function callScriptPost<T>(body: Record<string, string>): Promise<ScriptResponse<T>> {
  const APPS_SCRIPT_URL = await getAppsScriptUrl();
  if (!APPS_SCRIPT_URL) {
    return { success: false, error: 'APPS_SCRIPT_URL not configured' };
  }
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { success: false, error: `Script responded with HTTP ${res.status}` };
    }
    const json = await res.json() as ScriptResponse<T>;
    return json;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Validate a student's email + registration ID combination. */
export async function validateStudent(
  email: string,
  regId: string,
): Promise<ScriptResponse<SheetStudent>> {
  return callScript<SheetStudent>({ action: 'validate', email, regId });
}

// Maps tabKey-style final session ids to the COURSES config session ids
const FINAL_TABKEY_TO_SESSION_ID: Record<string, string> = {
  '3SFM_Final': 'S18',
  'BVM_Final':  'L7',
};

/**
 * Normalise a session ID returned by Apps Script into the short form used by the
 * COURSES config (e.g. "3SFM_S1" → "S1", "BVM_L3" → "L3", "3SFM_Final" → "S18").
 * If the id is already in short form it is returned unchanged.
 */
function normalizeSessionId(id: string): string {
  if (!id) return id;
  if (FINAL_TABKEY_TO_SESSION_ID[id]) return FINAL_TABKEY_TO_SESSION_ID[id];
  // Strip course prefix: "3SFM_S4" → "S4", "BVM_L2" → "L2"
  const m = id.match(/^(?:3SFM|BVM)_(.+)$/i);
  return m ? m[1] : id;
}

function normalizeSession(raw: Record<string, unknown>): SessionProgress {
  // Apps Script may use `tabKey` instead of `sessionId`
  const rawId = (raw.sessionId as string) || (raw.tabKey as string) || '';
  return {
    sessionId:   normalizeSessionId(rawId),
    passed:      Boolean(raw.passed),
    score:       Number(raw.score ?? raw.percentage ?? 0),
    attempts:    Number(raw.attemptsUsed ?? raw.attempts ?? 0),
    completedAt: (raw.completedAt as string) ?? (raw.lastCompletedAt as string) ?? null,
  };
}

// Passing threshold used when deriving pass/fail from a raw percentage score
const PASSING_SCORE_PCT = 70;

type CourseProgressEntry = {
  sessions: Record<string, { status: string; bestScore: number | null; score?: number | null; passed?: boolean; attempts: number; maxAttempts: number }>;
  allSessionsPassed?: boolean;
  finalExam?: { status: string; bestScore: number | null; score?: number | null; passed?: boolean };
  certificateStatus?: string;
};

/**
 * Shape A-extended: Apps Script returns data.student.progress[courseKey].sessions as a keyed
 * object, e.g. { "S1": { status, bestScore, attempts, maxAttempts }, "S2": … }.
 * Sessions from all enrolled courses (3sfm + bvm) are merged into one flat array.
 */
function normalizeProgressObject(
  studentRaw: Record<string, unknown>,
  email: string,
  regId: string,
): ScriptResponse<StudentProgress> {
  const progressMap = studentRaw.progress as Record<string, CourseProgressEntry>;
  const allSessions: SessionProgress[] = [];
  let finalPassed = false;
  let certificateIssued = false;

  for (const courseProgress of Object.values(progressMap)) {
    for (const [sessionId, sd] of Object.entries(courseProgress.sessions ?? {})) {
      const scoreVal = sd.bestScore ?? sd.score ?? 0;
      const passed   = sd.status === 'passed'
                    || sd.passed === true
                    || (typeof sd.score === 'number' && sd.score >= PASSING_SCORE_PCT)
                    || (typeof sd.bestScore === 'number' && sd.bestScore >= PASSING_SCORE_PCT);
      const attempts = sd.attempts ?? 0;
      allSessions.push({
        sessionId,
        passed,
        score:       scoreVal,
        // If a session is marked passed, it must have had at least 1 attempt
        attempts:    passed && attempts === 0 ? 1 : attempts,
        completedAt: null,
      });
    }
    const fe = courseProgress.finalExam;
    const fePassed = fe
      ? (fe.status === 'passed'
        || fe.passed === true
        || (typeof fe.score === 'number' && fe.score >= PASSING_SCORE_PCT)
        || (typeof fe.bestScore === 'number' && fe.bestScore >= PASSING_SCORE_PCT))
      : false;
    if (courseProgress.allSessionsPassed || fePassed) finalPassed = true;
    if (courseProgress.certificateStatus === 'earned') certificateIssued = true;
  }

  // Derive the `course` value used by getEnrolledCourses() in the dashboard:
  //   'both'  — student enrolled in 3sfm AND bvm
  //   'bvm'   — bvm only
  //   '3sfm'  — 3sfm only (default)
  const enrolled = Array.isArray(studentRaw.enrolledCourses)
    ? (studentRaw.enrolledCourses as string[]).map(c => c.toLowerCase())
    : [];
  const hasSfm = enrolled.includes('3sfm') || enrolled.length === 0;
  const hasBvm = enrolled.includes('bvm');
  const courseField = hasSfm && hasBvm ? 'both' : hasBvm ? 'bvm' : '3sfm';

  return {
    success: true,
    data: {
      student: {
        name:           String(studentRaw.fullName ?? studentRaw.name ?? regId),
        email:          String(studentRaw.email ?? email),
        registrationId: String(studentRaw.registrationId ?? regId),
        course:         courseField,
        registeredAt:   String(studentRaw.enrolledDate ?? ''),
      },
      sessions: allSessions,
      finalPassed,
      certificateIssued,
    },
  };
}

/**
 * Shape C: Apps Script returns the sheet row as flat columns —
 *   3SFM: S1%, S2%, …, S17%, Final Exam %, Sessions Passed, Avg Score
 *   BVM:  L1%, L2%, …, L6%,  Final Exam %, Lessons Passed, Avg Score, Final Passed, Cert Issued
 */
function normalizeFlatSheetProgress(
  root: Record<string, unknown>,
  email: string,
  regId: string,
): ScriptResponse<StudentProgress> {
  const hasBVM = typeof root['L1%'] !== 'undefined';
  const course  = hasBVM ? 'BVM' : '3SFM';
  const sessions: SessionProgress[] = [];

  if (!hasBVM) {
    // 3SFM — S1 … S17
    for (let i = 1; i <= 17; i++) {
      const raw = root[`S${i}%`];
      if (raw === undefined || raw === null || raw === '') continue;
      const score = Number(raw) || 0;
      sessions.push({ sessionId: `S${i}`, passed: score >= PASSING_SCORE_PCT, score, attempts: score > 0 ? 1 : 0, completedAt: null });
    }
    // Final exam → S18
    const finalRaw = root['Final Exam %'];
    if (finalRaw !== undefined && finalRaw !== null && finalRaw !== '') {
      const score = Number(finalRaw) || 0;
      sessions.push({ sessionId: 'S18', passed: score >= PASSING_SCORE_PCT, score, attempts: score > 0 ? 1 : 0, completedAt: null });
    }
  } else {
    // BVM — L1 … L6
    for (let i = 1; i <= 6; i++) {
      const raw = root[`L${i}%`];
      if (raw === undefined || raw === null || raw === '') continue;
      const score = Number(raw) || 0;
      sessions.push({ sessionId: `L${i}`, passed: score >= PASSING_SCORE_PCT, score, attempts: score > 0 ? 1 : 0, completedAt: null });
    }
    // Final exam → L7
    const finalRaw = root['Final Exam %'];
    if (finalRaw !== undefined && finalRaw !== null && finalRaw !== '') {
      const score = Number(finalRaw) || 0;
      sessions.push({
        sessionId:   'L7',
        passed:      Boolean(root['Final Passed']) || score >= PASSING_SCORE_PCT,
        score,
        attempts:    score > 0 ? 1 : 0,
        completedAt: null,
      });
    }
  }

  const student: SheetStudent = {
    name:           String(root['Full Name'] ?? root.fullName ?? regId),
    email:          String(root.email ?? email),
    registrationId: String(root['Registration ID'] ?? root.registrationId ?? regId),
    course,
    registeredAt:   '',
  };

  return {
    success: true,
    data: {
      student,
      sessions,
      finalPassed:       Boolean(root['Final Passed'] ?? root.finalPassed),
      certificateIssued: Boolean(root['Cert Issued']  ?? root.certIssued ?? root.certificateIssued),
    },
  };
}

/** Fetch a student's full session progress. */
export async function getStudentProgress(
  email: string,
  regId: string,
): Promise<ScriptResponse<StudentProgress>> {
  console.log('[DEBUG] getStudentProgress called:', { email, regId });
  const raw = await callScript<StudentProgress>({ action: 'getProgress', email, regId });
  console.log('[DEBUG] raw Apps Script response:', JSON.stringify(raw).substring(0, 500));

  // Log which shape branch will be taken
  const root = raw as unknown as Record<string, unknown>;
  const hasDataStudent = raw.data && typeof raw.data === 'object' && 'student' in raw.data;
  const hasRootStudent = root.student && typeof root.student === 'object';
  const hasFlatCols = typeof root['S1%'] !== 'undefined' || typeof root['L1%'] !== 'undefined';
  console.log('[DEBUG] shape detection:', { success: raw.success, hasDataStudent, hasRootStudent, hasFlatCols });

  if (!raw.success) return raw;

  // Shape A: properly nested under `data` key with a `student` object
  if (raw.data && typeof raw.data === 'object' && 'student' in raw.data) {
    const d = raw.data;
    const studentRaw = d.student as unknown as Record<string, unknown>;

    // Shape A-extended: sessions live inside student.progress[courseKey].sessions (keyed object)
    if (studentRaw?.progress && typeof studentRaw.progress === 'object') {
      return normalizeProgressObject(studentRaw, email, regId);
    }

    return {
      success: true,
      data: {
        ...d,
        sessions: (d.sessions ?? []).map(s => normalizeSession(s as unknown as Record<string, unknown>)),
      },
    };
  }

  // Shape B: flat root with a `student` object
  if (root.student && typeof root.student === 'object') {
    const studentRaw = root.student as unknown as Record<string, unknown>;

    // Shape B-extended: sessions nested inside student.progress[courseKey].sessions (keyed object)
    if (studentRaw.progress && typeof studentRaw.progress === 'object') {
      return normalizeProgressObject(studentRaw, email, regId);
    }

    const rawSessions = Array.isArray(root.sessions) ? root.sessions as Record<string, unknown>[] : [];
    return {
      success: true,
      data: {
        student:           root.student as SheetStudent,
        sessions:          rawSessions.map(normalizeSession),
        finalPassed:       Boolean(root.finalPassed),
        certificateIssued: Boolean(root.certificateIssued),
      },
    };
  }

  // Shape C: flat sheet columns — S1%, S2%, …, Final Exam %  (or L1%, L2%, …)
  if (typeof root['S1%'] !== 'undefined' || typeof root['L1%'] !== 'undefined' || typeof root['Final Exam %'] !== 'undefined') {
    return normalizeFlatSheetProgress(root, email, regId);
  }

  return raw;
}

/** Trigger a re-send of the registration ID email. */
export async function resendRegistrationId(
  email: string,
): Promise<ScriptResponse<null>> {
  return callScript<null>({ action: 'resendId', email });
}

/** Fetch all certificates issued to a given email address. */
export async function getCertificatesByEmail(
  email: string,
): Promise<ScriptResponse<SheetCertificate[]>> {
  return callScript<SheetCertificate[]>({ action: 'getCertificates', email });
}

/** Fetch a single certificate by Registration ID + course (public lookup). */
export async function getCertificateByRegId(
  regId: string,
  course: string,
): Promise<ScriptResponse<SheetCertificate>> {
  return callScript<SheetCertificate>({ action: 'getCertificateByRegId', regId, course });
}

/** Register a new student for a course. */
export async function registerStudent(
  name: string,
  email: string,
  course: string,
): Promise<ScriptResponse<SheetStudent>> {
  return callScriptPost<SheetStudent>({ action: 'register', name, email, course });
}

// ── Course Details (Form Registry) ───────────────────────────────────────────

export interface CourseSession {
  tabKey: string;
  course: string;
  num: number;
  sessionName: string;
  description?: string;
  isFinal: boolean;
  formId: string;
  formUrl: string;
  youtubeUrl: string;
  hasForm: boolean;
  hasVideo: boolean;
  videoDuration?: number;
}

/** Fetch session details (YouTube URLs etc.) from the Apps Script Form Registry. */
export async function getCourseDetails(course?: string): Promise<CourseSession[]> {
  const params: Record<string, string> = { action: 'getCourseDetails' };
  if (course) params.course = course;
  try {
    // Apps Script returns { success: true, sessions: [...] } at root level
    const raw = await callScript<unknown>(params);
    const res = raw as unknown as { success: boolean; sessions?: Partial<CourseSession>[] };
    if (!res.success) return [];
    const sessions = Array.isArray(res.sessions) ? res.sessions : [];
    // V8 Apps Script no longer exposes form columns — normalize absent fields to safe defaults
    // so that callers don't need to guard against undefined
    return sessions.map(s => ({
      tabKey:        s.tabKey        ?? '',
      course:        s.course        ?? '',
      num:           s.num           ?? 0,
      sessionName:   s.sessionName   ?? '',
      description:   s.description   ?? '',
      isFinal:       s.isFinal       ?? false,
      formId:        s.formId        ?? '',
      formUrl:       s.formUrl       ?? '',
      youtubeUrl:    s.youtubeUrl    ?? '',
      hasForm:       s.hasForm       ?? false,
      hasVideo:      s.hasVideo      ?? false,
      videoDuration: s.videoDuration,
    }));
  } catch {
    return [];
  }
}

/** Save a YouTube URL (and optional video duration) to the Apps Script Form Registry for a given tab key. */
export async function updateCourseLink(tabKey: string, youtubeUrl: string, videoDuration?: number): Promise<boolean> {
  try {
    const payload: Record<string, string> = { action: 'updateCourseLink', tabKey, youtubeUrl };
    if (videoDuration !== undefined) payload.videoDuration = String(videoDuration);
    const raw = await callScriptPost<unknown>(payload);
    return raw.success === true;
  } catch {
    return false;
  }
}

// ── Admin bulk APIs (require Apps Script to implement these actions) ───────────

export interface StudentSummary {
  registrationId: string;
  name: string;
  email: string;
  course: string;
  registeredAt: string;
  sessionsPassedCount?: number;
  totalSessions?: number;
  finalPassed?: boolean;
  finalExamStatus?: string;   // 'not_started' | 'attempted' | 'passed' | 'locked'
  finalScore?: number;
  certificateIssued?: boolean;
}

// Apps Script listStudents response uses different field names
interface RawStudentEntry {
  registrationId?: string;
  fullName?: string;
  name?: string;
  email?: string;
  enrolledCourses?: string[];
  course?: string;
  enrolledDate?: string;
  registeredAt?: string;
  progress?: {
    sessionsPassed?: number;
    totalSessions?: number;
    finalExam?: { status?: string; score?: number };
    certificateStatus?: string;
  };
  sessionsPassedCount?: number;
  totalSessions?: number;
  finalPassed?: boolean;
  certificateIssued?: boolean;
}

function normalizeCourse(raw: string): string {
  const up = (raw ?? '').toUpperCase().trim();
  if (up === '3SFM') return '3SFM';
  if (up === 'BVM')  return 'BVM';
  return up;
}

function mapRawStudent(r: RawStudentEntry): StudentSummary {
  const courseRaw = r.course ?? (Array.isArray(r.enrolledCourses) ? r.enrolledCourses[0] : '') ?? '';
  const prog = r.progress;

  let sessionsPassedCount: number | undefined;
  let totalSessions: number | undefined;
  let finalExamStatus: string | undefined;
  let certificateIssued: boolean = r.certificateIssued ?? false;

  if (prog) {
    const p = prog as unknown as Record<string, unknown>;

    // Detect format: flat if progress has numeric sessionsPassed/totalSessions at root;
    // per-course keyed if values are objects (e.g. { "3sfm": { sessions, sessionsPassed, … } })
    const hasFlat = typeof p.sessionsPassed === 'number' || typeof p.totalSessions === 'number';

    if (hasFlat) {
      // Flat format: progress.sessionsPassed / totalSessions / finalExam at root
      sessionsPassedCount = typeof p.sessionsPassed === 'number' ? (p.sessionsPassed as number) : undefined;
      totalSessions       = typeof p.totalSessions  === 'number' ? (p.totalSessions  as number) : undefined;
      finalExamStatus     = (p.finalExam as { status?: string } | undefined)?.status;
      if (p.certificateStatus === 'earned') certificateIssued = true;
    } else {
      // Per-course keyed format: { "3sfm": { sessionsPassed?, totalSessions?, sessions?, finalExam? }, … }
      type CourseEntry = {
        sessionsPassed?: number; totalSessions?: number;
        sessions?: Record<string, { status?: string }>;
        finalExam?: { status?: string }; certificateStatus?: string;
      };
      const entries = (Object.values(p) as unknown[])
        .filter((e): e is CourseEntry => typeof e === 'object' && e !== null);

      if (entries.length > 0) {
        let sp = 0, ts = 0;
        for (const cp of entries) {
          // Count passed sessions: prefer explicit count, fall back to counting from keyed sessions object
          if (typeof cp.sessionsPassed === 'number') {
            sp += cp.sessionsPassed;
          } else if (cp.sessions && typeof cp.sessions === 'object') {
            sp += Object.values(cp.sessions).filter(s => s.status === 'passed').length;
          }
          // Count total sessions: prefer explicit count, fall back to key count
          if (typeof cp.totalSessions === 'number') {
            ts += cp.totalSessions;
          } else if (cp.sessions && typeof cp.sessions === 'object') {
            ts += Object.keys(cp.sessions).length;
          }
          // Final exam status: 'passed' wins across courses
          if (cp.finalExam?.status === 'passed') {
            finalExamStatus = 'passed';
          } else if (!finalExamStatus && cp.finalExam?.status) {
            finalExamStatus = cp.finalExam.status;
          }
          if (cp.certificateStatus === 'earned') certificateIssued = true;
        }
        sessionsPassedCount = sp;
        totalSessions       = ts;
      }
    }
  } else {
    // No progress object on the record — use top-level flat fields
    sessionsPassedCount = r.sessionsPassedCount;
    totalSessions       = r.totalSessions;
  }

  return {
    registrationId:     r.registrationId ?? '',
    name:               r.fullName ?? r.name ?? '',
    email:              r.email ?? '',
    course:             normalizeCourse(courseRaw),
    registeredAt:       r.enrolledDate ?? r.registeredAt ?? '',
    sessionsPassedCount,
    totalSessions,
    finalPassed:        finalExamStatus === 'passed',
    finalExamStatus,
    certificateIssued,
  };
}

/** [Admin] List all enrolled students. Requires Apps Script action: 'listStudents'. */
export async function listAllStudents(): Promise<ScriptResponse<StudentSummary[]>> {
  const raw = await callScript<StudentSummary[]>({ action: 'listStudents' });

  if (!raw.success) return raw;

  // Shape A: already normalised under `data` key
  if (Array.isArray(raw.data)) {
    return { success: true, data: raw.data.map(mapRawStudent) };
  }

  // Shape B: Apps Script returns { success: true, students: [...] } at root level
  const root = raw as unknown as { success: boolean; students?: RawStudentEntry[] };
  if (Array.isArray(root.students)) {
    return { success: true, data: root.students.map(mapRawStudent) };
  }

  return { success: true, data: [] };
}

/** [Admin] List all issued certificates. Requires Apps Script action: 'listCertificates'. */
export async function listAllCertificates(): Promise<ScriptResponse<SheetCertificate[]>> {
  const raw = await callScript<SheetCertificate[]>({ action: 'listCertificates' });
  if (!raw.success) return raw;
  if (Array.isArray(raw.data)) return raw;
  // Apps Script may return { success: true, certificates: [...] } at root level
  const root = raw as unknown as { certificates?: SheetCertificate[] };
  if (Array.isArray(root.certificates)) return { success: true, data: root.certificates };
  return { success: true, data: [] };
}

// ── Certificate Lookup (by Registration ID or all) ───────────────────────────

export interface CertRow {
  certifierUuid: string;
  registrationId: string;
  fullName: string;
  email: string;
  course: string;
  completionDate: string;
  finalExamScore: string;
  avgSessionScore: string;
  certStatus: string;
  certificateUrl: string;
  issuedDate: string;
}

function mapRawCertRow(raw: Record<string, unknown>): CertRow {
  return {
    certifierUuid:   String(raw.certifierUuid   ?? raw.certifier_uuid   ?? ''),
    registrationId:  String(raw.registrationId  ?? raw.registration_id  ?? ''),
    fullName:        String(raw.fullName         ?? raw.full_name        ?? ''),
    email:           String(raw.email            ?? ''),
    course:          String(raw.course           ?? ''),
    completionDate:  String(raw.completionDate   ?? raw.completion_date  ?? ''),
    finalExamScore:  String(raw.finalExamScore   ?? raw.final_exam_score ?? ''),
    avgSessionScore: String(raw.avgSessionScore  ?? raw.avg_session_score ?? ''),
    certStatus:      String(raw.certStatus       ?? raw.cert_status      ?? ''),
    certificateUrl:  String(raw.certificateUrl   ?? raw.certificate_url  ?? ''),
    issuedDate:      String(raw.issuedDate       ?? raw.issued_date      ?? ''),
  };
}

/** Fetch certificates for a specific registration ID. */
export async function getCertificatesByRegistrationId(
  registrationId: string,
): Promise<{ success: boolean; data?: CertRow[] }> {
  const raw = await callScript<unknown>({ action: 'getCertificates', registrationId });
  if (!raw.success) return { success: false };
  if (Array.isArray(raw.data)) {
    return { success: true, data: (raw.data as Record<string, unknown>[]).map(mapRawCertRow) };
  }
  // Apps Script may return { success: true, certificates: [...] } at root level
  const root = raw as unknown as { certificates?: Record<string, unknown>[] };
  if (Array.isArray(root.certificates)) {
    return { success: true, data: root.certificates.map(mapRawCertRow) };
  }
  return { success: true, data: [] };
}

/** Fetch all certificates (no filter). */
export async function getAllCertificates(): Promise<{ success: boolean; data?: CertRow[] }> {
  const raw = await callScript<unknown>({ action: 'getCertificates' });
  if (!raw.success) return { success: false };
  if (Array.isArray(raw.data)) {
    return { success: true, data: (raw.data as Record<string, unknown>[]).map(mapRawCertRow) };
  }
  const root = raw as unknown as { certificates?: Record<string, unknown>[] };
  if (Array.isArray(root.certificates)) {
    return { success: true, data: root.certificates.map(mapRawCertRow) };
  }
  return { success: true, data: [] };
}

// ── Assessment Engine ─────────────────────────────────────────────────────────

export interface AssessmentQuestion {
  questionId:    string;
  q:             string;
  options:       string[];
  correctIndex?: number;   // 0-based index of correct answer — used for local scoring (V8 architecture)
  correctAnswer?: number;  // Apps Script may use this field name instead of correctIndex
  explanation?:  string;   // Explanation text shown in question review after submission
  points?:       number;
}

export interface AssessmentQuestionsData {
  tabKey: string;
  sessionName: string;
  course: string;
  isFinal: boolean;
  questions: AssessmentQuestion[];
  timeLimit?: number;       // minutes; 0 or absent = no limit
  passingScore?: number;    // percentage, e.g. 70
  maxAttempts?: number;
}

export interface AttemptStatus {
  tabKey: string;
  attempts: number;
  maxAttempts: number;
  passed: boolean;
  lastScore?: number;
  lastCompletedAt?: string;
  canAttempt: boolean;
}

export interface QuestionResult {
  index: number;
  q: string;
  type?: string;
  options: string[];
  submitted: number;       // 0-based index of the student's chosen option
  submittedText: string;   // full text of the student's chosen option
  correct: number;         // 0-based index of the correct option
  correctText: string;     // full text of the correct option
  isCorrect: boolean;      // true if student chose the correct option
  explanation: string;
}

export interface SubmitAssessmentResult {
  tabKey: string;
  score: number;          // percentage 0–100
  passed: boolean;
  correctCount: number;
  totalQuestions: number;
  attempts: number;
  maxAttempts: number;
  canRetry: boolean;
  feedback?: string;
  results?: QuestionResult[];
}

/** Fetch questions for a given tab key. */
export async function getAssessmentQuestions(
  tabKey: string,
  email: string,
  regId: string,
  shuffle?: boolean,
): Promise<ScriptResponse<AssessmentQuestionsData>> {
  const params: Record<string, string> = { action: 'getQuestions', tabKey, email, regId };
  if (shuffle === false) params.shuffle = 'false';
  return callScript<AssessmentQuestionsData>(params);
}

/** Check attempt status (attempts used, passed, can attempt). */
export async function getAttemptStatus(
  tabKey: string,
  email: string,
  regId: string,
): Promise<ScriptResponse<AttemptStatus>> {
  return callScript<AttemptStatus>({ action: 'getAttemptStatus', tabKey, email, regId });
}

/** Submit answers for scoring. answers = array of 0-based selected option indices. */
export async function submitAssessment(
  tabKey: string,
  email: string,
  regId: string,
  answers: number[],
): Promise<ScriptResponse<SubmitAssessmentResult>> {
  return callScriptPostJson<SubmitAssessmentResult>({
    action: 'submitAssessment',
    tabKey,
    email,
    regId,
    answers,
  });
}

export interface SubmitAssessmentScoredParams {
  tabKey:    string;
  regId:     string;
  email:     string;
  score:     number;   // percentage 0–100
  passed:    boolean;
  isFinal:   boolean;
  attemptNo: number;
}

/**
 * V8 architecture: website scores answers locally, then sends the scored summary
 * to Apps Script for storage. Apps Script no longer performs its own scoring.
 */
export async function submitAssessmentToAppsScript(
  params: SubmitAssessmentScoredParams,
): Promise<ScriptResponse<{ recorded: boolean }>> {
  return callScriptPostJson<{ recorded: boolean }>({
    action: 'submitAssessment',
    ...params,
  });
}

// ── Internal Certificate System ───────────────────────────────────────────────

/**
 * Raw shape returned by Apps Script V8 `getPendingCertificates` action.
 * Field names differ from our internal `PendingCertificate` type — see mapRawPendingCert().
 */
interface AppsScriptRawPendingCert {
  registrationId:    string;
  email:             string;
  // Student name — V8 uses `fullName`, legacy may use `studentName`
  fullName?:         string;
  studentName?:      string;
  // Course identifier — V8 uses `course`, legacy uses `courseCode`
  course?:           string;
  courseCode?:       string;
  courseName?:       string;
  courseSubheading?: string;
  courseDescription?: string;
  // Scores — V8 uses `finalExamScore` / `avgSessionScore`, legacy uses `finalScore` / `avgScore`
  finalExamScore?:   number;
  finalScore?:       number;
  avgSessionScore?:  number;
  avgScore?:         number;
  grade?:            string;
  completionDate?:   string;
  // Optional fields present if certificate was partially issued
  certificateId?:    string;
  issueDate?:        string;
  verificationUrl?:  string;
  qrCodeUrl?:        string;
}

export interface PendingCertificate {
  registrationId:    string;
  email:             string;
  studentName:       string;
  courseName:        string;
  courseCode:        string;        // '3SFM' | 'BVM'
  courseSubheading:  string;
  courseDescription: string;
  finalScore:        number;
  avgScore:          number;
  grade:             string;        // 'Distinction' | 'Merit' | 'Pass'
  completionDate:    string;
  // Optional — populated after partial issuance
  certificateId?:    string;
  issueDate?:        string;
  verificationUrl?:  string;
  qrCodeUrl?:        string;
}

function mapRawPendingCert(raw: AppsScriptRawPendingCert): PendingCertificate {
  const courseRaw = raw.courseCode ?? raw.course ?? '';
  return {
    registrationId:    raw.registrationId   ?? '',
    email:             raw.email            ?? '',
    studentName:       raw.fullName         ?? raw.studentName      ?? '',
    courseName:        raw.courseName       ?? raw.course           ?? courseRaw,
    courseCode:        courseRaw.toUpperCase(),
    courseSubheading:  raw.courseSubheading  ?? '',
    courseDescription: raw.courseDescription ?? '',
    finalScore:        raw.finalExamScore   ?? raw.finalScore       ?? 0,
    avgScore:          raw.avgSessionScore  ?? raw.avgScore         ?? 0,
    grade:             raw.grade            ?? '',
    completionDate:    raw.completionDate   ?? '',
    certificateId:     raw.certificateId,
    issueDate:         raw.issueDate,
    verificationUrl:   raw.verificationUrl,
    qrCodeUrl:         raw.qrCodeUrl,
  };
}

/** Fetch pending certificates from Apps Script Certificate Queue sheet. */
export async function getPendingCertificates(): Promise<PendingCertificate[]> {
  // ── Debug: env var + resolved URL ──────────────────────────────────────────
  const envUrl      = process.env.APPS_SCRIPT_URL;
  const resolvedUrl = await getAppsScriptUrl();
  console.log('[getPendingCertificates] APPS_SCRIPT_URL env var set?', !!envUrl);
  console.log('[getPendingCertificates] resolved Apps Script URL:', resolvedUrl || '(empty — not configured)');

  if (resolvedUrl) {
    const debugUrl = new URL(resolvedUrl);
    debugUrl.searchParams.set('action', 'getPendingCertificates');
    console.log('[getPendingCertificates] fetching URL:', debugUrl.toString());
  } else {
    console.log('[getPendingCertificates] fetching URL: SKIPPED — no URL configured');
  }
  // ───────────────────────────────────────────────────────────────────────────

  const raw = await callScript<AppsScriptRawPendingCert[]>({ action: 'getPendingCertificates' });
  console.log('[getPendingCertificates] Apps Script response:', JSON.stringify(raw, null, 2));
  if (!raw.success) return [];
  if (Array.isArray(raw.data)) return raw.data.map(mapRawPendingCert);
  const root = raw as unknown as { certificates?: AppsScriptRawPendingCert[]; pending?: AppsScriptRawPendingCert[] };
  if (Array.isArray(root.certificates)) return root.certificates.map(mapRawPendingCert);
  if (Array.isArray(root.pending)) return root.pending.map(mapRawPendingCert);
  return [];
}

/** Write issued certificate URLs back to the Apps Script Certificate Queue. */
export async function updateCertificateUrls(params: {
  certificateId: string;
  certPdfUrl:    string;
  badgeUrl:      string;
  transcriptUrl: string;
  status:        'Issued';
}): Promise<void> {
  await callScriptPostJson<unknown>({ action: 'updateCertificateUrls', ...params });
}

/** Fetch a single certificate by its internal certificate ID (e.g. FMP-3SFM-2026-0001). */
export async function getCertificateById(certificateId: string): Promise<{
  certificateId: string;
  studentName: string;
  email: string;
  courseName: string;
  courseSubheading: string;
  courseDescription: string;
  courseCode: string;
  grade: string;
  finalScore: number;
  issuedAt: string;
  certPdfUrl: string;
  badgeUrl: string;
  transcriptUrl: string;
} | null> {
  const raw = await callScript<unknown>({ action: 'getCertificateById', certificateId });
  if (!raw.success || !raw.data) return null;
  return raw.data as ReturnType<typeof getCertificateById> extends Promise<infer T> ? NonNullable<T> : never;
}
