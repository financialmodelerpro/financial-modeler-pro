'use client';

/**
 * CountryCombobox.tsx (2026-08-20)
 *
 * A real combobox over the ONE country list (src/core/countries.ts).
 *
 * Replaces the register form's <input list> + <datalist>, whose popup is
 * browser-owned: on some browsers it behaves like a native select's
 * type-ahead, so typing "P" then "a" JUMPED to Panama instead of filtering,
 * arrow keys had no defined contract, and clicking did not reliably open the
 * list. None of that is stylable or fixable from the outside, which is why
 * this is a rebuild and not a patch.
 *
 * The contract:
 *   - Typing filters to every country CONTAINING the text, case insensitive,
 *     matched anywhere in the name: "kist" finds Pakistan.
 *   - ArrowDown / ArrowUp move through the filtered list, Enter selects the
 *     highlighted entry, Escape closes and restores the selected value.
 *   - Clicking or focusing the field opens the FULL list with no typing.
 *   - STORAGE IS UNCHANGED: a picked country stores what the datalist path
 *     stored (resolveCountryCode(name) ?? name, so the ISO code for a
 *     recognised name), and free text that resolves to nothing is kept
 *     verbatim on blur, so every existing stored value keeps working.
 *
 * One list. COUNTRIES is imported, never copied, and no entry is filtered
 * out: this restricts nothing.
 *
 * Styling comes in through props (accent + input style), because this is
 * shared by auth pages that carry their own inline design rather than the
 * platform tokens.
 *
 * No em dashes in this file.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES, countryLabel, resolveCountryCode } from '@/src/core/countries';

export default function CountryCombobox({
  value,
  onChange,
  placeholder,
  required,
  accentColor = '#2E75B6',
  inputStyle,
  testid = 'country-combobox',
}: {
  /** The stored value: an ISO code, or legacy free text. */
  value: string;
  /** Receives the value to STORE (code for a recognised pick, text otherwise). */
  onChange: (stored: string) => void;
  placeholder?: string;
  required?: boolean;
  accentColor?: string;
  /** The host form's input styling, so the field sits in its design. */
  inputStyle?: React.CSSProperties;
  testid?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // null query = not typing: the field shows the selected label. A string,
  // even '', means the user is filtering and sees what they typed.
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = (query ?? '').trim().toLowerCase();
  const filtered = useMemo(
    () => (q === '' ? COUNTRIES : COUNTRIES.filter((c) => c.name.toLowerCase().includes(q))),
    [q],
  );

  // Keep the highlight inside the filtered list as it shrinks.
  useEffect(() => { setHighlight((h) => Math.min(h, Math.max(0, filtered.length - 1))); }, [filtered.length]);

  // The highlighted row stays in view while arrowing.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  // Outside click closes and restores the selected label.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        // Free text that resolves to nothing is KEPT, exactly as the datalist
        // path kept it, so a hand-typed value still submits.
        setQuery((prev) => {
          if (prev !== null && prev.trim() !== '') onChange(resolveCountryCode(prev) ?? prev);
          return null;
        });
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (name: string): void => {
    // Stored exactly as the datalist path stored it: the ISO code when the
    // name is recognised, the text itself when not.
    onChange(resolveCountryCode(name) ?? name);
    setQuery(null);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered.length > 0) {
        e.preventDefault();
        select(filtered[Math.min(highlight, filtered.length - 1)].name);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery(null);
    }
  };

  const display = query !== null ? query : countryLabel(value);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        required={required}
        value={display}
        placeholder={placeholder}
        data-testid={testid}
        autoComplete="off"
        style={inputStyle}
        onFocus={(e) => { setOpen(true); setHighlight(0); e.currentTarget.style.borderColor = accentColor; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div
          ref={listRef}
          data-testid={`${testid}-list`}
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
            maxHeight: 240, overflowY: 'auto',
            background: '#fff', border: '1.5px solid #D1D5DB', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '9px 12px', fontSize: 12.5, color: '#94A3B8' }} data-testid={`${testid}-empty`}>
              No country matches. Your text is kept as typed.
            </div>
          ) : filtered.map((c, i) => (
            <div
              key={c.code}
              data-idx={i}
              role="option"
              aria-selected={i === highlight}
              // onMouseDown, not onClick: the outside-click closer runs on
              // mousedown and would close the list before a click landed.
              onMouseDown={(e) => { e.preventDefault(); select(c.name); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '8px 12px', fontSize: 13, cursor: 'pointer', color: '#1F2937',
                background: i === highlight ? `${accentColor}1A` : '#fff',
                borderLeft: i === highlight ? `3px solid ${accentColor}` : '3px solid transparent',
              }}
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
