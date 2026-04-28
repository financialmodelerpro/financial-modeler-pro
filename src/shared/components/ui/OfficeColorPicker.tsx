'use client';

/**
 * OfficeColorPicker - Microsoft Office-style colour picker dropdown.
 * Usage: <OfficeColorPicker value="#1B4F8A" onChange={(hex) => …} label="Primary" />
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ── Colour helpers ─────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const c = hex.replace('#', '').trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(c)) return null;
  const n = parseInt(c, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function blend(base: string, target: string, t: number): string {
  const a = hexToRgb(base), b = hexToRgb(target);
  if (!a || !b) return base;
  return rgbToHex(
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  );
}
/** Generate 5 cells for one column: darkest → dark → base → light → lightest */
function columnTints(base: string): { hex: string; label: string }[] {
  return [
    { hex: blend(base, '#000000', 0.60), label: 'Darker 60%'  },
    { hex: blend(base, '#000000', 0.30), label: 'Darker 30%'  },
    { hex: base,                          label: 'Base'         },
    { hex: blend(base, '#ffffff', 0.50), label: 'Lighter 50%' },
    { hex: blend(base, '#ffffff', 0.80), label: 'Lighter 80%' },
  ];
}

// ── Palette definition ────────────────────────────────────────────────────────
const THEME_COLUMNS: { name: string; base: string }[] = [
  { name: 'Primary Dark',   base: '#0D2E5A' },
  { name: 'Primary Blue',   base: '#1B4F8A' },
  { name: 'Accent Dark',    base: '#1A5C30' },
  { name: 'Accent Green',   base: '#2EAA4A' },
  { name: 'Neutral Dark',   base: '#374151' },
  { name: 'Neutral Grey',   base: '#6B7280' },
];
const THEME_GRID = THEME_COLUMNS.map((col) =>
  columnTints(col.base).map((cell) => ({ ...cell, colName: col.name })),
);

const STANDARD_COLORS: { hex: string; name: string }[] = [
  { hex: '#C00000', name: 'Dark Red'    },
  { hex: '#FF0000', name: 'Red'         },
  { hex: '#FF6600', name: 'Orange'      },
  { hex: '#FFFF00', name: 'Yellow'      },
  { hex: '#92D050', name: 'Light Green' },
  { hex: '#00B050', name: 'Green'       },
  { hex: '#00B0F0', name: 'Light Blue'  },
  { hex: '#0070C0', name: 'Blue'        },
  { hex: '#002060', name: 'Dark Blue'   },
  { hex: '#7030A0', name: 'Purple'      },
];

const CELL = 18;   // px - cell size
const GAP  = 2;    // px - gap between cells

// ── Swatch cell ───────────────────────────────────────────────────────────────
function Swatch({
  hex, label, selected, onClick,
}: { hex: string; label: string; selected: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      title={`${label}\n${hex.toUpperCase()}`}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: CELL, height: CELL,
        background: hex,
        borderRadius: 2,
        cursor: 'pointer',
        boxSizing: 'border-box',
        border: selected
          ? '2px solid #fff'
          : hover ? '1px solid rgba(0,0,0,0.45)' : '1px solid rgba(0,0,0,0.12)',
        outline: selected ? '2px solid #0078D4' : hover ? '1px solid #0078D4' : 'none',
        outlineOffset: selected ? 1 : 0,
        transition: 'outline 0.08s',
        flexShrink: 0,
      }}
    />
  );
}

// ── Dropdown ──────────────────────────────────────────────────────────────────
interface DropdownProps {
  value: string;
  pos: { top: number; left: number };
  onPick: (hex: string | null) => void;
  onClose: () => void;
}

