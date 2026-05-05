'use client';

/**
 * ExportModal.tsx (M2.0b restored brand-styled export picker)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand option grid
 * (PDF basic / PDF full / PDF white-label / Excel static / Excel
 * formula model) with per-tier plan badges and unlock states.
 *
 * Adapted to v5: the export pipelines (lib/export/*) still consume
 * the legacy v3/v4 hierarchy. Until they are rebuilt against v5
 * (M2.1), the modal surfaces the option grid but every Download
 * button writes a "rebuilding in M2.1" notice in lieu of running.
 * Plan-gated rows still surface their lock + Upgrade CTA.
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { PLAN_COLOR as TOKEN_PLAN_COLOR } from '@/src/styles/tokens';

type SubscriptionPlan = 'free' | 'professional' | 'enterprise';

interface ExportOption {
  key: string;
  icon: string;
  label: string;
  description: string;
  featureKey: string;
  requiredPlan: SubscriptionPlan;
  available: boolean;
}

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  canAccess?: (featureKey: string) => boolean;
}

const PLAN_COLOR: Record<SubscriptionPlan, string> = {
  free: 'var(--color-grey-mid)',
  professional: 'var(--color-navy)',
  enterprise: TOKEN_PLAN_COLOR.enterprise.color,
};
const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  free: 'Free',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

export default function ExportModal({
  open,
  onClose,
  canAccess,
}: ExportModalProps): React.JSX.Element | null {
  const [notice, setNotice] = useState<string | null>(null);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const access = canAccess ?? (() => false);

  const options: ExportOption[] = [
    {
      key: 'pdf_basic',
      icon: '📄',
      label: 'PDF, Basic Report',
      description: 'Summary financials, project overview',
      featureKey: 'pdf_basic',
      requiredPlan: 'free',
      available: false,
    },
    {
      key: 'pdf_full',
      icon: '📋',
      label: 'PDF, Full Report',
      description: 'All modules, schedules, charts',
      featureKey: 'pdf_full',
      requiredPlan: 'professional',
      available: false,
    },
    {
      key: 'pdf_whitelabel',
      icon: '🏷️',
      label: 'PDF, White-Label',
      description: 'Branded report with client logo',
      featureKey: 'pdf_whitelabel',
      requiredPlan: 'enterprise',
      available: false,
    },
    {
      key: 'excel_static',
      icon: '📊',
      label: 'Excel, Static',
      description: 'Pre-calculated values, formatted',
      featureKey: 'excel_static',
      requiredPlan: 'professional',
      available: false,
    },
    {
      key: 'excel_formula',
      icon: '⚡',
      label: 'Excel, Formula Model',
      description: 'Live formulas, full auditability',
      featureKey: 'excel_formula',
      requiredPlan: 'enterprise',
      available: false,
    },
  ];

  const handleClick = (opt: ExportOption): void => {
    if (!access(opt.featureKey)) return;
    setNotice(
      `${opt.label} export is being rebuilt against the v5 schema. It returns in M2.1 once revenue + statements ship.`,
    );
  };

  const content = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'color-mix(in srgb, var(--color-heading) 55%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="export-modal"
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-modal)',
          width: '100%',
          maxWidth: 480,
          overflow: 'hidden',
          fontFamily: 'Inter, sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px 16px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-heading)' }}>Export</div>
            <div style={{ fontSize: 12, color: 'var(--color-meta)', marginTop: 2 }}>
              Choose an export format
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="export-modal-close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-muted)',
              fontSize: 20,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((opt) => {
            const unlocked = access(opt.featureKey);
            const planColor = PLAN_COLOR[opt.requiredPlan];
            const planLabel = PLAN_LABEL[opt.requiredPlan];

            return (
              <div
                key={opt.key}
                data-testid={`export-option-${opt.key}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: unlocked
                    ? '1.5px solid var(--color-border)'
                    : `1.5px solid color-mix(in srgb, ${planColor} 19%, transparent)`,
                  background: unlocked
                    ? 'var(--color-surface)'
                    : `color-mix(in srgb, ${planColor} 2%, transparent)`,
                  cursor: unlocked ? 'pointer' : 'default',
                }}
                onClick={() => unlocked && handleClick(opt)}
              >
                <span style={{ fontSize: 22, flexShrink: 0 }}>{opt.icon}</span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: unlocked ? 'var(--color-heading)' : 'var(--color-meta)',
                      }}
                    >
                      {opt.label}
                    </span>
                    {!unlocked && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: `color-mix(in srgb, ${planColor} 9%, transparent)`,
                          color: planColor,
                          border: `1px solid color-mix(in srgb, ${planColor} 19%, transparent)`,
                          letterSpacing: '0.07em',
                          textTransform: 'uppercase',
                          flexShrink: 0,
                        }}
                      >
                        {planLabel}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                    {opt.description}
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {unlocked ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--color-on-primary-navy)',
                        background: 'var(--color-primary)',
                        padding: '5px 12px',
                        borderRadius: 6,
                      }}
                    >
                      Download
                    </span>
                  ) : (
                    <a
                      href="/settings"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--color-on-primary-navy)',
                        background: planColor,
                        padding: '5px 10px',
                        borderRadius: 6,
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      🔒 Upgrade
                    </a>
                  )}
                </div>
              </div>
            );
          })}

          {notice && (
            <div
              role="status"
              data-testid="export-modal-notice"
              style={{
                background: 'var(--color-warning-bg)',
                border: '1px solid var(--color-warning)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                fontSize: 12,
                color: 'var(--color-heading)',
                marginTop: 4,
              }}
            >
              {notice}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
