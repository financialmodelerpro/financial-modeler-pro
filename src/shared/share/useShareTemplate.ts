'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_TEMPLATES, type ShareTemplate } from './shareTemplates';

/**
 * Hook for loading a share template on the client. Returns the template
 * immediately from the fallback `DEFAULT_TEMPLATES`, then swaps in the
 * DB-fetched version once available. A module-level cache prevents repeat
 * network calls when multiple share buttons mount for the same key.
 *
 * Callers never see `null` — there's always a valid template to render,
 * even offline or during the first fetch.
 */
const cache = new Map<string, ShareTemplate>();
const inflight = new Map<string, Promise<ShareTemplate>>();

async function fetchTemplate(key: string): Promise<ShareTemplate> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`/api/share-templates/${key}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json() as { template: ShareTemplate | null };
      if (json.template && json.template.active) {
        cache.set(key, json.template);
        return json.template;
      }
    } catch {
      // fall through to default
    }
    const fallback = DEFAULT_TEMPLATES[key];
    if (fallback) {
      cache.set(key, fallback);
      return fallback;
    }
    throw new Error(`Unknown share template: ${key}`);
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

export function useShareTemplate(key: string): ShareTemplate {
  // Initial value pulls from the module-cache first (instant on remount),
  // then falls back to the offline seed. `useState`'s initializer reads
  // the cache exactly once per mount — no synchronous setState inside the
  // effect, so cascading renders are avoided.
  const [template, setTemplate] = useState<ShareTemplate>(
    () => cache.get(key) ?? DEFAULT_TEMPLATES[key],
  );

  useEffect(() => {
    // Cache hit — state already reflects it via the initializer above.
    if (cache.has(key)) return;

    let active = true;
    fetchTemplate(key)
      .then(t => { if (active) setTemplate(t); })
      .catch(() => { /* keep current fallback */ });
    return () => { active = false; };
  }, [key]);

  return template;
}
