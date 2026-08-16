'use client';

/**
 * Admin > API Keys
 *
 * Shows the shared secrets the platform hands to partners, so an admin can copy
 * or rotate one without opening the Vercel dashboard or an env file.
 *
 * MASKED BY DEFAULT, because this is a secret rendered in a browser that may be
 * screen shared. Revealing is explicit, auto hides again after a minute, and
 * every reveal is recorded in the audit log. COPY GOES THROUGH THE SAME PATH as
 * reveal: copying is reading, so it audits too rather than being the quiet way
 * around the record.
 *
 * The value is fetched only when revealed. The page load carries metadata only,
 * so a secret is never sitting in the initial payload.
 *
 * ── TWO KINDS OF DISCLOSURE, DELIBERATELY DIFFERENT ────────────────────────
 *
 * A REVEALED key auto hides after a minute, because it can always be revealed
 * again. A ROTATED key never auto hides and must be dismissed by hand, because
 * it is stored as a hash and this is the only time it will ever be on screen.
 * Applying the reveal timer to a rotation panel would destroy the value while
 * the admin was still reading it.
 *
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

/** How long a revealed key stays on screen before hiding itself again. */
const AUTO_HIDE_MS = 60_000;

interface RetiredEntry {
  keyPrefix: string;
  createdAt: string;
  retiredAt: string | null;
  retiredBy: string | null;
}

