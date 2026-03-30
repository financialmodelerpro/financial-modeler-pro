'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface StudentSummary {
  registrationId: string; name: string; email: string; course: string;
  registeredAt: string; certificateIssued?: boolean;
}
interface OverviewData {
  totalStudents: number | null; sfmEnrolled: number | null; bvmEnrolled: number | null;
  totalCertificates: number | null; sfmCertificates: number | null; bvmCertificates: number | null;
  sfmFinalPassRate: number | null; bvmFinalPassRate: number | null;
  sfmCertsIssued: number | null; bvmCertsIssued: number | null;
  recentRegistrations: StudentSummary[];
  dataAvailable: boolean; appsScriptConfigured: boolean;
}

const stat = (v: number | null, suffix = '') =>
  v === null || v === undefined ? '—' : `${v}${suffix}`;

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#1B3A6B', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Skeleton({ h = 24, w = '100%', mb = 8 }: { h?: number; w?: number | string; mb?: number }) {
  return <div style={{ height: h, width: w, background: '#E5E7EB', borderRadius: 6, marginBottom: mb }} />;
}

export default function TrainingHubOverviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData]           = useState<OverviewData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [toast, setToast]         = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session.user as any).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/training-hub');
      if (res.ok) { setData(await res.json()); setLastUpdated(new Date()); }
      else setToast('Failed to load data');
    } catch { setToast('Network error'); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return iso ?? '—'; }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>🎓 Training Hub</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>Manage FMP Training &amp; Certification System</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {lastUpdated && (
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              style={{ padding: '8px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Apps Script not configured warning */}
        {!loading && data && !data.appsScriptConfigured && (
          <div style={{ background: '#FEF9C3', border: '1px solid #FDE68A', borderRadius: 10, padding: '14px 20px', marginBottom: 24, fontSize: 13, color: '#92400E' }}>
            ⚠️ <strong>Apps Script not configured.</strong> Go to{' '}
            <a href="/admin/training-settings" style={{ color: '#1B4F8A', fontWeight: 700 }}>Training Settings</a>{' '}
            to add your Google Apps Script Web App URL.
          </div>
        )}

        {/* Apps Script configured but bulk listing not supported */}
        {!loading && data && data.appsScriptConfigured && !data.dataAvailable && (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '14px 20px', marginBottom: 24, fontSize: 13, color: '#1E40AF' }}>
            ℹ️ <strong>Bulk student data not available.</strong> Your Apps Script needs a <code style={{ background: '#DBEAFE', padding: '1px 4px', borderRadius: 3 }}>listStudents</code> action to show full stats. Stats will show 0 until then.
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {loading ? (
            [1,2,3,4].map(i => (
              <div key={i} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 160 }}>
                <Skeleton h={12} w={80} mb={12} /><Skeleton h={28} w={60} mb={0} />
              </div>
            ))
          ) : (
            <>
              <StatCard label="Total Students"    value={stat(data?.totalStudents ?? null)} />
              <StatCard label="3SFM Enrolled"     value={stat(data?.sfmEnrolled ?? null)} />
              <StatCard label="BVM Enrolled"      value={stat(data?.bvmEnrolled ?? null)} />
              <StatCard label="Total Certificates" value={stat(data?.totalCertificates ?? null)} />
            </>
          )}
        </div>

        {/* Course breakdown */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          {['3SFM', 'BVM'].map(course => {
            const enrolled = course === '3SFM' ? data?.sfmEnrolled : data?.bvmEnrolled;
            const passRate = course === '3SFM' ? data?.sfmFinalPassRate : data?.bvmFinalPassRate;
            const certs    = course === '3SFM' ? data?.sfmCertsIssued : data?.bvmCertsIssued;
            const emoji    = course === '3SFM' ? '📐' : '📊';
            return (
              <div key={course} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1B3A6B', marginBottom: 16 }}>
                  {emoji} {course} Progress
                </div>
                {loading ? (
                  <><Skeleton mb={10} /><Skeleton mb={10} /><Skeleton /></>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      ['Enrolled Students', stat(enrolled ?? null)],
                      ['Final Exam Pass Rate', stat(passRate ?? null, '%')],
                      ['Certificates Issued', stat(certs ?? null)],
                    ].map(([label, val]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid #F3F4F6', paddingBottom: 8 }}>
                        <span style={{ color: '#6B7280' }}>{label}</span>
                        <span style={{ fontWeight: 700, color: '#1B3A6B' }}>{val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Recent registrations */}
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ fontWeight: 700, color: '#1B3A6B', fontSize: 14 }}>Recent Registrations</div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>Last 10 students to register</div>
          </div>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 2fr 80px 100px 80px', background: '#1B4F8A', padding: '10px 20px', gap: 0 }}>
            {['Reg ID', 'Name', 'Email', 'Course', 'Date', 'Cert'].map(h => (
              <div key={h} style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
            ))}
          </div>
          {loading ? (
            [1,2,3,4,5].map(i => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 2fr 80px 100px 80px', padding: '12px 20px', borderBottom: '1px solid #F3F4F6', gap: 8 }}>
                {[1,2,3,4,5,6].map(j => <Skeleton key={j} h={14} mb={0} />)}
              </div>
            ))
          ) : data?.recentRegistrations?.length ? (
            data.recentRegistrations.map(s => (
              <div key={s.registrationId} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 2fr 80px 100px 80px', padding: '11px 20px', borderBottom: '1px solid #F3F4F6', alignItems: 'center', fontSize: 12 }}>
                <div style={{ fontFamily: 'monospace', color: '#6B7280', fontSize: 11 }}>{s.registrationId}</div>
                <div style={{ fontWeight: 600, color: '#1B3A6B' }}>{s.name || '—'}</div>
                <div style={{ color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email}</div>
                <div>
                  <span style={{ background: s.course === '3SFM' ? '#EFF6FF' : '#F0FDF4', color: s.course === '3SFM' ? '#1D4ED8' : '#166534', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                    {s.course}
                  </span>
                </div>
                <div style={{ color: '#6B7280' }}>{s.registeredAt ? fmt(s.registeredAt) : '—'}</div>
                <div>
                  {s.certificateIssued ? (
                    <span style={{ background: '#DCFCE7', color: '#166534', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Yes</span>
                  ) : (
                    <span style={{ color: '#D1D5DB', fontSize: 11 }}>—</span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              No recent registrations found.
            </div>
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
