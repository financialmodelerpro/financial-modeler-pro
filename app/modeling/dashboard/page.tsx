import { redirect } from 'next/navigation';

/**
 * /modeling/dashboard is retired in favour of /portal (the sidebar
 * workspace shell with Dashboard / My Projects / Certificates / Settings /
 * Admin Panel nav). This thin redirect preserves any inbound bookmarks
 * pointing at the old 3-card layout.
 */
export default function ModelingDashboardRedirect() {
  redirect('/portal');
}
