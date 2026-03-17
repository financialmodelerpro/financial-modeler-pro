'use client';

import { useEffect, useRef, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

const BUCKETS = ['cms-assets', 'article-covers', 'course-thumbnails', 'founder-media'];

interface MediaFile {
  name:       string;
  size:       number;
  mimetype:   string;
  created_at: string;
  url:        string;
  bucket:     string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function AdminMediaPage() {
  const [bucket,       setBucket]       = useState('cms-assets');
  const [files,        setFiles]        = useState<MediaFile[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [toast,        setToast]        = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MediaFile | null>(null);
  const [copied,       setCopied]       = useState<string | null>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function loadFiles(b = bucket) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media?bucket=${encodeURIComponent(b)}`);
      const j   = await res.json();
      setFiles(j.files ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFiles(bucket); }, [bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    setUploading(true);
    let uploaded = 0;
    for (const f of Array.from(picked)) {
      const form = new FormData();
      form.append('file', f);
      form.append('bucket', bucket);
      const res = await fetch('/api/admin/media', { method: 'POST', body: form });
      if (res.ok) uploaded++;
      else {
        const j = await res.json();
        showToast(`Error: ${j.error}`);
      }
    }
    setUploading(false);
    if (uploaded > 0) {
      showToast(`${uploaded} file${uploaded > 1 ? 's' : ''} uploaded`);
      await loadFiles(bucket);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const res = await fetch('/api/admin/media', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: deleteTarget.bucket, name: deleteTarget.name }),
    });
    setDeleteTarget(null);
    if (res.ok) {
      setFiles((prev) => prev.filter((f) => f.name !== deleteTarget.name));
      showToast('File deleted');
    } else {
      const j = await res.json();
      showToast(`Error: ${j.error}`);
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function isImage(mimetype: string) { return mimetype.startsWith('image/'); }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />

      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1100 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Media Library</h1>
              <p style={{ fontSize: 13, color: '#6B7280' }}>Upload and manage images. Served from Supabase Storage.</p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.7 : 1 }}
            >
              {uploading ? '⏳ Uploading…' : '⬆️ Upload Files'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              style={{ display: 'none' }}
              onChange={handleUpload}
            />
          </div>

          {/* Bucket tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #E5E7EB', marginBottom: 28 }}>
            {BUCKETS.map((b) => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                style={{
                  padding: '8px 16px', fontSize: 12, fontWeight: bucket === b ? 700 : 500,
                  border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: bucket === b ? '2px solid #1B4F8A' : '2px solid transparent',
                  color: bucket === b ? '#1B4F8A' : '#6B7280', marginBottom: -2,
                }}
              >
                {b}
              </button>
            ))}
          </div>

          {/* Upload drop hint */}
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed #D1D5DB', borderRadius: 10, padding: '20px 32px',
              textAlign: 'center', cursor: 'pointer', marginBottom: 28,
              background: '#fff', transition: 'border-color 0.15s',
            }}
          >
            <span style={{ fontSize: 28 }}>📂</span>
            <div style={{ fontSize: 13, color: '#6B7280', marginTop: 6 }}>
              Click to upload to <strong>{bucket}</strong> — JPG, PNG, GIF, WebP, SVG, PDF (max 10 MB)
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading files…</div>
          ) : files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🖼️</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No files in this bucket</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Upload your first file above</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
              {files.map((f) => (
                <div key={f.name} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {/* Thumbnail */}
                  <div style={{ height: 140, background: '#F4F7FC', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {isImage(f.mimetype) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 36 }}>📄</span>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ padding: '10px 12px', flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }} title={f.name}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF' }}>{formatBytes(f.size)}</div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', borderTop: '1px solid #F3F4F6' }}>
                    <button
                      onClick={() => copyUrl(f.url)}
                      style={{ flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: 600, color: copied === f.url ? '#1A7A30' : '#1B4F8A', background: 'none', border: 'none', cursor: 'pointer', borderRight: '1px solid #F3F4F6' }}
                    >
                      {copied === f.url ? '✓ Copied' : 'Copy URL'}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(f)}
                      style={{ flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: 600, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, maxWidth: 420, width: '90%', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 12 }}>Delete File?</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 4 }}>This will permanently remove:</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', background: '#F4F7FC', padding: '8px 12px', borderRadius: 6, marginBottom: 24, wordBreak: 'break-all' }}>
              {deleteTarget.name}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: 7, cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmDelete} style={{ padding: '9px 20px', fontSize: 13, fontWeight: 700, background: '#EF4444', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1A7A30', color: '#fff', fontWeight: 700, fontSize: 13, padding: '10px 20px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 10000 }}>
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
