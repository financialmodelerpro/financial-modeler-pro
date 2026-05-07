/**
 * /modeling-hub
 *
 * Overview of all modeling platforms (REFM, BVM, FPA, ...). Reads the legacy
 * `modules` table (which actually stores platforms) via getModules() and
 * renders one card per platform with a "Modules ->" affordance pointing to
 * the per-platform page.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { getModules, getCmsContent, cms } from '@/src/shared/cms';

export const revalidate = 60;

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export const metadata: Metadata = {
  title: 'Modeling Hub, Financial Modeler Pro',
  description:
    'Explore the Financial Modeler Pro modeling platforms: real estate, business valuation, FP&A, equity research, project finance, LBO, corporate finance, energy, startup, banking and credit.',
  alternates: { canonical: `${MAIN_URL}/modeling-hub` },
};

export default async function ModelingHubOverviewPage() {
  const [platforms, content] = await Promise.all([getModules(), getCmsContent()]);
  const footerCompany = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder = cms(content, 'footer', 'founder_line', 'Ahmad Din, CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <>
      <NavbarServer />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px 80px' }}>
        <header style={{ marginBottom: 40, textAlign: 'center' }}>
          <h1 style={{ fontSize: 40, fontWeight: 800, color: '#1B3A6B', marginBottom: 12 }}>
            The Modeling Hub
          </h1>
          <p style={{ fontSize: 16, color: '#6B7280', maxWidth: 720, margin: '0 auto' }}>
            Choose a modeling platform to explore. Each one is a structured, guided workflow built
            for institutional financial modeling, with rigour, traceability, and presentation-quality output.
          </p>
        </header>

        <div
          data-testid="platforms-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 20,
          }}
        >
          {platforms.map((p) => {
            const isLive = p.status === 'live';
            return (
              <Link
                key={p.id}
                href={`/modeling-hub/${p.slug}`}
                data-testid={`platform-card-${p.slug}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: '#fff',
                  borderRadius: 14,
                  border: '1px solid #E8F0FB',
                  padding: 24,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>{p.icon}</div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>
                  {p.name}
                </h2>
                <p style={{ fontSize: 13, color: '#6B7280', flex: 1, marginBottom: 16 }}>
                  {p.description}
                </p>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: 20,
                    background: isLive ? '#E8F7EC' : '#FEF3C7',
                    color: isLive ? '#1A7A30' : '#92400E',
                    width: 'fit-content',
                  }}
                >
                  {isLive ? '✓ Live' : 'Coming Soon'}
                </span>
              </Link>
            );
          })}
        </div>
      </main>
      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </>
  );
}
