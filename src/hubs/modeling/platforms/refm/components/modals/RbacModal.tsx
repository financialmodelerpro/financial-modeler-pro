'use client';

/**
 * RbacModal.tsx (v5 schema, M2.0 stub)
 *
 * Role switcher used during pre-launch testing. Pass-through for the
 * 4 ROLES tokens.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { ROLES } from '@/src/core/state';
import type { Role } from '@/src/core/types/settings.types';

interface RbacModalProps {
  open: boolean;
  onClose: () => void;
  currentRole: Role;
  selectedRole: Role;
  onSelectRole: (r: Role) => void;
  onApply: (role: Role) => void;
}

export default function RbacModal({
  open,
  onClose,
  currentRole,
  selectedRole,
  onSelectRole,
  onApply,
}: RbacModalProps): React.JSX.Element | null {
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  const allRoles = Object.values(ROLES) as Role[];
  const content = (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="rbac-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)', maxWidth: 480, width: '90vw' }}
      >
        <h3 style={{ marginTop: 0 }}>Switch role (testing)</h3>
        <div style={{ marginBottom: 'var(--sp-1)', color: 'var(--color-meta)', fontSize: 'var(--font-small)' }}>
          Current: <strong>{currentRole}</strong>
        </div>
        {allRoles.map((r) => (
          <label key={r} style={{ display: 'block', padding: 6 }} data-testid={`rbac-role-${r}`}>
            <input
              type="radio"
              name="rbac-role"
              checked={selectedRole === r}
              onChange={() => onSelectRole(r)}
            />{' '}
            {r}
          </label>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 'var(--sp-2)' }}>
          <button type="button" onClick={onClose} data-testid="rbac-cancel">
            Cancel
          </button>
          <button type="button" onClick={() => onApply(selectedRole)} className="btn-primary" data-testid="rbac-apply">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
