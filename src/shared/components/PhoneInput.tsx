'use client';

import { useState, useRef, useEffect } from 'react';

const COUNTRY_CODES = [
  { code: '+1',   flag: '🇺🇸', label: 'US / Canada' },
  { code: '+44',  flag: '🇬🇧', label: 'UK' },
  { code: '+92',  flag: '🇵🇰', label: 'Pakistan' },
  { code: '+971', flag: '🇦🇪', label: 'UAE' },
  { code: '+966', flag: '🇸🇦', label: 'Saudi Arabia' },
  { code: '+91',  flag: '🇮🇳', label: 'India' },
  { code: '+61',  flag: '🇦🇺', label: 'Australia' },
  { code: '+49',  flag: '🇩🇪', label: 'Germany' },
  { code: '+33',  flag: '🇫🇷', label: 'France' },
  { code: '+86',  flag: '🇨🇳', label: 'China' },
  { code: '+93',  flag: '🇦🇫', label: 'Afghanistan' },
  { code: '+213', flag: '🇩🇿', label: 'Algeria' },
  { code: '+54',  flag: '🇦🇷', label: 'Argentina' },
  { code: '+880', flag: '🇧🇩', label: 'Bangladesh' },
  { code: '+55',  flag: '🇧🇷', label: 'Brazil' },
  { code: '+20',  flag: '🇪🇬', label: 'Egypt' },
  { code: '+251', flag: '🇪🇹', label: 'Ethiopia' },
  { code: '+233', flag: '🇬🇭', label: 'Ghana' },
  { code: '+62',  flag: '🇮🇩', label: 'Indonesia' },
  { code: '+98',  flag: '🇮🇷', label: 'Iran' },
  { code: '+964', flag: '🇮🇶', label: 'Iraq' },
  { code: '+972', flag: '🇮🇱', label: 'Israel' },
  { code: '+39',  flag: '🇮🇹', label: 'Italy' },
  { code: '+81',  flag: '🇯🇵', label: 'Japan' },
  { code: '+962', flag: '🇯🇴', label: 'Jordan' },
  { code: '+254', flag: '🇰🇪', label: 'Kenya' },
  { code: '+965', flag: '🇰🇼', label: 'Kuwait' },
  { code: '+961', flag: '🇱🇧', label: 'Lebanon' },
  { code: '+218', flag: '🇱🇾', label: 'Libya' },
  { code: '+60',  flag: '🇲🇾', label: 'Malaysia' },
  { code: '+52',  flag: '🇲🇽', label: 'Mexico' },
  { code: '+212', flag: '🇲🇦', label: 'Morocco' },
  { code: '+31',  flag: '🇳🇱', label: 'Netherlands' },
  { code: '+64',  flag: '🇳🇿', label: 'New Zealand' },
  { code: '+234', flag: '🇳🇬', label: 'Nigeria' },
  { code: '+47',  flag: '🇳🇴', label: 'Norway' },
  { code: '+968', flag: '🇴🇲', label: 'Oman' },
  { code: '+63',  flag: '🇵🇭', label: 'Philippines' },
  { code: '+48',  flag: '🇵🇱', label: 'Poland' },
  { code: '+351', flag: '🇵🇹', label: 'Portugal' },
  { code: '+974', flag: '🇶🇦', label: 'Qatar' },
  { code: '+7',   flag: '🇷🇺', label: 'Russia' },
  { code: '+65',  flag: '🇸🇬', label: 'Singapore' },
  { code: '+27',  flag: '🇿🇦', label: 'South Africa' },
  { code: '+82',  flag: '🇰🇷', label: 'South Korea' },
  { code: '+34',  flag: '🇪🇸', label: 'Spain' },
  { code: '+249', flag: '🇸🇩', label: 'Sudan' },
  { code: '+46',  flag: '🇸🇪', label: 'Sweden' },
  { code: '+41',  flag: '🇨🇭', label: 'Switzerland' },
  { code: '+963', flag: '🇸🇾', label: 'Syria' },
  { code: '+255', flag: '🇹🇿', label: 'Tanzania' },
  { code: '+66',  flag: '🇹🇭', label: 'Thailand' },
  { code: '+216', flag: '🇹🇳', label: 'Tunisia' },
  { code: '+90',  flag: '🇹🇷', label: 'Turkey' },
  { code: '+256', flag: '🇺🇬', label: 'Uganda' },
  { code: '+380', flag: '🇺🇦', label: 'Ukraine' },
  { code: '+84',  flag: '🇻🇳', label: 'Vietnam' },
  { code: '+967', flag: '🇾🇪', label: 'Yemen' },
  { code: '+263', flag: '🇿🇼', label: 'Zimbabwe' },
];

