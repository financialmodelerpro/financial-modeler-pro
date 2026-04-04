'use client';

/**
 * Global toast notification system.
 *
 * Usage:
 *   import { useToast } from '@/src/components/ui/Toaster';
 *   const { showToast } = useToast();
 *   showToast('Saved!');
 *   showToast('Something went wrong', 'error');
 *
 * <Toaster /> must be rendered once in the root layout (already added to app/layout.tsx).
 */

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id:      number;
  message: string;
  type:    ToastType;
}

interface ToastContext {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastCtx = createContext<ToastContext>({ showToast: () => {} });

const TYPE_STYLE: Record<ToastType, { bg: string; icon: string }> = {
  success: { bg: '#166534', icon: '✓' },
  error:   { bg: '#991b1b', icon: '✕' },
  info:    { bg: '#1e40af', icon: 'ℹ' },
  warning: { bg: '#92400e', icon: '⚠' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={{ showToast }}>
      {children}
      {/* Toast stack */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',
      }}>
        {toasts.map((t) => {
          const s = TYPE_STYLE[t.type];
          return (
            <div key={t.id} style={{
              background: s.bg, color: '#fff',
              padding: '10px 18px', borderRadius: 8,
              fontSize: 13, fontWeight: 600,
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              fontFamily: 'Inter,sans-serif',
              display: 'flex', alignItems: 'center', gap: 8,
              animation: 'toast-in 0.2s ease',
              pointerEvents: 'auto',
            }}>
              <span style={{ fontWeight: 800 }}>{s.icon}</span>
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/** Hook — call from any component to show a toast. */
export function useToast(): ToastContext {
  return useContext(ToastCtx);
}

/** Convenience alias for the provider — render once in layout. */
export function Toaster() { return null; } // placeholder; actual rendering is in ToastProvider
