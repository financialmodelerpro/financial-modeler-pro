'use client';

/**
 * Training Hub onboarding walkthrough — powered by driver.js.
 *
 * Runs automatically on a new student's first dashboard visit (trigger
 * lives in the parent dashboard page, driven by /api/training/tour-status).
 * Restartable any time from the profile dropdown's "Restart Tour".
 *
 * Safety:
 *   - Steps targeting selectors that aren't present in the DOM are
 *     skipped by driver.js, never throw.
 *   - Students can dismiss any time via Skip / Close / Esc.
 *   - Tour never blocks navigation — it sits in an overlay layer only.
 *
 * Applied to the Training Hub only. Modeling Hub onboarding is planned
 * separately.
 */

import { useEffect, useRef } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

interface DashboardTourProps {
  /** Parent-controlled. Set true to start/restart; false stops/destroys. */
  run:         boolean;
  studentName: string;
  /** Fires when the tour reaches a terminal state (finished or closed). */
  onComplete:  (reason: 'finished' | 'closed') => void;
}

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}

function buildSteps(studentName: string): DriveStep[] {
  // A step with no `element` renders as a centered modal — driver.js
  // handles that automatically. This is how we cover UI that lives on
  // sub-pages (session card / watch button / assessment button) without
  // having to navigate the student around mid-tour.
  const first = firstName(studentName);
  return [
    {
      popover: {
        title:       `Welcome to the FMP Training Hub${first ? `, ${first}` : ''} 👋`,
        description:
          'Let’s take a 60-second tour so you know exactly where everything lives. You can skip any time.',
      },
    },
    {
      element: '[data-tour="dashboard-main"]',
      popover: {
        title:       'Your Dashboard',
        description:
          'This is home base. Your courses, live sessions, progress, and achievement cards all show up here.',
        side:  'top',
        align: 'center',
      },
    },
    {
      element: '[data-tour="course-card"]',
      popover: {
        title:       'A Course Card',
        description:
          'Each course has a series of sessions plus a final exam. Click a course to see every session — complete them all to unlock your verified certificate.',
        side:  'bottom',
        align: 'center',
      },
    },
    {
      popover: {
        title:       'Session Cards',
        description:
          'Inside a course, each session shows a video, any attached study material, and an assessment. You work through them in order.',
      },
    },
    {
      popover: {
        title:       'Watch the Video',
        description:
          'Every session starts with a video. Watch it through to move on to the assessment.',
      },
    },
    {
      popover: {
        title:       'Take the Assessment',
        description:
          'After the video, take the session assessment. Pass it and the next session unlocks automatically.',
      },
    },
    {
      element: '[data-tour="overall-progress"]',
      popover: {
        title:       'Track Your Progress',
        description:
          'Your overall progress updates as soon as you pass a session. Keep an eye on this — it’s your path to the certificate.',
        side:  'right',
        align: 'center',
      },
    },
    {
      element: '[data-tour="live-sessions-nav"]',
      popover: {
        title:       'Live Sessions',
        description:
          'Join practitioner-led live sessions on real-world modeling topics. Recordings and attachments stay here too, so you can catch up later.',
        side:  'right',
        align: 'center',
      },
    },
    {
      popover: {
        title:       'Your Certificate',
        description:
          'Pass every session + the final exam and your verified certificate is issued automatically. Share it to LinkedIn with one click from the dashboard.',
      },
    },
    {
      element: '[data-tour="help-menu"]',
      popover: {
        title:       'Need Help?',
        description:
          'Open your profile menu and pick “Restart Tour” to run this walkthrough again any time.',
        side:  'bottom',
        align: 'end',
      },
    },
    {
      popover: {
        title:       'You’re all set 🚀',
        description:
          'Jump into Session 1 of 3-Statement Financial Modeling whenever you’re ready. Good luck!',
      },
    },
  ];
}

