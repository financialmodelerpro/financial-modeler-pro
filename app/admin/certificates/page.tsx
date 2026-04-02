'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CertRecord {
  certifier_uuid: string;
  registration_id: string;
  full_name: string;
  email: string;
  course: string;
  completion_date: string | null;
  final_exam_score: string | null;
  cert_status: string;
  certificate_url: string | null;
  issued_date: string | null;
}

// ── Mock data for testing ─────────────────────────────────────────────────────

const MOCK_CERT: CertRecord = {
  certifier_uuid:   'mock-cert-uuid-dev-001',
  registration_id:  'FMP-2024-001',
  full_name:        'Ahmad Al-Rashidi',
  email:            'ahmad@example.com',
  course:           '3-Statement Financial Model',
  completion_date:  '2024-03-10',
  final_exam_score: '89',
  cert_status:      'Issued',
  certificate_url:  null,
  issued_date:      '2024-03-15',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  try {
    return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return raw; }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    Issued:  { bg: '#D1FAE5', color: '#065F46' },
    Pending: { bg: '#FEF3C7', color: '#92400E' },
  };
  const style = map[status] ?? { bg: '#F3F4F6', color: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11,
      fontWeight: 700, background: style.bg, color: style.color,
    }}>
      {status}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminCertificatesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [certs, setCerts]             = useState<CertRecord[]>([]);
  const [lastSynced, setLastSynced]   = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [toast, setToast]             = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') {
      router.replace('/');
    }
  }, [status, session, router]);

  const fetchCerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/certificates/sync');
      if (res.ok) {
        const json = await res.json() as { certs: CertRecord[]; lastSynced: string | null };
        setCerts(json.certs ?? []);
        setLastSynced(json.lastSynced ?? null);
      } else {
        showToast('Failed to load certificates');
      }
    } catch {
      showToast('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCerts(); }, [fetchCerts]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/certificates/sync', { method: 'POST' });
      const json = await res.json() as { ok?: boolean; synced?: number; skipped?: number; error?: string };
      if (json.ok) {
        showToast(`Sync complete: ${json.synced} synced, ${json.skipped} skipped`);
        await fetchCerts();
      } else {
        showToast(`Sync failed: ${json.error ?? 'Unknown error'}`);
      }
    } catch {
      showToast('Sync failed — network error');
    }
    setSyncing(false);
  }

  function copyLink(uuid: string) {
    const url = `https://financialmodelerpro.com/verify/${uuid}`;
    navigator.clipboard.writeText(url).then(() => showToast('Verification link copied!')).catch(() => showToast('Copy failed'));
  }

  const displayCerts = certs.length > 0 ? certs : [MOCK_CERT];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <CmsAdminNav active="/admin/certificates" />

      <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', top: 20, right: 20, zIndex: 9999,
            background: '#1B4F8A', color: '#fff', padding: '12px 20px',
            borderRadius: 8, fontSize: 13, fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          }}>
            {toast}
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#0D2E5A' }}>🏅 Certificates</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>Manage and verify student certificates</p>
            {lastSynced && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>
                Last synced: {formatDate(lastSynced)}
              </p>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none', cursor: syncing ? 'not-allowed' : 'pointer',
              background: syncing ? '#9CA3AF' : '#2EAA4A', color: '#fff', fontSize: 13, fontWeight: 600,
            }}
          >
            {syncing ? 'Syncing…' : '🔄 Sync from Apps Script'}
          </button>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading certificates…</div>
          ) : displayCerts.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 8 }}>No certificates synced yet</div>
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>Click &quot;Sync from Apps Script&quot; to import certificates.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                    {['Registration ID', 'Full Name', 'Course', 'Issue Date', 'Score', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayCerts.map((cert, i) => (
                    <tr key={cert.certifier_uuid} style={{ borderBottom: i < displayCerts.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                      <td style={{ padding: '12px 16px', color: '#374151', fontFamily: 'monospace', fontSize: 12 }}>
                        {cert.registration_id}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1F2937' }}>
                        {cert.full_name}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#4B5563' }}>
                        {cert.course}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#4B5563', whiteSpace: 'nowrap' }}>
                        {formatDate(cert.issued_date)}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#4B5563' }}>
                        {cert.final_exam_score ? `${cert.final_exam_score}%` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <StatusBadge status={cert.cert_status} />
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <a
                            href={`/verify/${cert.certifier_uuid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                              background: '#EFF6FF', color: '#1D4ED8', textDecoration: 'none', whiteSpace: 'nowrap',
                            }}
                          >
                            Verify ↗
                          </a>
                          <button
                            onClick={() => copyLink(cert.certifier_uuid)}
                            style={{
                              padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                              background: '#F3F4F6', color: '#374151', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >
                            Copy Link
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {certs.length === 0 && !loading && (
          <p style={{ marginTop: 10, fontSize: 11, color: '#9CA3AF', textAlign: 'center' }}>
            Showing mock data for testing purposes. Sync to load real certificates.
          </p>
        )}
      </div>
    </div>
  );
}
