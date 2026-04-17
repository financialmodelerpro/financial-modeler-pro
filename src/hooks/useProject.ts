'use client';

/**
 * useProject - Supabase-backed project save/load hook
 *
 * - Auto-saves dirty state to Supabase every 30 seconds
 * - saveNow() triggers an immediate save (e.g. manual save button)
 * - loadProject(id) fetches a single project by ID
 * - Falls back to localStorage when unauthenticated (guest mode)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AUTO_SAVE_INTERVAL_MS } from '@/src/constants/app';

export interface ProjectMeta {
  id:          string;
  name:        string;
  platform:    string;
  module_data: Record<string, unknown>;
  created_at:  string;
  updated_at:  string;
}

interface UseProjectReturn {
  projectId:     string | null;
  saveStatus:    'idle' | 'saving' | 'saved' | 'error';
  listProjects:  () => Promise<ProjectMeta[]>;
  createProject: (name: string, initialData?: Record<string, unknown>) => Promise<ProjectMeta | null>;
  loadProject:   (id: string) => Promise<Record<string, unknown> | null>;
  markDirty:     (projectId: string, moduleData: Record<string, unknown>) => void;
  saveNow:       () => Promise<void>;
  archiveProject:(id: string) => Promise<boolean>;
}

export function useProject(): UseProjectReturn {
  const { data: session, status: sessionStatus } = useSession();
  const isAuthenticated = Boolean(session?.user?.id);

  const [projectId,  setProjectId]  = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const dirtyRef         = useRef<{ id: string; data: Record<string, unknown> } | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Core save function ──────────────────────────────────────────────────────
  const flushToSupabase = useCallback(async () => {
    if (!dirtyRef.current) return;

    // If session has expired, don't attempt to save - show error instead
    if (!isAuthenticated || sessionStatus === 'unauthenticated') {
      setSaveStatus('error');
      return;
    }

    const { id, data } = dirtyRef.current;
    dirtyRef.current = null;

    setSaveStatus('saving');
    try {
      const res = await fetch('/api/projects', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, module_data: data }),
      });

      if (res.status === 401) {
        // Session expired mid-edit - re-queue and mark error so UI can warn
        dirtyRef.current = { id, data };
        setSaveStatus('error');
        return;
      }

      if (!res.ok) throw new Error(await res.text().catch(() => 'Unknown error'));
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
      // Re-queue so next tick can retry
      if (dirtyRef.current === null) {
        dirtyRef.current = { id, data };
      }
    }
  }, [isAuthenticated, sessionStatus]);

  // ── Auto-save interval ──────────────────────────────────────────────────────
  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      if (dirtyRef.current) void flushToSupabase();
    }, AUTO_SAVE_INTERVAL_MS);

    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [flushToSupabase]);

  // ── Public API ──────────────────────────────────────────────────────────────

  const listProjects = useCallback(async (): Promise<ProjectMeta[]> => {
    if (!isAuthenticated) return [];
    const res = await fetch('/api/projects');
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return (json.projects ?? []) as ProjectMeta[];
  }, [isAuthenticated]);

  const createProject = useCallback(
    async (name: string, initialData: Record<string, unknown> = {}): Promise<ProjectMeta | null> => {
      const res = await fetch('/api/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, module_data: initialData }),
      });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      if (!json?.project) return null;
      const project = json.project as ProjectMeta;
      setProjectId(project.id);
      return project;
    },
    [],
  );

  // Fetches a single project by ID via ?id= query param
  const loadProject = useCallback(async (id: string): Promise<Record<string, unknown> | null> => {
    const res = await fetch(`/api/projects?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const project = json?.project as ProjectMeta | undefined;
    if (!project) return null;
    setProjectId(id);
    return project.module_data;
  }, []);

  const markDirty = useCallback((id: string, moduleData: Record<string, unknown>) => {
    dirtyRef.current = { id, data: moduleData };
    setProjectId(id);
    setSaveStatus('idle');
  }, []);

  const saveNow = useCallback(async () => {
    await flushToSupabase();
  }, [flushToSupabase]);

  const archiveProject = useCallback(async (id: string): Promise<boolean> => {
    const res = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  }, []);

  return {
    projectId,
    saveStatus,
    listProjects,
    createProject,
    loadProject,
    markDirty,
    saveNow,
    archiveProject,
  };
}
