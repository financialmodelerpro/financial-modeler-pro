'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface Check {
  name:     string;
  status:   'ok' | 'warn' | 'error' | 'unknown';
  detail:   string;
  latency?: number;
}

const STATUS_COLOR = { ok: 'var(--color-green-dark)', warn: '#92400e', error: 'var(--color-negative)', unknown: 'var(--color-grey-mid)' };
const STATUS_BG    = { ok: 'var(--color-green-light)', warn: '#fef3c7', error: '#fee2e2', unknown: 'var(--color-grey-pale)' };
const STATUS_ICON  = { ok: '✓', warn: '⚠', error: '✕', unknown: '?' };

export default function SystemHealth() {
  const [checks,    setChecks]    = useState<Check[]>([]);
  const [running,   setRunning]   = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    const results: Check[] = [];

    // 1. API health endpoint
    try {
      const t0  = Date.now();
      const res = await fetch('/api/health');
      const lat = Date.now() - t0;
      if (res.ok) {
        const json = await res.json();
        results.push({ name: 'API Health', status: 'ok', detail: `v${json.version} · ${lat}ms`, latency: lat });
      } else {
        results.push({ name: 'API Health', status: 'error', detail: `HTTP ${res.status}` });
      }
    } catch (e) {
      results.push({ name: 'API Health', status: 'error', detail: String(e) });
    }

    // 2. Permissions API (hits Supabase indirectly)
    try {
      const t0  = Date.now();
      const res = await fetch('/api/permissions');
      const lat = Date.now() - t0;
      results.push({
        name:    'Permissions API',
        status:  res.ok ? 'ok' : res.status === 401 ? 'warn' : 'error',
        detail:  res.ok ? `${lat}ms` : res.status === 401 ? 'Auth required (expected)' : `HTTP ${res.status}`,
        latency: lat,
      });
    } catch (e) {
      results.push({ name: 'Permissions API', status: 'error', detail: String(e) });
    }

    // 3. Environment variables - server-side check (avoids Next.js static inlining limitation)
    try {
      const res = await fetch('/api/admin/env-check');
      if (res.ok) {
        const json = await res.json() as { checks: { label: string; required: boolean; present: boolean }[] };
        for (const c of json.checks) {
          results.push({
            name:   c.label,
            status: c.present ? 'ok' : c.required ? 'error' : 'warn',
            detail: c.present ? 'Present' : c.required ? 'MISSING - required' : 'Not set (optional)',
          });
        }
      } else {
        results.push({ name: 'Env Vars', status: 'warn', detail: `Could not check (HTTP ${res.status})` });
      }
    } catch (e) {
      results.push({ name: 'Env Vars', status: 'error', detail: String(e) });
    }

    // 4. Browser storage
    try {
      localStorage.setItem('__health_test', '1');
      localStorage.removeItem('__health_test');
      results.push({ name: 'Local Storage', status: 'ok', detail: 'Read/write OK' });
    } catch {
      results.push({ name: 'Local Storage', status: 'error', detail: 'Blocked or unavailable' });
    }

    setChecks(results);
    setCheckedAt(new Date());
    setRunning(false);
  }, []);

  useEffect(() => { run(); }, [run]);

  const overall: Check['status'] = checks.some((c) => c.status === 'error')
    ? 'error'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : checks.length > 0 ? 'ok' : 'unknown';

  return (
    <div style={{ fontFamily: 'Inter,sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', borderRadius: 20,
          background: STATUS_BG[overall], color: STATUS_COLOR[overall],
          fontWeight: 700, fontSize: 13,
        }}>
          <span style={{ fontSize: 16 }}>{STATUS_ICON[overall]}</span>
          {overall === 'ok' ? 'All Systems Operational' : overall === 'warn' ? 'Some Warnings' : overall === 'error' ? 'Issues Detected' : 'Running checks…'}
        </div>
        {checkedAt && (
          <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>
            Last checked: {checkedAt.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={run}
          disabled={running}
          style={{ marginLeft: 'auto', padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', cursor: running ? 'default' : 'pointer', fontFamily: 'Inter,sans-serif', opacity: running ? 0.6 : 1 }}
        >
          {running ? '⏳ Checking…' : '↻ Re-check'}
        </button>
      </div>

      {/* Checks grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {checks.map((c) => (
          <div key={c.name} style={{
            border:     `1px solid ${STATUS_COLOR[c.status]}30`,
            borderLeft: `4px solid ${STATUS_COLOR[c.status]}`,
            borderRadius: 8, padding: '12px 16px',
            background: 'var(--color-grey-white)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: STATUS_BG[c.status], color: STATUS_COLOR[c.status],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800,
              }}>
                {STATUS_ICON[c.status]}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>{c.name}</span>
            </div>
            <div style={{ fontSize: 11, color: STATUS_COLOR[c.status], fontWeight: 600 }}>{c.detail}</div>
            {c.latency !== undefined && (
              <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 2 }}>
                {c.latency < 200 ? '⚡ Fast' : c.latency < 800 ? '🟡 Moderate' : '🔴 Slow'} ({c.latency}ms)
              </div>
            )}
          </div>
        ))}
        {running && checks.length === 0 && (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 16px', background: 'var(--color-grey-pale)', height: 72, animation: 'pulse 1.5s infinite' }} />
          ))
        )}
      </div>
    </div>
  );
}