function Dropdown({ value, pos, onPick, onClose }: DropdownProps) {
  const [showMore, setShowMore] = useState(false);
  const [hexInput, setHexInput] = useState(value.replace('#', '').toUpperCase());
  const [hexErr,   setHexErr]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const applyHex = () => {
    const clean = hexInput.replace('#', '');
    if (/^[0-9A-Fa-f]{6}$/.test(clean)) {
      onPick('#' + clean.toLowerCase());
      setHexErr(false);
    } else {
      setHexErr(true);
    }
  };

  // Adjust position so dropdown stays on screen
  const dropW = 240;
  const left  = Math.min(pos.left, window.innerWidth  - dropW - 8);
  const top   = pos.top + 2;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', zIndex: 999999,
        top, left,
        width: dropW,
        background: '#fff',
        border: '1px solid #D0D0D0',
        borderRadius: 4,
        boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
        padding: '8px 10px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* ── Theme Colors ── */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#605E5C', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        Theme Colors
      </div>
      {/* Column header dots */}
      <div style={{ display: 'flex', gap: GAP, marginBottom: GAP }}>
        {THEME_COLUMNS.map((col) => (
          <div key={col.name} title={col.name}
            style={{ width: CELL, height: 4, borderRadius: 1, background: col.base, flexShrink: 0 }} />
        ))}
      </div>
      {/* 5 rows */}
      {Array.from({ length: 5 }, (_, row) => (
        <div key={row} style={{ display: 'flex', gap: GAP, marginBottom: row < 4 ? GAP : 0 }}>
          {THEME_GRID.map((col, ci) => {
            const cell = col[row];
            return (
              <Swatch
                key={ci}
                hex={cell.hex}
                label={`${cell.colName} - ${cell.label}`}
                selected={value.toLowerCase() === cell.hex.toLowerCase()}
                onClick={() => onPick(cell.hex)}
              />
            );
          })}
        </div>
      ))}

      {/* ── Separator ── */}
      <div style={{ height: 1, background: '#E5E5E5', margin: '8px 0' }} />

      {/* ── Standard Colors ── */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#605E5C', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        Standard Colors
      </div>
      <div style={{ display: 'flex', gap: GAP }}>
        {STANDARD_COLORS.map((sc) => (
          <Swatch
            key={sc.hex}
            hex={sc.hex}
            label={sc.name}
            selected={value.toLowerCase() === sc.hex.toLowerCase()}
            onClick={() => onPick(sc.hex)}
          />
        ))}
      </div>

      {/* ── Separator ── */}
      <div style={{ height: 1, background: '#E5E5E5', margin: '8px 0' }} />

      {/* ── No Fill ── */}
      <button
        onClick={() => onPick(null)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '4px 4px', border: 'none', background: 'none',
          cursor: 'pointer', borderRadius: 3, fontSize: 12,
          color: '#323130', fontFamily: 'Inter,sans-serif',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#F3F2F1')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
      >
        {/* No-fill icon: white square with red X */}
        <div style={{
          width: CELL, height: CELL, border: '1px solid #8A8886', borderRadius: 2,
          background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: '#C00000', fontWeight: 700, flexShrink: 0,
        }}>✕</div>
        No Fill
      </button>

      {/* ── More Colors ── */}
      <button
        onClick={() => setShowMore((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '4px 4px', border: 'none', background: 'none',
          cursor: 'pointer', borderRadius: 3, fontSize: 12,
          color: '#323130', fontFamily: 'Inter,sans-serif',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#F3F2F1')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
      >
        <div style={{
          width: CELL, height: CELL, border: '1px solid #8A8886', borderRadius: 2,
          background: 'linear-gradient(135deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff)',
          flexShrink: 0,
        }} />
        More Colors…
      </button>

      {/* Inline hex input (shown when More Colors is open) */}
      {showMore && (
        <div style={{ marginTop: 8, padding: '8px', background: '#F8F8F8', borderRadius: 4, border: '1px solid #E5E5E5' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#605E5C', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Custom Hex Code</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Live preview */}
            <div style={{
              width: 28, height: 28, borderRadius: 3, flexShrink: 0,
              background: /^[0-9A-Fa-f]{6}$/.test(hexInput) ? `#${hexInput}` : '#ccc',
              border: '1px solid #D0D0D0',
            }} />
            {/* Hex field */}
            <div style={{
              display: 'flex', alignItems: 'center', flex: 1,
              border: `1.5px solid ${hexErr ? '#C00000' : '#D0D0D0'}`,
              borderRadius: 3, background: '#fff', overflow: 'hidden',
            }}>
              <span style={{ padding: '0 5px', fontSize: 12, color: '#888', fontFamily: 'monospace', fontWeight: 700 }}>#</span>
              <input
                value={hexInput}
                maxLength={6}
                onChange={(e) => {
                  setHexInput(e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase());
                  setHexErr(false);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') applyHex(); }}
                placeholder="1B4F8A"
                style={{
                  flex: 1, padding: '5px 4px', border: 'none', outline: 'none',
                  fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
                  color: '#1E3A8A', background: 'transparent', letterSpacing: '0.05em',
                }}
              />
            </div>
            <button
              onClick={applyHex}
              style={{
                padding: '5px 10px', background: '#0078D4', color: 'white',
                border: 'none', borderRadius: 3, fontSize: 11, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Inter,sans-serif', flexShrink: 0,
              }}
            >OK</button>
          </div>
          {hexErr && <div style={{ fontSize: 10, color: '#C00000', marginTop: 4 }}>Enter a valid 6-digit hex code</div>}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export interface OfficeColorPickerProps {
  value: string;                          // current hex (e.g. '#1B4F8A')
  onChange: (hex: string | null) => void; // null = No Fill
  label?: string;
  desc?: string;
}

export default function OfficeColorPicker({ value, onChange, label, desc }: OfficeColorPickerProps) {
  const [open, setOpen]     = useState(false);
  const [pos,  setPos]      = useState({ top: 0, left: 0 });
  const triggerRef          = useRef<HTMLButtonElement>(null);

  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom, left: rect.left });
    setOpen(true);
  };

  const handlePick = useCallback((hex: string | null) => {
    onChange(hex);
    setOpen(false);
  }, [onChange]);

  const handleClose = useCallback(() => setOpen(false), []);

  const isValid  = /^#?[0-9A-Fa-f]{6}$/.test(value);
  const display  = isValid ? value : '#cccccc';

  return (
    <>
      {/* ── Trigger ── */}
      <div>
        {label && (
          <div style={{ fontSize: 10, fontWeight: 700, color: '#605E5C', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
            {label}
          </div>
        )}
        {desc && (
          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 6 }}>{desc}</div>
        )}
        <button
          ref={triggerRef}
          onClick={handleOpen}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 10px 5px 6px',
            border: open ? '1.5px solid #0078D4' : '1.5px solid #D0D0D0',
            borderRadius: 4, background: '#fff', cursor: 'pointer',
            fontFamily: 'Inter,sans-serif', transition: 'border-color 0.15s',
            boxShadow: open ? '0 0 0 2px rgba(0,120,212,0.15)' : 'none',
          }}
        >
          {/* Colour swatch */}
          <div style={{
            width: 22, height: 22, borderRadius: 3,
            background: display,
            border: '1px solid rgba(0,0,0,0.15)',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#323130', letterSpacing: '0.02em', fontFamily: 'monospace' }}>
            {value.toUpperCase()}
          </span>
          {/* Chevron */}
          <span style={{ fontSize: 8, color: '#605E5C', marginLeft: 2 }}>▼</span>
        </button>
      </div>

      {/* ── Dropdown (portal-style via fixed position) ── */}
      {open && (
        <Dropdown value={display} pos={pos} onPick={handlePick} onClose={handleClose} />
      )}
    </>
  );
}
