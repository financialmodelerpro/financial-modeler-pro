/**
 * The frame around every live course page (overview and session): the
 * training shell for a signed-in student, the site navbar and footer for a
 * visitor. One place, so the two pages cannot drift.
 *
 * The navbar and footer data come from the 60 s cached CMS reads
 * (src/shared/cms/cached.ts): these pages are on every course click and each
 * read is a round trip to a database on another continent. Read here, in a
 * server-only file, because NavbarServer is also imported by client
 * components, which cannot import next/cache.
 */
import type { ReactNode } from 'react';
import { TrainingShell } from '@/src/hubs/training/components/TrainingShell';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { getSitePagesCached, getCmsContentCached, getFooterLegalLinksCached } from '@/src/shared/cms/cached';

export async function CoursePageFrame({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  if (signedIn) return <TrainingShell activeNav="dashboard">{children}</TrainingShell>;
  const [sitePages, content, legalLinks] = await Promise.all([getSitePagesCached(), getCmsContentCached(), getFooterLegalLinksCached()]);
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', minHeight: '100vh' }}>
      <NavbarServer preloaded={{ sitePages, content }} />
      <div style={{ height: 64 }} />
      {children}
      <SharedFooter
        company="Financial Modeler Pro"
        founder="Financial Modeler Pro Team"
        copyright={`© ${new Date().getFullYear()} Financial Modeler Pro`}
        height="compact"
        legalLinks={legalLinks}
      />
    </div>
  );
}
