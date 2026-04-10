'use client';

import { useState, useEffect } from 'react';

interface MediaPickerProps {
  onSelect: (url: string) => void;
  onClose: () => void;
}

interface MediaFile {
  name: string;
  id: string;
  metadata?: { mimetype?: string; size?: number };
}

const BUCKETS = ['cms-assets', 'article-covers', 'course-thumbnails', 'founder-media'];

export function MediaPicker({ onSelect, onClose }: MediaPickerProps) {
  const [bucket, setBucket] = useState('cms-assets');
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadFiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket]);

  async function loadFiles() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media?bucket=${bucket}`);
      const data = await res.json();
      setFiles(data.files ?? []);
    } catch { setFiles([]); }
    finally { setLoading(false); }
  }

  async function handleUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.svg,.pdf,.ico';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bucket', bucket);
      try {
        const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.url) {
          onSelect(data.url);
          return;
        }
        await loadFiles();
      } catch {}
      finally { setUploading(false); }
    };
    input.click();
  }

  function getPublicUrl(fileName: string) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${fileName}`;
  }

  const isImage = (name: string) => /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(name);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, width: '90vw', maxWidth: 800, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A', flex: 1 }}>Media Library</div>
          <button onClick={handleUpload} disabled={uploading} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: '#2EAA4A', color: '#fff', border: 'none', cursor: 'pointer',
          }}>
            {uploading ? 'Uploading...' : 'Upload New'}
          </button>
          <button onClick={onClose} style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 14, fontWeight: 700,
            background: 'transparent', color: '#9CA3AF', border: 'none', cursor: 'pointer',
          }}>
            &#10005;
          </button>
        </div>

        {/* Bucket tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E5E7EB', padding: '0 20px' }}>
          {BUCKETS.map(b => (
            <button key={b} onClick={() => setBucket(b)} style={{
              padding: '8px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: 'none', background: 'transparent',
              borderBottom: bucket === b ? '2px solid #0D2E5A' : '2px solid transparent',
              color: bucket === b ? '#0D2E5A' : '#9CA3AF',
            }}>
              {b}
            </button>
          ))}
        </div>

        {/* File grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>Loading...</div>
          ) : files.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>No files in this bucket.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
              {files.map(file => {
                const url = getPublicUrl(file.name);
                return (
                  <button key={file.name} onClick={() => onSelect(url)} style={{
                    padding: 8, borderRadius: 8, border: '1px solid #E5E7EB', background: '#F9FAFB',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2EAA4A'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#E5E7EB'; }}
                  >
                    {isImage(file.name) ? (
                      <img src={url} alt={file.name} style={{ width: '100%', height: 80, objectFit: 'contain', borderRadius: 4 }} />
                    ) : (
                      <div style={{ width: '100%', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#9CA3AF' }}>
                        📄
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#6B7280', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                      {file.name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline button that opens the MediaPicker and returns the selected URL */
export function MediaPickerButton({ onSelect, label }: { onSelect: (url: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding: '5px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
        border: '1px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}>
        {label ?? 'Media Library'}
      </button>
      {open && <MediaPicker onSelect={url => { onSelect(url); setOpen(false); }} onClose={() => setOpen(false)} />}
    </>
  );
}
