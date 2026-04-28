'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ── Colour math ───────────────────────────────────────────────────────────────
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    if (max === rr)      h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
    else if (max === gg) h = ((bb - rr) / d + 2) / 6;
    else                 h = ((rr - gg) / d + 4) / 6;
  }
  return [h * 360, s, v];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Canvas drawing ────────────────────────────────────────────────────────────
function drawSB(canvas: HTMLCanvasElement, hue: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const [r, g, b] = hsvToRgb(hue, 1, 1);
  const gH = ctx.createLinearGradient(0, 0, width, 0);
  gH.addColorStop(0, '#fff');
  gH.addColorStop(1, `rgb(${r},${g},${b})`);
  ctx.fillStyle = gH;
  ctx.fillRect(0, 0, width, height);
  const gV = ctx.createLinearGradient(0, 0, 0, height);
  gV.addColorStop(0, 'rgba(0,0,0,0)');
  gV.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = gV;
  ctx.fillRect(0, 0, width, height);
}

function drawHue(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const stops = ['#ff0000','#ffff00','#00ff00','#00ffff','#0000ff','#ff00ff','#ff0000'];
  const g = ctx.createLinearGradient(0, 0, width, 0);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

// ── Component ─────────────────────────────────────────────────────────────────
interface ColorPickerProps {
  value: string;              // hex e.g. '#1E3A8A'
  onChange: (hex: string) => void;
  label: string;
  desc: string;
}

export default function ColorPicker({ value, onChange, label, desc }: ColorPickerProps) {
  const initRgb  = hexToRgb(value) ?? [30, 58, 138];
  const initHsv  = rgbToHsv(...initRgb);

  const [hue, setHue] = useState(initHsv[0]);
  const [sat, setSat] = useState(initHsv[1]);
  const [bri, setBri] = useState(initHsv[2]);
  const [hexIn, setHexIn] = useState(value.replace('#','').toUpperCase());
  const [rgbIn, setRgbIn] = useState({
    r: String(initRgb[0]), g: String(initRgb[1]), b: String(initRgb[2]),
  });

  // Always-fresh ref for mousemove handler (avoids stale closures)
  const live = useRef({ hue, sat, bri });
  live.current = { hue, sat, bri };

  const sbRef   = useRef<HTMLCanvasElement>(null);
  const hueBarRef = useRef<HTMLCanvasElement>(null);
  const dragging  = useRef<'sb' | 'hue' | null>(null);

  // Sync when prop changes externally (preset click)
  useEffect(() => {
    const rgb = hexToRgb(value);
    if (!rgb) return;
    const [h, s, v] = rgbToHsv(...rgb);
    setHue(h); setSat(s); setBri(v);
    setHexIn(value.replace('#', '').toUpperCase());
    setRgbIn({ r: String(rgb[0]), g: String(rgb[1]), b: String(rgb[2]) });
  }, [value]);

  // Draw SB canvas whenever hue changes
  useEffect(() => { if (sbRef.current) drawSB(sbRef.current, hue); }, [hue]);

  // Draw hue bar once
  useEffect(() => { if (hueBarRef.current) drawHue(hueBarRef.current); }, []);

  // Commit HSV → propagate to parent + sync inputs
  const commit = useCallback((h: number, s: number, v: number) => {
    const rgb = hsvToRgb(h, s, v);
    const hex = rgbToHex(...rgb);
    setHexIn(hex.replace('#', '').toUpperCase());
    setRgbIn({ r: String(rgb[0]), g: String(rgb[1]), b: String(rgb[2]) });
    onChange(hex);
  }, [onChange]);

  // SB canvas pick
  const pickSB = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = sbRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left)  / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    setSat(s); setBri(v);
    commit(live.current.hue, s, v);
  }, [commit]);

  // Hue bar pick
  const pickHue = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = hueBarRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
    setHue(h);
    commit(h, live.current.sat, live.current.bri);
  }, [commit]);

  // Global mousemove / mouseup
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragging.current === 'sb')  pickSB(e);
      if (dragging.current === 'hue') pickHue(e);
    };
    const up = () => { dragging.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [pickSB, pickHue]);

  // Hex text input handler
  const handleHexInput = (raw: string) => {
    const clean = raw.replace(/[^0-9A-Fa-f#]/g, '');
    setHexIn(clean.replace('#', '').toUpperCase());
    const full = clean.startsWith('#') ? clean : `#${clean}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(full)) {
      const rgb = hexToRgb(full)!;
      const [h, s, v] = rgbToHsv(...rgb);
      setHue(h); setSat(s); setBri(v);
      setRgbIn({ r: String(rgb[0]), g: String(rgb[1]), b: String(rgb[2]) });
      onChange(full);
    }
  };

  // RGB input handler
  const handleRgbInput = (ch: 'r' | 'g' | 'b', raw: string) => {
    setRgbIn((p) => ({ ...p, [ch]: raw }));
    const n = parseInt(raw);
    if (isNaN(n) || n < 0 || n > 255) return;
    const cur = {
      r: parseInt(rgbIn.r) || 0,
      g: parseInt(rgbIn.g) || 0,
      b: parseInt(rgbIn.b) || 0,
      [ch]: n,
    };
    const rgb: [number, number, number] = [cur.r, cur.g, cur.b];
    const [h, s, v] = rgbToHsv(...rgb);
    setHue(h); setSat(s); setBri(v);
    const hex = rgbToHex(...rgb);
    setHexIn(hex.replace('#', '').toUpperCase());
    onChange(hex);
  };

  const currentHex = rgbToHex(...hsvToRgb(hue, sat, bri));

  return (
    <div style={{
      border: '1.5px solid #E5E7EB', borderRadius: 14,
      overflow: 'hidden', background: '#fff',
      userSelect: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid #F0F0F0', background: '#FAFAFA' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>{desc}</div>
      </div>

      <div style={{ padding: '14px 16px 16px' }}>

        {/* ── Saturation / Brightness canvas ── */}
        <div style={{
          position: 'relative', borderRadius: 8, overflow: 'hidden',
          cursor: 'crosshair', marginBottom: 10,
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}>
          <canvas
            ref={sbRef} width={400} height={190}
            style={{ display: 'block', width: '100%', height: 190 }}
            onMouseDown={(e) => { dragging.current = 'sb'; pickSB(e); }}
          />
          {/* Round cursor */}
          <div style={{
            position: 'absolute', pointerEvents: 'none',
            left: `${sat * 100}%`, top: `${(1 - bri) * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 16, height: 16, borderRadius: '50%',
            border: '2.5px solid white',
            boxShadow: '0 0 0 1.5px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.35)',
            background: currentHex,
          }} />
        </div>

        {/* ── Hue slider ── */}
        <div style={{
          position: 'relative', borderRadius: 8, overflow: 'visible',
          cursor: 'ew-resize', marginBottom: 16, height: 20,
        }}>
          <canvas
            ref={hueBarRef} width={400} height={20}
            style={{ display: 'block', width: '100%', height: 20, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}
            onMouseDown={(e) => { dragging.current = 'hue'; pickHue(e); }}
          />
          {/* Thumb */}
          <div style={{
            position: 'absolute', pointerEvents: 'none',
            left: `${(hue / 360) * 100}%`, top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 22, height: 22, borderRadius: '50%',
            border: '3px solid white',
            boxShadow: '0 0 0 1.5px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.3)',
            background: `hsl(${hue},100%,50%)`,
          }} />
        </div>

        {/* ── Inputs row ── */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>

          {/* Current colour swatch */}
          <div style={{
            width: 44, height: 44, borderRadius: 8, background: currentHex,
            flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            border: '2.5px solid white', outline: '1px solid #E5E7EB',
          }} />

          {/* Hex */}
          <div>
            <div style={inputLabel}>Hex</div>
            <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #E5E7EB', borderRadius: 7, overflow: 'hidden', background: '#FFFBEB' }}>
              <span style={{ padding: '0 6px', fontSize: 13, fontWeight: 700, color: '#9CA3AF', fontFamily: 'monospace' }}>#</span>
              <input
                value={hexIn}
                onChange={(e) => handleHexInput(e.target.value)}
                maxLength={6}
                placeholder="1E3A8A"
                style={{
                  width: 76, padding: '7px 4px 7px 0', fontSize: 12, fontWeight: 700,
                  border: 'none', background: 'transparent', outline: 'none',
                  fontFamily: 'monospace', color: '#1E3A8A', letterSpacing: '0.04em',
                }}
              />
            </div>
          </div>

          {/* R G B */}
          {(['r', 'g', 'b'] as const).map((ch) => (
            <div key={ch} style={{ flex: 1 }}>
              <div style={inputLabel}>{ch.toUpperCase()}</div>
              <input
                value={rgbIn[ch]}
                onChange={(e) => handleRgbInput(ch, e.target.value)}
                maxLength={3}
                placeholder="0"
                style={{
                  width: '100%', padding: '7px 6px', fontSize: 12, fontWeight: 600,
                  border: '1.5px solid #E5E7EB', borderRadius: 7,
                  textAlign: 'center', background: '#FFFBEB', outline: 'none',
                  fontFamily: 'Inter,sans-serif', color: '#374151',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

const inputLabel: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: '#9CA3AF',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4,
};
