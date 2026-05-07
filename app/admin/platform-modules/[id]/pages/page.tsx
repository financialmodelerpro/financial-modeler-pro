/**
 * /admin/platform-modules/[id]/pages
 *
 * Page-sections editor for a single platform module. Renders one editable
 * card per section (hero / features / how_it_works / cta / testimonials)
 * with a JSON textarea for content_blocks. The 5 sections are pre-seeded
 * with empty templates so the admin can fill them without thinking about
 * what shape each section expects.
 */

'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

type PageSection = 'hero' | 'features' | 'how_it_works' | 'cta' | 'testimonials';

interface PlatformModulePage {
  id: string;
  module_id: string;
  page_section: PageSection;
  display_order: number;
  content_blocks: Record<string, unknown>;
  visible: boolean;
}

const SECTION_TEMPLATES: Record<PageSection, Record<string, unknown>> = {
  hero: {
    title: '',
    subtitle: '',
    primaryCta: { label: 'Try it Free', href: '/refm' },
    secondaryCta: { label: 'Watch Demo', href: '#demo' },
    heroImageUrl: '',
  },
  features: {
    heading: 'What you can do',
    bullets: [],
  },
  how_it_works: {
    heading: 'How it works',
    steps: [{ number: 1, title: '', body: '' }],
  },
  cta: {
    heading: '',
    body: '',
    primaryCta: { label: '', href: '' },
    secondaryCta: { label: '', href: '' },
  },
  testimonials: {
    heading: 'What our users say',
    items: [],
  },
};

const SECTION_ORDER: PageSection[] = ['hero', 'features', 'how_it_works', 'cta', 'testimonials'];
const SECTION_LABEL: Record<PageSection, string> = {
  hero: 'Hero',
  features: 'Features',
  how_it_works: 'How It Works',
  cta: 'Call To Action',
  testimonials: 'Testimonials',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB',
  borderRadius: 6, fontSize: 13, color: '#1B3A6B', background: '#fff', boxSizing: 'border-box',
};

interface ModuleSummary {
  id: string;
  name: string;
  short_name: string;
  platform_slug: string;
  slug: string;
}

export default function AdminPlatformModulePagesPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id: moduleId } = use(props.params);

  const [moduleSummary, setModuleSummary] = useState<ModuleSummary | null>(null);
  const [pages, setPages] = useState<PlatformModulePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<PageSection, string>>({
    hero: '', features: '', how_it_works: '', cta: '', testimonials: '',
  });
  const [savingSection, setSavingSection] = useState<PageSection | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  // Load module summary + pages
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Look up module via the admin listing across all platforms (since we
      // only have moduleId here, walk the active platform's list).
      // Cheaper path: fetch pages directly + read module_id back.
      const pagesRes = await fetch(`/api/admin/platform-module-pages?moduleId=${moduleId}`);
      const pagesJson = await pagesRes.json();
      const pageRows = (pagesJson.pages ?? []) as PlatformModulePage[];
      setPages(pageRows);

      // Initialise draft JSON from existing pages, or template if missing.
      const next: Record<PageSection, string> = {
        hero: '', features: '', how_it_works: '', cta: '', testimonials: '',
      };
      for (const section of SECTION_ORDER) {
        const existing = pageRows.find((p) => p.page_section === section);
        next[section] = JSON.stringify(
          existing ? existing.content_blocks : SECTION_TEMPLATES[section],
          null,
          2,
        );
      }
      setDrafts(next);

      // Walk admin/modules to find the parent platform_slug + module slug.
      const platformsRes = await fetch('/api/admin/modules');
      const platformsJson = await platformsRes.json();
      const platforms = (platformsJson.modules ?? []) as { slug: string }[];
      for (const p of platforms) {
        const r = await fetch(`/api/platforms/${p.slug}/modules?includeHidden=1`);
        const j = await r.json();
        const found = (j.modules ?? []).find((m: { id: string }) => m.id === moduleId);
        if (found) {
          setModuleSummary({
            id: found.id,
            name: found.name,
            short_name: found.short_name,
            platform_slug: found.platform_slug,
            slug: found.slug,
          });
          break;
        }
      }
    } catch {
      showToast('Failed to load page sections', 'error');
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSection(section: PageSection) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(drafts[section]);
    } catch {
      showToast(`Invalid JSON in ${SECTION_LABEL[section]}`, 'error');
      return;
    }
    setSavingSection(section);
    try {
      const existing = pages.find((p) => p.page_section === section);
      const url = existing
        ? `/api/admin/platform-module-pages/${existing.id}`
        : '/api/admin/platform-module-pages';
      const method = existing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: moduleId,
          page_section: section,
          display_order: SECTION_ORDER.indexOf(section) + 1,
          content_blocks: parsed,
          visible: existing ? existing.visible : true,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        showToast(j.error ?? 'Save failed', 'error');
        return;
      }
      showToast(`${SECTION_LABEL[section]} saved`);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSavingSection(null);
    }
  }

  async function toggleVisibility(section: PageSection) {
    const existing = pages.find((p) => p.page_section === section);
    if (!existing) {
      showToast('Save the section first before toggling visibility', 'error');
      return;
    }
    try {
      const res = await fetch(`/api/admin/platform-module-pages/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: moduleId,
          page_section: section,
          visible: !existing.visible,
        }),
      });
      if (res.ok) {
        showToast(`${SECTION_LABEL[section]} ${existing.visible ? 'hidden' : 'shown'}`);
        load();
      } else {
        showToast('Toggle failed', 'error');
      }
    } catch {
      showToast('Toggle failed', 'error');
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/platform-modules" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ marginBottom: 24 }}>
          <Link href="/admin/platform-modules" style={{ fontSize: 12, color: '#1D4ED8', textDecoration: 'none' }}>
            ← Back to Platform Modules
          </Link>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
          {moduleSummary ? `Page Sections, ${moduleSummary.name}` : 'Page Sections'}
        </h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>
          Edit each section's content_blocks JSON. Hero, Features, How It Works, CTA, and Testimonials each get their own editable card.
          {moduleSummary && (
            <>
              {' '}Public URL: <code style={{ fontSize: 12, background: '#F3F4F6', padding: '2px 6px', borderRadius: 4 }}>
                /modeling-hub/{moduleSummary.platform_slug}/{moduleSummary.slug}
              </code>
            </>
          )}
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading sections…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {SECTION_ORDER.map((section) => {
              const existing = pages.find((p) => p.page_section === section);
              const visible = existing ? existing.visible : true;
              return (
                <div
                  key={section}
                  data-testid={`section-card-${section}`}
                  style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', padding: 20 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', margin: 0 }}>
                      {SECTION_LABEL[section]}
                    </h3>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                          background: visible ? '#E8F7EC' : '#F3F4F6',
                          color: visible ? '#1A7A30' : '#6B7280',
                        }}
                      >
                        {visible ? '✓ Visible' : 'Hidden'}
                      </span>
                      <button
                        onClick={() => toggleVisibility(section)}
                        style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151' }}
                      >
                        {visible ? 'Hide' : 'Show'}
                      </button>
                      <button
                        onClick={() => saveSection(section)}
                        disabled={savingSection === section}
                        data-testid={`save-section-${section}`}
                        style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 6, border: 'none', background: '#1B4F8A', color: '#fff', cursor: 'pointer', opacity: savingSection === section ? 0.6 : 1 }}
                      >
                        {savingSection === section ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={drafts[section]}
                    onChange={(e) => setDrafts({ ...drafts, [section]: e.target.value })}
                    data-testid={`textarea-${section}`}
                    style={{ ...inputStyle, minHeight: 180, fontFamily: 'monospace', fontSize: 12 }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </main>

      {toast && (
        <div
          data-testid="admin-toast"
          style={{
            position: 'fixed', bottom: 24, right: 24,
            background: toast.type === 'success' ? '#1A7A30' : '#DC2626',
            color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px',
            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999,
          }}
        >
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
