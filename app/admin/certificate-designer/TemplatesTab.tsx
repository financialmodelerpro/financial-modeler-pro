'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

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

export function TemplatesTab() {
  const [toast, setToast] = useState('');
  const [templateStatus, setTemplateStatus] = useState<TemplateStatus>({
    '3sfm-cert': false, 'bvm-cert': false, '3sfm-badge': false, 'bvm-badge': false,
  });
  const [uploading, setUploading]     = useState<string | null>(null);
  const [deleting,  setDeleting]      = useState<string | null>(null);
  const [templateUrls, setTemplateUrls] = useState<Partial<Record<keyof TemplateStatus, string>>>({});

  const fileRefs = {
    '3sfm-cert':  useRef<HTMLInputElement>(null),
    'bvm-cert':   useRef<HTMLInputElement>(null),
    '3sfm-badge': useRef<HTMLInputElement>(null),
    'bvm-badge':  useRef<HTMLInputElement>(null),
  };

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

  return (
    <div style={{ padding: 28 }}>
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: '#1B4F8A', color: '#fff', padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', padding: '24px' }}>
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
          💡 After uploading templates, switch to the <strong>Certificate Layout</strong> tab to position text fields on the PDF. Certificates issue automatically the moment a student passes their final exam. If an inline issuance ever misses, use the{' '}
          <a href="/admin/training-hub/certificates" style={{ fontWeight: 700, color: '#1D4ED8' }}>Certificates</a>
          {' '}page to pick it up from the &quot;Eligible but not issued&quot; panel.
        </div>
      </div>
    </div>
  );
}
