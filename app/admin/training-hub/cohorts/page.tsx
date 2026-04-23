'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface Cohort {
  id: string; name: string; description: string | null; course_code: string;
  start_date: string | null; end_date: string | null; is_active: boolean;
  created_at: string; memberCount: number;
}
interface CohortMember {
  registrationId: string; name: string; email: string; course: string;
  joinedAt: string; sessionsPassedCount: number; totalSessions: number;
  finalPassed: boolean; certificateIssued: boolean;
}
interface CohortDetail {
  cohort: Cohort;
  members: CohortMember[];
  stats: { memberCount: number; avgCompletion: number; certified: number; avgScore: number };
}

function ProgressBar({ pct, color = '#1B4F8A' }: { pct: number; color?: string }) {
  return (
    <div style={{ width: '100%', height: 5, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 3 }} />
    </div>
  );
}

export default function CohortsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [cohorts, setCohorts]   = useState<Cohort[]>([]);
  const [loading, setLoading]   = useState(true);
  const [detail, setDetail]     = useState<CohortDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create modal
  const [showCreate, setShowCreate]   = useState(false);
  const [createName, setCreateName]   = useState('');
  const [createDesc, setCreateDesc]   = useState('');
  const [createCode, setCreateCode]   = useState<'3SFM' | 'BVM'>('3SFM');
  const [createStart, setCreateStart] = useState('');
  const [createEnd, setCreateEnd]     = useState('');
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');

  // Add member modal
  const [addRegId, setAddRegId]   = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [addError, setAddError]   = useState('');

  const [toast, setToast] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchCohorts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/training-hub/cohorts');
      if (res.ok) {
        const j = await res.json();
        setCohorts(j.cohorts ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCohorts(); }, [fetchCohorts]);

  const openDetail = async (cohort: Cohort) => {
    setDetail(null);
    setDetailLoading(true);
    setAddRegId('');
    setAddError('');
    try {
      const res = await fetch(`/api/admin/training-hub/cohorts/${cohort.id}`);
      if (res.ok) setDetail(await res.json());
    } catch { /* ignore */ }
    setDetailLoading(false);
  };

  const handleCreate = async () => {
    if (!createName.trim()) { setCreateError('Name is required'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch('/api/admin/training-hub/cohorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName, description: createDesc, courseCode: createCode,
          startDate: createStart || undefined, endDate: createEnd || undefined,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setCreateName(''); setCreateDesc(''); setCreateStart(''); setCreateEnd('');
        await fetchCohorts();
        showToast('Cohort created');
      } else {
        const j = await res.json();
        setCreateError(j.error ?? 'Failed to create');
      }
    } catch { setCreateError('Network error'); }
    setCreating(false);
  };

  const handleDelete = async (cohort: Cohort) => {
    if (!confirm(`Delete cohort "${cohort.name}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/training-hub/cohorts/${cohort.id}`, { method: 'DELETE' });
    if (detail?.cohort.id === cohort.id) setDetail(null);
    await fetchCohorts();
    showToast('Cohort deleted');
  };

  const handleToggleActive = async (cohort: Cohort) => {
    await fetch(`/api/admin/training-hub/cohorts/${cohort.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !cohort.is_active }),
    });
    await fetchCohorts();
    if (detail?.cohort.id === cohort.id) await openDetail({ ...cohort, is_active: !cohort.is_active });
  };

  const handleAddMember = async () => {
    if (!addRegId.trim() || !detail) return;
    setAddingMember(true);
    setAddError('');
    const res = await fetch(`/api/admin/training-hub/cohorts/${detail.cohort.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addMember', registrationId: addRegId.trim() }),
    });
    if (res.ok) {
      setAddRegId('');
      await openDetail(detail.cohort);
      showToast('Member added');
    } else {
      const j = await res.json();
      setAddError(j.error ?? 'Failed to add');
    }
    setAddingMember(false);
  };

  const handleRemoveMember = async (regId: string) => {
    if (!detail) return;
    await fetch(`/api/admin/training-hub/cohorts/${detail.cohort.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'removeMember', registrationId: regId }),
    });
    await openDetail(detail.cohort);
    showToast('Member removed');
  };

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700,
    color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/cohorts" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Toast */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B4F8A', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 900, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            {toast}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>👥 Cohort Manager</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>Group students into cohorts for batch tracking and communication</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '10px 20px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + New Cohort
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24, alignItems: 'start' }}>

          {/* Cohort list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6B7280', fontSize: 14 }}>Loading…</div>
            ) : cohorts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, color: '#9CA3AF', fontSize: 14 }}>
                No cohorts yet. Create one to get started.
              </div>
            ) : cohorts.map(c => {
              const isSelected = detail?.cohort.id === c.id;
              return (
                <div key={c.id}
                  onClick={() => openDetail(c)}
                  style={{
                    background: '#fff', border: `2px solid ${isSelected ? '#1B4F8A' : '#E8F0FB'}`,
                    borderRadius: 12, padding: '16px 18px', cursor: 'pointer',
                    boxShadow: isSelected ? '0 0 0 3px rgba(27,79,138,0.15)' : 'none',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1B3A6B' }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{c.course_code} · {c.memberCount} member{c.memberCount !== 1 ? 's' : ''}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: c.is_active ? '#F0FFF4' : '#F3F4F6', color: c.is_active ? '#15803D' : '#6B7280' }}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {c.description && (
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 6 }}>{c.description}</div>
                  )}
                  {(c.start_date || c.end_date) && (
                    <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                      {c.start_date ? new Date(c.start_date).toLocaleDateString() : '?'} → {c.end_date ? new Date(c.end_date).toLocaleDateString() : 'ongoing'}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button onClick={e => { e.stopPropagation(); handleToggleActive(c); }}
                      style={{ flex: 1, padding: '5px 0', fontSize: 11, border: '1px solid #E5E7EB', borderRadius: 6, background: '#F9FAFB', color: '#374151', cursor: 'pointer' }}>
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(c); }}
                      style={{ padding: '5px 12px', fontSize: 11, border: '1px solid #FCA5A5', borderRadius: 6, background: '#FFF5F5', color: '#DC2626', cursor: 'pointer' }}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail panel */}
          <div>
            {detailLoading && (
              <div style={{ textAlign: 'center', padding: 60, color: '#6B7280', fontSize: 14 }}>Loading cohort…</div>
            )}

            {!detailLoading && !detail && (
              <div style={{ textAlign: 'center', padding: 60, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, color: '#9CA3AF', fontSize: 14 }}>
                Select a cohort to view details
              </div>
            )}

            {!detailLoading && detail && (
              <>
                {/* Stats */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Members',    value: detail.stats.memberCount,    color: '#1B4F8A' },
                    { label: 'Avg Progress', value: `${detail.stats.avgCompletion}%`, color: '#0891B2' },
                    { label: 'Certified',  value: detail.stats.certified,      color: '#15803D' },
                    { label: 'Avg Score',  value: `${detail.stats.avgScore}%`, color: '#7C3AED' },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Add member */}
                <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: 'column' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Add Member by Registration ID</div>
                  <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                    <input value={addRegId} onChange={e => setAddRegId(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddMember(); }}
                      placeholder="e.g. REG-2024-001"
                      style={{ flex: 1, padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none' }} />
                    <button onClick={handleAddMember} disabled={addingMember || !addRegId.trim()}
                      style={{ padding: '8px 16px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      {addingMember ? '…' : 'Add'}
                    </button>
                  </div>
                  {addError && <div style={{ fontSize: 11, color: '#DC2626' }}>{addError}</div>}
                </div>

                {/* Members table */}
                <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#1B4F8A' }}>
                        {['Student', 'Course', 'Progress', 'Status', 'Joined', ''].map(h => (
                          <th key={h} style={thStyle}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.members.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '30px 0', color: '#9CA3AF', fontSize: 13 }}>No members yet</td>
                        </tr>
                      ) : detail.members.map((m, i) => {
                        const pct = m.totalSessions > 0 ? Math.round((m.sessionsPassedCount / m.totalSessions) * 100) : 0;
                        const certified = m.finalPassed || m.certificateIssued;
                        return (
                          <tr key={m.registrationId} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                            <td style={{ padding: '10px 14px' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{m.name}</div>
                              <div style={{ fontSize: 11, color: '#6B7280' }}>{m.email}</div>
                            </td>
                            <td style={{ padding: '10px 14px', fontSize: 11, color: '#374151' }}>{m.course}</td>
                            <td style={{ padding: '10px 14px', minWidth: 110 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: 1 }}><ProgressBar pct={pct} color={pct >= 80 ? '#2EAA4A' : pct >= 40 ? '#F59E0B' : '#1B4F8A'} /></div>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', width: 32, textAlign: 'right' }}>{pct}%</span>
                              </div>
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                                background: certified ? '#F0FFF4' : pct > 0 ? '#FEF3C7' : '#F3F4F6',
                                color:      certified ? '#15803D' : pct > 0 ? '#92400E' : '#6B7280' }}>
                                {certified ? '🏆 Certified' : pct > 0 ? '⚡ Active' : '⬜ Not Started'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>
                              {new Date(m.joinedAt).toLocaleDateString()}
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <button onClick={() => handleRemoveMember(m.registrationId)}
                                style={{ fontSize: 11, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Create cohort modal */}
        {showCreate && (
          <div onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: '28px 28px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1B3A6B' }}>New Cohort</div>
                <button onClick={() => setShowCreate(false)} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>✕</button>
              </div>

              {createError && (
                <div style={{ background: '#FFF5F5', border: '1px solid #FCA5A5', borderRadius: 7, padding: '10px 14px', fontSize: 12, color: '#DC2626', marginBottom: 14 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Cohort Name *</label>
                  <input value={createName} onChange={e => setCreateName(e.target.value)}
                    placeholder="e.g. March 2026 Cohort"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Description</label>
                  <input value={createDesc} onChange={e => setCreateDesc(e.target.value)}
                    placeholder="Optional notes about this cohort"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Course *</label>
                  <select value={createCode} onChange={e => setCreateCode(e.target.value as '3SFM' | 'BVM')}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff' }}>
                    <option value="3SFM">3SFM</option>
                    <option value="BVM">BVM</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Start Date</label>
                    <input type="date" value={createStart} onChange={e => setCreateStart(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>End Date</label>
                    <input type="date" value={createEnd} onChange={e => setCreateEnd(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCreate(false)}
                  style={{ padding: '9px 18px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, background: '#F9FAFB', color: '#374151', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleCreate} disabled={creating}
                  style={{ padding: '9px 20px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {creating ? 'Creating…' : 'Create Cohort'}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
