'use client';

/**
 * Admin > API Keys
 *
 * Shows the shared secrets the platform hands to partners, so an admin can copy
 * one without opening the Vercel dashboard or an env file.
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
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

/** How long a revealed key stays on screen before hiding itself again. */
const AUTO_HIDE_MS = 60_000;

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
  configured: boolean;
  length: number;
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

function KeyCard({ meta }: { meta: KeyMeta }): React.JSX.Element {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  /** One path to the secret, used by both Reveal and Copy, so neither can get
   *  the value without the server writing an audit row. */
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
        setError(body?.error === 'not_configured'
          ? `${meta.envVar} is not set on this deployment.`
          : `Could not read the key (${body?.error ?? res.status}).`);
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

  const endpoint = `${APP_URL}${meta.endpointPath}`;

  return (
    <section style={card} data-testid={`api-key-${meta.id}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', margin: 0 }}>{meta.label}</h2>
        <code style={{ ...mono, fontSize: 11, color: '#6B7280' }}>{meta.envVar}</code>
      </div>
      <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 18px' }}>{meta.consumer}</p>

      {/* ── The key itself ───────────────────────────────────────────────── */}
      <div style={label}>Key</div>
      {!meta.configured ? (
        <div
          data-testid={`api-key-${meta.id}-unset`}
          style={{
            border: '1px solid #F5C6A5', background: '#FEF6EE', borderRadius: 8,
            padding: '12px 14px', fontSize: 13, color: '#92400E', marginBottom: 18,
          }}
        >
          <strong>Not configured.</strong> <code style={mono}>{meta.envVar}</code> is not set on this
          deployment, so the endpoint refuses every request. It fails closed by design: an unset key
          rejects callers rather than serving the feed openly. Set it in the Vercel project
          environment variables and redeploy.
        </div>
      ) : (
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
            {meta.length} characters. Revealing or copying is recorded in the audit log, and a
            revealed key hides itself again after a minute.
          </p>
        </>
      )}

      {error && (
        <div
          data-testid={`api-key-${meta.id}-error`}
          style={{ fontSize: 12, color: '#C00000', marginBottom: 14, fontWeight: 600 }}
        >
          {error}
        </div>
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
  }, [status]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>🔑 API Keys</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32, maxWidth: 760 }}>
          Shared secrets the platform issues to partners. Values are read from the server environment
          and are sent to this page only when you explicitly reveal or copy one, which is recorded in
          the audit log. Treat anything here as a live credential.
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
        {keys?.map((k) => (<KeyCard key={k.id} meta={k} />))}
      </main>
    </div>
  );
}
