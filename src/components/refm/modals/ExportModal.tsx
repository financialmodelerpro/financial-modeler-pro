'use client';

import React from 'react';
import type { SubscriptionPlan } from '@/src/types/subscription.types';

interface ExportOption {
  key:          string;
  icon:         string;
  label:        string;
  description:  string;
  featureKey:   string;
  requiredPlan: SubscriptionPlan;
  onExport?:    () => void;
  exporting?:   boolean;
}

interface ExportModalProps {
  canAccess:      (featureKey: string) => boolean;
  onClose:        () => void;
  onExportExcel:  () => void;
  onExportPdf:    () => void;
  exportingExcel: boolean;
  exportingPdf:   boolean;
}

const PLAN_COLOR: Record<SubscriptionPlan, string> = {
  free:         '#6b7280',
  professional: '#2563EB',
  enterprise:   '#7C3AED',
};
const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  free:         'Free',
  professional: 'Professional',
  enterprise:   'Enterprise',
};

export default function ExportModal({
  canAccess,
  onClose,
  onExportExcel,
  onExportPdf,
  exportingExcel,
  exportingPdf,
}: ExportModalProps) {
  const options: ExportOption[] = [
    {
      key: 'pdf_basic',
      icon: '📄',
      label: 'PDF - Basic Report',
      description: 'Summary financials, project overview',
      featureKey:   'pdf_basic',
      requiredPlan: 'free',
      onExport:     onExportPdf,
      exporting:    exportingPdf,
    },
    {
      key: 'pdf_full',
      icon: '📋',
      label: 'PDF - Full Report',
      description: 'All modules, schedules, charts',
      featureKey:   'pdf_full',
      requiredPlan: 'professional',
      onExport:     onExportPdf,
      exporting:    exportingPdf,
    },
    {
      key: 'pdf_whitelabel',
      icon: '🏷️',
      label: 'PDF - White-Label',
      description: 'Branded report with client logo',
      featureKey:   'pdf_whitelabel',
      requiredPlan: 'enterprise',
    },
    {
      key: 'excel_static',
      icon: '📊',
      label: 'Excel - Static',
      description: 'Pre-calculated values, formatted',
      featureKey:   'excel_static',
      requiredPlan: 'professional',
      onExport:     onExportExcel,
      exporting:    exportingExcel,
    },
    {
      key: 'excel_formula',
      icon: '⚡',
      label: 'Excel - Formula Model',
      description: 'Live formulas, full auditability',
      featureKey:   'excel_formula',
      requiredPlan: 'enterprise',
    },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          width: '100%', maxWidth: 480,
          overflow: 'hidden',
          fontFamily: 'Inter, sans-serif',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px 16px',
          borderBottom: '1px solid #E5E7EB',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>Export</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
              Choose an export format
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#9CA3AF', fontSize: 20, lineHeight: 1, padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Options */}
        <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map(opt => {
            const unlocked = canAccess(opt.featureKey);
            const planColor = PLAN_COLOR[opt.requiredPlan];
            const planLabel = PLAN_LABEL[opt.requiredPlan];

            return (
              <div
                key={opt.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: unlocked ? '1.5px solid #E5E7EB' : `1.5px solid ${planColor}30`,
                  background: unlocked ? '#fff' : `${planColor}06`,
                  cursor: unlocked ? 'pointer' : 'default',
                  opacity: opt.exporting ? 0.6 : 1,
                  transition: 'box-shadow 0.15s, border-color 0.15s',
                }}
                onClick={() => {
                  if (unlocked && opt.onExport && !opt.exporting) {
                    opt.onExport();
                    onClose();
                  }
                }}
              >
                <span style={{ fontSize: 22, flexShrink: 0 }}>{opt.icon}</span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: unlocked ? '#111827' : '#6B7280' }}>
                      {opt.label}
                    </span>
                    {!unlocked && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                        background: `${planColor}18`, color: planColor,
                        border: `1px solid ${planColor}30`,
                        letterSpacing: '0.07em', textTransform: 'uppercase',
                        flexShrink: 0,
                      }}>
                        {planLabel}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                    {opt.description}
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {unlocked ? (
                    opt.exporting ? (
                      <span style={{ fontSize: 12, color: '#6B7280' }}>Exporting…</span>
                    ) : (
                      opt.onExport ? (
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: '#fff',
                          background: '#1B4F8A', padding: '5px 12px', borderRadius: 6,
                        }}>
                          Download →
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>SOON</span>
                      )
                    )
                  ) : (
                    <a
                      href="/settings"
                      style={{
                        fontSize: 11, fontWeight: 700, color: '#fff',
                        background: planColor, padding: '5px 10px', borderRadius: 6,
                        textDecoration: 'none', whiteSpace: 'nowrap',
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      🔒 Upgrade
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
