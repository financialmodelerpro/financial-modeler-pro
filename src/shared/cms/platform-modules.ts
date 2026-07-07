/**
 * platform-modules.ts, P-Sync helpers (created 2026-05-07)
 *
 * Three-way source of truth between the admin dashboard, the REFM workspace
 * sidebar, and the public marketing site. The legacy `modules` table stores
 * platforms (REFM, BVM, FPA, etc.) under a misleading name. The two new
 * tables added in p_sync_platform_modules.sql are:
 *
 *   platform_modules        - per-platform sub-modules (Module 1..N within REFM)
 *   platform_module_pages   - marketing CMS sections (hero / features / how_it_works / cta / testimonials)
 *
 * Helpers in this file are isomorphic-safe: they use getServerClient when
 * called from server components / API routes (service role bypasses RLS).
 * Public callers only ever see rows with status != 'hidden'.
 */

import { getServerClient } from '@/src/core/db/supabase';

// ── Types ──────────────────────────────────────────────────────────────────

export type PlatformModuleStatus = 'live' | 'coming_soon' | 'hidden' | 'pro' | 'enterprise';
export type PlatformModuleGatingTier = 'free' | 'pro' | 'enterprise';
export type PlatformModulePageSection =
  | 'hero'
  | 'features'
  | 'how_it_works'
  | 'cta'
  | 'testimonials';