export function DashboardTour({ run, studentName, onComplete }: DashboardTourProps) {
  // Single driver instance lives in a ref so we can destroy cleanly on
  // unmount / when the parent toggles `run` back to false. Re-building
  // the instance on every run gives us fresh steps (in case studentName
  // has arrived since the last run) without leaking overlays.
  const driverRef = useRef<Driver | null>(null);
  // Track whether driver.js closed itself via its own completion path so
  // we don't double-fire onComplete when we also unmount / stop.
  const settledRef = useRef(false);

  useEffect(() => {
    if (!run) {
      // Parent switched us off — tear down any overlay that was up.
      driverRef.current?.destroy();
      driverRef.current = null;
      return;
    }

    settledRef.current = false;
    const instance = driver({
      showProgress:   true,
      animate:        true,
      allowClose:     true,
      smoothScroll:   true,
      overlayColor:   'rgba(13, 46, 90, 0.55)',
      popoverClass:   'fmp-tour-popover',
      steps:          buildSteps(studentName),
      nextBtnText:    'Next →',
      prevBtnText:    '← Back',
      doneBtnText:    'Start Learning',
      onDestroyStarted: () => {
        // Fires on Close / Esc / overlay-click. Manually destroy since
        // allowClose=true makes it user-driven.
        if (!settledRef.current) {
          settledRef.current = true;
          // Driver.js considers the tour "finished" only if we're on the
          // last step. Treat last-step destroy as finished, anything else
          // as closed/skipped — both count as "don't re-auto-start."
          const total = instance.getActiveIndex();
          const stepsLen = buildSteps(studentName).length;
          const reachedEnd = typeof total === 'number' && total >= stepsLen - 1;
          instance.destroy();
          onComplete(reachedEnd ? 'finished' : 'closed');
        }
      },
    });

    driverRef.current = instance;
    // Kick off from step 0 asynchronously so React finishes the render
    // pass before driver.js measures target elements.
    const timer = setTimeout(() => {
      if (driverRef.current === instance) {
        instance.drive();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      if (driverRef.current === instance) {
        instance.destroy();
        driverRef.current = null;
      }
    };
    // studentName change alone shouldn't restart — parent controls via `run`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // Brand-tinted popover — styles injected via a plain <style> element
  // (global, no styled-jsx dependency). The `.fmp-tour-popover` class is
  // applied via the `popoverClass` config above; `.driver-active-element`
  // is driver.js's built-in spotlight target.
  return (
    <style>{`
      .fmp-tour-popover.driver-popover {
        font-family: 'Inter', sans-serif;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(13, 46, 90, 0.25);
        max-width: 420px;
      }
      .fmp-tour-popover .driver-popover-title {
        color: #0D2E5A;
        font-size: 15px;
        font-weight: 800;
        margin-bottom: 6px;
      }
      .fmp-tour-popover .driver-popover-description {
        color: #374151;
        font-size: 13.5px;
        line-height: 1.55;
      }
      .fmp-tour-popover .driver-popover-footer {
        margin-top: 14px;
      }
      .fmp-tour-popover .driver-popover-progress-text {
        color: #9CA3AF;
        font-size: 11px;
        font-weight: 600;
      }
      .fmp-tour-popover .driver-popover-navigation-btns button.driver-popover-next-btn,
      .fmp-tour-popover .driver-popover-navigation-btns button.driver-popover-prev-btn,
      .fmp-tour-popover .driver-popover-navigation-btns button.driver-popover-close-btn {
        background: #0D2E5A;
        color: #fff;
        border: none;
        border-radius: 7px;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 700;
        text-shadow: none;
        cursor: pointer;
      }
      .fmp-tour-popover .driver-popover-navigation-btns button.driver-popover-prev-btn {
        background: #F3F4F6;
        color: #374151;
      }
      .fmp-tour-popover .driver-popover-navigation-btns button.driver-popover-next-btn:hover,
      .fmp-tour-popover .driver-popover-navigation-btns button.driver-popover-close-btn:hover {
        background: #1B4F8A;
      }
      .fmp-tour-popover .driver-popover-close-btn {
        background: #F3F4F6 !important;
        color: #6B7280 !important;
      }
      .fmp-tour-popover .driver-popover-arrow-side-top.driver-popover-arrow { border-top-color: #fff; }
      .fmp-tour-popover .driver-popover-arrow-side-bottom.driver-popover-arrow { border-bottom-color: #fff; }
      .fmp-tour-popover .driver-popover-arrow-side-left.driver-popover-arrow { border-left-color: #fff; }
      .fmp-tour-popover .driver-popover-arrow-side-right.driver-popover-arrow { border-right-color: #fff; }
      /* Spotlight ring — tint to brand gold so the highlighted element
         reads as "the thing we're pointing at". */
      .driver-active-element {
        box-shadow: 0 0 0 4px rgba(201, 168, 76, 0.8), 0 0 0 8px rgba(13, 46, 90, 0.15) !important;
        border-radius: 10px !important;
      }
    `}</style>
  );
}