interface PhoneInputProps {
  phoneCode: string;
  phoneLocal: string;
  onCodeChange: (code: string) => void;
  onLocalChange: (local: string) => void;
  required?: boolean;
  accentColor?: string;
  inputBackground?: string;
}

export function PhoneInput({
  phoneCode,
  phoneLocal,
  onCodeChange,
  onLocalChange,
  required,
  accentColor = '#1B4F8A',
  inputBackground = '#FFFBEB',
}: PhoneInputProps) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef    = useRef<HTMLInputElement>(null);
  const listRef      = useRef<HTMLDivElement>(null);

  const selected = COUNTRY_CODES.find(c => c.code === phoneCode) ?? COUNTRY_CODES[0];

  const filtered = search.trim()
    ? COUNTRY_CODES.filter(c =>
        c.label.toLowerCase().includes(search.toLowerCase()) ||
        c.code.includes(search)
      )
    : COUNTRY_CODES;

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 10);
  }, [open]);

  function handleSelect(code: string) {
    onCodeChange(code);
    setOpen(false);
    setSearch('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); setSearch(''); }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      handleSelect(filtered[0].code);
    }
  }

  const triggerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '10px 8px',
    fontSize: 13,
    fontFamily: "'Inter', sans-serif",
    border: '1.5px solid #D1D5DB',
    borderRadius: '7px 0 0 7px',
    borderRight: 'none',
    background: inputBackground,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    outline: 'none',
    color: '#374151',
  };

  const numberInputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: "'Inter', sans-serif",
    border: '1.5px solid #D1D5DB',
    borderRadius: '0 7px 7px 0',
    outline: 'none',
    background: inputBackground,
    boxSizing: 'border-box',
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', position: 'relative' }}>
      {/* Trigger */}
      <button
        type="button"
        style={triggerStyle}
        onClick={() => { setOpen(o => !o); setSearch(''); }}
        onFocus={e => { e.currentTarget.style.borderColor = accentColor; }}
        onBlur={e => { e.currentTarget.style.borderColor = open ? accentColor : '#D1D5DB'; }}
      >
        <span style={{ fontSize: 16 }}>{selected.flag}</span>
        <span>{selected.code}</span>
        <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 2 }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          background: '#fff',
          border: '1.5px solid #D1D5DB',
          borderRadius: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,0.13)',
          // C4: hardcoded width: 270 overflowed the viewport on 320px
          // phones. Cap at viewport-width-minus-margin so the country
          // picker stays readable without horizontal scroll.
          width: 270,
          maxWidth: 'calc(100vw - 20px)',
          marginTop: 2,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Search box */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #F3F4F6' }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search country…"
              style={{
                width: '100%', border: 'none', outline: 'none',
                fontSize: 13, fontFamily: "'Inter', sans-serif",
                color: '#374151', background: 'transparent',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* List */}
          <div ref={listRef} style={{ overflowY: 'auto', maxHeight: 220 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 13, color: '#9CA3AF' }}>No results</div>
            ) : filtered.map(c => (
              <button
                key={c.code + c.label}
                type="button"
                onClick={() => handleSelect(c.code)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 12px',
                  border: 'none', background: c.code === phoneCode ? '#EFF6FF' : 'transparent',
                  cursor: 'pointer', textAlign: 'left',
                  fontSize: 13, fontFamily: "'Inter', sans-serif",
                  color: '#374151',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F9FAFB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = c.code === phoneCode ? '#EFF6FF' : 'transparent'; }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{c.flag}</span>
                <span style={{ color: '#6B7280', flexShrink: 0, minWidth: 36 }}>{c.code}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Local number input */}
      <input
        type="tel"
        value={phoneLocal}
        onChange={e => onLocalChange(e.target.value)}
        placeholder="Local number"
        required={required}
        style={numberInputStyle}
        onFocus={e => {
          e.currentTarget.style.borderColor = accentColor;
          // Also highlight trigger border
          const trigger = containerRef.current?.querySelector('button') as HTMLButtonElement | null;
          if (trigger) trigger.style.borderColor = accentColor;
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = '#D1D5DB';
          const trigger = containerRef.current?.querySelector('button') as HTMLButtonElement | null;
          if (trigger && !open) trigger.style.borderColor = '#D1D5DB';
        }}
      />
    </div>
  );
}
