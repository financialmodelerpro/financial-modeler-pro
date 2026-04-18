'use client';

import { useRef, useState } from 'react';
import type { CanvasElement, CanvasBackground, BrandKit, ImageAsset, BackgroundLibraryItem } from '@/src/lib/marketing/types';

const BORDER = '#E5E7EB';
const NAVY = '#0D2E5A';

interface Props {
  selected: CanvasElement | null;
  background: CanvasBackground;
  brandKit: BrandKit;
  onUpdateElement: (patch: Partial<CanvasElement>) => void;
  onUpdateBackground: (patch: Partial<CanvasBackground>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onAddBrandImage: (url: string) => void;
  onBrandKitChange: (patch: Partial<BrandKit>) => void;
}

export function PropertiesPanel({
  selected, background, brandKit,
  onUpdateElement, onUpdateBackground,
  onDelete, onDuplicate, onBringForward, onSendBackward,
  onBrandKitChange,
}: Props) {
  if (!selected) return <BackgroundPanel background={background} onUpdate={onUpdateBackground} brandKit={brandKit} onBrandKitChange={onBrandKitChange} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel title={`${selected.type[0].toUpperCase() + selected.type.slice(1)} Properties`}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={onDuplicate} style={smallBtn}>Duplicate</button>
          <button onClick={onBringForward} style={smallBtn}>↑ Forward</button>
          <button onClick={onSendBackward} style={smallBtn}>↓ Backward</button>
          <button onClick={onDelete} style={{ ...smallBtn, color: '#DC2626', borderColor: '#FCA5A5' }}>Delete</button>
        </div>

        {/* Position + size */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <NumField label="X"      value={selected.x}      onChange={v => onUpdateElement({ x: v })} />
          <NumField label="Y"      value={selected.y}      onChange={v => onUpdateElement({ y: v })} />
          <NumField label="Width"  value={selected.width}  onChange={v => onUpdateElement({ width: v })} />
          <NumField label="Height" value={selected.height} onChange={v => onUpdateElement({ height: v })} />
        </div>
      </Panel>

      {selected.type === 'text' && selected.text && (
        <TextProps element={selected} onUpdate={onUpdateElement} />
      )}
      {selected.type === 'image' && selected.image && (
        <ImagePropsPanel element={selected} brandKit={brandKit} onUpdate={onUpdateElement} />
      )}
      {selected.type === 'shape' && selected.shape && (
        <ShapePropsPanel element={selected} onUpdate={onUpdateElement} />
      )}
    </div>
  );
}

// ── Text ────────────────────────────────────────────────────────────────────
const FONTS = ['Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman'];

function TextProps({ element, onUpdate }: { element: CanvasElement; onUpdate: (p: Partial<CanvasElement>) => void }) {
  const t = element.text!;
  function patch(p: Partial<typeof t>) { onUpdate({ text: { ...t, ...p } }); }
  return (
    <Panel title="Text">
      <label style={lbl}>Content</label>
      <textarea value={t.content} onChange={e => patch({ content: e.target.value })} rows={3} style={{ ...input, resize: 'vertical', minHeight: 66 }} />

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={lbl}>Font</label>
          <select value={t.fontFamily} onChange={e => patch({ fontFamily: e.target.value })} style={input}>
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Weight</label>
          <select value={t.fontWeight} onChange={e => patch({ fontWeight: Number(e.target.value) as typeof t.fontWeight })} style={input}>
            <option value={400}>400 Regular</option>
            <option value={500}>500 Medium</option>
            <option value={600}>600 Semibold</option>
            <option value={700}>700 Bold</option>
            <option value={800}>800 Extrabold</option>
          </select>
        </div>
      </div>

      <RangeField label="Font size" value={t.fontSize} min={8} max={240} onChange={v => patch({ fontSize: v })} unit="px" />
      <RangeField label="Line height" value={t.lineHeight} min={0.8} max={3} step={0.05} onChange={v => patch({ lineHeight: v })} />
      <RangeField label="Letter spacing" value={t.letterSpacing} min={-10} max={20} onChange={v => patch({ letterSpacing: v })} unit="px" />

      <div style={{ marginTop: 10 }}>
        <label style={lbl}>Color</label>
        <ColorRow value={t.color} onChange={v => patch({ color: v })} />
      </div>

      <div style={{ marginTop: 10 }}>
        <label style={lbl}>Alignment</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['left', 'center', 'right'] as const).map(a => (
            <button key={a} onClick={() => patch({ textAlign: a })} style={{
              ...smallBtn, flex: 1,
              background: t.textAlign === a ? NAVY : '#fff',
              color:      t.textAlign === a ? '#fff' : NAVY,
              borderColor: t.textAlign === a ? NAVY : BORDER,
            }}>{a[0].toUpperCase() + a.slice(1)}</button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <label style={lbl}>Style</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['normal', 'Normal'], ['italic', 'Italic']] as const).map(([val, label]) => (
            <button key={val} onClick={() => patch({ fontStyle: val })} style={{
              ...smallBtn, flex: 1,
              background: (t.fontStyle ?? 'normal') === val ? NAVY : '#fff',
              color:      (t.fontStyle ?? 'normal') === val ? '#fff' : NAVY,
              borderColor: (t.fontStyle ?? 'normal') === val ? NAVY : BORDER,
              fontStyle: val,
            }}>{label}</button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ── Image ───────────────────────────────────────────────────────────────────
function ImagePropsPanel({ element, brandKit, onUpdate }: { element: CanvasElement; brandKit: BrandKit; onUpdate: (p: Partial<CanvasElement>) => void }) {
  const i = element.image!;
  function patch(p: Partial<typeof i>) { onUpdate({ image: { ...i, ...p } }); }

  const brandImages: ImageAsset[] = [
    ...(brandKit.logo_url ? [{ url: brandKit.logo_url, name: 'Primary Logo' }] : []),
    ...(brandKit.logo_light_url ? [{ url: brandKit.logo_light_url, name: 'Light Logo' }] : []),
    ...(brandKit.founder_photo_url ? [{ url: brandKit.founder_photo_url, name: 'Founder Photo' }] : []),
    ...brandKit.additional_logos,
    ...brandKit.additional_photos,
    ...brandKit.uploaded_images,
  ];

  return (
    <Panel title="Image">
      <label style={lbl}>Source URL</label>
      <input type="text" value={i.src} onChange={e => patch({ src: e.target.value })} placeholder="https://…" style={input} />
      <ImageUploadButton onUploaded={url => patch({ src: url })} />

      {brandImages.length > 0 && (
        <>
          <div style={{ ...lbl, marginTop: 10 }}>From Brand Kit</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
            {brandImages.map((img, idx) => (
              <button
                key={idx}
                onClick={() => patch({ src: img.url })}
                title={img.name}
                style={{ padding: 0, border: i.src === img.url ? `2px solid ${NAVY}` : `1px solid ${BORDER}`, borderRadius: 5, cursor: 'pointer', aspectRatio: '1', background: '#F3F4F6', overflow: 'hidden' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={i.lockAspectRatio !== false}
            onChange={e => patch({ lockAspectRatio: e.target.checked })}
          />
          Lock aspect ratio
        </label>
      </div>

      <div style={{ marginTop: 10 }}>
        <label style={lbl}>Object fit</label>
        <select value={i.objectFit} onChange={e => patch({ objectFit: e.target.value as typeof i.objectFit })} style={input}>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Fill</option>
        </select>
      </div>

      <RangeField label="Border radius" value={i.borderRadius} min={0} max={50} onChange={v => patch({ borderRadius: v })} unit="%" />
      <RangeField label="Opacity" value={i.opacity} min={0} max={100} onChange={v => patch({ opacity: v })} unit="%" />
      <RangeField label="Brightness" value={i.brightness} min={0} max={200} onChange={v => patch({ brightness: v })} unit="%" />

      <RangeField label="Border width" value={i.borderWidth ?? 0} min={0} max={20} onChange={v => patch({ borderWidth: v })} unit="px" />
      {(i.borderWidth ?? 0) > 0 && (
        <>
          <label style={{ ...lbl, marginTop: 6 }}>Border color</label>
          <ColorRow value={(i.borderColor && i.borderColor !== 'transparent') ? i.borderColor : '#2DD4BF'} onChange={v => patch({ borderColor: v })} />
        </>
      )}

      <div style={{ marginTop: 10 }}>
        <label style={lbl}>Filter</label>
        <select value={i.filter} onChange={e => patch({ filter: e.target.value as typeof i.filter })} style={input}>
          <option value="none">None</option>
          <option value="grayscale">Grayscale</option>
          <option value="blur">Blur</option>
        </select>
      </div>
    </Panel>
  );
}

// ── Shape ───────────────────────────────────────────────────────────────────
function ShapePropsPanel({ element, onUpdate }: { element: CanvasElement; onUpdate: (p: Partial<CanvasElement>) => void }) {
  const s = element.shape!;
  function patch(p: Partial<typeof s>) { onUpdate({ shape: { ...s, ...p } }); }
  return (
    <Panel title="Shape">
      <label style={lbl}>Background color</label>
      <ColorRow value={s.backgroundColor} onChange={v => patch({ backgroundColor: v })} />

      <RangeField label="Border radius" value={s.borderRadius} min={0} max={50} onChange={v => patch({ borderRadius: v })} unit="%" />
      <RangeField label="Border width" value={s.borderWidth} min={0} max={20} onChange={v => patch({ borderWidth: v })} unit="px" />
      {s.borderWidth > 0 && (
        <>
          <label style={{ ...lbl, marginTop: 6 }}>Border color</label>
          <ColorRow value={s.borderColor === 'transparent' ? '#000000' : s.borderColor} onChange={v => patch({ borderColor: v })} />
        </>
      )}
      <RangeField label="Opacity" value={s.opacity} min={0} max={100} onChange={v => patch({ opacity: v })} unit="%" />

      <div style={{ marginTop: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={s.lockAspectRatio === true}
            onChange={e => patch({ lockAspectRatio: e.target.checked })}
          />
          Lock aspect ratio
        </label>
      </div>
    </Panel>
  );
}

// ── Background ──────────────────────────────────────────────────────────────
function BackgroundPanel({ background, onUpdate, brandKit, onBrandKitChange }: {
  background: CanvasBackground;
  onUpdate: (p: Partial<CanvasBackground>) => void;
  brandKit: BrandKit;
  onBrandKitChange: (patch: Partial<BrandKit>) => void;
}) {
  return (
    <Panel title="Background">
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>Select an element to edit its properties, or set the canvas background here.</div>
      <label style={lbl}>Type</label>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['color', 'gradient', 'image'] as const).map(t => (
          <button key={t} onClick={() => onUpdate({ type: t })} style={{
            ...smallBtn, flex: 1,
            background: background.type === t ? NAVY : '#fff',
            color:      background.type === t ? '#fff' : NAVY,
            borderColor: background.type === t ? NAVY : BORDER,
          }}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {background.type === 'color' && (
        <>
          <label style={lbl}>Color</label>
          <ColorRow value={background.color ?? '#1B4F72'} onChange={v => onUpdate({ color: v })} />
          <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[brandKit.primary_color, brandKit.secondary_color, brandKit.accent_color, brandKit.text_color_dark, '#000000', '#FFFFFF'].map(c => (
              <button key={c} onClick={() => onUpdate({ color: c })} title={c} style={{ width: 24, height: 24, borderRadius: 4, border: `1px solid ${BORDER}`, background: c, cursor: 'pointer' }} />
            ))}
          </div>
        </>
      )}

      {background.type === 'gradient' && (
        <>
          <label style={lbl}>From</label>
          <ColorRow value={background.gradient?.from ?? brandKit.primary_color} onChange={v => onUpdate({ gradient: { from: v, to: background.gradient?.to ?? brandKit.secondary_color, direction: background.gradient?.direction ?? 'to bottom right' } })} />
          <label style={{ ...lbl, marginTop: 8 }}>To</label>
          <ColorRow value={background.gradient?.to ?? brandKit.secondary_color} onChange={v => onUpdate({ gradient: { from: background.gradient?.from ?? brandKit.primary_color, to: v, direction: background.gradient?.direction ?? 'to bottom right' } })} />
          <label style={{ ...lbl, marginTop: 8 }}>Direction</label>
          <select
            value={background.gradient?.direction ?? 'to bottom right'}
            onChange={e => onUpdate({ gradient: { from: background.gradient?.from ?? brandKit.primary_color, to: background.gradient?.to ?? brandKit.secondary_color, direction: e.target.value as never } })}
            style={input}
          >
            <option value="to right">Left → Right</option>
            <option value="to left">Right → Left</option>
            <option value="to bottom">Top → Bottom</option>
            <option value="to top">Bottom → Top</option>
            <option value="to bottom right">Top-Left → Bottom-Right</option>
            <option value="to bottom left">Top-Right → Bottom-Left</option>
            <option value="to top right">Bottom-Left → Top-Right</option>
            <option value="to top left">Bottom-Right → Top-Left</option>
            <option value="radial">Radial</option>
          </select>
        </>
      )}

      {background.type === 'image' && (
        <BackgroundImagePanel background={background} onUpdate={onUpdate} brandKit={brandKit} onBrandKitChange={onBrandKitChange} />
      )}
    </Panel>
  );
}

function BackgroundImagePanel({ background, onUpdate, brandKit, onBrandKitChange }: {
  background: CanvasBackground;
  onUpdate: (p: Partial<CanvasBackground>) => void;
  brandKit: BrandKit;
  onBrandKitChange: (patch: Partial<BrandKit>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function upload(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('bucket', 'cms-assets');
    const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Upload failed');
    return json.url ?? null;
  }

  async function saveLibrary(next: BackgroundLibraryItem[]) {
    setSaving(true);
    setMsg('');
    try {
      onBrandKitChange({ background_library: next });
      const res = await fetch('/api/admin/marketing-studio/brand-kit', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ background_library: next }),
      });
      if (!res.ok) throw new Error('Save failed');
      setMsg('Saved ✓');
      setTimeout(() => setMsg(''), 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onUploadAndSave(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await upload(file);
      if (!url) throw new Error('No URL returned');
      const newItem: BackgroundLibraryItem = {
        id: 'bg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: file.name.replace(/\.[^.]+$/, ''),
        url,
        thumbnail: url,
        type: 'custom',
      };
      await saveLibrary([...brandKit.background_library, newItem]);
      onUpdate({ image: url });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = '';
    }
  }

  async function removeFromLibrary(item: BackgroundLibraryItem) {
    if (item.type === 'brand') return;
    if (!confirm(`Remove "${item.name}" from library?`)) return;
    await saveLibrary(brandKit.background_library.filter(b => b.id !== item.id));
  }

  const overlay = background.overlay;

  return (
    <>
      <label style={lbl}>Image URL</label>
      <input type="text" value={background.image ?? ''} onChange={e => onUpdate({ image: e.target.value })} placeholder="https://…" style={input} />

      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
        <button onClick={() => ref.current?.click()} disabled={uploading || saving} style={{ ...smallBtn, flex: 1 }}>
          {uploading ? 'Uploading…' : '↑ Upload Background'}
        </button>
        <input ref={ref} type="file" accept="image/*" onChange={onUploadAndSave} style={{ display: 'none' }} />
        {msg && <span style={{ fontSize: 10, color: msg.includes('fail') ? '#DC2626' : '#059669' }}>{msg}</span>}
      </div>

      {brandKit.background_library.length > 0 && (
        <>
          <label style={{ ...lbl, marginTop: 12 }}>Library</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
            {brandKit.background_library.map((bg) => (
              <div key={bg.id} style={{ position: 'relative', borderRadius: 5, overflow: 'hidden', border: background.image === bg.url ? `2px solid ${NAVY}` : `1px solid ${BORDER}`, cursor: 'pointer', aspectRatio: '16/9', background: bg.url ? '#F3F4F6' : 'linear-gradient(135deg, #0A1F3C, #1B4F72)' }}>
                <button
                  onClick={() => bg.url && onUpdate({ image: bg.url })}
                  title={bg.name + (bg.type === 'brand' ? ' (Brand)' : '')}
                  style={{ width: '100%', height: '100%', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }}
                >
                  {bg.url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={bg.thumbnail || bg.url} alt={bg.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ color: '#fff', fontSize: 9, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: 4, textAlign: 'center' }}>
                      {bg.name}
                    </span>
                  )}
                </button>
                {bg.type === 'brand' ? (
                  <span style={{ position: 'absolute', bottom: 2, left: 2, background: '#F59E0B', color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, letterSpacing: '0.05em' }}>BRAND</span>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFromLibrary(bg); }}
                    title="Remove"
                    style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: '#DC2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 800, lineHeight: 1 }}
                  >×</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 10, padding: 8, background: '#F9FAFB', borderRadius: 5 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!overlay}
            onChange={e => onUpdate({ overlay: e.target.checked ? { color: '#000000', opacity: 20 } : undefined })}
          />
          Add dark overlay
        </label>
        {overlay && (
          <>
            <div style={{ marginTop: 6 }}>
              <label style={lbl}>Overlay color</label>
              <ColorRow value={overlay.color} onChange={v => onUpdate({ overlay: { color: v, opacity: overlay.opacity } })} />
            </div>
            <RangeField label="Overlay opacity" value={overlay.opacity} min={0} max={100} onChange={v => onUpdate({ overlay: { color: overlay.color, opacity: v } })} unit="%" />
          </>
        )}
      </div>
    </>
  );
}

// ── Atoms ───────────────────────────────────────────────────────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type="number" value={Math.round(value)} onChange={e => onChange(Number(e.target.value))} style={input} />
    </div>
  );
}

function RangeField({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <label style={lbl}>{label}</label>
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>{value}{unit ?? ''}</span>
      </div>
      <input type="range" min={min} max={max} step={step ?? 1} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%' }} />
    </div>
  );
}

function ColorRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 32, height: 28, border: `1px solid ${BORDER}`, borderRadius: 5, cursor: 'pointer', background: '#fff', padding: 2 }} />
      <input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ ...input, fontFamily: 'monospace', fontSize: 11 }} />
    </div>
  );
}

function ImageUploadButton({ onUploaded }: { onUploaded: (url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bucket', 'cms-assets');
      const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.url) onUploaded(json.url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = '';
    }
  }

  return (
    <>
      <button onClick={() => ref.current?.click()} disabled={uploading} style={{ ...smallBtn, marginTop: 6, width: '100%' }}>
        {uploading ? 'Uploading…' : '↑ Upload Image'}
      </button>
      <input ref={ref} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
    </>
  );
}

// Shared styles
const input: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '6px 8px', border: `1px solid ${BORDER}`,
  borderRadius: 5, background: '#fff', color: '#111827', fontFamily: 'inherit', boxSizing: 'border-box',
};
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 600, color: '#4B5563', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
};
const smallBtn: React.CSSProperties = {
  padding: '5px 9px', fontSize: 10, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
  border: `1px solid ${BORDER}`, background: '#fff', color: NAVY,
};
