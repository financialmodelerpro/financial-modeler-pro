'use client';

import { useState } from 'react';
import type { CanvasElement } from '@/src/lib/marketing/types';

const NAVY = '#0D2E5A';
const BORDER = '#E5E7EB';

type Platform = 'linkedin' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube';
type Tone     = 'professional' | 'casual' | 'thought-leader' | 'educational';

const PLATFORM_META: Record<Platform, { label: string; icon: string; color: string }> = {
  linkedin:  { label: 'LinkedIn',  icon: '💼', color: '#0A66C2' },
  instagram: { label: 'Instagram', icon: '📷', color: '#E4405F' },
  facebook:  { label: 'Facebook',  icon: 'ƒ',  color: '#1877F2' },
  whatsapp:  { label: 'WhatsApp',  icon: '💬', color: '#25D366' },
  twitter:   { label: 'Twitter/X', icon: '𝕏',  color: '#000000' },
  youtube:   { label: 'YouTube',   icon: '▶',  color: '#FF0000' },
};

const DEFAULT_PLATFORMS: Platform[] = ['linkedin', 'instagram', 'facebook'];
const ALL_PLATFORMS: Platform[] = ['linkedin', 'instagram', 'facebook', 'whatsapp', 'twitter', 'youtube'];

interface Props {
  templateType: string;
  elements: CanvasElement[];
  captions: Record<string, string>;
  onCaptionsChange: (next: Record<string, string>) => void;
}

export function CaptionsPanel({ templateType, elements, captions, onCaptionsChange }: Props) {
  const [selected, setSelected] = useState<Set<Platform>>(new Set(DEFAULT_PLATFORMS));
  const [tone, setTone] = useState<Tone>('professional');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Platform>('linkedin');
  const [copiedFor, setCopiedFor] = useState<Platform | null>(null);

  function togglePlatform(p: Platform) {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p); else next.add(p);
    setSelected(next);
  }

  async function generate() {
    if (selected.size === 0) { setError('Select at least one platform'); return; }
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/admin/marketing-studio/generate-captions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          template_type: templateType,
          elements,
          platforms: Array.from(selected),
          tone,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      const merged = { ...captions, ...(json.captions || {}) };
      onCaptionsChange(merged);
      // Jump to first successfully-generated tab
      const firstGenerated = Array.from(selected).find(p => (json.captions || {})[p]);
      if (firstGenerated) setActiveTab(firstGenerated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function copy(platform: Platform) {
    const text = captions[platform] || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFor(platform);
      setTimeout(() => setCopiedFor(null), 1500);
    } catch { /* ignore */ }
  }

  const anyGenerated = ALL_PLATFORMS.some(p => captions[p]);

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          ✨ Generate Captions
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <label style={{ fontSize: 10, color: '#6B7280', fontWeight: 600 }}>Tone</label>
          <select value={tone} onChange={e => setTone(e.target.value as Tone)} style={{ fontSize: 11, padding: '5px 7px', border: `1px solid ${BORDER}`, borderRadius: 4 }}>
            <option value="professional">🎯 Professional</option>
            <option value="casual">☕ Casual</option>
            <option value="thought-leader">💡 Thought Leader</option>
            <option value="educational">📚 Educational</option>
          </select>
        </div>
        <button
          onClick={generate}
          disabled={generating || selected.size === 0}
          style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: 'none', background: '#7C3AED', color: '#fff', opacity: generating ? 0.7 : 1 }}
        >
          {generating ? 'Generating…' : `Generate All (${selected.size})`}
        </button>
      </div>

      {/* Platform checkboxes */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {ALL_PLATFORMS.map(p => {
          const active = selected.has(p);
          const meta = PLATFORM_META[p];
          return (
            <label
              key={p}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px',
                fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
                border: active ? `1px solid ${meta.color}` : `1px solid ${BORDER}`,
                background: active ? `${meta.color}15` : '#fff',
                color: active ? meta.color : '#6B7280',
              }}
            >
              <input type="checkbox" checked={active} onChange={() => togglePlatform(p)} style={{ margin: 0 }} />
              <span>{meta.icon}</span> {meta.label}
            </label>
          );
        })}
      </div>

      {error && <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 8 }}>{error}</div>}

      {/* Tabs */}
      {anyGenerated && (
        <>
          <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${BORDER}`, marginBottom: 0, overflowX: 'auto' }}>
            {ALL_PLATFORMS.filter(p => captions[p]).map(p => {
              const meta = PLATFORM_META[p];
              const active = activeTab === p;
              return (
                <button
                  key={p}
                  onClick={() => setActiveTab(p)}
                  style={{
                    padding: '7px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: active ? '#F0F5FA' : 'transparent',
                    border: active ? `1px solid ${BORDER}` : '1px solid transparent',
                    borderBottom: active ? `2px solid ${meta.color}` : '2px solid transparent',
                    color: active ? NAVY : '#6B7280',
                    borderRadius: '5px 5px 0 0', marginBottom: -1, whiteSpace: 'nowrap',
                  }}
                >{meta.icon} {meta.label}</button>
              );
            })}
          </div>

          {(() => {
            const text = captions[activeTab] || '';
            if (!text) return null;
            const meta = PLATFORM_META[activeTab];
            return (
              <div style={{ paddingTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>{text.length} chars</span>
                  <button
                    onClick={() => copy(activeTab)}
                    style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: `1px solid ${meta.color}`, background: copiedFor === activeTab ? meta.color : '#fff', color: copiedFor === activeTab ? '#fff' : meta.color }}
                  >
                    {copiedFor === activeTab ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <textarea
                  value={text}
                  onChange={e => onCaptionsChange({ ...captions, [activeTab]: e.target.value })}
                  rows={Math.max(6, Math.min(20, text.split('\n').length + 2))}
                  style={{ width: '100%', fontSize: 12, lineHeight: 1.5, padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 5, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
