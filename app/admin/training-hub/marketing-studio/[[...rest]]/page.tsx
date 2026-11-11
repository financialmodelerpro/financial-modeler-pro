import { redirect } from 'next/navigation';

/**
 * Marketing Studio was removed on 2026-11-11 (founder). Its old admin
 * addresses, the page and anything under it, go to the admin home.
 * (A page redirect rather than a next.config.ts rule: that file is on the
 * do-not-touch list.)
 */
export default function MarketingStudioRemoved(): never {
  redirect('/admin');
}
