/**
 * /admin/platform-modules
 *
 * Two-level admin UI for the P-Sync source of truth:
 *   Level 1: list of platforms (REFM, BVM, FPA...) loaded from the legacy
 *            `modules` table via /api/admin/modules.
 *   Level 2: per-platform sub-modules (Module 1..N within REFM) loaded from
 *            the new platform_modules table via the P-Sync API. Inline
 *            create + edit + delete + status toggle.
 *
 * Page sections (hero / features / how_it_works / cta) are managed via the
 * companion page /admin/platform-modules/[id]/pages (linked from the row).
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Local types (mirror src/shared/cms/platform-modules.ts) ────────────────

interface Platform {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  status: 'live' | 'coming_soon' | 'hidden';
  display_order: number;
}

type ModuleStatus = 'live' | 'coming_soon' | 'hidden' | 'pro' | 'enterprise';
type GatingTier = 'free' | 'pro' | 'enterprise';

interface PlatformModule {
  id: string;
  platform_slug: string;
  slug: string;
  number: number;
  name: string;
  short_name: string;
  description: string;
  icon_emoji: string | null;
  status: ModuleStatus;
  gating_tier: GatingTier;
  display_order: number;
  features: string[];
  updated_at: string;
}

const STATUS_CFG: Record<ModuleStatus, { label: string; bg: string; color: string }> = {
  live:        { label: '✓ Live',        bg: '#E8F7EC', color: '#1A7A30' },
  coming_soon: { label: 'Coming Soon',   bg: '#FEF3C7', color: '#92400E' },
  hidden:      { label: 'Hidden',        bg: '#F3F4F6', color: '#6B7280' },
  pro:         { label: 'Pro',           bg: '#EFF6FF', color: '#1D4ED8' },
  enterprise:  { label: 'Enterprise',    bg: '#F5F3FF', color: '#5B21B6' },
};

const NEXT_STATUS: Record<ModuleStatus, ModuleStatus> = {
  live: 'coming_soon',
  coming_soon: 'pro',
  pro: 'enterprise',
  enterprise: 'hidden',
  hidden: 'live',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB',
  borderRadius: 6, fontSize: 13, color: '#1B3A6B', background: '#fff', boxSizing: 'border-box',
};

const emptyDraft = (platformSlug: string, nextNumber: number): Partial<PlatformModule> => ({
  platform_slug: platformSlug,
  slug: '',
  number: nextNumber,
  name: '',
  short_name: '',
  description: '',
  icon_emoji: '',
  status: 'coming_soon',
  gating_tier: 'free',
  display_order: nextNumber,
  features: [],
});

export default function AdminPlatformModulesPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [activePlatformSlug, setActivePlatformSlug] = useState<string | null>(null);
  const [modules, setModules] = useState<PlatformModule[]>([]);
  const [loadingP, setLoadingP] = useState(true);
  const [loadingM, setLoadingM] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<PlatformModule>>(emptyDraft('', 1));
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  // ── Level 1: load platforms ─────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/admin/modules')
      .then((r) => r.json())
      .then((j) => {
        const list = (j.modules ?? []) as Platform[];
        setPlatforms(list);
        setLoadingP(false);
        if (!activePlatformSlug && list.length > 0) {
          setActivePlatformSlug(list[0].slug);
        }
      })
      .catch(() => setLoadingP(false));
  }, [activePlatformSlug]);

  // ── Level 2: load modules for active platform ───────────────────────────
  const loadModules = useCallback((slug: string) => {
    setLoadingM(true);
    fetch(`/api/platforms/${slug}/modules?includeHidden=1`)
      .then((r) => r.json())
      .then((j) => {
        setModules((j.modules ?? []) as PlatformModule[]);
        setLoadingM(false);
      })
      .catch(() => setLoadingM(false));
  }, []);

  useEffect(() => {
    if (activePlatformSlug) loadModules(activePlatformSlug);
  }, [activePlatformSlug, loadModules]);

  // ── Module CRUD ────────────────────────────────────────────────────────
  function startEdit(m: PlatformModule) {
    setEditingId(m.id);
    setCreating(false);
    setDraft({ ...m });
  }

  function startCreate() {
    if (!activePlatformSlug) return;
    const nextNumber = modules.length > 0 ? Math.max(...modules.map((m) => m.number)) + 1 : 1;
    setEditingId(null);
    setCreating(true);
    setDraft(emptyDraft(activePlatformSlug, nextNumber));
  }

  function cancelEdit() {
    setEditingId(null);
    setCreating(false);
  }

  async function saveDraft() {
    if (!activePlatformSlug) return;
    if (!draft.slug || !draft.name || !draft.short_name || typeof draft.number !== 'number') {
      showToast('Slug, name, short_name, and number are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = editingId
        ? `/api/platforms/${activePlatformSlug}/modules/${draft.slug}`
        : `/api/platforms/${activePlatformSlug}/modules`;
      const method = editingId ? 'PATCH' : 'POST';
      const body = editingId ? { ...draft, id: editingId } : draft;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        showToast(j.error ?? 'Save failed', 'error');
        setSaving(false);
        return;
      }
      showToast(editingId ? 'Module updated' : 'Module created');
      cancelEdit();
      loadModules(activePlatformSlug);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function cycleStatus(m: PlatformModule) {
    if (!activePlatformSlug) return;
    const newStatus = NEXT_STATUS[m.status];
    setSaving(true);
    try {
      const res = await fetch(`/api/platforms/${activePlatformSlug}/modules/${m.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...m, status: newStatus }),
      });
      if (res.ok) {
        setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: newStatus } : x)));
        showToast(`Status set to ${newStatus.replace('_', ' ')}`);
      } else {
        showToast('Status update failed', 'error');
      }
    } catch {
      showToast('Status update failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteModule(m: PlatformModule) {
    if (!activePlatformSlug) return;
    if (!confirm(`Delete "${m.name}"? This also removes all its page sections.`)) return;
    try {
      const res = await fetch(`/api/platforms/${activePlatformSlug}/modules/${m.slug}?id=${m.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setModules((prev) => prev.filter((x) => x.id !== m.id));
        showToast('Module deleted');
      } else {
        showToast('Delete failed', 'error');
      }
    } catch {
      showToast('Delete failed', 'error');
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────
  const THead = ({ cols }: { cols: string[] }) => (
    <thead>
      <tr style={{ background: '#1B4F8A' }}>
        {cols.map((h) => (
          <th
            key={h}
            style={{
              padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700,
              color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase',
            }}
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );

  const renderEditDraft = () => (
    <tr style={{ borderTop: '1px solid #BFDBFE', background: '#EFF6FF' }}>
      <td colSpan={7} style={{ padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '60px 80px 1fr 1fr 1fr 100px', gap: 12, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>NUM</div>
            <input
              type="number"
              value={draft.number ?? 0}
              onChange={(e) => setDraft({ ...draft, number: Number(e.target.value) })}
              style={inputStyle}
            />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>ICON</div>
            <input
              value={draft.icon_emoji ?? ''}
              onChange={(e) => setDraft({ ...draft, icon_emoji: e.target.value })}
              style={{ ...inputStyle, textAlign: 'center', fontSize: 22 }}
              placeholder="🧱"
            />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>NAME</div>
            <input
              value={draft.name ?? ''}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={inputStyle}
              placeholder="Module 1, Project Setup"
            />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>SHORT NAME</div>
            <input
              value={draft.short_name ?? ''}
              onChange={(e) => setDraft({ ...draft, short_name: e.target.value })}
              style={inputStyle}
              placeholder="Setup"
            />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>SLUG</div>
            <input
              value={draft.slug ?? ''}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              style={inputStyle}
              placeholder="project-setup"
              disabled={!!editingId}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={saveDraft}
              disabled={saving}
              style={{ flex: 1, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 6, border: 'none', background: '#1B4F8A', color: '#fff', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? '…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              style={{ flex: 1, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151' }}
            >
              Cancel
            </button>
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 140px 140px', gap: 12, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>DESCRIPTION</div>
            <input
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              style={inputStyle}
              placeholder="Short description shown on marketing page hero"
            />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>STATUS</div>
            <select
              value={draft.status ?? 'coming_soon'}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as ModuleStatus })}
              style={inputStyle}
            >
              <option value="live">Live</option>
              <option value="coming_soon">Coming Soon</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>GATING TIER</div>
            <select
              value={draft.gating_tier ?? 'free'}
              onChange={(e) => setDraft({ ...draft, gating_tier: e.target.value as GatingTier })}
              style={inputStyle}
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>FEATURES (one per line)</div>
          <textarea
            value={(draft.features ?? []).join('\n')}
            onChange={(e) => setDraft({ ...draft, features: e.target.value.split('\n').filter(Boolean) })}
            style={{ ...inputStyle, minHeight: 80, fontFamily: 'inherit' }}
            placeholder={'Feature 1\nFeature 2\n...'}
          />
        </div>
      </td>
    </tr>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/platform-modules" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Platform Module Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>
          Manage per-platform sub-modules. Changes flow to the workspace sidebar and the public marketing pages.
        </p>

        {/* ── Level 1: Platform tabs ── */}
        {loadingP ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#6B7280' }}>Loading platforms…</div>
        ) : (
          <div
            data-testid="platform-tabs"
            style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}
          >
            {platforms.map((p) => {
              const isActive = p.slug === activePlatformSlug;
              return (
                <button
                  key={p.id}
                  onClick={() => setActivePlatformSlug(p.slug)}
                  data-testid={`platform-tab-${p.slug}`}
                  style={{
                    fontSize: 13, fontWeight: 700, padding: '10px 18px', borderRadius: 8,
                    border: isActive ? 'none' : '1px solid #D1D5DB',
                    background: isActive ? '#1B4F8A' : '#fff',
                    color: isActive ? '#fff' : '#374151',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{p.icon}</span>
                  <span>{p.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Level 2: Modules table for the active platform ── */}
        {activePlatformSlug && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', margin: 0 }}>
                Modules in {platforms.find((p) => p.slug === activePlatformSlug)?.name ?? activePlatformSlug}
              </h2>
              <button
                onClick={startCreate}
                disabled={creating || editingId !== null}
                data-testid="create-module-btn"
                style={{
                  fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 6,
                  border: 'none', background: '#1B4F8A', color: '#fff', cursor: 'pointer',
                  opacity: creating || editingId !== null ? 0.5 : 1,
                }}
              >
                + New Module
              </button>
            </div>

            {loadingM ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading modules…</div>
            ) : (
              <div
                data-testid="modules-table"
                style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden', marginBottom: 48 }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <THead cols={['#', 'Icon', 'Name', 'Slug', 'Status', 'Pages', 'Actions']} />
                  <tbody>
                    {creating && renderEditDraft()}
                    {modules.length === 0 && !creating && (
                      <tr>
                        <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
                          No modules yet. Click + New Module to create one.
                        </td>
                      </tr>
                    )}
                    {modules.map((m, i) => {
                      const cfg = STATUS_CFG[m.status];
                      const isEditing = editingId === m.id;
                      return (
                        <>
                          <tr
                            key={m.id}
                            data-testid={`module-row-${m.slug}`}
                            style={{
                              borderTop: '1px solid #E8F0FB',
                              background: isEditing ? '#F0F7FF' : i % 2 === 1 ? '#F9FAFB' : '#fff',
                            }}
                          >
                            <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF', width: 40 }}>{m.number}</td>
                            <td style={{ padding: '12px 16px', fontSize: 22, width: 52 }}>{m.icon_emoji ?? '·'}</td>
                            <td style={{ padding: '12px 16px' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{m.name}</div>
                              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                                {m.description.substring(0, 90)}
                                {m.description.length > 90 ? '…' : ''}
                              </div>
                            </td>
                            <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280', fontFamily: 'monospace' }}>{m.slug}</td>
                            <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>
                                {cfg.label}
                              </span>
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              <Link
                                href={`/admin/platform-modules/${m.id}/pages`}
                                style={{
                                  fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                                  background: '#EFF6FF', color: '#1D4ED8', textDecoration: 'none',
                                }}
                              >
                                Edit Page
                              </Link>
                            </td>
                            <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  onClick={() => (isEditing ? cancelEdit() : startEdit(m))}
                                  style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid #1B4F8A', background: isEditing ? '#1B4F8A' : '#fff', cursor: 'pointer', color: isEditing ? '#fff' : '#1B4F8A' }}
                                >
                                  {isEditing ? 'Cancel' : 'Edit'}
                                </button>
                                <button
                                  onClick={() => cycleStatus(m)}
                                  disabled={saving}
                                  style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151' }}
                                >
                                  Status
                                </button>
                                <button
                                  onClick={() => deleteModule(m)}
                                  style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid #DC2626', background: '#fff', cursor: 'pointer', color: '#DC2626' }}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isEditing && renderEditDraft()}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {toast && (
        <div
          data-testid="admin-toast"
          style={{
            position: 'fixed', bottom: 24, right: 24,
            background: toast.type === 'success' ? '#1A7A30' : '#DC2626',
            color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px',
            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999,
          }}
        >
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
