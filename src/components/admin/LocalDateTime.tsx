'use client';

/**
 * Renders a UTC timestamp in the VIEWER'S timezone.
 *
 * The admin articles list is a server component, so it renders in the server's zone
 * (UTC on Vercel). Formatting a scheduled publish time there would show "04:00" to an
 * admin who scheduled 09:00 in Karachi, which is exactly the confusion a scheduling
 * feature cannot afford. Formatting after mount reads the real browser zone, and
 * starting from an empty string keeps server and client markup identical so there is
 * no hydration mismatch.
 */

import { useEffect, useState } from 'react';

export function LocalDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState('');

  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    setText(d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
  }, [iso]);

  return <span suppressHydrationWarning>{text}</span>;
}
