'use client';

/**
 * useEntitlements
 *
 * Client hook that fetches the signed-in user's RESOLVED gate from
 * /api/refm/entitlements (server-authoritative, reuses the Phase C resolver).
 * Exposes a synchronous canAccess(featureKey) the gate points read, plus the
 * project cap facts. Admin / full-access fold into canAccess server-side, so an
 * admin always resolves true.
 *
 * Fail-safe posture: while loading, `loaded` is false (callers can treat the
 * gate as not-yet-known). If the fetch fails, the server already failed closed;
 * here we mirror that by denying non-admin features, but we never throw.
 *
 * No em dashes in this file.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

export interface FeatureAccess { included: boolean; value: number | null; feature_type: string }

export interface EntitlementsState {
  loaded: boolean;
  isAdmin: boolean;
  fullAccess: boolean;
  planKey: string;
  knownPlan: boolean;
  trialExpired: boolean;
  trialEndsAt: string | null;
  featureMap: Record<string, FeatureAccess>;
  projectLimit: number;
  archiveAllowed: boolean;
  activeProjectCount: number;
  error: boolean;
}

const INITIAL: EntitlementsState = {
  loaded: false, isAdmin: false, fullAccess: false, planKey: '', knownPlan: false,
  trialExpired: false, trialEndsAt: null, featureMap: {}, projectLimit: 0,
  archiveAllowed: false, activeProjectCount: 0, error: false,
};

export interface UseEntitlements extends EntitlementsState {
  /** True when the feature is accessible. fullAccess (admin/safety-net) wins. */
  canAccess: (featureKey: string) => boolean;
  /** Resolved numeric limit for a limit feature (-1 unlimited), or null. */
  limitOf: (featureKey: string) => number | null;
  refresh: () => void;
}

export function useEntitlements(): UseEntitlements {
  const [state, setState] = useState<EntitlementsState>(INITIAL);
  const reqId = useRef(0);

  const load = useCallback(() => {
    const id = ++reqId.current;
    fetch('/api/refm/entitlements', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (id !== reqId.current) return; // a newer request superseded this one
        setState({
          loaded: true,
          isAdmin: !!j.isAdmin,
          fullAccess: !!j.fullAccess,
          planKey: j.planKey ?? '',
          knownPlan: !!j.knownPlan,
          trialExpired: !!j.trialExpired,
          trialEndsAt: j.trialEndsAt ?? null,
          featureMap: j.featureMap ?? {},
          projectLimit: typeof j.projectLimit === 'number' ? j.projectLimit : 0,
          archiveAllowed: !!j.archiveAllowed,
          activeProjectCount: j.activeProjectCount ?? 0,
          error: !!j.error,
        });
      })
      .catch(() => {
        if (id !== reqId.current) return;
        // Mirror the server's fail-closed posture: deny non-admin features.
        setState({ ...INITIAL, loaded: true, error: true });
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const canAccess = useCallback((featureKey: string): boolean => {
    if (state.fullAccess || state.isAdmin) return true;
    return state.featureMap[featureKey]?.included ?? false;
  }, [state.fullAccess, state.isAdmin, state.featureMap]);

  const limitOf = useCallback((featureKey: string): number | null => {
    const f = state.featureMap[featureKey];
    return f && f.included ? f.value : null;
  }, [state.featureMap]);

  return { ...state, canAccess, limitOf, refresh: load };
}
