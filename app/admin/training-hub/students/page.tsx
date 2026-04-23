'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface AdminStudent {
  registrationId: string; name: string; email: string; phone: string | null; course: string;
  registeredAt: string; sessionsPassedCount?: number; totalSessions?: number;
  finalPassed?: boolean; finalExamStatus?: string; certificateIssued?: boolean;
  isBlocked: boolean; blockActionId: string | null;
}
interface SessionProgress {
  sessionId: string; passed: boolean; score: number; attempts: number; completedAt: string | null;
}
interface StudentProgress {
  student: { name: string; email: string; registrationId: string; course: string; registeredAt: string };
  sessions: SessionProgress[]; finalPassed: boolean; certificateIssued: boolean;
}

function Skeleton({ h = 14, w = '100%', mb = 0 }: { h?: number; w?: number | string; mb?: number }) {
  return <div style={{ height: h, width: w, background: '#E5E7EB', borderRadius: 4, marginBottom: mb }} />;
}

const badge = (text: string, color: string, bg: string) => (
  <span style={{ background: bg, color, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</span>
);

export default function StudentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [students, setStudents]         = useState<AdminStudent[]>([]);
  const [loading, setLoading]           = useState(true);
  const [dataAvailable, setDataAvailable] = useState(false);
  const [appsConfigured, setAppsConfigured] = useState(true);
  const [apiError, setApiError]         = useState<string | null>(null);
  const [search, setSearch]             = useState('');
  const [courseFilter, setCourseFilter] = useState<'all' | '3SFM' | 'BVM'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [progressStudent, setProgressStudent] = useState<AdminStudent | null>(null);
  const [progress, setProgress]         = useState<StudentProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [toast, setToast]               = useState('');
  // Reset attempts
  const [resetCourse, setResetCourse]   = useState<'3sfm' | 'bvm'>('3sfm');
  const [resetSession, setResetSession] = useState('');
  const [resetting, setResetting]       = useState(false);
  const [modalTab, setModalTab]         = useState<'progress' | 'reset'>('progress');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session.user as any).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/training-hub/students');
      const j   = await res.json();
      setStudents(j.students ?? []);
      setDataAvailable(j.dataAvailable ?? false);
      setAppsConfigured(j.appsScriptConfigured ?? true);
      setApiError(j.error ?? null);
    } catch { setApiError('Network error'); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const setAL = (key: string, val: boolean) => setActionLoading(p => ({ ...p, [key]: val }));

  const handleBlock = async (s: AdminStudent) => {
    if (!confirm(`Block ${s.name} (${s.email})? They will not be able to log in.`)) return;
    setAL(s.registrationId, true);
    const res = await fetch('/api/admin/training-actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_id: s.registrationId, email: s.email, action_type: 'block', course: s.course }),
    });
    setAL(s.registrationId, false);
    if (res.ok) {
      const { action } = await res.json();
      setStudents(p => p.map(st => st.registrationId === s.registrationId ? { ...st, isBlocked: true, blockActionId: action.id } : st));
      showToast(`${s.name} has been blocked`);
    } else { showToast('Block failed'); }
  };

  const handleUnblock = async (s: AdminStudent) => {
    if (!s.blockActionId) return;
    setAL(s.registrationId, true);
    const res = await fetch(`/api/admin/training-actions/${s.blockActionId}`, { method: 'DELETE' });
    setAL(s.registrationId, false);
    if (res.ok) {
      setStudents(p => p.map(st => st.registrationId === s.registrationId ? { ...st, isBlocked: false, blockActionId: null } : st));
      showToast(`${s.name} has been unblocked`);
    } else { showToast('Unblock failed'); }
  };

  const handleResend = async (s: AdminStudent) => {
    setAL(`resend_${s.registrationId}`, true);
    const res = await fetch('/api/training/resend-id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: s.email }),
    });
    setAL(`resend_${s.registrationId}`, false);
    showToast(res.ok ? `Registration ID resent to ${s.email}` : 'Resend failed - check email or Apps Script');
  };

  const handleViewProgress = async (s: AdminStudent) => {
    setProgressStudent(s);
    setProgress(null);
    setProgressError(null);
    setProgressLoading(true);
    setModalTab('progress');
    try {
      const res = await fetch(`/api/admin/training-hub/student-progress?email=${encodeURIComponent(s.email)}&regId=${encodeURIComponent(s.registrationId)}`);
      if (res.ok) {
        const j = await res.json();
        setProgress(j.progress);
      } else {
        setProgressError('Could not load progress data');
      }
    } catch { setProgressError('Network error'); }
    setProgressLoading(false);
  };

  type SortField = 'registrationId' | 'name' | 'registeredAt' | 'sessionsPassedCount' | 'finalPassed' | 'certificateIssued';
  type SortDir   = 'asc' | 'desc';

  const [sortField, setSortField] = useState<SortField>('registrationId');
  const [sortDir,   setSortDir]   = useState<SortDir>('asc');

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  // Comparator for a given field. Name sorts with empty names last in asc
  // order (the "NULL last" rule); other fields rely on natural ordering
  // with defaults so nothing throws on undefined.
  function compareBy(a: AdminStudent, b: AdminStudent, field: SortField): number {
    switch (field) {
      case 'registrationId':
        return a.registrationId.localeCompare(b.registrationId);
      case 'name': {
        const an = (a.name ?? '').trim().toLowerCase();
        const bn = (b.name ?? '').trim().toLowerCase();
        if (!an && bn) return 1;
        if (an && !bn) return -1;
        return an.localeCompare(bn);
      }
      case 'registeredAt': {
        const at = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
        const bt = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
        return at - bt;
      }
      case 'sessionsPassedCount':
        return (a.sessionsPassedCount ?? 0) - (b.sessionsPassedCount ?? 0);
      case 'finalPassed':
        return Number(a.finalPassed ?? false) - Number(b.finalPassed ?? false);
      case 'certificateIssued':
        return Number(a.certificateIssued ?? false) - Number(b.certificateIssued ?? false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    // getStudentRoster returns `course` as a comma-joined list of enrolled
    // codes ("3SFM", "BVM", or "3SFM, BVM"). Membership check so
    // dual-enrolled students aren't dropped by the per-course filter.
    const filteredList = students.filter(s => {
      if (courseFilter !== 'all') {
        const codes = (s.course ?? '').split(',').map(c => c.trim()).filter(Boolean);
        if (!codes.includes(courseFilter)) return false;
      }
      if (statusFilter === 'active'  && s.isBlocked) return false;
      if (statusFilter === 'blocked' && !s.isBlocked) return false;
      if (q
          && !s.name.toLowerCase().includes(q)
          && !s.email.toLowerCase().includes(q)
          && !s.registrationId.toLowerCase().includes(q)
          && !(s.phone ?? '').toLowerCase().includes(q)) return false;
      return true;
    });

    // Stable sort: RegID secondary key so ties (e.g. two students with the
    // same name) fall back to deterministic order.
    const sorted = [...filteredList].sort((a, b) => {
      const primary = compareBy(a, b, sortField);
      if (primary !== 0) return sortDir === 'asc' ? primary : -primary;
      return a.registrationId.localeCompare(b.registrationId);
    });

    return sorted;
  }, [students, search, courseFilter, statusFilter, sortField, sortDir]);

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return iso ?? '-'; }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>👨‍🎓 Students</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>View and manage all enrolled students across 3SFM and BVM courses</p>
          </div>
          <button onClick={fetchStudents} disabled={loading} style={{ padding: '8px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        {/* Banners */}
        {!loading && !appsConfigured && (
          <div style={{ background: '#FEF9C3', border: '1px solid #FDE68A', borderRadius: 10, padding: '14px 20px', marginBottom: 20, fontSize: 13, color: '#92400E' }}>
            ⚠️ <strong>Apps Script not configured.</strong> Go to <a href="/admin/training-settings" style={{ color: '#1B4F8A', fontWeight: 700 }}>Training Settings</a> to connect your Apps Script.
          </div>
        )}
        {!loading && appsConfigured && !dataAvailable && (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '14px 20px', marginBottom: 20, fontSize: 13, color: '#1E40AF' }}>
            ℹ️ <strong>Student list unavailable.</strong> Add a <code style={{ background: '#DBEAFE', padding: '1px 4px', borderRadius: 3 }}>listStudents</code> action to your Apps Script to enable bulk listing.
            {apiError && <span style={{ display: 'block', marginTop: 4, fontSize: 11, opacity: 0.7 }}>Error: {apiError}</span>}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, phone or Reg ID…"
            style={{ flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, outline: 'none', fontFamily: 'Inter,sans-serif' }}
          />
          {(['all', '3SFM', 'BVM'] as const).map(c => (
            <button key={c} onClick={() => setCourseFilter(c)} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 7, border: '1px solid #D1D5DB', background: courseFilter === c ? '#1B4F8A' : '#fff', color: courseFilter === c ? '#fff' : '#374151', cursor: 'pointer' }}>
              {c === 'all' ? 'All Courses' : c}
            </button>
          ))}
          {(['all', 'active', 'blocked'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 7, border: '1px solid #D1D5DB', background: statusFilter === s ? '#1B4F8A' : '#fff', color: statusFilter === s ? '#fff' : '#374151', cursor: 'pointer', textTransform: 'capitalize' }}>
              {s === 'all' ? 'All Status' : s}
            </button>
          ))}
        </div>

        {/* Count */}
        {!loading && dataAvailable && (
          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
            Showing <strong>{filtered.length}</strong> of <strong>{students.length}</strong> students
          </div>
        )}

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 2fr 1.3fr 70px 80px 80px 80px 80px 160px', background: '#1B4F8A', padding: '10px 20px', gap: 0 }}>
            {([
              { label: 'Reg ID',   field: 'registrationId'      as const },
              { label: 'Name',     field: 'name'                as const },
              { label: 'Email',    field: null                             },
              { label: 'Phone',    field: null                             },
              { label: 'Course',   field: null                             },
              { label: 'Sessions', field: 'sessionsPassedCount' as const },
              { label: 'Final',    field: 'finalPassed'         as const },
              { label: 'Cert',     field: 'certificateIssued'   as const },
              { label: 'Joined',   field: 'registeredAt'        as const },
              { label: 'Actions',  field: null                             },
            ]).map(h => {
              const sortable = h.field !== null;
              const active = sortable && sortField === h.field;
              const arrow  = active ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';
              const base: React.CSSProperties = {
                fontSize: 10, fontWeight: 700, color: '#fff',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                cursor: sortable ? 'pointer' : 'default',
                userSelect: 'none',
                opacity: !sortable ? 0.9 : active ? 1 : 0.85,
              };
              if (!sortable) {
                return <div key={h.label} style={base}>{h.label}</div>;
              }
              return (
                <button
                  key={h.label}
                  type="button"
                  onClick={() => toggleSort(h.field!)}
                  style={{ ...base, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', font: 'inherit' }}
                  title={`Sort by ${h.label}`}
                >
                  {h.label}{arrow}
                </button>
              );
            })}
          </div>

          {loading ? (
            [1,2,3,4,5,6].map(i => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 2fr 1.3fr 70px 80px 80px 80px 80px 160px', padding: '14px 20px', borderBottom: '1px solid #F3F4F6', gap: 8, alignItems: 'center' }}>
                {Array(10).fill(0).map((_, j) => <Skeleton key={j} h={14} />)}
              </div>
            ))
          ) : !dataAvailable ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              {appsConfigured ? 'Student data unavailable - update your Apps Script to support listStudents.' : 'Connect your Apps Script to view students.'}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              No students match your search.
            </div>
          ) : (
            filtered.map(s => {
              const busy = !!actionLoading[s.registrationId];
              const resendBusy = !!actionLoading[`resend_${s.registrationId}`];
              const passCount = s.sessionsPassedCount ?? null;
              const total     = s.totalSessions ?? null;
              return (
                <div key={s.registrationId} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 2fr 1.3fr 70px 80px 80px 80px 80px 160px', padding: '11px 20px', borderBottom: '1px solid #F3F4F6', alignItems: 'center', fontSize: 12, background: s.isBlocked ? '#FFF5F5' : '#fff' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#6B7280' }}>{s.registrationId}</div>
                  <div style={{ fontWeight: 600, color: '#1B3A6B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || '-'}</div>
                  <div style={{ color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{s.email}</div>
                  <div style={{ color: s.phone ? '#374151' : '#D1D5DB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, fontFamily: 'monospace' }}>
                    {s.phone ? (
                      <a href={`tel:${s.phone}`} style={{ color: 'inherit', textDecoration: 'none' }} title="Click to call">{s.phone}</a>
                    ) : '-'}
                  </div>
                  <div>
                    <span style={{ background: s.course === '3SFM' ? '#EFF6FF' : '#F0FDF4', color: s.course === '3SFM' ? '#1D4ED8' : '#166534', borderRadius: 20, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>{s.course}</span>
                  </div>
                  {/* Sessions: passCount / (total - 1) to exclude final exam */}
                  <div style={{ color: '#6B7280' }}>{passCount !== null && total !== null ? `${passCount} / ${total > 1 ? total - 1 : total}` : '-'}</div>
                  {/* Final: use finalExamStatus for accurate not_started vs attempted vs passed */}
                  <div>
                    {!s.finalExamStatus || s.finalExamStatus === 'not_started'
                      ? <span style={{ color: '#9CA3AF' }}>-</span>
                      : s.finalExamStatus === 'passed'   ? badge('Passed',   '#166534', '#DCFCE7')
                      : s.finalExamStatus === 'attempted' ? badge('Attempted', '#92400E', '#FEF3C7')
                      : s.finalExamStatus === 'locked'    ? badge('Locked',   '#DC2626', '#FEF2F2')
                      : <span style={{ color: '#9CA3AF' }}>-</span>}
                  </div>
                  <div>
                    {s.certificateIssued === undefined ? <span style={{ color: '#D1D5DB' }}>-</span>
                      : s.certificateIssued ? badge('Yes', '#166534', '#DCFCE7')
                      : badge('No', '#6B7280', '#F3F4F6')}
                  </div>
                  {/* Joined: registeredAt comes from enrolledDate in the Apps Script response */}
                  <div style={{ color: '#6B7280', fontSize: 11 }}>{s.registeredAt ? fmt(s.registeredAt) : '-'}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => handleViewProgress(s)}
                      style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >Progress</button>
                    {s.isBlocked ? (
                      <button onClick={() => handleUnblock(s)} disabled={busy} style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0', cursor: 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                        {busy ? '…' : 'Unblock'}
                      </button>
                    ) : (
                      <button onClick={() => handleBlock(s)} disabled={busy} style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', cursor: 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                        {busy ? '…' : 'Block'}
                      </button>
                    )}
                    <button onClick={() => handleResend(s)} disabled={resendBusy} style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, background: '#F9FAFB', color: '#374151', border: '1px solid #E5E7EB', cursor: 'pointer', opacity: resendBusy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                      {resendBusy ? '…' : 'Resend'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </main>

      {/* Progress Modal */}
      {progressStudent && (
        <div
          onClick={e => { if (e.target === e.currentTarget) { setProgressStudent(null); setProgress(null); } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 700, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            {/* Modal header */}
            <div style={{ padding: '16px 24px 0', borderBottom: '1px solid #E5E7EB' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: '#1B3A6B' }}>{progressStudent.name || progressStudent.email}</div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                    {progressStudent.email} &bull; {progressStudent.registrationId} &bull;{' '}
                    <span style={{ fontWeight: 700, color: progressStudent.course === '3SFM' ? '#1D4ED8' : '#166534' }}>{progressStudent.course}</span>
                  </div>
                </div>
                <button onClick={() => { setProgressStudent(null); setProgress(null); }} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>✕</button>
              </div>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0 }}>
                {([['progress', 'Progress'], ['reset', 'Reset Attempts']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setModalTab(key)}
                    style={{
                      padding: '8px 20px', fontSize: 13, fontWeight: modalTab === key ? 700 : 400,
                      color: modalTab === key ? (key === 'reset' ? '#DC2626' : '#1B3A6B') : '#6B7280',
                      background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: modalTab === key ? `2px solid ${key === 'reset' ? '#DC2626' : '#1B4F8A'}` : '2px solid transparent',
                      marginBottom: -1,
                    }}>
                    {key === 'reset' ? '⟳ ' : ''}{label}
                  </button>
                ))}
              </div>
            </div>
            {/* Modal body */}
            <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>

              {/* ── Progress Tab ── */}
              {modalTab === 'progress' && (
              <>
                {progressLoading && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[1,2,3,4,5].map(i => <Skeleton key={i} h={36} />)}
                  </div>
                )}
                {progressError && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '14px 18px', color: '#DC2626', fontSize: 13 }}>
                    ❌ {progressError}
                  </div>
                )}
                {progress && !progressLoading && (() => {
                // Group sessions by course: S* = 3SFM, L* = BVM
                const sfmSessions = progress.sessions.filter(s => /^S/i.test(s.sessionId));
                const bvmSessions = progress.sessions.filter(s => /^L/i.test(s.sessionId));
                const hasBoth = sfmSessions.length > 0 && bvmSessions.length > 0;

                const SessionTable = ({ sessions, label }: { sessions: SessionProgress[]; label?: string }) => {
                  // Determine status for each session
                  const getStatus = (s: SessionProgress) => {
                    if (s.passed) return { text: 'Passed', color: '#166534', bg: '#DCFCE7' };
                    if (s.score > 0 && s.attempts > 0) return { text: 'Failed', color: '#DC2626', bg: '#FEF2F2' };
                    if (s.attempts > 0) return { text: 'Attempted', color: '#B45309', bg: '#FEF3C7' };
                    return { text: 'Not Started', color: '#6B7280', bg: '#F3F4F6' };
                  };
                  const passedCount = sessions.filter(s => s.passed).length;
                  return (
                    <div style={{ marginBottom: hasBoth ? 16 : 0 }}>
                      {label && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#2563EB', padding: '5px 14px', borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{label}</span>
                          <span style={{ fontWeight: 400 }}>{passedCount} / {sessions.length} passed</span>
                        </div>
                      )}
                      <div style={{ borderRadius: label ? '0 0 8px 8px' : 8, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 80px 80px 1fr', background: '#1B4F8A', padding: '8px 14px', gap: 0 }}>
                          {['Session', 'Score', 'Attempts', 'Status', 'Completed'].map(h => (
                            <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                          ))}
                        </div>
                        {sessions.map(sess => {
                          const st = getStatus(sess);
                          const scoreDisplay = sess.score != null && sess.score > 0 ? `${sess.score}%` : '-';
                          return (
                            <div key={sess.sessionId} style={{ display: 'grid', gridTemplateColumns: '80px 80px 80px 80px 1fr', padding: '9px 14px', borderBottom: '1px solid #F3F4F6', fontSize: 12, alignItems: 'center', background: sess.passed ? '#F0FDF4' : '#fff' }}>
                              <div style={{ fontWeight: 700, color: '#1B3A6B' }}>{sess.sessionId}</div>
                              <div style={{ color: '#374151' }}>{scoreDisplay}</div>
                              <div style={{ color: '#6B7280' }}>{sess.attempts ?? 0}</div>
                              <div>{badge(st.text, st.color, st.bg)}</div>
                              <div style={{ color: '#9CA3AF', fontSize: 11 }}>{sess.completedAt ? new Date(sess.completedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                };

                return (
                  <>
                    {/* Summary badges */}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                      <div style={{ background: '#F4F7FC', borderRadius: 8, padding: '10px 16px', fontSize: 12 }}>
                        <div style={{ color: '#6B7280', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Final Exam</div>
                        <div style={{ fontWeight: 800, color: progress.finalPassed ? '#166534' : '#DC2626', marginTop: 4 }}>
                          {progress.finalPassed ? '✅ Passed' : '❌ Not Passed'}
                        </div>
                      </div>
                      <div style={{ background: '#F4F7FC', borderRadius: 8, padding: '10px 16px', fontSize: 12 }}>
                        <div style={{ color: '#6B7280', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Certificate</div>
                        <div style={{ fontWeight: 800, color: progress.certificateIssued ? '#166534' : '#6B7280', marginTop: 4 }}>
                          {progress.certificateIssued ? '🏆 Issued' : '-'}
                        </div>
                      </div>
                      {hasBoth ? (
                        <>
                          <div style={{ background: '#EFF6FF', borderRadius: 8, padding: '10px 16px', fontSize: 12 }}>
                            <div style={{ color: '#1D4ED8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>3SFM Sessions</div>
                            <div style={{ fontWeight: 800, color: '#1B3A6B', marginTop: 4 }}>
                              {sfmSessions.filter(s => s.passed).length} / {sfmSessions.length}
                            </div>
                          </div>
                          <div style={{ background: '#F0FDF4', borderRadius: 8, padding: '10px 16px', fontSize: 12 }}>
                            <div style={{ color: '#166534', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>BVM Sessions</div>
                            <div style={{ fontWeight: 800, color: '#1B3A6B', marginTop: 4 }}>
                              {bvmSessions.filter(s => s.passed).length} / {bvmSessions.length}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div style={{ background: '#F4F7FC', borderRadius: 8, padding: '10px 16px', fontSize: 12 }}>
                          <div style={{ color: '#6B7280', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Sessions Passed</div>
                          <div style={{ fontWeight: 800, color: '#1B3A6B', marginTop: 4 }}>
                            {progress.sessions.filter(s => s.passed).length} / {progress.sessions.length}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Sessions table(s) */}
                    {progress.sessions.length > 0 ? (
                      hasBoth ? (
                        <>
                          {sfmSessions.length > 0 && <SessionTable sessions={sfmSessions} label="3SFM" />}
                          {bvmSessions.length > 0 && <SessionTable sessions={bvmSessions} label="BVM" />}
                        </>
                      ) : (
                        <SessionTable sessions={progress.sessions} />
                      )
                    ) : (
                      <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: 24 }}>No session data available.</div>
                    )}

                    </>
                  );
                })()}
              </>
              )}

              {/* ── Reset Attempts Tab ── */}
              {modalTab === 'reset' && (
                <div>
                  <div style={{ padding: 16, background: '#FEF2F2', borderRadius: 10, border: '1px solid #FECACA' }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#DC2626', marginBottom: 4 }}>Reset Assessment Attempts</div>
                    <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 16, lineHeight: 1.5 }}>
                      Clear a student&apos;s score and attempts for a specific session or all sessions. This allows them to retake the assessment from attempt 1.
                    </p>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
                        {/* Course selector */}
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 3 }}>Course</label>
                          <select value={resetCourse} onChange={e => { setResetCourse(e.target.value as '3sfm' | 'bvm'); setResetSession(''); }}
                            style={{ padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer' }}>
                            <option value="3sfm">3SFM</option>
                            <option value="bvm">BVM</option>
                          </select>
                        </div>
                        {/* Session selector */}
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 3 }}>Session</label>
                          <select value={resetSession} onChange={e => setResetSession(e.target.value)}
                            style={{ padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', minWidth: 160 }}>
                            <option value="">Select session...</option>
                            {resetCourse === '3sfm' ? (
                              <>
                                {Array.from({ length: 17 }, (_, i) => (
                                  <option key={i} value={`3SFM_S${i + 1}`}>Session {i + 1}</option>
                                ))}
                                <option value="3SFM_S18">Final Exam</option>
                              </>
                            ) : (
                              <>
                                {Array.from({ length: 6 }, (_, i) => (
                                  <option key={i} value={`BVM_L${i + 1}`}>Lesson {i + 1}</option>
                                ))}
                                <option value="BVM_L7">Final Exam</option>
                              </>
                            )}
                          </select>
                        </div>
                        {/* Reset single session */}
                        <button
                          disabled={!resetSession || resetting}
                          onClick={async () => {
                            const studentName = progressStudent?.name || progressStudent?.registrationId || '';
                            const sessionLabel = resetSession.includes('S18') || resetSession.includes('L7') ? 'Final Exam' : resetSession;
                            if (!confirm(`Reset attempts for ${studentName} - ${sessionLabel}?\n\nThis will clear their score and allow them to retake from attempt 1. This cannot be undone.`)) return;
                            setResetting(true);
                            try {
                              const res = await fetch('/api/admin/reset-attempts', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ regId: progressStudent?.registrationId, email: progressStudent?.email, tabKey: resetSession, course: resetCourse }),
                              });
                              const d = await res.json() as { success: boolean; error?: string };
                              if (d.success) {
                                setToast(`Attempts reset for ${studentName} - ${sessionLabel}`);
                                setTimeout(() => setToast(''), 3000);
                                // Refresh progress
                                if (progressStudent) {
                                  setProgressLoading(true);
                                  const r = await fetch(`/api/admin/training-hub/student-progress?email=${encodeURIComponent(progressStudent.email)}&regId=${encodeURIComponent(progressStudent.registrationId)}`);
                                  const j = await r.json();
                                  if (j.success) setProgress(j.data);
                                  setProgressLoading(false);
                                }
                              } else {
                                setToast(d.error ?? 'Reset failed');
                                setTimeout(() => setToast(''), 3000);
                              }
                            } catch { setToast('Reset failed'); setTimeout(() => setToast(''), 3000); }
                            setResetting(false);
                          }}
                          style={{
                            padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 700,
                            background: (!resetSession || resetting) ? '#F3F4F6' : '#DC2626',
                            color: (!resetSession || resetting) ? '#9CA3AF' : '#fff',
                            border: 'none', cursor: (!resetSession || resetting) ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {resetting ? 'Resetting...' : 'Reset Session'}
                        </button>
                      </div>
                      {/* Reset ALL */}
                      <button
                        disabled={resetting}
                        onClick={async () => {
                          const studentName = progressStudent?.name || progressStudent?.registrationId || '';
                          const courseLabel = resetCourse.toUpperCase();
                          if (!confirm(`⚠️ RESET ALL ${courseLabel} SESSIONS for ${studentName}?\n\nThis will clear ALL scores, attempts, and progress for the entire ${courseLabel} course. This CANNOT be undone.`)) return;
                          setResetting(true);
                          try {
                            const res = await fetch('/api/admin/reset-attempts', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ regId: progressStudent?.registrationId, email: progressStudent?.email, tabKey: 'ALL', course: resetCourse }),
                            });
                            const d = await res.json() as { success: boolean; error?: string };
                            if (d.success) {
                              setToast(`All ${courseLabel} attempts reset for ${studentName}`);
                              setTimeout(() => setToast(''), 3000);
                              if (progressStudent) {
                                setProgressLoading(true);
                                const r = await fetch(`/api/admin/training-hub/student-progress?email=${encodeURIComponent(progressStudent.email)}&regId=${encodeURIComponent(progressStudent.registrationId)}`);
                                const j = await r.json();
                                if (j.success) setProgress(j.data);
                                setProgressLoading(false);
                              }
                            } else {
                              setToast(d.error ?? 'Reset failed');
                              setTimeout(() => setToast(''), 3000);
                            }
                          } catch { setToast('Reset failed'); setTimeout(() => setToast(''), 3000); }
                          setResetting(false);
                        }}
                        style={{
                          padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                          background: resetting ? '#F3F4F6' : '#fff',
                          color: resetting ? '#9CA3AF' : '#DC2626',
                          border: '1px solid #FECACA', cursor: resetting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {resetting ? 'Resetting...' : `Reset All ${resetCourse.toUpperCase()} Sessions`}
                      </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
