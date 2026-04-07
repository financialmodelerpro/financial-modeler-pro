'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

type Course = '3sfm' | 'bvm';

export default function BadgeEditorPage() {
  const [course,      setCourse]      = useState<Course>('3sfm');
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [toast,       setToast]       = useState('');
  const [isError,     setIsError]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string, error = false) {
    setToast(msg);
    setIsError(error);
    setTimeout(() => setToast(''), 4000);
  }

  // Load badge template from Supabase storage on course change
  useEffect(() => {
    setTemplateUrl(null);
    setPreviewUrl(null);

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { data: { publicUrl } } = sb.storage
      .from('badges')
      .getPublicUrl(`templates/${course}-badge.png`);

    const bust = `${publicUrl}?t=${Date.now()}`;

    fetch(bust, { method: 'HEAD' })
      .then(res => { if (res.ok) setTemplateUrl(bust); })
      .catch(() => {});
  }, [course]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.png')) {
      showToast('Only PNG files are accepted for badge templates.', true);
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', `${course}-badge`);

      const res  = await fetch('/api/admin/certificates/upload-template', { method: 'POST', body: form });
      const json = await res.json() as { success?: boolean; url?: string; error?: string };

      if (json.success) {
        setTemplateUrl(`${json.url}?t=${Date.now()}`);
        setPreviewUrl(null);
        showToast('Badge template uploaded successfully.');
      } else {
        showToast(`Upload failed: ${json.error ?? 'Unknown error'}`, true);
      }
    } catch {
      showToast('Upload failed: network error.', true);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete the ${course.toUpperCase()} badge template? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res  = await fetch('/api/admin/certificates/upload-template', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: `${course}-badge` }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (json.success) {
        setTemplateUrl(null);
        setPreviewUrl(null);
        showToast('Badge template deleted.');
      } else {
        showToast(`Delete failed: ${json.error ?? 'Unknown error'}`, true);
      }
    } catch {
      showToast('Delete failed: network error.', true);
    } finally {
      setDeleting(false);
    }
  }

  async function handleGeneratePreview() {
    setGenerating(true);
    setPreviewUrl(null);
    try {
      const res = await fetch('/api/admin/badge-preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ course }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        showToast(`Preview failed: ${err.error ?? res.statusText}`, true);
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (e) {
      showToast(`Preview failed: ${String(e)}`, true);
    } finally {
      setGenerating(false);
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 16,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 800, color: '#9CA3AF',
    letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
  };

  const btnPrimary: React.CSSProperties = {
    width: '100%', padding: '10px 0', borderRadius: 7, fontSize: 13, fontWeight: 700,
    border: 'none', cursor: 'pointer', background: '#2EAA4A', color: '#fff',
  };

  const btnSecondary: React.CSSProperties = {
    width: '100%', padding: '9px 0', borderRadius: 7, fontSize: 13, fontWeight: 700,
    border: '1px solid #1B4F8A', cursor: 'pointer', background: '#EFF6FF', color: '#1B4F8A',
  };

  const btnDanger: React.CSSProperties = {
    width: '100%', marginTop: 8, padding: '7px 0', borderRadius: 7, fontSize: 12,
    fontWeight: 600, border: '1px solid #FECACA', cursor: 'pointer',
    background: '#FEF2F2', color: '#DC2626',
  };

  const imgBox: React.CSSProperties = {
    background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB',
    minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  };

  const placeholder: React.CSSProperties = {
    textAlign: 'center', color: '#9CA3AF', padding: 24,
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* ── Header ── */}
        <div style={{
          padding: '16px 24px', background: '#fff',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0D2E5A' }}>
              🎖 Badge Editor
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9CA3AF' }}>
              Upload badge PNG templates · Preview the issued badge with Certificate ID and Issue Date overlay
            </p>
          </div>
          {toast && (
            <span style={{
              fontSize: 12, fontWeight: 600,
              color:      isError ? '#DC2626' : '#065F46',
              padding:    '6px 12px', borderRadius: 6,
              background: isError ? '#FEF2F2' : '#F0FFF4',
              border:     `1px solid ${isError ? '#FECACA' : '#BBF7D0'}`,
            }}>
              {toast}
            </span>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: 24, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* ── Left panel ── */}
          <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Course selector */}
            <div style={cardStyle}>
              <div style={labelStyle}>Course</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['3sfm', 'bvm'] as const).map(c => (
                  <button key={c} onClick={() => setCourse(c)} style={{
                    flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 13, fontWeight: 700,
                    border: 'none', cursor: 'pointer',
                    background: course === c ? '#1B4F8A' : '#E5E7EB',
                    color:      course === c ? '#fff'    : '#374151',
                  }}>
                    {c.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Upload */}
            <div style={cardStyle}>
              <div style={labelStyle}>Badge Template PNG</div>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6B7280', lineHeight: 1.6 }}>
                Upload a square PNG (recommended 600×600 or 800×800 px).
                Certificate ID and Issue Date are automatically overlaid at the bottom when issuing.
              </p>
              <input ref={fileRef} type="file" accept=".png" onChange={handleUpload}
                style={{ display: 'none' }} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{ ...btnSecondary, opacity: uploading ? 0.6 : 1, cursor: uploading ? 'not-allowed' : 'pointer' }}
              >
                {uploading ? 'Uploading…' : '⬆ Upload PNG'}
              </button>
              {templateUrl && (
                <button onClick={handleDelete} disabled={deleting}
                  style={{ ...btnDanger, opacity: deleting ? 0.6 : 1, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                  {deleting ? 'Deleting…' : '✕ Delete Template'}
                </button>
              )}
            </div>

            {/* Generate preview */}
            <button
              onClick={handleGeneratePreview}
              disabled={!templateUrl || generating}
              style={{
                ...btnPrimary,
                opacity: (!templateUrl || generating) ? 0.5 : 1,
                cursor:  (!templateUrl || generating) ? 'not-allowed' : 'pointer',
              }}
            >
              {generating ? 'Generating…' : '🎖 Generate Preview'}
            </button>

            {/* Overlay info */}
            <div style={{ background: '#F0FFF4', borderRadius: 8, border: '1px solid #BBF7D0', padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#065F46', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Auto Overlay
              </div>
              <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
                <div>🪪 Certificate ID — bottom strip</div>
                <div>📅 Issue Date — below ID</div>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: '#6B7280', lineHeight: 1.5 }}>
                Semi-transparent dark band · White text · Centered · Applied automatically at issuance
              </div>
            </div>
          </div>

          {/* ── Preview panels ── */}
          <div style={{ flex: 1, minWidth: 300, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Raw template */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                📁 Uploaded Template — {course.toUpperCase()}
              </div>
              <div style={imgBox}>
                {templateUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={templateUrl}
                    alt={`${course} badge template`}
                    style={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 8 }}
                  />
                ) : (
                  <div style={placeholder}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>🎖</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No template uploaded</div>
                    <div style={{ fontSize: 11 }}>Upload a PNG badge template to get started</div>
                  </div>
                )}
              </div>
            </div>

            {/* Preview with overlay */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                ✅ Preview with Overlay
              </div>
              <div style={{ ...imgBox, borderColor: previewUrl ? '#BBF7D0' : '#E5E7EB' }}>
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Badge preview with overlay"
                    style={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 8 }}
                  />
                ) : (
                  <div style={placeholder}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      {templateUrl ? 'Click Generate Preview' : 'Upload a template first'}
                    </div>
                    <div style={{ fontSize: 11 }}>
                      {templateUrl
                        ? 'Shows the badge with Certificate ID + Issue Date overlaid'
                        : 'Then click Generate Preview to see the issued badge'}
                    </div>
                  </div>
                )}
              </div>
              {previewUrl && (
                <a
                  href={previewUrl}
                  download={`${course}-badge-preview.png`}
                  style={{
                    display: 'block', marginTop: 10, padding: '9px 16px',
                    borderRadius: 7, fontSize: 13, fontWeight: 600,
                    textAlign: 'center', textDecoration: 'none',
                    background: '#1B4F8A', color: '#fff',
                  }}
                >
                  ⬇ Download Preview PNG
                </a>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
