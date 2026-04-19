'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CertRecord {
  certificate_id?:   string | null;
  certifier_uuid?:   string | null;
  registration_id:   string;
  full_name:         string;
  email:             string;
  course:            string;
  completion_date:   string | null;
  final_exam_score:  string | null;
  cert_status:       string;
  certificate_url?:  string | null;
  cert_pdf_url?:     string | null;
  badge_url?:        string | null;
  grade?:            string | null;
  issued_date?:      string | null;
  issued_at?:        string | null;
}

interface TemplateStatus {
  '3sfm-cert':  boolean;
  'bvm-cert':   boolean;
  '3sfm-badge': boolean;
  'bvm-badge':  boolean;
}

const TEMPLATE_LABELS: Record<keyof TemplateStatus, string> = {
  '3sfm-cert':  '3SFM Certificate Template (PDF)',
  'bvm-cert':   'BVM Certificate Template (PDF)',
  '3sfm-badge': '3SFM Badge (PNG)',
  'bvm-badge':  'BVM Badge (PNG)',
};

const TEMPLATE_ACCEPT: Record<keyof TemplateStatus, string> = {
  '3sfm-cert':  '.pdf',
  'bvm-cert':   '.pdf',
  '3sfm-badge': '.png',
  'bvm-badge':  '.png',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-';
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
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: style.bg, color: style.color }}>
      {status}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminCertificatesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [certs, setCerts]               = useState<CertRecord[]>([]);
  const [lastSynced, setLastSynced]     = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [syncing, setSyncing]           = useState(false);
  const [toast, setToast]               = useState('');
  const [templateStatus, setTemplateStatus] = useState<TemplateStatus>({
    '3sfm-cert': false, 'bvm-cert': false, '3sfm-badge': false, 'bvm-badge': false,
  });
  const [uploading, setUploading]       = useState<string | null>(null);
  const [deleting,  setDeleting]        = useState<string | null>(null);
  const [templateUrls, setTemplateUrls] = useState<Partial<Record<keyof TemplateStatus, string>>>({});

  // ── Generation settings state ──
  const [autoEnabled,    setAutoEnabled]    = useState(false);
  const [togglingAuto,   setTogglingAuto]   = useState(false);
  const [generating,     setGenerating]     = useState(false);
  const [lastGenerated,  setLastGenerated]  = useState<string | null>(null);

  const fileRefs = {
    '3sfm-cert':  useRef<HTMLInputElement>(null),
    'bvm-cert':   useRef<HTMLInputElement>(null),
    '3sfm-badge': useRef<HTMLInputElement>(null),
    'bvm-badge':  useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') {
      router.replace('/');
    }
  }, [status, session, router]);

  const fetchCerts = useCallback(async () => {
    setLoading(true);
    try {
      const [certsRes, settingsRes] = await Promise.all([
        fetch('/api/admin/certificates/sync'),
        fetch('/api/admin/certificates/settings'),
      ]);
      if (certsRes.ok) {
        const json = await certsRes.json() as { certs: CertRecord[]; lastSynced: string | null };
        setCerts(json.certs ?? []);
        setLastSynced(json.lastSynced ?? null);
      } else {
        showToast('Failed to load certificates');
      }
      if (settingsRes.ok) {
        const sj = await settingsRes.json() as { autoEnabled: boolean; lastGenerated: string | null };
        setAutoEnabled(sj.autoEnabled);
        setLastGenerated(sj.lastGenerated ?? null);
      }
    } catch {
      showToast('Network error');
    }
    setLoading(false);
  }, []);

  async function handleToggleAuto() {
    setTogglingAuto(true);
    const next = !autoEnabled;
    try {
      const res = await fetch('/api/admin/certificates/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ autoEnabled: next }),
      });
      if (res.ok) {
        setAutoEnabled(next);
        showToast(next ? 'Automatic generation enabled' : 'Automatic generation disabled');
      } else {
        showToast('Failed to save setting');
      }
    } catch {
      showToast('Network error');
    }
    setTogglingAuto(false);
  }

  async function handleGenerateNow() {
    setGenerating(true);
    try {
      const res  = await fetch('/api/admin/certificates/generate', { method: 'POST' });
      const json = await res.json() as { ok?: boolean; processed?: number; errors?: unknown[]; generatedAt?: string; error?: string };
      if (json.ok) {
        showToast(`Generated: ${json.processed ?? 0} certificate(s)`);
        setLastGenerated(json.generatedAt ?? new Date().toISOString());
        await fetchCerts();
      } else {
        showToast(`Generation failed: ${json.error ?? 'Unknown error'}`);
      }
    } catch {
      showToast('Network error');
    }
    setGenerating(false);
  }

  useEffect(() => { fetchCerts(); }, [fetchCerts]);

  // Check which templates already exist in storage on load
  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const checks: Array<{ type: keyof TemplateStatus; bucket: string; filePath: string }> = [
      { type: '3sfm-cert',  bucket: 'certificates', filePath: 'templates/3sfm-template.pdf' },
      { type: 'bvm-cert',   bucket: 'certificates', filePath: 'templates/bvm-template.pdf'  },
      { type: '3sfm-badge', bucket: 'badges',       filePath: 'templates/3sfm-badge.png'    },
      { type: 'bvm-badge',  bucket: 'badges',       filePath: 'templates/bvm-badge.png'     },
    ];
    async function checkTemplates() {
      for (const { type, bucket, filePath } of checks) {
        const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(filePath);
        try {
          const res = await fetch(`${publicUrl}?t=${Date.now()}`, { method: 'HEAD' });
          if (res.ok) {
            setTemplateStatus(prev => ({ ...prev, [type]: true }));
            setTemplateUrls(prev => ({ ...prev, [type]: `${publicUrl}?t=${Date.now()}` }));
          }
        } catch { /* network error - skip */ }
      }
    }
    void checkTemplates();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res  = await fetch('/api/admin/certificates/sync', { method: 'POST' });
      const json = await res.json() as { ok?: boolean; synced?: number; skipped?: number; error?: string };
      if (json.ok) {
        showToast(`Sync complete: ${json.synced} synced, ${json.skipped} skipped`);
        await fetchCerts();
      } else {
        showToast(`Sync failed: ${json.error ?? 'Unknown error'}`);
      }
    } catch {
      showToast('Sync failed - network error');
    }
    setSyncing(false);
  }

  async function handleTemplateUpload(type: keyof TemplateStatus, file: File) {
    setUploading(type);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', type);
      const res  = await fetch('/api/admin/certificates/upload-template', { method: 'POST', body: form });
      const json = await res.json() as { success?: boolean; error?: string; url?: string };
      if (json.success) {
        setTemplateStatus(prev => ({ ...prev, [type]: true }));
        if (json.url) setTemplateUrls(prev => ({ ...prev, [type]: `${json.url}?t=${Date.now()}` }));
        showToast(`${TEMPLATE_LABELS[type]} uploaded ✓`);
      } else {
        showToast(`Upload failed: ${json.error ?? 'unknown error'}`);
      }
    } catch {
      showToast('Upload failed - network error');
    }
    setUploading(null);
  }

  async function handleTemplateDelete(type: keyof TemplateStatus) {
    if (!confirm(`Remove ${TEMPLATE_LABELS[type]}? You can upload a new one afterwards.`)) return;
    setDeleting(type);
    try {
      const res  = await fetch('/api/admin/certificates/upload-template', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (json.success) {
        setTemplateStatus(prev => ({ ...prev, [type]: false }));
        setTemplateUrls(prev => { const next = { ...prev }; delete next[type]; return next; });
        showToast(`${TEMPLATE_LABELS[type]} removed`);
      } else {
        showToast(`Remove failed: ${json.error ?? 'unknown error'}`);
      }
    } catch {
      showToast('Remove failed - network error');
    }
    setDeleting(null);
  }

  const learnUrl = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

  function getVerifyLink(cert: CertRecord): string {
    if (cert.certificate_id) return `${learnUrl}/verify/${cert.certificate_id}`;
    if (cert.certifier_uuid) return `${learnUrl}/verify/${cert.certifier_uuid}`;
    return '#';
  }

  function copyLink(cert: CertRecord) {
    const url = getVerifyLink(cert);
    navigator.clipboard.writeText(url)
      .then(() => showToast('Verification link copied!'))
      .catch(() => showToast('Copy failed'));
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <CmsAdminNav active="/admin/certificates" />

      <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        {/* Toast */}
        {toast && (
          <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: '#1B4F8A', color: '#fff', padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
            {toast}
          </div>
        )}

        {/* ── Template Upload Section ── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', padding: '24px', marginBottom: 28 }}>
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>📁 Certificate Templates</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9CA3AF' }}>
              Upload PDF templates and badge PNGs. These are used to auto-generate certificates for each student.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {(Object.keys(TEMPLATE_LABELS) as (keyof TemplateStatus)[]).map(type => {
              const url = templateUrls[type];
              const isBadge = type.includes('badge');
              return (
                <div key={type} style={{ border: '1.5px dashed #D1D5DB', borderRadius: 10, padding: '16px', display: 'flex', flexDirection: 'column', gap: 10, background: '#FAFAFA' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{isBadge ? '🎖' : '📄'}</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A' }}>{TEMPLATE_LABELS[type]}</div>
                  </div>
                  {templateStatus[type] && (
                    <>
                      <div style={{ fontSize: 11, color: '#2EAA4A', fontWeight: 700 }}>✓ Template uploaded</div>
                      {url && (
                        <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                          {isBadge ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={url} alt="Badge preview" style={{ width: '100%', height: 80, objectFit: 'contain', background: '#F9FAFB', display: 'block' }} />
                          ) : (
                            <iframe src={url} style={{ width: '100%', height: 80, border: 'none', pointerEvents: 'none', display: 'block' }} title="PDF preview" />
                          )}
                        </div>
                      )}
                      {!isBadge && (
                        <a href="/admin/certificate-editor" style={{ fontSize: 11, color: '#1D4ED8', fontWeight: 600, textDecoration: 'none' }}>
                          Open in Certificate Editor →
                        </a>
                      )}
                    </>
                  )}
                  <input
                    ref={fileRefs[type]}
                    type="file"
                    accept={TEMPLATE_ACCEPT[type]}
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleTemplateUpload(type, file);
                      e.target.value = '';
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => fileRefs[type].current?.click()}
                      disabled={uploading === type || deleting === type}
                      style={{
                        flex: 1, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                        background: uploading === type ? '#9CA3AF' : '#1B4F8A',
                        color: '#fff', border: 'none', cursor: (uploading === type || deleting === type) ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {uploading === type ? 'Uploading…' : templateStatus[type] ? 'Replace' : 'Upload'}
                    </button>
                    {templateStatus[type] && (
                      <button
                        onClick={() => handleTemplateDelete(type)}
                        disabled={deleting === type || uploading === type}
                        title="Remove this template"
                        style={{
                          padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                          background: deleting === type ? '#9CA3AF' : '#FEF2F2',
                          color: deleting === type ? '#fff' : '#DC2626',
                          border: '1px solid #FECACA', cursor: (deleting === type || uploading === type) ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {deleting === type ? '…' : '🗑 Remove'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, padding: '10px 14px', background: '#EFF6FF', borderRadius: 8, fontSize: 12, color: '#1D4ED8' }}>
            💡 After uploading templates, use the{' '}
            <a href="/admin/certificate-editor" style={{ fontWeight: 700, color: '#1D4ED8' }}>Certificate Editor</a>
            {' '}to position text fields on the PDF, then the cron job will auto-generate certificates every 15 minutes.
          </div>
        </div>

        {/* ── Certificate Generation Settings ── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', padding: '24px', marginBottom: 28 }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>⚙️ Certificate Generation</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9CA3AF' }}>
              Control when certificates are generated. Use &quot;Generate Now&quot; to process pending certificates immediately.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            {/* Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1F2937', marginBottom: 2 }}>Automatic Generation</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                  Runs daily at midnight (Hobby plan) ·{' '}
                  <span style={{ color: '#C9A84C', fontWeight: 600 }}>Upgrade to Pro for every 15 min</span>
                </div>
              </div>
              {/* Toggle switch */}
              <button
                onClick={handleToggleAuto}
                disabled={togglingAuto}
                aria-label="Toggle automatic generation"
                style={{
                  position: 'relative', display: 'inline-flex', alignItems: 'center',
                  width: 48, height: 26, borderRadius: 13,
                  background: autoEnabled ? '#2EAA4A' : '#D1D5DB',
                  border: 'none', cursor: togglingAuto ? 'not-allowed' : 'pointer',
                  padding: 0, transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute',
                  left: autoEnabled ? 24 : 2,
                  width: 22, height: 22, borderRadius: '50%',
                  background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                  transition: 'left 0.2s',
                }} />
              </button>
              <span style={{ fontSize: 13, fontWeight: 600, color: autoEnabled ? '#2EAA4A' : '#9CA3AF' }}>
                {autoEnabled ? 'ON' : 'OFF'}
              </span>
            </div>

            {/* Generate Now + last generated */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {lastGenerated && (
                <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'right' }}>
                  Last generated<br />
                  <span style={{ color: '#4B5563', fontWeight: 600 }}>{formatDate(lastGenerated)}</span>
                </div>
              )}
              <button
                onClick={handleGenerateNow}
                disabled={generating}
                style={{
                  padding: '10px 20px', borderRadius: 8, border: 'none',
                  cursor: generating ? 'not-allowed' : 'pointer',
                  background: generating ? '#9CA3AF' : '#1B4F8A',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                {generating
                  ? <><span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Generating…</>
                  : '⚡ Generate Now'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#0D2E5A' }}>🏅 Certificates</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>Issued student certificates</p>
            {lastSynced && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>Last synced: {formatDate(lastSynced)}</p>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', cursor: syncing ? 'not-allowed' : 'pointer', background: syncing ? '#9CA3AF' : '#2EAA4A', color: '#fff', fontSize: 13, fontWeight: 600 }}
          >
            {syncing ? 'Syncing…' : '🔄 Sync from Apps Script'}
          </button>
        </div>

        {/* ── Table ── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading certificates…</div>
          ) : certs.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 8 }}>No certificates yet</div>
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>Click &quot;Sync from Apps Script&quot; to import, or wait for the cron job to generate certificates.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                    {['Cert ID', 'Name', 'Course', 'Grade', 'Issue Date', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {certs.map((cert, i) => (
                    <tr key={cert.registration_id + i} style={{ borderBottom: i < certs.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                      <td style={{ padding: '12px 16px', color: '#374151', fontFamily: 'monospace', fontSize: 11 }}>
                        {cert.certificate_id ?? cert.registration_id}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1F2937' }}>{cert.full_name}</td>
                      <td style={{ padding: '12px 16px', color: '#4B5563' }}>{cert.course}</td>
                      <td style={{ padding: '12px 16px', color: '#4B5563' }}>{cert.grade ?? '-'}</td>
                      <td style={{ padding: '12px 16px', color: '#4B5563', whiteSpace: 'nowrap' }}>
                        {formatDate(cert.issued_at ?? cert.issued_date)}
                      </td>
                      <td style={{ padding: '12px 16px' }}><StatusBadge status={cert.cert_status} /></td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <a
                            href={getVerifyLink(cert)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#EFF6FF', color: '#1D4ED8', textDecoration: 'none', whiteSpace: 'nowrap' }}
                          >
                            Verify ↗
                          </a>
                          <button
                            onClick={() => copyLink(cert)}
                            style={{ padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#374151', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
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
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
