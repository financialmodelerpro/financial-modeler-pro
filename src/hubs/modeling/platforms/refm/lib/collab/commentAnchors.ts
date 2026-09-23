/**
 * commentAnchors.ts (2026-09-23)
 *
 * WHICH COMMENTS BELONG TO THIS FIELD, AND TO THIS TAB. Pure, so a verifier
 * runs the real rule rather than a restatement of it.
 *
 * ONE RULE PER QUESTION, and the questions are genuinely different:
 *
 *   openThreadsForPath   the threads anchored to exactly this field
 *   countsByScreen       how many open threads each TAB carries, so a tab can
 *                        say so before anyone opens it
 *   unplaceable          comments whose anchor the map cannot place
 *
 * THE MAP IS THE EVIDENCE, AND SILENCE IS AN ANSWER. A comment whose path the
 * map cannot place is NOT filed against a screen on a guess: it is counted as
 * unplaceable and still appears in the Collaborate tab, which is the whole
 * picture. Filing it somewhere plausible would put a remark on a tab it is not
 * about, and the reader would have no way to tell.
 *
 * OPEN means a ROOT comment, not deleted, not resolved. A reply is part of a
 * thread, not a thread of its own, and a resolved thread is done. This is the
 * same definition the Collaborate overview already counts with, stated here
 * once so the two cannot drift.
 *
 * No em dashes in this file.
 */
import type { ProjectCommentDTO } from '../persistence/types';
import { screenForPath, pathShape, isScreenAnchor } from './pathScreen';

export interface AnchoredThread {
  root: ProjectCommentDTO;
  replies: ProjectCommentDTO[];
}

/** A root, still live, still open. The ONE definition of "open thread". */
export const isOpenRoot = (c: ProjectCommentDTO): boolean =>
  c.parentId === null && !c.deleted && c.resolvedAt === null;

/** A root that is live, open or not: resolved threads are still readable. */
export const isLiveRoot = (c: ProjectCommentDTO): boolean =>
  c.parentId === null && !c.deleted;

/** Replies of a root, oldest first, as the panels render them. */
export const repliesOf = (all: readonly ProjectCommentDTO[], rootId: string): ProjectCommentDTO[] =>
  all.filter((c) => c.parentId === rootId);

/**
 * TWO ANCHORS MATCH WHEN THEY NAME THE SAME THING.
 *
 * For a field that means the same SHAPE and the same ids: two rows of one
 * array are different fields, so `assets[id=a].buaSqm` and
 * `assets[id=b].buaSqm` must not share a thread. The raw string is therefore
 * compared, with only whitespace normalised. (`pathShape` is used for the
 * SCREEN lookup, where the row does not matter, and nowhere else here.)
 */
export const sameAnchor = (a: string | null | undefined, b: string | null | undefined): boolean =>
  typeof a === 'string' && typeof b === 'string' && a.trim() === b.trim();

/** Open threads anchored to exactly this field (or this tab). */
export function openThreadsForPath(
  all: readonly ProjectCommentDTO[],
  path: string | null | undefined,
): AnchoredThread[] {
  if (!path) return [];
  return all
    .filter((c) => isOpenRoot(c) && sameAnchor(c.path, path))
    .map((root) => ({ root, replies: repliesOf(all, root.id) }));
}

/** Every live thread on this anchor, resolved ones included. */
export function threadsForPath(
  all: readonly ProjectCommentDTO[],
  path: string | null | undefined,
): AnchoredThread[] {
  if (!path) return [];
  return all
    .filter((c) => isLiveRoot(c) && sameAnchor(c.path, path))
    .map((root) => ({ root, replies: repliesOf(all, root.id) }));
}

export interface ScreenCounts {
  /** tab key -> number of OPEN threads filed to that tab. */
  byScreen: Map<string, number>;
  /** Open threads with no path at all: the project-wide ones. */
  projectWide: number;
  /**
   * Open threads carrying a path the map cannot place. NOT distributed to a
   * screen on a guess, and reported so the number is visible rather than
   * quietly missing from every tab's count.
   */
  unplaceable: number;
}

/**
 * How many open threads each tab carries.
 *
 * A comment on a field with TWO HOMES counts on BOTH, deliberately: the map
 * says the field is edited on either tab, so an editor arriving at either one
 * must be told. Counting it once, on a tab chosen by this function, would hide
 * it from the other half of the people who could act on it.
 */