export interface PlatformModule {
  id: string;
  platform_slug: string;
  slug: string;
  number: number;
  name: string;
  short_name: string;
  description: string;
  icon_url: string | null;
  icon_emoji: string | null;
  status: PlatformModuleStatus;
  gating_tier: PlatformModuleGatingTier;
  display_order: number;
  features: string[];
  screenshots: string[];
  demo_video_url: string | null;
  launch_date: string | null;
  /** Whether this module is offered as an option in the PDF Full Financial Model
   *  export (mig 186). Display / export-scope only, never gating. Undefined when
   *  the column is not present yet (pre-migration): consumers treat that as true. */
  include_in_pdf?: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformModulePage {
  id: string;
  module_id: string;
  page_section: PlatformModulePageSection;
  display_order: number;
  content_blocks: Record<string, unknown>;
  visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformModuleWithPages extends PlatformModule {
  pages: PlatformModulePage[];
}

// Public input shape for upserting a module from the admin UI.
export interface PlatformModuleInput {
  id?: string;
  platform_slug: string;
  slug: string;
  number: number;
  name: string;
  short_name: string;
  description?: string;
  icon_url?: string | null;
  icon_emoji?: string | null;
  status?: PlatformModuleStatus;
  gating_tier?: PlatformModuleGatingTier;
  display_order?: number;
  features?: string[];
  screenshots?: string[];
  demo_video_url?: string | null;
  launch_date?: string | null;
  include_in_pdf?: boolean;
}

export interface PlatformModulePageInput {
  id?: string;
  module_id: string;
  page_section: PlatformModulePageSection;
  display_order?: number;
  content_blocks?: Record<string, unknown>;
  visible?: boolean;
}

// ── Public read helpers (RLS-safe shape, hidden filtered out) ──────────────

/**
 * Fetch all visible platform modules for a platform slug, ordered by display_order.
 * Returns [] on failure (DB unavailable, table missing).
 */
export async function getPlatformModules(platformSlug: string): Promise<PlatformModule[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('platform_modules')
      .select('*')
      .eq('platform_slug', platformSlug)
      .neq('status', 'hidden')
      .order('display_order');
    return (data as PlatformModule[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch a single platform module by (platformSlug, moduleSlug).
 * Returns null when not found or when status === 'hidden'.
 */
export async function getPlatformModuleBySlug(
  platformSlug: string,
  moduleSlug: string,
): Promise<PlatformModule | null> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('platform_modules')
      .select('*')
      .eq('platform_slug', platformSlug)
      .eq('slug', moduleSlug)
      .neq('status', 'hidden')
      .maybeSingle();
    return (data as PlatformModule) ?? null;
  } catch {
    return null;
  }
}

/** Fetch all visible page sections for a module, ordered by display_order. */
export async function getPlatformModulePages(moduleId: string): Promise<PlatformModulePage[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('platform_module_pages')
      .select('*')
      .eq('module_id', moduleId)
      .eq('visible', true)
      .order('display_order');
    return (data as PlatformModulePage[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch a module with its visible page sections in one shot. Convenient for
 * marketing-site server components that render hero + features + cta together.
 */
export async function getPlatformModuleWithPages(
  platformSlug: string,
  moduleSlug: string,
): Promise<PlatformModuleWithPages | null> {
  const m = await getPlatformModuleBySlug(platformSlug, moduleSlug);
  if (!m) return null;
  const pages = await getPlatformModulePages(m.id);
  return { ...m, pages };
}

// ── Admin helpers (always include hidden rows; require service-role caller) ─

/** Admin: list every module for a platform, including hidden. */
export async function adminListPlatformModules(platformSlug: string): Promise<PlatformModule[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('platform_modules')
      .select('*')
      .eq('platform_slug', platformSlug)
      .order('display_order');
    return (data as PlatformModule[]) ?? [];
  } catch {
    return [];
  }
}

/** Admin: list every page (visible + hidden) for a module. */
export async function adminListPlatformModulePages(moduleId: string): Promise<PlatformModulePage[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('platform_module_pages')
      .select('*')
      .eq('module_id', moduleId)
      .order('display_order');
    return (data as PlatformModulePage[]) ?? [];
  } catch {
    return [];
  }
}

/** Admin: upsert (create or update) a platform module. */
export async function adminUpsertPlatformModule(
  input: PlatformModuleInput,
): Promise<{ ok: true; module: PlatformModule } | { ok: false; error: string }> {
  try {
    const sb = getServerClient();
    const payload = {
      ...(input.id ? { id: input.id } : {}),
      platform_slug: input.platform_slug,
      slug: input.slug,
      number: input.number,
      name: input.name,
      short_name: input.short_name,
      description: input.description ?? '',
      icon_url: input.icon_url ?? null,
      icon_emoji: input.icon_emoji ?? null,
      status: input.status ?? 'coming_soon',
      gating_tier: input.gating_tier ?? 'free',
      display_order: input.display_order ?? input.number,
      features: input.features ?? [],
      screenshots: input.screenshots ?? [],
      demo_video_url: input.demo_video_url ?? null,
      launch_date: input.launch_date ?? null,
    };

    const { data, error } = input.id
      ? await sb.from('platform_modules').update(payload).eq('id', input.id).select().single()
      : await sb.from('platform_modules').insert(payload).select().single();

    if (error) return { ok: false, error: error.message };
    const saved = data as PlatformModule;

    // include_in_pdf (mig 186) is written in a SEPARATE best-effort update, kept
    // out of the core payload so a pre-migration save (column absent) still
    // succeeds with the DB default. A missing-column error is swallowed.
    if (input.include_in_pdf !== undefined && saved?.id) {
      const { error: pdfErr } = await sb
        .from('platform_modules')
        .update({ include_in_pdf: input.include_in_pdf })
        .eq('id', saved.id);
      if (!pdfErr) saved.include_in_pdf = input.include_in_pdf;
    }
    return { ok: true, module: saved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}

/** Admin: delete a platform module by id (cascades to its pages). */
export async function adminDeletePlatformModule(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = getServerClient();
    const { error } = await sb.from('platform_modules').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}

/** Admin: upsert (create or update) a module page section. */
export async function adminUpsertPlatformModulePage(
  input: PlatformModulePageInput,
): Promise<{ ok: true; page: PlatformModulePage } | { ok: false; error: string }> {
  try {
    const sb = getServerClient();
    const payload = {
      ...(input.id ? { id: input.id } : {}),
      module_id: input.module_id,
      page_section: input.page_section,
      display_order: input.display_order ?? 0,
      content_blocks: input.content_blocks ?? {},
      visible: input.visible ?? true,
    };

    const { data, error } = input.id
      ? await sb.from('platform_module_pages').update(payload).eq('id', input.id).select().single()
      : await sb
          .from('platform_module_pages')
          .upsert(payload, { onConflict: 'module_id,page_section' })
          .select()
          .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, page: data as PlatformModulePage };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}

/** Admin: delete a single page section by id. */
export async function adminDeletePlatformModulePage(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = getServerClient();
    const { error } = await sb.from('platform_module_pages').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}

// ── Page-section content shape helpers (typed extraction from content_blocks)─

export interface HeroContent {
  title: string;
  subtitle: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  heroImageUrl?: string;
}

export interface FeaturesContent {
  heading: string;
  bullets: string[];
}

export interface HowItWorksContent {
  heading: string;
  steps: { number: number; title: string; body: string }[];
}

export interface CtaContent {
  heading: string;
  body: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

export interface TestimonialsContent {
  heading: string;
  items: { quote: string; author: string; role?: string; company?: string }[];
}

/**
 * Extract a typed content block by section. Returns null when the section is
 * absent so callers can choose between fallback rendering and skipping.
 */
export function getSectionContent<T = Record<string, unknown>>(
  pages: PlatformModulePage[],
  section: PlatformModulePageSection,
): T | null {
  const page = pages.find((p) => p.page_section === section);
  return page ? (page.content_blocks as T) : null;
}
