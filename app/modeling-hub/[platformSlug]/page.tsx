/**
 * /modeling-hub/[platformSlug]
 *
 * Per-platform overview, lists every visible module under that platform with
 * description + status badge + link to the per-module marketing page.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { getModules, getCmsContent, cms } from '@/src/shared/cms';
import {
  getPlatformModules,
  type PlatformModuleStatus,
} from '@/src/shared/cms/platform-modules';

export const revalidate = 60;

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

const STATUS_PILL: Record<PlatformModuleStatus, { label: string; bg: string; color: string }> = {
  live:        { label: '✓ Live',      bg: '#E8F7EC', color: '#1A7A30' },
  coming_soon: { label: 'Coming Soon', bg: '#FEF3C7', color: '#92400E' },
  pro:         { label: 'Pro',         bg: '#EFF6FF', color: '#1D4ED8' },
  enterprise:  { label: 'Enterprise',  bg: '#F5F3FF', color: '#5B21B6' },
  hidden:      { label: 'Hidden',      bg: '#F3F4F6', color: '#6B7280' },
};

export async function generateMetadata(props: {
  params: Promise<{ platformSlug: string }>;
}): Promise<Metadata> {
  const { platformSlug } = await props.params;
  const platforms = await getModules();
  const p = platforms.find((x) => x.slug === platformSlug);
  if (!p) return { title: 'Modeling Hub' };
  return {
    title: `${p.name}, Financial Modeler Pro`,
    description: p.description,
    alternates: { canonical: `${MAIN_URL}/modeling-hub/${platformSlug}` },
  };
}

export default async function PlatformOverviewPage(props: {
  params: Promise<{ platformSlug: string }>;
}) {
  const { platformSlug } = await props.params;

  const [platforms, modules, content] = await Promise.all([
    getModules(),
    getPlatformModules(platformSlug),
    getCmsContent(),
  ]);
  const platform = platforms.find((p) => p.slug === platformSlug);
  if (!platform) notFound();
  const footerCompany = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder = cms(content, 'footer', 'founder_line', 'Ahmad Din, CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <>
      <NavbarServer />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '60px 24px 80px' }}>
        <Link
          href="/modeling-hub"
          style={{ fontSize: 13, color: '#1D4ED8', textDecoration: 'none', display: 'inline-block', marginBottom: 16 }}
        >
          ← Modeling Hub
        </Link>

        <header style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{platform.icon}</div>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: '#1B3A6B', marginBottom: 12 }}>
            {platform.name}
          </h1>
          <p style={{ fontSize: 16, color: '#6B7280', maxWidth: 760 }}>{platform.description}</p>
        </header>

        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>
          Modules ({modules.length})
        </h2>

        {modules.length === 0 ? (
          <div
            data-testid="no-modules"
            style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', background: '#F9FAFB', borderRadius: 12 }}
          >
            No modules yet for this platform. Check back soon.
          </div>
        ) : (
          <div
            data-testid="modules-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 16,
            }}
          >
            {modules.map((m) => {
              const pill = STATUS_PILL[m.status];
              return (
                <Link
                  key={m.id}
                  href={`/modeling-hub/${platformSlug}/${m.slug}`}
                  data-testid={`module-card-${m.slug}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#fff',
                    borderRadius: 12,
                    border: '1px solid #E8F0FB',
                    padding: 20,
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 24 }}>{m.icon_emoji ?? '·'}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF' }}>
                      MODULE {m.number}
                    </span>
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>
                    {m.name}
                  </h3>
                  <p style={{ fontSize: 13, color: '#6B7280', flex: 1, marginBottom: 14 }}>
                    {m.description}
                  </p>
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: 20,
                      background: pill.bg,
                      color: pill.color,
                      width: 'fit-content',
                    }}
                  >
                    {pill.label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </main>
      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </>
  );
}
