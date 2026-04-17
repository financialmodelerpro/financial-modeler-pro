import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getCmsPage, getPageSections, getCmsContent, cms } from '@/src/lib/shared/cms';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { SectionRenderer } from '@/src/components/cms/SectionRenderer';

export const revalidate = 60; // ISR: revalidate every 60 seconds

// ── Dynamic metadata from cms_pages ──────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getCmsPage(slug);
  if (!page) return {};
  return {
    title:       page.seo_title || `${page.title} - Financial Modeler Pro`,
    description: page.seo_description || undefined,
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CmsPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Fetch page metadata + sections in parallel
  const [page, sections, content] = await Promise.all([
    getCmsPage(slug),
    getPageSections(slug),
    getCmsContent(),
  ]);

  // If page doesn't exist or is not published, show 404
  if (!page) notFound();

  // Footer CMS content
  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Ahmad Din - CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {sections.length > 0 ? (
        <SectionRenderer sections={sections} />
      ) : (
        <div style={{ padding: '120px 40px', textAlign: 'center', color: '#9CA3AF' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🧱</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0D2E5A', marginBottom: 8 }}>{page.title}</h1>
          <p style={{ fontSize: 14 }}>This page has no sections yet. Add content in the admin Page Builder.</p>
        </div>
      )}

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}
