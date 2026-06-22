/**
 * /admin/access (consolidated)
 *
 * The "User Access" tab was merged into "Users". Per-user entitlements now live
 * at /admin/users/[id] (reached from the Users list). This route redirects to
 * the Users list so old links / bookmarks keep working.
 */
import { redirect } from 'next/navigation';

export default function AdminAccessRedirect() {
  redirect('/admin/users');
}
