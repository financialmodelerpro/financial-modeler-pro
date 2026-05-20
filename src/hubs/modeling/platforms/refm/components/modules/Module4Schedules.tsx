'use client';

/**
 * Module4Schedules.tsx (M4 Pass 2i parent, 2026-05-20)
 *
 * Parent shell that combines the two former tabs (Fixed Assets & D&A,
 * BS Schedules) under a single "Schedules" main tab with an internal
 * sub-tab bar. Per Ahmad 2026-05-20: both surfaces are supporting
 * schedules that feed the Balance Sheet, so they share one entry
 * point with a sub-tab toggle.
 *
 * Sub-tabs:
 *   1. Fixed Assets & D&A:Module4FixedAssets
 *   2. BS Schedules      :Module4BSFeeders (BS-sequence ordered)
 */

import React, { useState } from 'react';
import Module4FixedAssets from './Module4FixedAssets';
import Module4BSFeeders from './Module4BSFeeders';

type SubTab = 'fa' | 'bs';

const SUB_TABS: ReadonlyArray<{ key: SubTab; label: string; icon: string }> = [
  { key: 'fa', label: 'Fixed Assets & D&A', icon: '🏗️' },
  { key: 'bs', label: 'BS Schedules', icon: '📑' },
];

export default function Module4Schedules(): React.JSX.Element {
  const [active, setActive] = useState<SubTab>('fa');

  return (
    <div data-testid="module4-schedules-shell" style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px var(--sp-3) 0',
          borderBottom: '1px solid var(--color-border)',
          marginBottom: 'var(--sp-2)',
        }}
        data-testid="m4-schedules-subtab-row"
      >
        {SUB_TABS.map((tab) => {
          const activeTab = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 600,
                background: activeTab ? 'var(--color-navy)' : 'transparent',
                color: activeTab ? 'var(--color-on-primary-navy)' : 'var(--color-meta)',
                border: '1px solid var(--color-border)',
                borderBottom: activeTab ? '1px solid var(--color-navy)' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                cursor: 'pointer',
                marginBottom: -1,
              }}
              data-testid={`m4-schedules-subtab-${tab.key}`}
            >
              <span style={{ marginRight: 6 }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {active === 'fa' && <Module4FixedAssets />}
      {active === 'bs' && <Module4BSFeeders />}
    </div>
  );
}
