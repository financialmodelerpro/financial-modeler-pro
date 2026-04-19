'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface AdminCert {
  certificateId: string; studentName: string; email: string; course: string;
  issuedAt: string; certifierUrl: string;
  registrationId?: string;
  isRevoked: boolean; revokeActionId: string | null;
}
interface CertsData {
  certificates: AdminCert[]; totalCerts: number; sfmCerts: number;
  bvmCerts: number; revokedCerts: number; dataAvailable: boolean;
  appsScriptConfigured: boolean; error?: string;
}

function Skeleton({ h = 14, w = '100%', mb = 0 }: { h?: number; w?: number | string; mb?: number }) {
  return <div style={{ height: h, width: w, background: '#E5E7EB', borderRadius: 4, marginBottom: mb }} />;
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '18px 22px', flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#1B3A6B' }}>{value}</div>
    </div>
  );
}

export default function CertificatesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [data, setData]     = useState<CertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState<'all' | '3SFM' | 'BVM'>('all');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [toast, setToast]   = useState('');

  // Force-issue panel state
  const [fiEmail, setFiEmail] = useState('');
  const [fiCourse, setFiCourse] = useState<'3SFM' | 'BVM'>('3SFM');
  const [fiBusy, setFiBusy] = useState(false);
  const [fiCheck, setFiCheck] = useState<null | {
    eligible: boolean;
    course: string;
    email: string;
    passedSessions: string[];
    missingSessions: Array<{ tabKey: string; title: string }>;
    watchThresholdMet: boolean;
    reason?: string;
  }>(null);
  const [fiResult, setFiResult] = useState<null | { certificateId: string; certPdfUrl: string; badgeUrl: string }>(null);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session.user as any).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/training-hub/certificates');
      if (res.ok) setData(await res.json());
      else setToast('Failed to load certificates');
    } catch { setToast('Network error'); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };
  const setAL = (key: string, val: boolean) => setActionLoading(p => ({ ...p, [key]: val }));

  const handleCheckEligibility = async () => {
    if (!fiEmail.trim()) { showToast('Enter an email'); return; }
    setFiBusy(true); setFiCheck(null); setFiResult(null);
    try {
      const res = await fetch('/api/admin/certificates/check-eligibility', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fiEmail.trim(), courseCode: fiCourse }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Check failed');
      setFiCheck(j);
    } catch (e) { showToast((e as Error).message); }
    setFiBusy(false);
  };

  const handleForceIssue = async () => {
    if (!fiEmail.trim()) { showToast('Enter an email'); return; }
    if (!confirm(`Force-issue ${fiCourse} certificate for ${fiEmail.trim()}? This bypasses the watch-threshold check and is audited.`)) return;
    setFiBusy(true); setFiResult(null);
    try {
      const res = await fetch('/api/admin/certificates/force-issue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fiEmail.trim(), courseCode: fiCourse }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Force-issue failed');
      setFiResult({ certificateId: j.certificateId, certPdfUrl: j.certPdfUrl, badgeUrl: j.badgeUrl });
      showToast('Certificate issued');
      await fetchData();
    } catch (e) { showToast((e as Error).message); }
    setFiBusy(false);
  };

  const handleRevoke = async (cert: AdminCert) => {
    if (!confirm(`Revoke certificate for ${cert.studentName}? This will mark it as revoked.`)) return;
    const key = cert.certificateId;
    setAL(key, true);
    const res = await fetch('/api/admin/training-actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_id: cert.registrationId ?? cert.certificateId,
        email: cert.email,
        action_type: 'revoke_certificate',
        course: cert.course,
        reason: 'Revoked by admin',
      }),
    });
    setAL(key, false);
    if (res.ok) {
      const { action } = await res.json();
      setData(d => d ? {
        ...d,
        revokedCerts: d.revokedCerts + 1,
        certificates: d.certificates.map(c => c.certificateId === cert.certificateId ? { ...c, isRevoked: true, revokeActionId: action.id } : c),
      } : d);
      showToast('Certificate revoked');
    } else { showToast('Revoke failed'); }
  };

  const handleRestore = async (cert: AdminCert) => {
    if (!cert.revokeActionId) return;
    const key = cert.certificateId;
    setAL(key, true);
    const res = await fetch(`/api/admin/training-actions/${cert.revokeActionId}`, { method: 'DELETE' });
    setAL(key, false);
    if (res.ok) {
      setData(d => d ? {
        ...d,
        revokedCerts: Math.max(0, d.revokedCerts - 1),
        certificates: d.certificates.map(c => c.certificateId === cert.certificateId ? { ...c, isRevoked: false, revokeActionId: null } : c),
      } : d);
      showToast('Certificate restored');
    } else { showToast('Restore failed'); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (data?.certificates ?? []).filter(c => {
      if (courseFilter !== 'all' && c.course !== courseFilter) return false;
      if (q && !c.studentName.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q) && !(c.registrationId ?? '').toLowerCase().includes(q) && !c.certificateId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, search, courseFilter]);

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
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>🏆 Certificates</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>All certificates issued via the Training Hub certification system</p>
          </div>
          <button onClick={fetchData} disabled={loading} style={{ padding: '8px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        {/* Banners */}
        {!loading && data && !data.appsScriptConfigured && (
          <div style={{ background: '#FEF9C3', border: '1px solid #FDE68A', borderRadius: 10, padding: '14px 20px', marginBottom: 20, fontSize: 13, color: '#92400E' }}>
            ⚠️ <strong>Apps Script not configured.</strong>{' '}
            <a href="/admin/training-settings" style={{ color: '#1B4F8A', fontWeight: 700 }}>Configure Training Settings →</a>
          </div>
        )}
        {!loading && data && data.appsScriptConfigured && !data.dataAvailable && (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '14px 20px', marginBottom: 20, fontSize: 13, color: '#1E40AF' }}>
            ℹ️ <strong>Certificate list unavailable.</strong> Add a <code style={{ background: '#DBEAFE', padding: '1px 4px', borderRadius: 3 }}>listCertificates</code> action to your Apps Script to enable bulk listing.
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {loading ? (
            [1,2,3,4].map(i => (
              <div key={i} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '18px 22px', flex: 1, minWidth: 130 }}>
                <Skeleton h={10} w={70} mb={10} /><Skeleton h={26} w={50} />
              </div>
            ))
          ) : (
            <>
              <StatCard label="Total Issued"  value={data?.totalCerts ?? 0} />
              <StatCard label="3SFM"          value={data?.sfmCerts ?? 0} />
              <StatCard label="BVM"           value={data?.bvmCerts ?? 0} />
              <StatCard label="Revoked"       value={data?.revokedCerts ?? 0} />
            </>
          )}
        </div>

        {/* Force-Issue + Check Eligibility panel */}
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '18px 22px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1B3A6B' }}>⚡ Force-Issue Certificate (admin override)</div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                Bypasses the watch-threshold check. Cert, badge, and email still generate with the standard design. Audit trail recorded in <code style={{ background: '#F3F4F6', padding: '1px 4px', borderRadius: 3 }}>student_certificates.issued_by_admin</code>.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <input
              type="email"
              placeholder="student@example.com"
              value={fiEmail}
              onChange={e => { setFiEmail(e.target.value); setFiCheck(null); setFiResult(null); }}
              style={{ flex: '2 1 240px', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 6, fontFamily: 'Inter,sans-serif' }}
            />
            <select
              value={fiCourse}
              onChange={e => { setFiCourse(e.target.value as '3SFM' | 'BVM'); setFiCheck(null); setFiResult(null); }}
              style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
            >
              <option value="3SFM">3SFM</option>
              <option value="BVM">BVM</option>
            </select>
            <button
              onClick={handleCheckEligibility}
              disabled={fiBusy || !fiEmail.trim()}
              style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6, background: '#fff', color: '#1B4F8A', border: '1px solid #1B4F8A', cursor: fiBusy ? 'not-allowed' : 'pointer', opacity: fiBusy ? 0.6 : 1 }}
            >
              Check Eligibility
            </button>
            <button
              onClick={handleForceIssue}
              disabled={fiBusy || !fiEmail.trim()}
              style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6, background: '#B45309', color: '#fff', border: 'none', cursor: fiBusy ? 'not-allowed' : 'pointer', opacity: fiBusy ? 0.6 : 1 }}
            >
              {fiBusy ? 'Working…' : '⚡ Force Issue'}
            </button>
          </div>

          {fiCheck && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: fiCheck.eligible ? '#F0FFF4' : '#FFFBEB', border: `1px solid ${fiCheck.eligible ? '#BBF7D0' : '#FDE68A'}`, borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: fiCheck.eligible ? '#166534' : '#92400E', marginBottom: 4 }}>
                {fiCheck.eligible ? '✓ Eligible — safe to auto-issue' : `⚠️ Not eligible — ${fiCheck.reason}`}
              </div>
              <div style={{ color: '#374151' }}>
                Passed: <strong>{fiCheck.passedSessions.length}</strong> session{fiCheck.passedSessions.length === 1 ? '' : 's'}
                {fiCheck.missingSessions.length > 0 && (
                  <> · Missing: {fiCheck.missingSessions.map(m => m.tabKey).join(', ')}</>
                )}
                {' · '}Watch threshold: <strong>{fiCheck.watchThresholdMet ? 'met' : 'not met'}</strong>
              </div>
            </div>
          )}

          {fiResult && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: '#166534', marginBottom: 4 }}>✓ Issued: {fiResult.certificateId}</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <a href={fiResult.certPdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1B4F8A', textDecoration: 'underline' }}>Certificate PDF ↗</a>
                {fiResult.badgeUrl && <a href={fiResult.badgeUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1B4F8A', textDecoration: 'underline' }}>Badge PNG ↗</a>}
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email or certificate ID…"
            style={{ flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, outline: 'none', fontFamily: 'Inter,sans-serif' }}
          />
          {(['all', '3SFM', 'BVM'] as const).map(c => (
            <button key={c} onClick={() => setCourseFilter(c)} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 7, border: '1px solid #D1D5DB', background: courseFilter === c ? '#1B4F8A' : '#fff', color: courseFilter === c ? '#fff' : '#374151', cursor: 'pointer' }}>
              {c === 'all' ? 'All Courses' : c}
            </button>
          ))}
        </div>

        {!loading && data?.dataAvailable && (
          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
            Showing <strong>{filtered.length}</strong> of <strong>{data.totalCerts}</strong> certificates
          </div>
        )}

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 2fr 70px 110px 80px 140px', background: '#1B4F8A', padding: '10px 20px', gap: 0 }}>
            {['Cert ID', 'Name', 'Email', 'Course', 'Issued', 'Status', 'Actions'].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
            ))}
          </div>

          {loading ? (
            [1,2,3,4,5].map(i => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 2fr 70px 110px 80px 140px', padding: '14px 20px', borderBottom: '1px solid #F3F4F6', gap: 8, alignItems: 'center' }}>
                {Array(7).fill(0).map((_, j) => <Skeleton key={j} h={14} />)}
              </div>
            ))
          ) : !data?.dataAvailable ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              {data?.appsScriptConfigured ? 'Certificate data unavailable - update your Apps Script to support listCertificates.' : 'Connect your Apps Script to view certificates.'}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              No certificates match your search.
            </div>
          ) : (
            filtered.map(cert => {
              const busy = !!actionLoading[cert.certificateId];
              return (
                <div key={cert.certificateId} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 2fr 70px 110px 80px 140px', padding: '11px 20px', borderBottom: '1px solid #F3F4F6', alignItems: 'center', fontSize: 12, background: cert.isRevoked ? '#FFF5F5' : '#fff' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cert.certificateId}</div>
                  <div style={{ fontWeight: 600, color: '#1B3A6B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cert.studentName || '-'}</div>
                  <div style={{ color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{cert.email}</div>
                  <div>
                    <span style={{ background: cert.course === '3SFM' ? '#EFF6FF' : '#F0FDF4', color: cert.course === '3SFM' ? '#1D4ED8' : '#166534', borderRadius: 20, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>{cert.course}</span>
                  </div>
                  <div style={{ color: '#6B7280', fontSize: 11 }}>{cert.issuedAt ? fmt(cert.issuedAt) : '-'}</div>
                  <div>
                    {cert.isRevoked
                      ? <span style={{ background: '#FEF2F2', color: '#DC2626', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>Revoked</span>
                      : <span style={{ background: '#DCFCE7', color: '#166534', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>Active</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {cert.certifierUrl && (
                      <a href={cert.certifierUrl} target="_blank" rel="noopener noreferrer"
                        style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        View ↗
                      </a>
                    )}
                    {cert.isRevoked ? (
                      <button onClick={() => handleRestore(cert)} disabled={busy} style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0', cursor: 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                        {busy ? '…' : 'Restore'}
                      </button>
                    ) : (
                      <button onClick={() => handleRevoke(cert)} disabled={busy} style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', cursor: 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                        {busy ? '…' : 'Revoke'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
