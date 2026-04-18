'use client';

import type { CanvasElement } from '@/src/lib/marketing/types';

interface Props {
  element: CanvasElement;
  editable?: boolean;
  onTextChange?: (content: string) => void;
}

/**
 * Pure visual renderer for a CanvasElement. Used both inside the editor canvas
 * and (via the same shape) inside the server ImageResponse JSX.
 * The wrapping <Rnd> inside the editor handles drag/resize + absolute positioning.
 */
export function ElementRenderer({ element, editable, onTextChange }: Props) {
  if (element.type === 'text' && element.text) {
    const t = element.text;
    const style: React.CSSProperties = {
      width: '100%',
      height: '100%',
      color: t.color,
      fontSize: t.fontSize,
      fontWeight: t.fontWeight,
      fontFamily: `${t.fontFamily}, Inter, Arial, sans-serif`,
      fontStyle: t.fontStyle ?? 'normal',
      textAlign: t.textAlign,
      lineHeight: t.lineHeight,
      letterSpacing: t.letterSpacing,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'hidden',
      userSelect: editable ? 'text' : 'none',
      outline: 'none',
    };
    if (editable && onTextChange) {
      return (
        <div
          contentEditable
          suppressContentEditableWarning
          style={style}
          onBlur={(e) => onTextChange(e.currentTarget.innerText)}
        >{t.content}</div>
      );
    }
    return <div style={style}>{t.content}</div>;
  }

  if (element.type === 'image' && element.image) {
    const i = element.image;
    const filters: string[] = [];
    if (i.filter === 'grayscale') filters.push('grayscale(100%)');
    if (i.filter === 'blur')      filters.push('blur(6px)');
    if (i.brightness !== 100)     filters.push(`brightness(${i.brightness}%)`);
    const radius = i.borderRadius <= 50 ? `${i.borderRadius}%` : `${i.borderRadius}px`;
    const hasBorder = (i.borderWidth ?? 0) > 0 && i.borderColor && i.borderColor !== 'transparent';
    const wrapperStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      borderRadius: radius,
      overflow: 'hidden',
      border: hasBorder ? `${i.borderWidth}px solid ${i.borderColor}` : undefined,
      boxSizing: 'border-box',
      opacity: i.opacity / 100,
    };
    if (!i.src) {
      return (
        <div style={{ ...wrapperStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.1)', color: 'rgba(255,255,255,0.7)', fontSize: 12, border: hasBorder ? wrapperStyle.border : '1px dashed rgba(255,255,255,0.3)' }}>
          No image
        </div>
      );
    }
    const imgStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      objectFit: i.objectFit,
      display: 'block',
      pointerEvents: 'none',
      filter: filters.length ? filters.join(' ') : undefined,
    };
    return (
      <div style={wrapperStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={i.src} alt="" style={imgStyle} draggable={false} />
      </div>
    );
  }

  if (element.type === 'shape' && element.shape) {
    const s = element.shape;
    const style: React.CSSProperties = {
      width: '100%',
      height: '100%',
      background: s.backgroundColor,
      borderRadius: s.borderRadius <= 50 ? `${s.borderRadius}%` : `${s.borderRadius}px`,
      border: s.borderWidth > 0 ? `${s.borderWidth}px solid ${s.borderColor}` : undefined,
      opacity: s.opacity / 100,
    };
    return <div style={style} />;
  }

  return null;
}
