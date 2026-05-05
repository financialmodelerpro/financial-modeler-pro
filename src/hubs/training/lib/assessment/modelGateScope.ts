/**
 * Helpers that scope the model-submission gate to Final Exams.
 *
 * Why this lives separately: the gate must fire only on a course's Final
 * Exam, never on per-session quizzes. These two helpers are the single
 * place where that scoping is decided, so server routes (questions /
 * submit-assessment) and any future caller share one definition and one
 * test.
 */

import { COURSES } from '@/src/hubs/training/config/courses';

/**
 * Resolve isFinal for a tabKey using the static COURSES config.
 *
 * tabKey shape is "<shortTitle>_<sessionId>". sessionId is either the
 * literal "Final" (Apps Script convention) or the session id (S1..S18 /
 * L1..L7). Anything that doesn't resolve to a known final session is a
 * regular session quiz, that's the conservative default.
 */
export function resolveIsFinal(tabKey: string): boolean {
  if (!tabKey) return false;
  const sep = tabKey.indexOf('_');
  if (sep === -1) return false;
  const shortCode = tabKey.slice(0, sep).toUpperCase();
  const sessionId = tabKey.slice(sep + 1);
  const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === shortCode);
  if (!course) return false;
  if (sessionId === 'Final') return true;
  return course.sessions.find(s => s.id === sessionId)?.isFinal === true;
}

/**
 * Detect Apps Script errors that look like the model-submission gate
 * fired. Used to override the misleading message for non-Final sessions
 * so a Session 2 student isn't told to "first upload a model".
 */
export function looksLikeModelGateError(err: string): boolean {
  if (!err) return false;
  const lower = err.toLowerCase();
  return lower.includes('model') && (
    lower.includes('upload') ||
    lower.includes('submit') ||
    lower.includes('approve')
  );
}
