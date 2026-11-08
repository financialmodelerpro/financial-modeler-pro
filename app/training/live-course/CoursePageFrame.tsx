/**
 * The frame around every live course page (overview and session): the
 * training shell for a signed-in student, the site navbar and footer for a
 * visitor. One place, so the two pages cannot drift.
 */
import type { ReactNode } from 'react';
import { TrainingShell } from '@/src/hubs/training/components/TrainingShell';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';

export function CoursePageFrame({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  if (signedIn) return <TrainingShell activeNav="dashboard">{children}</TrainingShell>;
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />
      {children}
      <SharedFooter
        company="Financial Modeler Pro"
        founder="Financial Modeler Pro Team"
        copyright={`© ${new Date().getFullYear()} Financial Modeler Pro`}
        height="compact"
      />
    </div>
  );
}
