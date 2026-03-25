/**
 * NavbarServer — server component wrapper around Navbar.
 * Fetches nav pages from DB (respects admin visibility toggles)
 * and logo URL from CMS. All public pages should use this instead
 * of importing <Navbar /> directly.
 */
import { getSitePages, getCmsContent, cms } from '@/src/lib/cms';
import { Navbar } from './Navbar';

interface Props {
  topOffset?: number;
}

export async function NavbarServer({ topOffset = 0 }: Props) {
  const [sitePages, content] = await Promise.all([
    getSitePages(),
    getCmsContent(),
  ]);
  const logoUrl = cms(content, 'branding', 'logo_url', '');
  return (
    <Navbar
      navPages={sitePages.length > 0 ? sitePages : undefined}
      topOffset={topOffset}
      logoUrl={logoUrl || undefined}
    />
  );
}