interface KeyMeta {
  id: string;
  label: string;
  envVar: string;
  consumer: string;
  endpointPath: string;
  transport: string;
  grants: string[];
  caveat: string | null;
  slugs: string[];
  source: 'database' | 'environment' | 'none';
  configured: boolean;
  sourceNote: string;
  envConfigured: boolean;
  length: number;
  activePrefix: string | null;
  activeCreatedAt: string | null;
  activeCreatedBy: string | null;
  retired: RetiredEntry[];
  rotatable: boolean;
  revealable: boolean;
  rotationUnavailable: string | null;
  keyStoreError: string | null;
}

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 24, marginBottom: 24,
};
const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13,
};
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6B7280', marginBottom: 6,
};
const btn: React.CSSProperties = {
  border: '1px solid #1B3A6B', background: '#fff', color: '#1B3A6B', borderRadius: 8,
  padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
const btnSolid: React.CSSProperties = { ...btn, background: '#1B3A6B', color: '#fff' };
const btnDanger: React.CSSProperties = {
  ...btn, border: '1px solid #C00000', color: '#C00000', background: '#fff',
};
const btnDangerSolid: React.CSSProperties = { ...btnDanger, background: '#C00000', color: '#fff' };

const notice = (tone: 'warn' | 'bad' | 'good'): React.CSSProperties => ({
  border: `1px solid ${tone === 'bad' ? '#F5A5A5' : tone === 'good' ? '#A9D5BC' : '#F5C6A5'}`,
  background: tone === 'bad' ? '#FEF0F0' : tone === 'good' ? '#F1F9F4' : '#FEF6EE',
  color: tone === 'bad' ? '#C00000' : tone === 'good' ? '#1E5B3A' : '#92400E',
  borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 18,
});

/** Where the endpoint currently gets its key, as a badge. */
function SourceBadge({ source }: { source: KeyMeta['source'] }): React.JSX.Element {
  const map = {
    database: { text: 'Rotated key (database)', bg: '#E8F0FB', fg: '#1B3A6B' },
    environment: { text: 'Environment variable', bg: '#FEF6EE', fg: '#92400E' },
    none: { text: 'No key, endpoint closed', bg: '#FEF0F0', fg: '#C00000' },
  }[source];
  return (
    <span style={{
      background: map.bg, color: map.fg, borderRadius: 999, padding: '3px 10px',
      fontSize: 11, fontWeight: 800, letterSpacing: 0.3, whiteSpace: 'nowrap',
    }}>
      {map.text}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString();
}

function KeyCard({ meta, onChanged }: { meta: KeyMeta; onChanged: () => void }): React.JSX.Element {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [issued, setIssued] = useState<
    { value: string; prefix: string; retiredPrefix: string | null; supersededSource: string; audited: boolean } | null
  >(null);
  const [issuedCopied, setIssuedCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  /** One path to an existing secret, used by both Reveal and Copy, so neither
   *  can get the value without the server writing an audit row. */
  const fetchValue = useCallback(async (): Promise<string | null> => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: meta.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map: Record<string, string> = {
          not_configured: `${meta.envVar} is not set on this deployment.`,
          hashed_not_revealable: 'This key was rotated, so only its hash is stored and it cannot be shown again. Rotate to issue a new one.',
          all_keys_retired: 'Every key has been retired and none is active. Rotate to issue a new one.',
          key_store_unreadable: 'The key store could not be read.',
        };
        setError(map[body?.error] ?? `Could not read the key (${body?.error ?? res.status}).`);
        return null;
      }
      return typeof body.value === 'string' ? body.value : null;
    } catch (e) {
      setError(`Could not reach the server: ${(e as Error).message}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, [meta.id, meta.envVar]);

  const armAutoHide = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setValue(null), AUTO_HIDE_MS);
  };

  const onReveal = async (): Promise<void> => {
    if (value !== null) { setValue(null); return; }
    const v = await fetchValue();
    if (v !== null) { setValue(v); armAutoHide(); }
  };

  const onCopy = async (): Promise<void> => {
    const v = value ?? (await fetchValue());
    if (v === null) return;
    try {
      await navigator.clipboard.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('The browser blocked clipboard access. Reveal the key and copy it by hand.');
    }
  };

  /** Rotate. The old key is refused the moment this returns. */
  const onRotate = async (): Promise<void> => {
    setError(null);
    setRotating(true);
    try {
      const res = await fetch('/api/admin/api-keys/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: meta.id, confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map: Record<string, string> = {
          table_missing: 'Migration 213 (public_api_keys) has not been applied to this database yet, so there is nowhere to store a rotated key. Nothing was changed and the current key still works.',
          not_rotatable: 'This key cannot be rotated from here.',
          confirmation_required: 'The rotation was not confirmed.',
          rotation_failed: `The rotation failed: ${body?.message ?? 'unknown error'}. Nothing was changed and the current key still works.`,
        };
        setError(map[body?.error] ?? `Rotation failed (${body?.error ?? res.status}).`);
        return;
      }
      setConfirming(false);
      setValue(null);
      setIssued({
        value: body.value,
        prefix: body.prefix,
        retiredPrefix: body.retiredPrefix ?? null,
        supersededSource: body.supersededSource ?? 'none',
        audited: body.audited !== false,
      });
      onChanged();
    } catch (e) {
      setError(`Could not reach the server: ${(e as Error).message}`);
    } finally {
      setRotating(false);
    }
  };

  const copyIssued = async (): Promise<void> => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.value);
      setIssuedCopied(true);
      setTimeout(() => setIssuedCopied(false), 2000);
    } catch {
      setError('The browser blocked clipboard access. Select the key above and copy it by hand before dismissing this panel.');
    }
  };

  const endpoint = `${APP_URL}${meta.endpointPath}`;

  return (
    <section style={card} data-testid={`api-key-${meta.id}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', margin: 0 }}>{meta.label}</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <SourceBadge source={meta.source} />
          <code style={{ ...mono, fontSize: 11, color: '#6B7280' }}>{meta.envVar}</code>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 18px' }}>{meta.consumer}</p>

      {/* ── The one-time disclosure of a freshly rotated key ─────────────── */}
      {issued && (
        <div style={{ ...notice('good'), background: '#F1F9F4' }} data-testid={`api-key-${meta.id}-issued`}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>New key issued. This is the only time it will be shown.</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <code
              data-testid={`api-key-${meta.id}-issued-value`}
              style={{
                ...mono, flex: '1 1 340px', minWidth: 0, background: '#fff', border: '1px solid #A9D5BC',
                borderRadius: 8, padding: '10px 12px', overflowX: 'auto', whiteSpace: 'nowrap', color: '#111827',
              }}
            >
              {issued.value}
            </code>
            <button type="button" onClick={copyIssued} style={btnSolid} data-testid={`api-key-${meta.id}-issued-copy`}>
              {issuedCopied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => { setIssued(null); setIssuedCopied(false); }}
              style={btn}
              data-testid={`api-key-${meta.id}-issued-dismiss`}
            >
              I have saved it
            </button>
          </div>
          <p style={{ margin: '0 0 6px', fontSize: 12 }}>
            Only a hash is stored, so it cannot be recovered. If you lose it, rotate again.
          </p>
          <p style={{ margin: 0, fontSize: 12 }}>
            {issued.supersededSource === 'environment'
              ? `The previous key from ${meta.envVar} stopped working the moment this one was issued, and that variable is no longer consulted. You can remove it from the deployment.`
              : issued.supersededSource === 'database'
                ? `The previous key (${issued.retiredPrefix ?? 'unknown'}) stopped working the moment this one was issued.`
                : 'There was no previous key, so nothing stopped working.'}
            {' '}Send this value to the consumer. Their requests will return 401 until they use it.
          </p>
          {!issued.audited && (
            <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: '#92400E' }}>
              The rotation succeeded but the audit row could not be written. Check the server logs.
            </p>
          )}
        </div>
      )}

      {/* ── What is live ─────────────────────────────────────────────────── */}
      <div style={label}>Key</div>

      {meta.keyStoreError && (
        <div style={notice('bad')} data-testid={`api-key-${meta.id}-store-error`}>
          <strong>The key store could not be read.</strong> The endpoint is refusing every request rather
          than falling back to the environment value, because that would resurrect a key a rotation
          retired. Details: {meta.keyStoreError}
        </div>
      )}

      {meta.source === 'none' && !meta.keyStoreError && (
        <div style={notice('warn')} data-testid={`api-key-${meta.id}-unset`}>
          <strong>Not configured.</strong> {meta.sourceNote} It fails closed by design: a missing key
          rejects callers rather than serving the feed openly. Rotate below to issue one, or set{' '}
          <code style={mono}>{meta.envVar}</code> in the deployment environment and redeploy.
        </div>
      )}

      {meta.source === 'database' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <code
              data-testid={`api-key-${meta.id}-value`}
              style={{
                ...mono, flex: '1 1 340px', minWidth: 0, background: '#F4F7FC', border: '1px solid #E8F0FB',
                borderRadius: 8, padding: '10px 12px', overflowX: 'auto', whiteSpace: 'nowrap', color: '#6B7280',
              }}
            >
              {meta.activePrefix}
              {'…'}
            </code>
          </div>
          <p style={{ fontSize: 11, color: '#6B7280', margin: '0 0 18px' }}>
            Issued {fmtDate(meta.activeCreatedAt)}
            {meta.activeCreatedBy ? ` by ${meta.activeCreatedBy}` : ''}. Only the prefix is shown because only
            a hash is stored: this key cannot be revealed or copied, and never could be after the moment it
            was issued. {meta.envConfigured ? `${meta.envVar} is still set on this deployment but is no longer consulted.` : ''}
          </p>
        </>
      )}

      {meta.source === 'environment' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <code
              data-testid={`api-key-${meta.id}-value`}
              style={{
                ...mono, flex: '1 1 340px', minWidth: 0, background: '#F4F7FC', border: '1px solid #E8F0FB',
                borderRadius: 8, padding: '10px 12px', overflowX: 'auto', whiteSpace: 'nowrap',
                color: value === null ? '#6B7280' : '#111827',
              }}
            >
              {value === null ? '•'.repeat(Math.min(meta.length, 48)) : value}
            </code>
            <button type="button" onClick={onReveal} disabled={busy} style={btn} data-testid={`api-key-${meta.id}-reveal`}>
              {busy ? 'Working...' : value === null ? 'Reveal' : 'Hide'}
            </button>
            <button type="button" onClick={onCopy} disabled={busy} style={btnSolid} data-testid={`api-key-${meta.id}-copy`}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#6B7280', margin: '0 0 18px' }}>
            {meta.length} characters, read from <code style={mono}>{meta.envVar}</code>. Revealing or copying
            is recorded in the audit log, and a revealed key hides itself again after a minute.
          </p>
        </>
      )}

      {meta.sourceNote && meta.source !== 'none' && (
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 18px' }} data-testid={`api-key-${meta.id}-source-note`}>
          {meta.sourceNote}
        </p>
      )}

      {error && (
        <div
          data-testid={`api-key-${meta.id}-error`}
          style={{ fontSize: 12, color: '#C00000', marginBottom: 14, fontWeight: 600 }}
        >
          {error}
        </div>
      )}

      {/* ── Rotation ─────────────────────────────────────────────────────── */}
      {meta.rotatable && (
        <>
          <div style={label}>Rotate</div>
          {meta.rotationUnavailable === 'migration_213_not_applied' ? (
            <div style={notice('warn')} data-testid={`api-key-${meta.id}-rotate-unavailable`}>
              <strong>Rotation is not available on this deployment yet.</strong> Migration 213
              (<code style={mono}>public_api_keys</code>) has not been applied, so there is nowhere to store
              an issued key. The endpoint keeps working from <code style={mono}>{meta.envVar}</code> in the
              meantime.
            </div>
          ) : !confirming ? (
            <div style={{ marginBottom: 18 }}>
              <button
                type="button"
                onClick={() => { setConfirming(true); setError(null); }}
                style={btnDanger}
                data-testid={`api-key-${meta.id}-rotate`}
              >
                Rotate key
              </button>
              <p style={{ fontSize: 12, color: '#6B7280', margin: '8px 0 0' }}>
                Issues a new key and stops the current one working immediately. There is no overlap window.
              </p>
            </div>
          ) : (
            <div style={notice('bad')} data-testid={`api-key-${meta.id}-rotate-confirm`}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Rotate this key now?</div>
              <ul style={{ margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}>
                <li>
                  {meta.source === 'environment'
                    ? `The value in ${meta.envVar} stops being accepted immediately and is never consulted again.`
                    : meta.source === 'database'
                      ? `The current key (${meta.activePrefix ?? 'unknown'}) stops being accepted immediately.`
                      : 'No key is currently active, so nothing stops working.'}
                </li>
                <li>Every caller using the old key gets 401 until you send them the new one.</li>
                <li>The new value is shown once and cannot be recovered afterwards.</li>
                <li>The rotation is recorded in the audit log against your account.</li>
              </ul>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={onRotate}
                  disabled={rotating}
                  style={btnDangerSolid}
                  data-testid={`api-key-${meta.id}-rotate-confirm-yes`}
                >
                  {rotating ? 'Rotating...' : 'Yes, rotate now'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={rotating}
                  style={btn}
                  data-testid={`api-key-${meta.id}-rotate-cancel`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Rotation history ─────────────────────────────────────────────── */}
      {meta.retired.length > 0 && (
        <>
          <div style={label}>Retired keys</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 18, fontSize: 12 }} data-testid={`api-key-${meta.id}-history`}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6B7280' }}>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Prefix</th>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Issued</th>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Retired</th>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Retired by</th>
              </tr>
            </thead>
            <tbody>
              {meta.retired.map((r) => (
                <tr key={`${r.keyPrefix}-${r.createdAt}`} style={{ borderTop: '1px solid #E8F0FB', color: '#374151' }}>
                  <td style={{ padding: '6px 8px', ...mono, fontSize: 12 }}>{r.keyPrefix}{'…'}</td>
                  <td style={{ padding: '6px 8px' }}>{fmtDate(r.createdAt)}</td>
                  <td style={{ padding: '6px 8px' }}>{fmtDate(r.retiredAt)}</td>
                  <td style={{ padding: '6px 8px' }}>{r.retiredBy ?? 'unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── Endpoint ─────────────────────────────────────────────────────── */}
      <div style={label}>Endpoint</div>
      <code style={{ ...mono, display: 'block', background: '#F4F7FC', border: '1px solid #E8F0FB', borderRadius: 8, padding: '10px 12px', marginBottom: 6, overflowX: 'auto' }}>
        GET {endpoint}
      </code>
      <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 18px' }}>{meta.transport}</p>

      {/* ── Slugs ────────────────────────────────────────────────────────── */}
      {meta.slugs.length > 0 && (
        <>
          <div style={label}>Whitelisted slugs</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {meta.slugs.map((s) => (
              <code key={s} style={{ ...mono, background: '#E8F0FB', color: '#1B3A6B', borderRadius: 6, padding: '4px 10px', fontWeight: 700 }}>
                {s}
              </code>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 18px' }}>
            These are public names, not the internal CMS slugs. Anything else returns 404, including
            a real page that has not been opted in.
          </p>
        </>
      )}

      {/* ── What it grants ───────────────────────────────────────────────── */}
      <div style={label}>What this key grants</div>
      <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 12, color: '#374151', lineHeight: 1.6 }}>
        {meta.grants.map((g) => (<li key={g}>{g}</li>))}
      </ul>
      {meta.caveat && (
        <p style={{ fontSize: 12, color: '#92400E', background: '#FEF6EE', border: '1px solid #F5C6A5', borderRadius: 8, padding: '10px 12px', margin: 0 }}>
          <strong>Tell the consumer:</strong> {meta.caveat}
        </p>
      )}
    </section>
  );
}

export default function ApiKeysPage(): React.JSX.Element {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [keys, setKeys] = useState<KeyMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && session.user.role !== 'admin') router.replace('/');
  }, [status, session, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let alive = true;
    fetch('/api/admin/api-keys')
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setLoadError(b?.error ?? `Request failed (${r.status})`); return; }
        setKeys(b.keys ?? []);
      })
      .catch((e) => { if (alive) setLoadError((e as Error).message); });
    return () => { alive = false; };
  }, [status, reloadTick]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>🔑 API Keys</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32, maxWidth: 760 }}>
          Shared secrets the platform issues to partners. A key is sent to this page only when you
          explicitly reveal, copy or rotate one, and each of those is recorded in the audit log. Rotating
          issues a new key and stops the old one working immediately, with no overlap window. Treat
          anything here as a live credential.
        </p>

        {loadError && (
          <div style={{ ...card, borderColor: '#F5A5A5', background: '#FEF0F0', color: '#C00000', fontSize: 13, fontWeight: 600 }}>
            Could not load the key list: {loadError}
          </div>
        )}
        {keys === null && !loadError && (
          <div style={{ ...card, color: '#6B7280', fontSize: 13 }}>Loading...</div>
        )}
        {keys?.length === 0 && (
          <div style={{ ...card, color: '#6B7280', fontSize: 13 }}>No API keys are registered.</div>
        )}
        {keys?.map((k) => (
          <KeyCard key={k.id} meta={k} onChanged={() => setReloadTick((t) => t + 1)} />
        ))}
      </main>
    </div>
  );
}
