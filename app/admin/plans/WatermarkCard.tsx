'use client';

/**
 * WatermarkCard (2026-08-20)
 *
 * Admin control for the trial export watermark: master switch, the text drawn
 * across every page, and which plans it applies to.
 *
 * Stored as one JSON blob in the shared cms_content row (section 'exports',
 * key 'pdf_watermark') through the existing admin content route, so there is
 * no new table and no migration. The rules that read it live in
 * src/shared/entitlements/exportWatermark.ts and this screen imports the same
 * parser, so what the admin sees is what the export resolves.
 *
 * Deliberately does NOT touch `white_label_pdf`. That flag lets a firm remove
 * our branding from a document they send to their own client; this decides
 * whether a document is marked as coming from a trial. Two questions, two
 * flags. See the header of exportWatermark.ts.
 *
 * No em dashes in this file.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  DEFAULT_WATERMARK_SETTINGS,
  WATERMARK_SECTION,
  WATERMARK_KEY,
  WATERMARK_TEXT_MAX,
  parseWatermarkSettings,
  resolveWatermarkSpec,
  type WatermarkSettings,
} from '@/src/shared/entitlements/exportWatermark';

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.03em' };

export function WatermarkCard({
  planKeys,
  showToast,
}: {
  /** Every plan the platform sells, from the live plan list, so a new plan
   *  appears here without this file being edited. */
  planKeys: string[];
  showToast: (msg: string, type: 'success' | 'error') => void;
}) {
  const [s, setS] = useState<WatermarkSettings>(DEFAULT_WATERMARK_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/content?section=${encodeURIComponent(WATERMARK_SECTION)}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        const rows = (res.rows ?? []) as { key: string; value: string | null }[];
        const row = rows.find((r) => r.key === WATERMARK_KEY);
        // Absent row means defaults, which are ON for trial. The card shows
        // that state rather than an empty form, so an admin who has never
        // opened this screen can still see what is actually happening.
        if (!row || !row.value) { setS(DEFAULT_WATERMARK_SETTINGS); setLoaded(true); return; }
        try { setS(parseWatermarkSettings(JSON.parse(row.value))); }
        catch { setS(DEFAULT_WATERMARK_SETTINGS); }
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) { setS(DEFAULT_WATERMARK_SETTINGS); setLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: WATERMARK_SECTION, key: WATERMARK_KEY, value: JSON.stringify(s) }),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); return; }
      showToast('Watermark settings saved', 'success');
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [s, showToast]);

  const togglePlan = (k: string) => setS((prev) => ({
    ...prev,
    plans: prev.plans.includes(k) ? prev.plans.filter((p) => p !== k) : [...prev.plans, k],
  }));

  // The live consequence, computed by the SAME resolver the export uses, so
  // this line cannot claim something the export does not do.
  const marked = planKeys.filter((k) => resolveWatermarkSpec(k, s) !== null);

  return (
    <div data-testid="watermark-card" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px', marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#0D2E5A', marginBottom: 4, letterSpacing: '0.03em' }}>
        PDF EXPORT WATERMARK
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
        Drawn diagonally across every page of a PDF exported by a listed plan, with a footer line on each page.
        Applies to the full report, the summary report and the IC deck PDF. Paid plans not listed here export unmarked.
        This is separate from White-label PDF, which removes our branding for a firm.
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#0f172a', marginBottom: 12 }}>
        <input
          type="checkbox"
          data-testid="watermark-enabled"
          checked={s.enabled}
          onChange={(e) => setS((p) => ({ ...p, enabled: e.target.checked }))}
        />
        <span><strong>Watermark enabled</strong>. Off means no export is watermarked, whatever is ticked below.</span>
      </label>

      <div style={{ marginBottom: 12 }}>
        <div style={LABEL}>WATERMARK TEXT</div>
        <input
          type="text"
          data-testid="watermark-text"
          value={s.text}
          maxLength={WATERMARK_TEXT_MAX}
          onChange={(e) => setS((p) => ({ ...p, text: e.target.value }))}
          style={{ width: '100%', maxWidth: 380, padding: '7px 9px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, marginTop: 4 }}
        />
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
          Up to {WATERMARK_TEXT_MAX} characters. Longer text is drawn smaller and stops being readable.
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ ...LABEL, marginBottom: 5 }}>APPLIES TO THESE PLANS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
          {planKeys.map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#334155' }}>
              <input
                type="checkbox"
                data-testid={`watermark-plan-${k}`}
                checked={s.plans.includes(k)}
                onChange={() => togglePlan(k)}
              />
              {k}
            </label>
          ))}
        </div>
      </div>

      {/* Stated from the resolver, not from the checkboxes, so a disabled
          master switch reads as "nothing is watermarked" rather than leaving
          the ticks looking live. */}
      <div
        data-testid="watermark-effect"
        style={{
          fontSize: 11.5, borderRadius: 6, padding: '7px 10px', marginBottom: 12,
          background: marked.length > 0 ? '#ECFDF5' : '#F1F5F9',
          color: marked.length > 0 ? '#166534' : '#475569',
          border: `1px solid ${marked.length > 0 ? '#A7F3D0' : '#E2E8F0'}`,
        }}
      >
        {marked.length > 0
          ? `Right now: exports on ${marked.join(', ')} are watermarked "${s.text}". Every other plan exports unmarked.`
          : 'Right now: no plan is watermarked. Every export is unmarked.'}
      </div>

      <button
        type="button"
        data-testid="watermark-save"
        onClick={() => void save()}
        disabled={saving || !loaded}
        style={{
          padding: '7px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: 6,
          border: 'none', background: saving ? '#94a3b8' : '#0D2E5A', color: '#fff',
          cursor: saving ? 'default' : 'pointer',
        }}
      >
        {saving ? 'Saving...' : 'Save watermark settings'}
      </button>
    </div>
  );
}
