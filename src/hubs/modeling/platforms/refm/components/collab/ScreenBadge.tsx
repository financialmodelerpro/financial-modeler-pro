/**
 * ScreenBadge.tsx (2026-09-23)
 *
 * "WHERE DO I GO TO CHANGE THIS?", answered beside the change itself.
 *
 * A comment or an activity row carries a snapshot path. Until now that path
 * rendered as monospace text with a note in the source saying "nothing in this
 * platform maps a snapshot path to a screen, and this step does not build
 * that". `lib/collab/pathScreen.ts` builds it, and this is the one thing that
 * renders it, so the two panels cannot drift apart.
 *
 * THREE BEHAVIOURS, and each is deliberate:
 *
 *   MAPPED    the screen name is a BUTTON that takes you there, through the
 *             same `fmp:trace-to` event the P&L trace arrows already use. One
 *             navigation mechanism, not a second one.
 *   TWO HOMES both names are offered, both clickable, joined with "or". The
 *             map refuses to pick and so does this: picking would be wrong
 *             half the time.
 *   UNMAPPED  plain text saying the field is not editable and why. NOT a
 *             button, because there is nowhere to go, and a dead button that
 *             looks live is worse than a sentence.
 *
 * An unknown path renders NOTHING here, and the caller still shows the raw
 * path, so a row can never become less informative than it was before.
 *
 * No em dashes in this file.
 */
'use client';

import React from 'react';
import { screenForPath } from '../../lib/collab/pathScreen';

/** Navigates the shell. The SAME event the M4 trace arrows dispatch. */
export function goToScreen(moduleId: string, tab?: string): void {
  window.dispatchEvent(new CustomEvent('fmp:trace-to', { detail: { module: moduleId, tab } }));
}

/**
 * THE ANCHOR HAS TO SURVIVE A MOUNT, so it is LATCHED here as well as
 * dispatched.
 *
 * The composer that needs the path is inside the Comments tab, which is not
 * rendered when the click happens: the user is on the Capex screen, the
 * Collaborate screen is not mounted, and its Comments tab is not the open one
 * even once it is. An event alone is delivered to nobody and the anchor is
 * silently lost, which would look exactly like the feature not working.
 *
 * So: the event serves a panel that IS mounted, and the latch serves one that
 * mounts afterwards. `takePendingAnchor` CONSUMES it, so an anchor can never
 * be picked up twice and attach itself to an unrelated comment later.
 */
let pendingAnchor: string | null = null;
export function takePendingAnchor(): string | null {
  const p = pendingAnchor;
  pendingAnchor = null;
  return p;
}

/**
 * RAISE A COMMENT ON A FIELD, from wherever that field is on screen.
 *
 * The other direction of the same idea: `goToScreen` takes you from a comment
 * to the field, this takes you from the field to a comment about it. Any input
 * on any module tab can call it with its own snapshot path.
 *
 * TWO LISTENERS, ONE EVENT, deliberately: Module10Collaborate moves to the
 * Comments tab and CommentsPanel holds the path for the composer. Neither
 * needs to know about the other, and a surface that mounts only one of them
 * still behaves sensibly.
 *
 * ORDER MATTERS. The navigation goes first so the Collaborate screen is
 * mounting, then the anchor, on the next frame, so a panel that was not
 * mounted when the click happened still receives it.
 */
export function commentOnField(path: string): void {
  pendingAnchor = path;
  goToScreen('module10');
  window.dispatchEvent(new CustomEvent('fmp:comment-on', { detail: { path } }));
}

export function ScreenBadge({ path, testid }: { path: string | null | undefined; testid?: string }): React.JSX.Element | null {
  const found = screenForPath(path);
  if (!found) return null;

  if (found.unmapped) {
    return (
      <div
        data-testid={testid ? `${testid}-unmapped` : undefined}
        style={{ fontSize: 11, color: 'var(--color-muted)', fontStyle: 'italic', marginTop: 2 }}
      >
        {found.sentence}
      </div>
    );
  }

  // The sentence is assembled here rather than taken whole from the map,
  // because the screen names have to be individually clickable. The map's own
  // `sentence` stays the single source of the WORDS (it is what a non-clickable
  // surface, such as an export, would print).
  return (
    <div
      data-testid={testid ? `${testid}-screen` : undefined}
      style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}
    >
      {'Edited on '}
      {found.screens.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && <span>{i === found.screens.length - 1 ? ' or ' : ', '}</span>}
          <button
            type="button"
            data-testid={testid ? `${testid}-goto-${s.key}` : undefined}
            onClick={() => goToScreen(s.module, s.key)}
            title={`Go to ${s.label}`}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              font: 'inherit', color: 'var(--color-primary, #1d4ed8)', textDecoration: 'underline',
            }}
          >
            {s.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
