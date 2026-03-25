/**
 * sheets.ts — Server-side only. Never import this from client components.
 * All functions proxy to the Google Apps Script Web App via APPS_SCRIPT_URL.
 *
 * URL resolution order:
 *   1. APPS_SCRIPT_URL env var (fast, no DB round-trip)
 *   2. training_settings.apps_script_url row in Supabase
 */

import { getServerClient } from '@/src/lib/supabase';

async function getAppsScriptUrl(): Promise<string> {
  if (process.env.APPS_SCRIPT_URL) return process.env.APPS_SCRIPT_URL;
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('value')
      .eq('key', 'apps_script_url')
      .single();
    return data?.value ?? '';
  } catch {
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
  const APPS_SCRIPT_URL = await getAppsScriptUrl();
  if (!APPS_SCRIPT_URL) {
    return { success: false, error: 'APPS_SCRIPT_URL not configured' };
  }
  try {
    const url = new URL(APPS_SCRIPT_URL);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
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

/** Fetch a student's full session progress. */
export async function getStudentProgress(
  email: string,
  regId: string,
): Promise<ScriptResponse<StudentProgress>> {
  return callScript<StudentProgress>({ action: 'getProgress', email, regId });
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
