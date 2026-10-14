'use client';

/**
 * usePlatformDisplayName: the selected platform's name for its own header.
 *
 * Reads the configured name until the live catalog arrives (so the header never
 * flashes the company name), then the catalog row's name, from the same
 * `/api/admin/modules` list the hub's platform picker reads. Resolution is
 * `resolvePlatformDisplayName`, the one rule; this hook only supplies the rows.
 */

import { useEffect, useState } from 'react';
import { resolvePlatformDisplayName } from '@/src/hubs/modeling/config/platforms';

type CatalogRow = { slug: string; name?: string | null };

export function usePlatformDisplayName(slug: string): string {
  const [catalog, setCatalog] = useState<CatalogRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/modules')
      .then((r) => r.json())
      .then((j: { modules?: CatalogRow[] }) => {
        if (!cancelled) setCatalog(j.modules ?? null);
      })
      // Offline or unreachable: the configured name stands.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return resolvePlatformDisplayName(slug, catalog);
}
