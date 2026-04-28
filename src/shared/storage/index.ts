/**
 * storage.ts - localStorage helpers ported from legacy projects.js
 */

const STORAGE_KEY = 'refm_v2';

export interface VersionData {
  name: string;
  versionNumber?: string;
  createdAt: string;
  savedAt?: string;
  data: Record<string, unknown>;
}

export interface ProjectEntry {
  name: string;
  location?: string;
  status?: string;
  assetMix?: string[];
  createdAt: string;
  lastModified?: string;
  versions: Record<string, VersionData>;
}

export interface StorageStore {
  projects: Record<string, ProjectEntry>;
  lastActiveProjectId: string | null;
  lastActiveVersionId: string | null;
}

export function loadStorage(): StorageStore {
  if (typeof window === 'undefined') {
    return { projects: {}, lastActiveProjectId: null, lastActiveVersionId: null };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StorageStore;
  } catch (_e) {}
  return { projects: {}, lastActiveProjectId: null, lastActiveVersionId: null };
}

export function saveStorage(store: StorageStore): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (_e) {}
}

export function genId(prefix: string): string {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}
