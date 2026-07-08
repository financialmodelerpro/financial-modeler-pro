'use client';

/**
 * ArticleExtraFields.tsx (admin, client)
 *
 * Shared authoring fields for the paste-and-go rebuild (Phase 1), used by both the
 * new + edit article pages: a mid-article image uploader (+ caption), a social/OG
 * image uploader (falls back to the hero on render when blank), and a freeform
 * hashtag/tags input. All uploads reuse the existing /api/admin/media -> cms-assets
 * path via uploadMediaImage. These map to migration-187 columns and are saved
 * schema-tolerantly by the API, so the UI is safe before the migration is applied.
 *
 * No em dashes in this file.
 */

import { useRef, useState } from 'react';
import { uploadMediaImage } from '@/src/components/admin/ArticleBodyEditor';

export interface ExtraFieldsValue {
  midImageUrl: string;
  midImageCaption: string;
  ogImageUrl: string;
  tags: string[];
}

interface Props {
  value: ExtraFieldsValue;
  onChange: (patch: Partial<ExtraFieldsValue>) => void;
  inputStyle: React.CSSProperties;
  notify?: (msg: string, type: 'success' | 'error') => void;
}

/** Normalize a raw tags string into a clean, deduped hashtag array (no leading #). */
export function parseTags(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim().replace(/^#+/, '').trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out;
}

export function ArticleExtraFields({ value, onChange, inputStyle, notify }: Props): React.JSX.Element {
  const [midUploading, setMidUploading] = useState(false);
  const [ogUploading, setOgUploading] = useState(false);
  const midRef = useRef<HTMLInputElement>(null);
  const ogRef = useRef<HTMLInputElement>(null);

  async function uploadTo(file: File, set: (url: string) => void, setBusy: (b: boolean) => void, label: string) {
    setBusy(true);
    try { set(await uploadMediaImage(file)); notify?.(`${label} uploaded.`, 'success'); }
    catch (e) { notify?.(e instanceof Error ? e.message : 'Upload failed', 'error'); }
    finally { setBusy(false); }
  }

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 };
  const uploadBtn = (busy: boolean): React.CSSProperties => ({ whiteSpace: 'nowrap', padding: '8px 12px', fontSize: 12, fontWeight: 600, border: '1px solid #D1D5DB', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#374151', opacity: busy ? 0.6 : 1 });

  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1B3A6B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Media & Tags</div>

      {/* Mid-article image */}
      <div>
        <label style={labelStyle}>Mid-article image</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={value.midImageUrl} onChange={e => onChange({ midImageUrl: e.target.value })} placeholder="https://… or upload" style={inputStyle} />
          <button type="button" onClick={() => midRef.current?.click()} disabled={midUploading} style={uploadBtn(midUploading)} data-testid="mid-image-upload">
            {midUploading ? 'Uploading…' : '📷 Upload'}
          </button>
          <input ref={midRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTo(f, (u) => onChange({ midImageUrl: u }), setMidUploading, 'Mid image'); e.target.value = ''; }} />
        </div>
        <input value={value.midImageCaption} onChange={e => onChange({ midImageCaption: e.target.value })} placeholder="Caption (optional)" style={{ ...inputStyle, marginTop: 8 }} />
        {value.midImageUrl && <img src={value.midImageUrl} alt="Mid preview" style={{ marginTop: 8, maxHeight: 110, borderRadius: 6, objectFit: 'cover', width: '100%' }} />}
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>Renders where you place the <code style={{ background: '#F1F5F9', padding: '1px 4px', borderRadius: 3 }}>{'{{MID_IMAGE}}'}</code> marker in the body.</div>
      </div>

      {/* Social / OG image */}
      <div>
        <label style={labelStyle}>Social / OG image</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={value.ogImageUrl} onChange={e => onChange({ ogImageUrl: e.target.value })} placeholder="Defaults to cover if blank" style={inputStyle} />
          <button type="button" onClick={() => ogRef.current?.click()} disabled={ogUploading} style={uploadBtn(ogUploading)} data-testid="og-image-upload">
            {ogUploading ? 'Uploading…' : '📷 Upload'}
          </button>
          <input ref={ogRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTo(f, (u) => onChange({ ogImageUrl: u }), setOgUploading, 'OG image'); e.target.value = ''; }} />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label style={labelStyle}>Tags</label>
        <input
          defaultValue={value.tags.join(', ')}
          onChange={e => onChange({ tags: parseTags(e.target.value) })}
          placeholder="comma separated, e.g. real-estate, KSA, feasibility"
          style={inputStyle}
          data-testid="tags-input"
        />
        {value.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {value.tags.map(t => (
              <span key={t} style={{ fontSize: 11, fontWeight: 600, color: '#1B4F8A', background: '#E8F0FB', padding: '3px 8px', borderRadius: 20 }}>#{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
