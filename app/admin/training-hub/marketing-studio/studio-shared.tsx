'use client';

import React, { useEffect, useState } from 'react';
import type { RenderRequest, UploadedAsset } from '@/src/lib/marketing-studio/types';

const RENDER_URL = '/api/admin/training-hub/marketing-studio/render';
const UPLOADS_URL = '/api/admin/training-hub/marketing-studio/uploads';

/**
 * POST a render request and return a blob URL. Caller must revoke when replaced.
 */
export async function renderToBlobUrl(payload: RenderRequest): Promise<string> {
  const res = await fetch(RENDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Render failed (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function downloadBlobUrl(blobUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Hook: list of uploaded background assets, refetched on demand.
 */
export function useUploadedAssets() {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(UPLOADS_URL);
      if (res.ok) {
        const j = await res.json() as { assets: UploadedAsset[] };
        setAssets(j.assets ?? []);
      }
    } catch { /* noop */ }
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { assets, loading, refetch };
}

/* ── Shared visual primitives ──────────────────────────────────────────── */

export function StudioShell({
  title,
  description,
  controls,
  preview,
  exportButton,
}: {
  title: string;
  description: string;
  controls: React.ReactNode;
  preview: React.ReactNode;
  exportButton: React.ReactNode;
}) {
  return (
    <div style={{ padding: 24, display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>{title}</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280', lineHeight: 1.45 }}>{description}</p>
        </div>
        {controls}
        <div>{exportButton}</div>
      </div>
      <div style={{ flex: 1, minWidth: 320 }}>
        {preview}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>{hint}</div>}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px',
  borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 13,
  background: '#fff', outline: 'none',
};

export const textareaStyle: React.CSSProperties = {
  ...inputStyle, resize: 'vertical', minHeight: 64, fontFamily: 'inherit',
};

export const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer',
};

export const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16,
};

export function PrimaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        width: '100%', padding: '11px 16px', borderRadius: 8, border: 'none',
        background: disabled ? '#9CA3AF' : '#1B4F8A', color: '#fff',
        fontSize: 14, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
      }}>{children}</button>
  );
}

export function SecondaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        width: '100%', padding: '10px 16px', borderRadius: 8, border: '1px solid #D1D5DB',
        background: '#fff', color: '#374151',
        fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}>{children}</button>
  );
}

export function PreviewFrame({
  blobUrl, error, generating, aspectRatio,
}: {
  blobUrl: string | null; error: string; generating: boolean; aspectRatio: number;
}) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 900 }}>
      <div style={{
        width: '100%', aspectRatio: String(aspectRatio),
        background: '#1a1a1a', border: '1px solid #E5E7EB', borderRadius: 10,
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {blobUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={blobUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : error ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#FCA5A5', fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚠</div>
            {error}
          </div>
        ) : (
          <div style={{ color: '#6B7280', fontSize: 13, textAlign: 'center', padding: 24 }}>
            {generating ? 'Generating…' : 'Click "Generate Preview" to render'}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline thumbnail picker for choosing an uploaded background. Shows a
 * "(no background)" option first, then up to 12 most recent uploads.
 */
export function BackgroundPicker({
  selectedUrl, onChange,
}: {
  selectedUrl: string | undefined; onChange: (url: string | undefined) => void;
}) {
  const { assets, loading } = useUploadedAssets();

  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Background</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        <button onClick={() => onChange(undefined)}
          style={{
            aspectRatio: '16/9', borderRadius: 6,
            border: !selectedUrl ? '2px solid #1B4F8A' : '1px solid #D1D5DB',
            background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 100%)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 10, fontWeight: 700, padding: 0,
          }}>Brand gradient</button>
        {loading && Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ aspectRatio: '16/9', borderRadius: 6, background: '#F3F4F6' }} />
        ))}
        {assets.slice(0, 11).map(a => (
          <button key={a.id} onClick={() => onChange(a.url)} title={a.name}
            style={{
              aspectRatio: '16/9', borderRadius: 6,
              border: selectedUrl === a.url ? '2px solid #1B4F8A' : '1px solid #D1D5DB',
              backgroundImage: `url("${a.url}")`, backgroundSize: 'cover', backgroundPosition: 'center',
              cursor: 'pointer', padding: 0,
            }} />
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: '#9CA3AF' }}>
        Manage backgrounds in the Asset Library tab.
      </div>
    </div>
  );
}
