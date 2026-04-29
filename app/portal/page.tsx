import { redirect } from 'next/navigation';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

// Legacy /portal entry. The canonical Modeling Hub landing is now
// /modeling/dashboard on app.* (kept on the same subdomain so the
// NextAuth session cookie stays in scope — the previous /portal
// route required cross-subdomain redirection which dropped the
// session cookie).
export default function PortalRedirect(): never {
  redirect(`${APP_URL}/modeling/dashboard`);
}
