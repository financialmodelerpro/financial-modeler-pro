/**
 * tour.ts (2026-08-20)
 *
 * The guided tour, DERIVED from the same two sources the guide renders:
 * guideContent.ts for every sentence and moduleTabs.ts for the structure.
 * This file writes no module or tab prose of its own, which is the rule that
 * keeps the tour and the guide from drifting: where they overlap there is one
 * string, used twice.
 *
 * Pure: no React, no DOM. The component (PlatformTour.tsx) resolves the
 * anchors and draws the spotlight; this file only decides what the steps ARE.
 *
 * Coverage is every module in canonical order and, within each module, every
 * tab (Module 6, which has no sidebar tabs, walks its four declared page
 * surfaces instead). verify-platform-tour holds this file to that.
 *
 * No em dashes in this file.
 */
import { MODULES } from '../modules-config';
import { MODULE_TABS, GUIDE_MODULE_ORDER } from '../moduleTabs';
import { MODULE_INTRO, TAB_CONTENT, MODULE6_SURFACES } from './guideContent';

export interface TourStep {
  id: string;
  /** Short heading on the card. */
  title: string;
  /** What the highlighted element is FOR. Verbatim from guideContent. */
  body: string;
  /** Where the platform should navigate before this step shows. */
  nav?: { module: string; tab?: string };
  /**
   * Selector fallback chain; the first that resolves is highlighted. An empty
   * list (the welcome and closing steps) renders a centred card with no
   * spotlight. Falling back matters: a tab surface only exists once a project
   * is open, so a step must degrade to highlighting the main area, and then
   * to no highlight, rather than dying.
   */
  anchors: string[];
}

const sidebarAnchor = (moduleKey: string): string => `[data-testid="sidebar-${moduleKey}"]`;
const MAIN = '[data-testid="platform-main"]';

export function buildPlatformTour(): TourStep[] {
  const steps: TourStep[] = [];

  steps.push({
    id: 'welcome',
    title: 'Welcome to the platform',
    body: 'This short tour walks every module in order and explains what each surface is for. You can pause at any time and pick up where you left off, go back a step, or skip the tour entirely; restart it later from the Guide.',
    anchors: [],
  });

  for (const mk of GUIDE_MODULE_ORDER) {
    const mod = MODULES.find((m) => m.key === mk);
    if (!mod || mod.disabled) continue;

    // The module step highlights its sidebar entry: the thing the user will
    // actually click, described by the same intro paragraph the guide opens
    // the module section with.
    steps.push({
      id: mk,
      title: mod.longLabel,
      body: MODULE_INTRO[mk] ?? mod.longLabel,
      nav: { module: mk },
      anchors: [sidebarAnchor(mk)],
    });

    const tabs = MODULE_TABS[mk] ?? [];
    if (tabs.length > 0) {
      for (const t of tabs) {
        const c = TAB_CONTENT[`${mk}/${t.key}`];
        steps.push({
          id: `${mk}/${t.key}`,
          title: t.label.replace(/^\d+\.\s*/, ''),
          body: c ? c.intro + (c.review ? ` What to review: ${c.review}` : '') : t.label,
          nav: { module: mk, tab: t.key },
          // The element described is the tab's surface, so the main content
          // area is the primary anchor; with no project open it may render a
          // placeholder, which is still the surface being described.
          anchors: [MAIN, sidebarAnchor(mk)],
        });
      }
    } else if (mk === 'module6') {
      // One page of sections, each with its own anchor on the page.
      for (const sf of MODULE6_SURFACES) {
        steps.push({
          id: sf.id,
          title: sf.title,
          body: sf.body,
          nav: { module: mk },
          anchors: [`[data-testid="${sf.anchor}"]`, MAIN],
        });
      }
    }
  }

  steps.push({
    id: 'finish',
    title: 'You are set',
    body: 'The Guide button in the top bar opens the full written guide from anywhere, with search and a section map, and this tour can be restarted from inside it whenever you want the walkthrough again.',
    anchors: ['[data-testid="topbar-open-guide"]'],
  });

  return steps;
}
