'use client';

import React, { useRef, useState } from 'react';
import { useUploadedAssets } from './studio-shared';
import type { UploadedAsset } from '@/src/lib/marketing-studio/types';

const MAX_BYTES = 10 * 1024 * 1024;

export function AssetLibrary() {
  const { assets, loading, refetch } = useUploadedAssets();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      flash(`File exceeds ${MAX_BYTES / 1024 / 1024} MB`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name.replace(/\.[^.]+$/, ''));
      const res = await fetch('/api/admin/training-hub/marketing-studio/uploads', { method: 'POST', body: fd });
      const j = await res.json() as { error?: string };
      if (!res.ok) flash(j.error ?? 'Upload failed');
      else { flash('Uploaded'); await refetch(); }
    } catch {
      flash('Upload failed - network error');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleRename(id: string, name: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/training-hub/marketing-studio/uploads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        flash((j as { error?: string }).error ?? 'Rename failed');
      } else {
        flash('Renamed');
        await refetch();
      }
    } catch { flash('Rename failed'); }
    setBusy(null);
    setRenaming(null);
  }

  async function handleDelete(asset: UploadedAsset) {
    if (!confirm(`Delete "${asset.name}"? This cannot be undone.`)) return;
    setBusy(asset.id);
    try {
      const res = await fetch(`/api/admin/training-hub/marketing-studio/uploads/${asset.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        flash((j as { error?: string }).error ?? 'Delete failed');
      } else {
        flash('Deleted');
        await refetch();
      }
    } catch { flash('Delete failed'); }
    setBusy(null);
  }

  return (
    <div style={{ padding: 24 }}>
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: '#1B4F8A', color: '#fff', padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>🗂 Background Asset Library</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280', maxWidth: 720, lineHeight: 1.5 }}>
            Upload PNG, JPEG, or WebP backgrounds (max 10 MB). They appear as picker thumbnails in every editor and overlay with your text + brand pack.
          </p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: uploading ? '#9CA3AF' : '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: uploading ? 'not-allowed' : 'pointer' }}>
            {uploading ? 'Uploading…' : '⬆ Upload Background'}
          </button>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#9CA3AF' }}>Loading library…</div>
      ) : assets.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', background: '#fff', borderRadius: 10, border: '1.5px dashed #D1D5DB' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 4 }}>No backgrounds yet</div>
          <div style={{ fontSize: 13, color: '#9CA3AF' }}>Upload your first PNG to get started.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {assets.map(a => (
            <div key={a.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                aspectRatio: '16/9', background: '#1a1a1a', backgroundImage: `url("${a.url}")`,
                backgroundSize: 'cover', backgroundPosition: 'center',
              }} />
              <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {renaming?.id === a.id ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input value={renaming.name} autoFocus
                      onChange={e => setRenaming({ id: a.id, name: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleRename(a.id, renaming.name);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 12, borderRadius: 5, border: '1px solid #1B4F8A', outline: 'none' }} />
                    <button onClick={() => handleRename(a.id, renaming.name)}
                      style={{ padding: '4px 8px', borderRadius: 5, border: 'none', background: '#2EAA4A', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✓</button>
                    <button onClick={() => setRenaming(null)}
                      style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', fontSize: 11, cursor: 'pointer', color: '#6B7280' }}>×</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</div>
                )}
                <div style={{ fontSize: 10, color: '#9CA3AF', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {a.width && a.height && <span>{a.width} × {a.height}</span>}
                  <span>{(a.fileSize / 1024).toFixed(0)} KB</span>
                  <span>{new Date(a.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button onClick={() => setRenaming({ id: a.id, name: a.name })} disabled={busy === a.id}
                    style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: '1px solid #D1D5DB', background: '#F9FAFB', fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                    Rename
                  </button>
                  <button onClick={() => handleDelete(a)} disabled={busy === a.id}
                    style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', fontSize: 11, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>
                    {busy === a.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
