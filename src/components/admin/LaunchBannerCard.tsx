'use client';

/**
 * LaunchBannerCard.tsx (admin)
 *
 * The ONE panel for the public launch countdown banner: the launch date, the
 * editable copy, which platform the launch is for, and, above all of it, a
 * plain statement of whether the banner is showing right now and why.
 *
 * That status line is the reason this is a dedicated card rather than another
 * LaunchStatusCard. Three cards on this page carry a launch date and only this
 * one drives the banner; a date typed into the wrong card, or a save that did
 * not take, looked exactly like success. Now the card answers the only question
 * that matters ("is it live?") from the SAME pure resolver the banner itself
 * uses, so the admin readout cannot drift from what a visitor sees.
 *
 * Writes through the existing /api/admin/modeling-coming-soon route into
 * `training_settings`. No migration: that table is a free-form key/value store.
 *
 * No em dashes in this file.
 */
import { useEffect, useState } from 'react';
import { PLATFORMS } from '@/src/hubs/modeling/config/platforms';
import {
  resolveLaunchCountdown, resolveLaunchCopy,
  DEFAULT_LAUNCH_HEADLINE, DEFAULT_LAUNCH_SUBLINE, PLATFORM_TOKEN,
} from '@/src/hubs/main/components/launch/launchCountdown';

const NAVY = '#1B3A6B';
const NAVY_MID = '#1B4F8A';
const ENDPOINT = '/api/admin/modeling-coming-soon';

interface Fetched {
  launchDate: string;
  headline: string;
  subline: string;
  platformSlug: string;
}

function isoToLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export function LaunchBannerCard({ onMessage }: { onMessage?: (msg: string, type: 'success' | 'error') => void }) {
  const [saved, setSaved] = useState<Fetched>({ launchDate: '', headline: '', subline: '', platformSlug: '' });
  const [dateDraft, setDateDraft] = useState('');
  const [headline, setHeadline] = useState('');
  const [subline, setSubline] = useState('');
  const [platformSlug, setPlatformSlug] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(ENDPOINT)
      .then((r) => r.json())
      .then((j: Partial<Fetched>) => {
        const next: Fetched = {
          launchDate: j.launchDate ?? '', headline: j.headline ?? '',
          subline: j.subline ?? '', platformSlug: j.platformSlug ?? '',
        };
        setSaved(next);
        setDateDraft(isoToLocal(next.launchDate));
        setHeadline(next.headline);
        setSubline(next.subline);
        setPlatformSlug(next.platformSlug);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  const draftIso = localToIso(dateDraft);
  const dirty = draftIso !== saved.launchDate || headline !== saved.headline
    || subline !== saved.subline || platformSlug !== saved.platformSlug;

  // Status is computed from the SAVED date, not the draft, so it describes what
  // visitors actually see rather than what is typed but unsaved.
  const decision = resolveLaunchCountdown({ launchDate: saved.launchDate, nowMs: Date.now() });
  const STATUS: Record<string, { text: string; bg: string; border: string; color: string }> = {
    ok: { text: 'SHOWING NOW', bg: '#E8F7EC', border: '#BBF7D0', color: '#1A7A30' },
    not_set: { text: 'NOT SHOWING', bg: '#FFFBEB', border: '#FDE68A', color: '#92400E' },
    invalid_date: { text: 'NOT SHOWING', bg: '#FEF2F2', border: '#FECACA', color: '#B91C1C' },
    already_launched: { text: 'NOT SHOWING', bg: '#F3F4F6', border: '#E5E7EB', color: '#4B5563' },
  };
  const s = STATUS[decision.reason];
  const why = decision.reason === 'ok'
    ? `Counting down to ${new Date(decision.targetIso).toLocaleString()}. It disappears by itself once that passes.`
    : decision.reason === 'not_set'
      ? 'No launch date is saved, so the banner is hidden. Set a date below and press Save.'
      : decision.reason === 'invalid_date'
        ? 'The saved launch date could not be read as a date, so the banner is hidden.'
        : 'The launch date has passed, so the banner has retired itself.';

  // The exact copy a visitor would see, resolved through the same pure function
  // the banner uses, so the preview cannot lie about token substitution.
  const chosen = platformSlug ? PLATFORMS.find((p) => p.slug === platformSlug) : undefined;
  const autoPlatform = PLATFORMS.find((p) => p.status === 'live') ?? PLATFORMS[0];
  const platformName = (chosen ?? autoPlatform)?.name ?? '';
  const preview = resolveLaunchCopy({ headline, subline, platformName });

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 6, color: NAVY, background: '#fff', fontFamily: "'Inter', sans-serif" };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchDate: draftIso, headline, subline, platformSlug }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        onMessage?.(j.error ? `Save failed: ${j.error}` : 'Save failed', 'error');
        return;
      }
      const j = await res.json() as Partial<Fetched>;
      const next: Fetched = {
        launchDate: j.launchDate ?? '', headline: j.headline ?? '',
        subline: j.subline ?? '', platformSlug: j.platformSlug ?? '',
      };
      setSaved(next);
      setDateDraft(isoToLocal(next.launchDate));
      // Report what the SAVED state now is, so a no-op save cannot read as success.
      onMessage?.(next.launchDate ? 'Launch banner saved and live' : 'Launch date cleared, banner hidden', 'success');
    } catch {
      onMessage?.('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
        📣 Public Launch Countdown Banner
      </div>
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
        A square countdown shown to visitors on the home page, the Modeling Hub pages and the Real Estate platform pages.
        It is driven by the DATE ALONE: it appears while the date is in the future and hides itself once it passes.
        This is also the date the auto-launch cron reads, so there is only one launch date to keep straight.
      </div>

      {/* The status readout. The whole point of this card. */}
      <div data-testid="launch-banner-status"
        style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: s.color, letterSpacing: '0.06em', marginBottom: 3 }}>
          BANNER {s.text}
        </div>
        <div style={{ fontSize: 12, color: s.color, opacity: 0.9 }}>{why}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={label}>LAUNCH DATE &amp; TIME</label>
          <input type="datetime-local" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)}
            data-testid="launch-banner-date" style={input} />
          <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
            Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Clear it to hide the banner immediately.
          </div>
        </div>
        <div>
          <label style={label}>PLATFORM THIS LAUNCH IS FOR</label>
          <select value={platformSlug} onChange={(e) => setPlatformSlug(e.target.value)}
            data-testid="launch-banner-platform" style={input}>
            <option value="">Auto ({autoPlatform?.name ?? 'first live platform'})</option>
            {PLATFORMS.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
            Only the choice is stored. The name comes from the platform config, so renaming a platform updates the banner.
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={label}>HEADLINE</label>
        <input value={headline} onChange={(e) => setHeadline(e.target.value)}
          placeholder={DEFAULT_LAUNCH_HEADLINE} data-testid="launch-banner-headline" style={input} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={label}>SUPPORTING LINE</label>
        <input value={subline} onChange={(e) => setSubline(e.target.value)}
          placeholder={DEFAULT_LAUNCH_SUBLINE} data-testid="launch-banner-subline" style={input} />
        <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
          Type <code style={{ background: '#F3F4F6', padding: '1px 4px', borderRadius: 3 }}>{PLATFORM_TOKEN}</code> in either
          field to insert the platform name. Leave a field empty to use the default shown in grey.
        </div>
      </div>

      <div style={{ background: '#0D2E5A', borderRadius: 10, padding: '14px 16px', marginBottom: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#C9A84C', letterSpacing: '0.1em', marginBottom: 6 }}>PREVIEW</div>
        <div data-testid="launch-banner-preview-headline" style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 3 }}>
          {preview.headline}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{preview.subline}</div>
      </div>

      <button onClick={save} disabled={saving || !dirty} data-testid="launch-banner-save"
        style={{ padding: '9px 20px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700,
          cursor: (saving || !dirty) ? 'not-allowed' : 'pointer', background: NAVY_MID, color: '#fff',
          opacity: (saving || !dirty) ? 0.5 : 1 }}>
        {saving ? 'Saving...' : dirty ? 'Save banner settings' : 'Saved'}
      </button>
    </div>
  );
}
