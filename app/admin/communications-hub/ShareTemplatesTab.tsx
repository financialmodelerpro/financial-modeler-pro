'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  renderShareTemplate, SAMPLE_VARS, TEMPLATE_VARIABLES,
  DEFAULT_BRAND_MENTION, DEFAULT_FOUNDER_MENTION,
  type ShareTemplate, type ShareSettings,
} from '@/src/shared/share/shareTemplates';

const NAVY   = '#1B3A6B';
const BLUE   = '#1B4F8A';
const GREEN  = '#2EAA4A';
const GOLD   = '#C9A84C';
const BORDER = '#E5E7EB';
const MUTED  = '#6B7280';

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: MUTED,
  letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6,
};
const field: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: NAVY, background: '#fff', boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif",
};
const btn = (bg: string, fg = '#fff', disabled = false): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 700, background: bg, color: fg,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});

export function ShareTemplatesTab() {
  const [templates, setTemplates] = useState<ShareTemplate[]>([]);
  const [settings, setSettings]   = useState<ShareSettings>({
    brand_mention:     DEFAULT_BRAND_MENTION,
    founder_mention:   DEFAULT_FOUNDER_MENTION,
    brand_prefix_at:   false,
    founder_prefix_at: false,
  });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const show = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/share-templates');
      const j = await res.json() as { templates?: ShareTemplate[]; settings?: ShareSettings };
      setTemplates(j.templates ?? []);
      if (j.settings) setSettings(j.settings);
    } catch {
      show('Failed to load templates', 'err');
    }
    setLoading(false);
  }, [show]);

  useEffect(() => { void load(); }, [load]);

  function updateLocal(key: string, patch: Partial<ShareTemplate>) {
    setTemplates(prev => prev.map(t => t.template_key === key ? { ...t, ...patch } : t));
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/admin/share-templates/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const j = await res.json() as { error?: string; settings?: ShareSettings };
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      if (j.settings) setSettings(j.settings);
      const next = j.settings;
      if (next) {
        setTemplates(prev => prev.map(t => ({
          ...t,
          brand_mention:     next.brand_mention,
          founder_mention:   next.founder_mention,
          brand_prefix_at:   next.brand_prefix_at,
          founder_prefix_at: next.founder_prefix_at,
        })));
      }
      show('Mention settings saved');
    } catch (e) {
      show((e as Error).message, 'err');
    }
    setSavingSettings(false);
  }

  async function save(t: ShareTemplate) {
    setSavingKey(t.template_key);
    try {
      const res = await fetch(`/api/admin/share-templates/${t.template_key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:           t.title,
          template_text:   t.template_text,
          hashtags:        t.hashtags,
          mention_brand:   t.mention_brand,
          mention_founder: t.mention_founder,
          active:          t.active,
        }),
      });
      const j = await res.json() as { error?: string };
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      show(`"${t.title}" saved`);
    } catch (e) {
      show((e as Error).message, 'err');
    }
    setSavingKey(null);
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: MUTED, margin: 0, maxWidth: 720, lineHeight: 1.55 }}>
          Central source for every share button across the Training Hub. Edit the copy, toggle brand /
          founder @-mentions, manage hashtags — changes apply instantly everywhere (certificate verify
          page, dashboard cert card, achievement cards, assessment passes, live session shares).
        </p>
        <div style={{
          marginTop: 12, padding: '10px 14px', background: '#F0F9FF',
          border: '1px solid #BAE6FD', borderRadius: 8, fontSize: 12, color: '#0C4A6E',
          lineHeight: 1.55, maxWidth: 720,
        }}>
          <strong>Variable syntax:</strong> <code>{'{studentName}'}</code>, <code>{'{course}'}</code> etc. get
          substituted at share time. <code>{'{@brand}'}</code> renders as <code>
            {settings.brand_prefix_at ? '@' : ''}{settings.brand_mention}
          </code> and <code>{'{@founder}'}</code> as <code>
            {settings.founder_prefix_at ? '@' : ''}{settings.founder_mention}
          </code> — both controlled from the Global Mention Settings card below.
        </div>
      </div>

      {!loading && (
        <div style={{
          background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12,
          padding: '18px 22px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>🏷️</span>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: NAVY, margin: 0 }}>Global mention settings</h2>
            <span style={{ flex: 1, height: 1, background: '#F3F4F6' }} />
          </div>
          <p style={{ fontSize: 12, color: MUTED, margin: '0 0 14px', lineHeight: 1.55 }}>
            These values drive <code>{'{@brand}'}</code> and <code>{'{@founder}'}</code> in every template
            above. Store the bare handle — no leading <code>@</code>. Each toggle below decides whether the
            render engine prefixes <code>@</code> (for LinkedIn tagging) or leaves the handle as plain text.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 12 }}>
            <div>
              <label style={label}>Brand name / LinkedIn handle</label>
              <input
                value={settings.brand_mention}
                onChange={e => setSettings(s => ({ ...s, brand_mention: e.target.value.replace(/^@+/, '') }))}
                placeholder="FinancialModelerPro"
                style={field}
              />
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12,
                color: NAVY, fontWeight: 600, cursor: 'pointer', marginTop: 8,
              }}>
                <input
                  type="checkbox"
                  checked={settings.brand_prefix_at}
                  onChange={e => setSettings(s => ({ ...s, brand_prefix_at: e.target.checked }))}
                />
                Prefix <code>@</code> for Brand
              </label>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>
                Live preview: <code style={{ color: BLUE }}>
                  {settings.brand_prefix_at ? '@' : ''}{settings.brand_mention || DEFAULT_BRAND_MENTION}
                </code>
              </div>
            </div>
            <div>
              <label style={label}>Founder name / LinkedIn handle</label>
              <input
                value={settings.founder_mention}
                onChange={e => setSettings(s => ({ ...s, founder_mention: e.target.value.replace(/^@+/, '') }))}
                placeholder="Ahmad Din, ACCA, FMVA®"
                style={field}
              />
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12,
                color: NAVY, fontWeight: 600, cursor: 'pointer', marginTop: 8,
              }}>
                <input
                  type="checkbox"
                  checked={settings.founder_prefix_at}
                  onChange={e => setSettings(s => ({ ...s, founder_prefix_at: e.target.checked }))}
                />
                Prefix <code>@</code> for Founder
              </label>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>
                Live preview: <code style={{ color: '#92400E' }}>
                  {settings.founder_prefix_at ? '@' : ''}{settings.founder_mention || DEFAULT_FOUNDER_MENTION}
                </code>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveSettings} disabled={savingSettings} style={btn(BLUE, '#fff', savingSettings)}>
              {savingSettings ? 'Saving…' : 'Save mention settings'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED }}>Loading templates…</div>
      ) : templates.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          No templates found. Run migration <code>114_share_templates.sql</code> to seed defaults.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {templates.map(t => (
            <TemplateEditor
              key={t.template_key}
              template={t}
              saving={savingKey === t.template_key}
              onChange={patch => updateLocal(t.template_key, patch)}
              onSave={() => save(t)}
            />
          ))}
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          padding: '12px 18px', borderRadius: 10,
          background: toast.type === 'ok' ? GREEN : '#DC2626',
          color: '#fff', fontSize: 13, fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function TemplateEditor({
  template, saving, onChange, onSave,
}: {
  template: ShareTemplate;
  saving: boolean;
  onChange: (patch: Partial<ShareTemplate>) => void;
  onSave: () => void;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const knownVars = TEMPLATE_VARIABLES[template.template_key] ?? [];

  const preview = useMemo(() => renderShareTemplate(template, SAMPLE_VARS), [template]);
  const previewFull = preview.hashtags.length
    ? `${preview.text}\n\n${preview.hashtags.map(h => `#${h}`).join(' ')}`
    : preview.text;

  function insertToken(token: string) {
    const ta = textAreaRef.current;
    if (!ta) { onChange({ template_text: template.template_text + token }); return; }
    const start = ta.selectionStart ?? template.template_text.length;
    const end   = ta.selectionEnd   ?? template.template_text.length;
    const next  = template.template_text.slice(0, start) + token + template.template_text.slice(end);
    onChange({ template_text: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div style={{
      background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12,
      padding: '20px 22px', opacity: template.active ? 1 : 0.65,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: GOLD, letterSpacing: '0.1em', marginBottom: 4 }}>
            {template.template_key}
          </div>
          <input
            value={template.title}
            onChange={e => onChange({ title: e.target.value })}
            placeholder="Template title (admin label)"
            style={{ ...field, fontSize: 16, fontWeight: 700, color: NAVY, border: 'none', padding: '2px 0', background: 'transparent' }}
          />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: template.active ? GREEN : MUTED, cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={template.active} onChange={e => onChange({ active: e.target.checked })} />
          {template.active ? 'Active' : 'Disabled'}
        </label>
      </div>

      {knownVars.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ ...label, marginBottom: 0, marginRight: 2 }}>Insert:</span>
          {knownVars.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => insertToken(`{${v}}`)}
              style={{ padding: '4px 10px', borderRadius: 999, border: `1px solid ${BORDER}`, background: '#F3F4F6', color: NAVY, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer' }}
            >
              {`{${v}}`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => insertToken('{@brand}')}
            style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid #BAE6FD', background: '#EFF6FF', color: BLUE, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer' }}
          >
            {'{@brand}'}
          </button>
          <button
            type="button"
            onClick={() => insertToken('{@founder}')}
            style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid #FDE68A', background: '#FFFBEB', color: '#92400E', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer' }}
          >
            {'{@founder}'}
          </button>
        </div>
      )}

      <label style={label}>Template text</label>
      <textarea
        ref={textAreaRef}
        value={template.template_text}
        onChange={e => onChange({ template_text: e.target.value })}
        rows={8}
        style={{ ...field, fontFamily: "'Inter', 'Menlo', monospace", fontSize: 13, lineHeight: 1.55, resize: 'vertical' }}
      />

      <div style={{ marginTop: 14 }}>
        <label style={label}>Hashtags</label>
        <HashtagEditor
          hashtags={template.hashtags}
          onChange={hashtags => onChange({ hashtags })}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={label}>Preview (with sample data)</label>
        <div style={{
          background: '#F9FAFB', border: `1px dashed ${BORDER}`, borderRadius: 8,
          padding: '14px 16px', fontSize: 13, color: '#1F2937',
          whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'Inter, sans-serif',
        }}>
          {previewFull}
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onSave} disabled={saving} style={btn(BLUE, '#fff', saving)}>
          {saving ? 'Saving…' : 'Save template'}
        </button>
      </div>
    </div>
  );
}

function HashtagEditor({
  hashtags, onChange,
}: { hashtags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function add(raw: string) {
    const clean = raw.trim().replace(/^#+/, '').replace(/\s+/g, '');
    if (!clean) return;
    if (hashtags.includes(clean)) return;
    onChange([...hashtags, clean]);
    setDraft('');
  }

  function remove(idx: number) {
    onChange(hashtags.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...hashtags];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {hashtags.map((h, i) => (
          <div key={`${h}-${i}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 6px 4px 10px', borderRadius: 999, background: '#EFF6FF',
            border: '1px solid #BAE6FD', fontSize: 12, color: BLUE, fontWeight: 600,
          }}>
            <span>#{h}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} title="Move left"
              style={{ background: 'none', border: 'none', color: i === 0 ? '#9CA3AF' : BLUE, cursor: i === 0 ? 'default' : 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>
              ◀
            </button>
            <button onClick={() => move(i, 1)} disabled={i === hashtags.length - 1} title="Move right"
              style={{ background: 'none', border: 'none', color: i === hashtags.length - 1 ? '#9CA3AF' : BLUE, cursor: i === hashtags.length - 1 ? 'default' : 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>
              ▶
            </button>
            <button onClick={() => remove(i)} title="Remove"
              style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder="Add hashtag (Enter to confirm)"
          style={{ ...field, flex: 1 }}
        />
        <button type="button" onClick={() => add(draft)} style={btn('#F3F4F6', NAVY)}>
          + Add
        </button>
      </div>
    </div>
  );
}
