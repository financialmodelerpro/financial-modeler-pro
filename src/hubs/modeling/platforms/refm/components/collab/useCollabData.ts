'use client';

/**
 * useCollabData.ts
 *
 * THE fetch discipline for the Activity and Comments panels, shared by the
 * Version modal tabs and the Module 10 Collaborate screen so the two doors
 * cannot drift on the semantics the modal was careful about:
 *
 *   - ONE piece of state, KEYED BY PROJECT, rather than a rows / available /
 *     loading trio. A separate loading flag has to be set synchronously in
 *     the effect body, which causes a cascading render; and three
 *     independent flags can disagree, which is how a previous project's log
 *     ends up on screen under a new project's heading. Loading is DERIVED:
 *     the answer we hold is either for this project or it is not.
 *   - `available: false` means the DATABASE has no table for this yet
 *     (pre-234 / pre-236). It is deliberately distinct from an EMPTY result,
 *     which is a real answer meaning nothing has been recorded or said, and
 *     must never read as "unavailable".
 *   - Loaded lazily, when `active` is true (a tab opened, a screen shown),
 *     and RE-READ each activation rather than cached: a record someone else
 *     is adding to must be current the second time it is looked at.
 *
 * No em dashes in this file.
 */
import { useEffect, useState, useCallback } from 'react';
import * as pclient from '../../lib/persistence/client';
import type { ProjectChangeDTO, ProjectCommentDTO } from '../../lib/persistence/types';

export interface ProjectChangesData {
  rows: ProjectChangeDTO[];
  available: boolean | undefined;
  /** True once the state held answers for THIS project. Loading is derived. */
  ready: boolean;
  error: string | null;
}

export function useProjectChanges(projectId: string | null, active: boolean): ProjectChangesData {
  const [state, setState] = useState<{ key: string; rows: ProjectChangeDTO[]; available: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !projectId) return;
    let cancelled = false;
    void (async () => {
      const res = await pclient.listChanges(projectId);
      if (cancelled) return;
      if (res.error) setError(res.error);
      // Stamped with the project it answers for, so a slow response that lands
      // after the user has switched projects is ignored rather than rendered
      // under the wrong name.
      setState({
        key: projectId,
        rows: res.data?.changes ?? [],
        available: res.data?.available ?? false,
      });
    })();
    return () => { cancelled = true; };
  }, [active, projectId]);

  const ready = state !== null && state.key === projectId;
  return {
    rows: ready ? state.rows : [],
    available: ready ? state.available : undefined,
    ready,
    error,
  };
}

export interface ProjectCommentsData {
  rows: ProjectCommentDTO[];
  available: boolean | undefined;
  viewerId: string;
  ready: boolean;
  error: string | null;
  /** Re-read after any write. The server is the source: a locally patched row
   *  would drift from what everyone else sees, and the whole point of these
   *  panels is that several people are looking at them. */
  refresh: () => Promise<void>;
}

export function useProjectComments(projectId: string | null, active: boolean): ProjectCommentsData {
  const [state, setState] = useState<
    { key: string; rows: ProjectCommentDTO[]; available: boolean; viewerId: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cancelledRef?: { current: boolean }): Promise<void> => {
    if (!projectId) return;
    const res = await pclient.listComments(projectId);
    if (cancelledRef?.current) return;
    if (res.error) setError(res.error);
    setState({
      key: projectId,
      rows: res.data?.comments ?? [],
      available: res.data?.available ?? false,
      viewerId: res.data?.viewerId ?? '',
    });
  }, [projectId]);

  useEffect(() => {
    if (!active || !projectId) return;
    const cancelled = { current: false };
    void load(cancelled);
    return () => { cancelled.current = true; };
  }, [active, projectId, load]);

  const ready = state !== null && state.key === projectId;
  return {
    rows: ready ? state.rows : [],
    available: ready ? state.available : undefined,
    viewerId: ready ? state.viewerId : '',
    ready,
    error,
    refresh: () => load(),
  };
}
