'use client';

/**
 * ScrollableTable.tsx (2026-06-01)
 *
 * Shared scroll container for the wide period-axis results tables. Replaces
 * the bare `<div style={{ overflowX: 'auto' }}>` wrappers so every results
 * table gets the same scrolling affordances:
 *
 *   - Thick custom scrollbars (see ScrollableTable.module.css), instead of
 *     the hairline default.
 *   - A SECOND horizontal scrollbar mirrored along the TOP of the table,
 *     kept in sync with the bottom one, so the user can pan from either
 *     edge without scrolling to the far bottom first.
 *   - Focusable body: Left / Right arrows pan horizontally; Up / Down scroll
 *     the body vertically when it overflows, otherwise fall through to the
 *     page. Click (or Tab) into the table, then drive it from the keyboard.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ScrollableTable.module.css';

interface Props {
  children: React.ReactNode;
  /** Wrap in the standard bordered + rounded results-table frame. Default true. */
  bordered?: boolean;
}

export function ScrollableTable({ children, bordered = true }: Props): React.JSX.Element {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollW, setScrollW] = useState(0);
  const syncing = useRef(false);

  // Keep the top scrollbar's spacer the same width as the table's full
  // scroll width so the two scrollbars track 1:1. Re-measure when the table
  // (first child) or the body resizes (e.g. the period count changes).
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = (): void => setScrollW(body.scrollWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    const child = body.firstElementChild;
    if (child) ro.observe(child);
    return () => ro.disconnect();
  }, [children]);

  const syncFrom = useCallback((src: HTMLDivElement | null, dst: HTMLDivElement | null): void => {
    if (!src || !dst || syncing.current) return;
    syncing.current = true;
    dst.scrollLeft = src.scrollLeft;
    // release on the next frame so the mirrored onScroll does not bounce back
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
    const el = bodyRef.current;
    if (!el) return;
    const step = 60;
    switch (e.key) {
      case 'ArrowLeft': el.scrollLeft -= step; e.preventDefault(); break;
      case 'ArrowRight': el.scrollLeft += step; e.preventDefault(); break;
      case 'ArrowUp': if (el.scrollHeight > el.clientHeight) { el.scrollTop -= step; e.preventDefault(); } break;
      case 'ArrowDown': if (el.scrollHeight > el.clientHeight) { el.scrollTop += step; e.preventDefault(); } break;
      default: break;
    }
  }, []);

  const outer: React.CSSProperties = bordered
    ? { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }
    : {};

  return (
    <div style={outer}>
      <div
        ref={topRef}
        className={styles.scroll}
        style={{ overflowX: 'auto', overflowY: 'hidden' }}
        onScroll={() => syncFrom(topRef.current, bodyRef.current)}
        aria-hidden
      >
        <div style={{ width: scrollW, height: 1 }} />
      </div>
      <div
        ref={bodyRef}
        className={styles.scroll}
        style={{ overflowX: 'auto', outline: 'none' }}
        tabIndex={0}
        onScroll={() => syncFrom(bodyRef.current, topRef.current)}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
