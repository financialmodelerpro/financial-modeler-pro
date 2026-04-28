'use client';

import { FollowPopup } from './FollowPopup';

/** Site-wide popup - appears after 60s, once per session */
export function SiteFollowPopup() {
  return (
    <FollowPopup
      heading="Stay Connected"
      subtext="Follow us on LinkedIn and YouTube for new training sessions and financial modeling content."
      storageKey="fmp_follow_popup_shown"
      delayMs={60000}
    />
  );
}
