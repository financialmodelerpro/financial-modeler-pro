'use client';

/**
 * useSubscription - Dynamic permission hook backed by a Zustand store.
 *
 * On first mount it calls /api/permissions once and caches the result.
 * All canAccess() calls hit the in-memory cache - zero DB calls per render.
 *
 * The store refreshes automatically when the session plan changes
 * (call useSubscriptionStore.getState().refresh() after a plan upgrade).
 */

import { create } from 'zustand';
import { useEffect } from 'react';
import { PERMISSIONS_LOAD_TIMEOUT_MS } from '@/src/constants/app';
import type {
  FeatureKey,
  PermissionCache,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@/src/types/subscription.types';

// ── Internal Zustand store ────────────────────────────────────────────────────
interface SubscriptionStore {
  plan:         SubscriptionPlan;
  status:       SubscriptionStatus;
  permissions:  PermissionCache;
  projectCount: number;
  loaded:       boolean;
  loading:      boolean;
  timedOut:     boolean;
  /** Fetch /api/permissions and populate the cache. */
  load: () => Promise<void>;
  /** Force a refresh (e.g. after a plan upgrade). */
  refresh: () => Promise<void>;
  /** Optimistically update projectCount after creating/deleting a project. */
  setProjectCount: (n: number) => void;
}

export const useSubscriptionStore = create<SubscriptionStore>((set, get) => ({
  plan:         'free',
  status:       'active',
  permissions:  {},
  projectCount: 0,
  loaded:       false,
  loading:      false,
  timedOut:     false,

  load: async () => {
    if (get().loaded || get().loading) return;   // already loaded or in-flight
    set({ loading: true, timedOut: false });

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => {
      controller.abort();
      set({ loaded: true, loading: false, timedOut: true });
    }, PERMISSIONS_LOAD_TIMEOUT_MS);

    try {
      const res = await fetch('/api/permissions', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) { set({ loaded: true, loading: false }); return; }
      const data = await res.json() as {
        plan:        SubscriptionPlan;
        status:      SubscriptionStatus;
        permissions: PermissionCache;
      };
      set({
        plan:        data.plan        ?? 'free',
        status:      data.status      ?? 'active',
        permissions: data.permissions ?? {},
        loaded:      true,
        loading:     false,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // AbortError is handled by the timeout callback above
      if (err instanceof Error && err.name !== 'AbortError') {
        set({ loaded: true, loading: false });
      }
    }
  },

  refresh: async () => {
    set({ loaded: false, loading: false, timedOut: false });
    await get().load();
  },

  setProjectCount: (n) => set({ projectCount: n }),
}));

// ── Public hook ───────────────────────────────────────────────────────────────
export function useSubscription() {
  const { plan, status, permissions, loaded, loading, timedOut, load, projectCount } =
    useSubscriptionStore();

  // Trigger load on first mount - idempotent (store guards against re-runs)
  useEffect(() => {
    load();
  }, [load]);

  /**
   * Check if the current user can access a feature.
   * Returns false while loading or if load timed out (fail-safe deny).
   */
  function canAccess(featureKey: FeatureKey | string): boolean {
    if (!loaded) return false;
    return permissions[featureKey as FeatureKey] ?? false;
  }

  /**
   * How many projects can still be created.
   * null = unlimited.
   */
  const projectsRemaining: number | null = (() => {
    if (permissions['projects_unlimited']) return null;
    const limit = permissions['projects_10'] ? 10 : 3;   // free = 3
    return Math.max(0, limit - projectCount);
  })();

  return {
    plan,
    status,
    canAccess,
    projectsRemaining,
    loaded,
    loading,
    timedOut,
  };
}
