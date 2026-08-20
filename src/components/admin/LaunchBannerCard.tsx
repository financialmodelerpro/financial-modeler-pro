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
  resolveLaunchState, resolveLaunchCopy, resolveLaunchedCopy,
  DEFAULT_LAUNCH_HEADLINE, DEFAULT_LAUNCH_SUBLINE,
  DEFAULT_LAUNCHED_HEADLINE, DEFAULT_LAUNCHED_SUBLINE, DEFAULT_LAUNCHED_CTA_LABEL,
  PLATFORM_TOKEN,
} from '@/src/hubs/main/components/launch/launchCountdown';

const NAVY = '#1B3A6B';
const NAVY_MID = '#1B4F8A';
const GOLD = '#C9A84C';
const ENDPOINT = '/api/admin/modeling-coming-soon';

interface Fetched {
  launchDate: string;
  headline: string;
  subline: string;
  platformSlug: string;
  bannerEnabled: boolean;
  launchedHeadline: string;
  launchedSubline: string;
  launchedCtaLabel: string;
  launchedCtaHref: string;
}

const EMPTY: Fetched = {
  launchDate: '', headline: '', subline: '', platformSlug: '', bannerEnabled: true,
  launchedHeadline: '', launchedSubline: '', launchedCtaLabel: '', launchedCtaHref: '',
};

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
  const [saved, setSaved] = useState<Fetched>(EMPTY);
  const [dateDraft, setDateDraft] = useState('');
  const [headline, setHeadline] = useState('');
  const [subline, setSubline] = useState('');
  const [platformSlug, setPlatformSlug] = useState('');
  const [bannerEnabled, setBannerEnabled] = useState(true);
  const [launchedHeadline, setLaunchedHeadline] = useState('');
  const [launchedSubline, setLaunchedSubline] = useState('');
  const [launchedCtaLabel, setLaunchedCtaLabel] = useState('');
  const [launchedCtaHref, setLaunchedCtaHref] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  function hydrate(next: Fetched): void {
    setSaved(next);
    setDateDraft(isoToLocal(next.launchDate));
    setHeadline(next.headline);
    setSubline(next.subline);
    setPlatformSlug(next.platformSlug);
    setBannerEnabled(next.bannerEnabled);
    setLaunchedHeadline(next.launchedHeadline);
    setLaunchedSubline(next.launchedSubline);
    setLaunchedCtaLabel(next.launchedCtaLabel);
    setLaunchedCtaHref(next.launchedCtaHref);
  }

  useEffect(() => {
    fetch(ENDPOINT)
      .then((r) => r.json())
      .then((j: Partial<Fetched>) => hydrate({
        ...EMPTY, ...j,
        // Only an explicit false is off, matching the server rule.
        bannerEnabled: j.bannerEnabled !== false,
      }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  const draftIso = localToIso(dateDraft);
  const dirty = draftIso !== saved.launchDate || headline !== saved.headline
    || subline !== saved.subline || platformSlug !== saved.platformSlug
    || bannerEnabled !== saved.bannerEnabled
    || launchedHeadline !== saved.launchedHeadline || launchedSubline !== saved.launchedSubline
    || launchedCtaLabel !== saved.launchedCtaLabel || launchedCtaHref !== saved.launchedCtaHref;

  // Status is computed from the SAVED date, not the draft, so it describes what
  // visitors actually see rather than what is typed but unsaved.
  const decision = resolveLaunchState({
    launchDate: saved.launchDate, nowMs: Date.now(), bannerEnabled: saved.bannerEnabled,
  });
  const STATUS: Record<string, { text: string; bg: string; border: string; color: string }> = {
    ok_countdown: { text: 'SHOWING: COUNTING DOWN', bg: '#E8F7EC', border: '#BBF7D0', color: '#1A7A30' },
    ok_launched: { text: 'SHOWING: LAUNCHED', bg: '#E8F7EC', border: '#BBF7D0', color: '#1A7A30' },
    turned_off: { text: 'OFF', bg: '#F3F4F6', border: '#E5E7EB', color: '#4B5563' },
    not_set: { text: 'NOT SHOWING', bg: '#FFFBEB', border: '#FDE68A', color: '#92400E' },
    invalid_date: { text: 'NOT SHOWING', bg: '#FEF2F2', border: '#FECACA', color: '#B91C1C' },
  };
  const s = STATUS[decision.reason];
  const why = decision.reason === 'ok_countdown'
    ? `Counting down to ${new Date(decision.targetIso).toLocaleString()}. At that moment it switches by itself to the launched message below.`
    : decision.reason === 'ok_launched'
      ? `The launch date has passed, so visitors see the launched message. It stays until you switch the banner off.`
      : decision.reason === 'turned_off'
        ? 'The banner is switched off, so no visitor sees it. The launch date is kept, so the auto-launch cron is unaffected.'
        : decision.reason === 'not_set'
          ? 'No launch date is saved, so the banner is hidden. Set a date below and press Save.'
          : 'The saved launch date could not be read as a date, so the banner is hidden.';

  // The exact copy a visitor would see, resolved through the same pure function
  // the banner uses, so the preview cannot lie about token substitution.
  const chosen = platformSlug ? PLATFORMS.find((p) => p.slug === platformSlug) : undefined;
  const autoPlatform = PLATFORMS.find((p) => p.status === 'live') ?? PLATFORMS[0];
  const platformName = (chosen ?? autoPlatform)?.name ?? '';
  const preview = resolveLaunchCopy({ headline, subline, platformName });
  const launchedPreview = resolveLaunchedCopy({
    headline: launchedHeadline, subline: launchedSubline,
    ctaLabel: launchedCtaLabel, ctaHref: launchedCtaHref,
    platformName,
    platformHref: `/modeling/${(chosen ?? autoPlatform)?.slug ?? ''}`,
  });

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 6, color: NAVY, background: '#fff', fontFamily: "'Inter', sans-serif" };

  async function save() {
    // WARN BEFORE SAVING, because this field now GATES THE HUB (2026-08-20).
    //
    // The launch date used to be banner copy: it changed a countdown and
    // nothing else, and only a separate auto-launch flag let it touch the
    // workspace. It is now the single source for the Coming Soon state, so
    // typing a future date CLOSES a hub that is currently open, and every
    // signed-in user without a whitelist entry stops being able to enter.
    //
    // That is a big consequence for a date field that used to be cosmetic, so
    // it is stated before the write rather than discovered afterwards. Only
    // the closing direction is confirmed: opening a hub needs no warning.
    const nowMs = Date.now();
    const willGate = draftIso.trim() !== '' && Date.parse(draftIso) > nowMs;
    const isOpenNow = !(saved.launchDate.trim() !== '' && Date.parse(saved.launchDate) > nowMs);
    if (willGate && isOpenNow) {
      const when = new Date(Date.parse(draftIso)).toISOString().slice(0, 10);
      const ok = window.confirm(
        `This launch date is in the future (${when}).\n\n`
        + 'The launch date now controls the hub itself, not just the banner. '
        + 'Saving this will put the Modeling Hub back into Coming Soon: everyone '
        + 'except admins and whitelisted emails will lose access to the platform '
        + `until ${when}.\n\nSave anyway?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          launchDate: draftIso, headline, subline, platformSlug, bannerEnabled,
          launchedHeadline, launchedSubline, launchedCtaLabel, launchedCtaHref,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        onMessage?.(j.error ? `Save failed: ${j.error}` : 'Save failed', 'error');
        return;
      }
      const j = await res.json() as Partial<Fetched>;
      const next: Fetched = { ...EMPTY, ...j, bannerEnabled: j.bannerEnabled !== false };
      hydrate(next);
      // Report the state the banner is ACTUALLY in now, resolved the same way
      // the banner resolves it, so a no-op save cannot read as success.
      const after = resolveLaunchState({
        launchDate: next.launchDate, nowMs: Date.now(), bannerEnabled: next.bannerEnabled,
      });
      const msg = after.mode === 'countdown' ? 'Saved. Banner is counting down.'
        : after.mode === 'launched' ? 'Saved. Banner is showing the launched message.'
        : after.reason === 'turned_off' ? 'Saved. Banner is switched off.'
        : 'Saved. Banner is hidden (no usable launch date).';
      onMessage?.(msg, 'success');
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
        Shown to visitors on the home page, the Modeling Hub pages and the platform pages. Three states:
        it <strong>counts down</strong> while the date is in the future, switches to the <strong>launched</strong> message
        once that date passes, and stays there until you switch it <strong>off</strong> below. Switching it off is the way to
        retire the banner without touching the date.
      </div>
      {/* THE DATE GATES THE HUB (2026-08-20). It used to be banner copy, so an
          admin could reasonably treat it as cosmetic. Saying so here, next to
          the field, is the cheap half of the fix; the confirm dialog on save is
          the other half. */}
      <div
        data-testid="launch-date-gates-hub"
        style={{
          fontSize: 12, lineHeight: 1.55, color: '#92400E', background: '#FFFBEB',
          border: '1px solid #FDE68A', borderRadius: 8, padding: '9px 12px', marginBottom: 14,
        }}
      >
        <strong>This date controls access, not just the banner.</strong> While it is in the future the
        Modeling Hub is in Coming Soon and only admins and whitelisted emails can open the platform.
        Once it passes, the hub is live. There is no separate switch and no nightly job: the date is
        the single source, so the banner and the hub can no longer disagree.
      </div>

      {/* The status readout. The whole point of this card. */}
      <div data-testid="launch-banner-status"
        style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: s.color, letterSpacing: '0.06em', marginBottom: 3 }}>
          BANNER {s.text}
        </div>
        <div style={{ fontSize: 12, color: s.color, opacity: 0.9 }}>{why}</div>
      </div>

      {/* The master switch. Its own row above everything else, because it
          overrides every other setting on this card. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, cursor: 'pointer' }}>
        <input type="checkbox" checked={bannerEnabled} data-testid="launch-banner-enabled"
          onChange={(e) => setBannerEnabled(e.target.checked)} />
        <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
          Banner is on
          <span style={{ fontWeight: 400, color: '#6B7280' }}>
            {' '}(uncheck to retire it completely, in either state, keeping the launch date)
          </span>
        </span>
      </label>

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

      <div style={{ background: '#0D2E5A', borderRadius: 10, padding: '14px 16px', marginBottom: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: GOLD, letterSpacing: '0.1em', marginBottom: 6 }}>
          PREVIEW: COUNTING DOWN
        </div>
        <div data-testid="launch-banner-preview-headline" style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 3 }}>
          {preview.headline}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{preview.subline}</div>
      </div>

      {/* ── After the launch date passes ──────────────────────────────────── */}
      <div style={{ borderTop: '1px dashed #E5E7EB', paddingTop: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 2 }}>After the launch date passes</div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
          The banner switches to this message by itself, including for anyone already on the page when the countdown hits zero.
          It keeps showing until you switch the banner off above.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>LAUNCHED HEADLINE</label>
          <input value={launchedHeadline} onChange={(e) => setLaunchedHeadline(e.target.value)}
            placeholder={DEFAULT_LAUNCHED_HEADLINE} data-testid="launch-banner-launched-headline" style={input} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>LAUNCHED SUPPORTING LINE</label>
          <input value={launchedSubline} onChange={(e) => setLaunchedSubline(e.target.value)}
            placeholder={DEFAULT_LAUNCHED_SUBLINE} data-testid="launch-banner-launched-subline" style={input} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 12 }}>
          <div>
            <label style={label}>BUTTON LABEL</label>
            <input value={launchedCtaLabel} onChange={(e) => setLaunchedCtaLabel(e.target.value)}
              placeholder={DEFAULT_LAUNCHED_CTA_LABEL} data-testid="launch-banner-cta-label" style={input} />
          </div>
          <div>
            <label style={label}>BUTTON LINK</label>
            <input value={launchedCtaHref} onChange={(e) => setLaunchedCtaHref(e.target.value)}
              placeholder={launchedPreview.ctaHref || '/modeling/...'} data-testid="launch-banner-cta-href" style={input} />
            <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
              Leave empty to link to the selected platform&apos;s own page.
            </div>
          </div>
        </div>

        <div style={{ background: '#0D2E5A', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: GOLD, letterSpacing: '0.1em', marginBottom: 6 }}>
            PREVIEW: LAUNCHED
          </div>
          <div data-testid="launch-banner-preview-launched" style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 3 }}>
            {launchedPreview.headline}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>{launchedPreview.subline}</div>
          <span style={{ display: 'inline-block', background: GOLD, color: '#0D2E5A', fontWeight: 800, fontSize: 12, padding: '7px 16px', borderRadius: 7 }}>
            {launchedPreview.ctaLabel}
          </span>
        </div>
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
