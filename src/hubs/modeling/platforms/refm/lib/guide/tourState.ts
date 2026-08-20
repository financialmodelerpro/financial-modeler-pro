/**
 * tourState.ts (2026-08-20, client)
 *
 * Per-user guided-tour state: has it run, where it paused, is it done.
 *
 * THE SERVER IS THE RECORD, localStorage is the fallback. Completion must be
 * per USER (the requirement), and localStorage is per browser: a user on a
 * second machine would get the tour again. So the state lives on the users
 * row (mig 217, one jsonb column) behind /api/refm/tour-state, and only when
 * that reports unavailable (migration not applied yet, or the fetch fails)
 * does the browser-local copy stand in, so the tour still behaves sensibly
 * rather than re-running on every load.
 *
 * Writes are fire-and-forget: losing a resume position is an annoyance,
 * blocking the UI on it would be worse.
 *
 * No em dashes in this file.
 */

export interface TourState {
  startedAt?: string;
  /** Resume position: the step index the user was on. */
  step?: number;
  completedAt?: string;
  /** Which shape finished: 'module' (the short walk taken with no project
   *  open) or the full walk. Auto-run stops after either; the guide restart
   *  button never consults completion at all, which is what keeps the full
   *  tour reachable after a module-only run. */
  completedMode?: 'module' | 'full';
  /** When the first-run "read the guide" prompt was dismissed. One click,
   *  permanent: set by BOTH of its actions, so it shows exactly once. */
  guidePromptAt?: string;
  skippedAt?: string;
}

const LS_KEY = 'refm-tour-state';

// The last state this session has seen, so saves can MERGE. Two features
// share the blob (the tour and the first-run guide prompt); an overwrite by
// one would silently erase the other, which is how a dismissed prompt would
// come back the day the tour saved its step.
let lastKnown: TourState | null = null;

function readLocal(): TourState | null {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) as TourState : null;
  } catch { return null; }
}

function writeLocal(s: TourState): void {
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* full or blocked */ }
}

/** Should the tour auto-run for this state? Never-run means yes. */
export function tourShouldAutoRun(s: TourState | null): boolean {
  if (!s) return true;
  return !s.completedAt && !s.skippedAt;
}

/**
 * Load the state, server first.
 *
 * Returns null only for a genuinely fresh user. A failed server read falls
 * back to the local copy INCLUDING when that copy is null, because "the
 * server is down and this browser has never seen the tour" should still
 * auto-run: that is the fresh-user experience, not an error state.
 */
export async function loadTourState(): Promise<TourState | null> {
  try {
    const res = await fetch('/api/refm/tour-state', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json() as { available?: boolean; state?: TourState | null };
      if (data.available) { lastKnown = data.state ?? null; return lastKnown; }
    }
  } catch { /* fall through to local */ }
  lastKnown = readLocal();
  return lastKnown;
}

/**
 * Persist the state. Written to BOTH stores: the server so it follows the
 * user, and localStorage so the fallback read above stays coherent on this
 * browser even if the server write was the one that failed.
 */
export function saveTourState(s: TourState): void {
  const merged: TourState = { ...(lastKnown ?? {}), ...s };
  lastKnown = merged;
  writeLocal(merged);
  void fetch('/api/refm/tour-state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: merged }),
  }).catch(() => { /* fire and forget */ });
}