export function countsByScreen(all: readonly ProjectCommentDTO[]): ScreenCounts {
  const byScreen = new Map<string, number>();
  let projectWide = 0;
  let unplaceable = 0;
  for (const c of all) {
    if (!isOpenRoot(c)) continue;
    if (!c.path) { projectWide++; continue; }
    const found = screenForPath(c.path);
    if (!found || found.screens.length === 0) { unplaceable++; continue; }
    for (const s of found.screens) byScreen.set(s.key, (byScreen.get(s.key) ?? 0) + 1);
  }
  return { byScreen, projectWide, unplaceable };
}

/** Open threads filed to one tab, for that tab's own banner. */
export function openThreadsForScreen(
  all: readonly ProjectCommentDTO[],
  tabKey: string,
): AnchoredThread[] {
  return all
    .filter((c) => {
      if (!isOpenRoot(c) || !c.path) return false;
      const found = screenForPath(c.path);
      return !!found && found.screens.some((s) => s.key === tabKey);
    })
    .map((root) => ({ root, replies: repliesOf(all, root.id) }));
}

/* ─────────────────────────── what is for you ────────────────────────────── */

/**
 * THERE IS NO NOTIFICATION LAYER ON THIS PLATFORM, AND THIS DOES NOT INVENT
 * ONE (2026-09-23).
 *
 * No email is sent for a comment, nothing is pushed, and no per-item unread
 * state is stored. Building any of that would mean a delivery mechanism, a
 * preference for it, an unsubscribe and a dedupe log, and the honest position
 * is that none of it exists rather than a half version that silently drops
 * messages.
 *
 * What DOES exist is the last-seen stamp per person per project (migration
 * 246), which already drives the unread marker. So the smallest honest
 * mechanism is to answer, from data the screen has already loaded, the
 * question a person actually has when they open the project:
 *
 *     "what happened to MY comments since I last looked?"
 *
 * Two things count, and both are things someone else did to your words:
 *   - somebody REPLIED to a thread you started;
 *   - somebody RESOLVED a thread you started.
 *
 * A reply you wrote yourself is not news, and neither is resolving your own
 * thread. MENTIONS ARE NOT INCLUDED because there is no way to write one: the
 * composer has no mention syntax and there is no directory behind it, so a
 * mention filter would match nothing and imply a feature that is absent.
 */
export interface ForYouItem {
  thread: AnchoredThread;
  /** What happened, in the order a person cares: a reply, or a resolution. */
  kind: 'reply' | 'resolved';
  /** When it happened, so the caller can compare against last-seen. */
  at: string;
  /** Who did it, when the row records a name. */
  byName: string | null;
}

export function forYou(
  all: readonly ProjectCommentDTO[],
  viewerId: string,
  since: string | null,
): ForYouItem[] {
  if (!viewerId) return [];
  const newer = (ts: string | null | undefined): boolean =>
    !!ts && (since === null || new Date(ts).getTime() > new Date(since).getTime());

  const out: ForYouItem[] = [];
  for (const root of all) {
    if (!isLiveRoot(root) || root.userId !== viewerId) continue;
    const replies = repliesOf(all, root.id);
    const thread = { root, replies };

    for (const r of replies) {
      if (r.deleted || r.userId === viewerId) continue;
      if (newer(r.createdAt)) {
        out.push({ thread, kind: 'reply', at: r.createdAt, byName: r.userName ?? null });
      }
    }
    // A resolution by someone else. `resolvedBy` is the actor the server
    // records; a thread you resolved yourself is not news.
    if (root.resolvedAt && root.resolvedBy !== viewerId && newer(root.resolvedAt)) {
      out.push({ thread, kind: 'resolved', at: root.resolvedAt, byName: root.resolvedByName ?? null });
    }
  }
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/**
 * A one-line description of what a comment is anchored to, for a list that
 * mixes field comments, tab comments and project-wide ones.
 */
export function anchorLabel(path: string | null | undefined): string {
  if (!path) return 'On the project';
  const found = screenForPath(path);
  if (isScreenAnchor(path)) return found ? found.sentence : 'On a tab that no longer exists';
  // A field: name the shape, which is readable, rather than the raw path with
  // its ids. The exact path is still shown beside it by the panels.
  const shape = pathShape(path);
  return found && !found.unmapped ? `${shape} (${found.sentence.toLowerCase()})` : shape;
}
