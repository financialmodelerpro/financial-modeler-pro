/**
 * optimize-marketing-images.ts
 *
 * Resizes and re-encodes the oversized images the marketing site serves, and
 * re-points the CMS at the optimized copies.
 *
 * WHY THIS EXISTS. Every marketing image is a Supabase storage object uploaded
 * at full camera / export resolution and served with `cache-control: no-cache`
 * (Supabase's default when an upload passes no `cacheControl`). The home page
 * shipped 9.84 MB of PNGs, including a 2861x2971 favicon, and because the
 * header carries `<link rel="preload" as="image">` for the section images, the
 * browser pays for them before first paint. Nothing about how the page LOOKS
 * depends on those pixels: every one is scaled down by CSS to a known box.
 *
 * WHAT IT DOES NOT DO. It never crops, never changes aspect ratio, and never
 * enlarges (`withoutEnlargement`). A target width is the CSS box at 2x device
 * pixel ratio, so a retina screen still has more pixels than it can show.
 *
 * NON-DESTRUCTIVE. Optimized copies are NEW objects under `optimized/`; the
 * originals are left untouched, so rollback is restoring the old URL (printed
 * as a rollback map on every apply run, and written to a JSON file).
 *
 * IDEMPOTENT. A reference already pointing at an `optimized/` object is
 * skipped, so re-running after a new upload only touches what changed.
 *
 * Run:  npx tsx scripts/optimize-marketing-images.ts           (dry run)
 *       npx tsx scripts/optimize-marketing-images.ts --apply   (writes)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* file optional */ }
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const BUCKET = 'cms-assets';
// One year. Every path these references point at is timestamped and therefore
// content-unique, so a long immutable cache can never serve a stale image:
// replacing an image writes a NEW object and a new URL.
const CACHE_CONTROL = '31536000';

/**
 * A reference is one place in the database that holds an image URL, plus the
 * largest box the site ever renders it in. `maxWidth` is the CSS width at 2x
 * DPR; the source of each number is recorded so it can be re-derived when the
 * layout changes.
 */
type Ref =
  | { kind: 'cms_content'; section: string; key: string }
  | { kind: 'page_section'; id: string; path: string[] };

interface Target {
  label: string;
  ref: Ref;
  maxWidth: number;
  format: 'webp' | 'png';
  rendered: string;
}

const TARGETS: Target[] = [
  {
    label: 'favicon',
    ref: { kind: 'cms_content', section: 'header_settings', key: 'icon_url' },
    // Rendered ONLY as <link rel="icon"> (header_settings.icon_in_header is
    // false). A browser tab icon is 16-32 CSS px; 256 covers every OS surface
    // that reuses a favicon (pinned tiles, bookmarks) with room to spare.
    maxWidth: 256,
    // PNG, not WebP: a favicon is fetched by surfaces beyond the page renderer
    // (OS shortcuts, feed readers), and PNG is the format every one of them
    // accepts. The saving is already ~99% at this size.
    format: 'png',
    rendered: 'link rel=icon only, 2861x2971 stored',
  },
  {
    label: 'navbar logo',
    ref: { kind: 'cms_content', section: 'header_settings', key: 'logo_url' },
    // header_settings.logo_height_px = 80, width auto. Source is 2011x787, so
    // 80px tall renders ~204px wide; 512 is well past 2x.
    maxWidth: 512,
    format: 'webp',
    rendered: 'height 80px, width auto (~204px)',
  },
  {
    label: 'founder photo',
    ref: { kind: 'page_section', id: '71c0aef0-5bc6-42f3-9565-e338ce8e923d', path: ['photo_url'] },
    // maxWidth 400 on the portal home, 360 on /about/ahmad-din.
    maxWidth: 800,
    format: 'webp',
    rendered: 'max-width 400px (home) / 360px (about)',
  },
  {
    label: 'vision image',
    ref: { kind: 'page_section', id: '2c593d4a-4c80-427e-9d7f-50f5d283deba', path: ['imageSrc'] },
    // imageWidth 50% of a 1200px section, height 220px, object-fit cover.
    maxWidth: 1200,
    format: 'webp',
    rendered: '600x220 box, object-fit cover',
  },
  {
    label: 'mission image',
    ref: { kind: 'page_section', id: 'c6eb62f8-7ca4-45c7-b104-99f9e25bcdd6', path: ['imageSrc'] },
    maxWidth: 1200,
    format: 'webp',
    rendered: '600x220 box, object-fit cover',
  },
  {
    label: 'PaceMakers logo',
    ref: { kind: 'page_section', id: '030acdfe-d3c2-480e-9ff8-63d4ffd52bf7', path: ['logo_url'] },
    // content.logo_width = 240px. Source is 7209x2239, a 30x oversample.
    maxWidth: 480,
    format: 'webp',
    rendered: 'width 240px',
  },
];

const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

function storagePathFromUrl(url: string): string | null {
  const m = new RegExp(`/storage/v1/object/public/${BUCKET}/(.+)$`).exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

async function readRef(ref: Ref): Promise<string | null> {
  if (ref.kind === 'cms_content') {
    const { data } = await sb
      .from('cms_content')
      .select('value')
      .eq('section', ref.section)
      .eq('key', ref.key)
      .maybeSingle();
    return (data as { value?: string } | null)?.value ?? null;
  }
  const { data } = await sb.from('page_sections').select('content').eq('id', ref.id).maybeSingle();
  let node: unknown = (data as { content?: unknown } | null)?.content;
  for (const k of ref.path) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[k];
  }
  return typeof node === 'string' ? node : null;
}

async function writeRef(ref: Ref, url: string): Promise<string | null> {
  if (ref.kind === 'cms_content') {
    const { error } = await sb
      .from('cms_content')
      .update({ value: url, updated_at: new Date().toISOString() })
      .eq('section', ref.section)
      .eq('key', ref.key);
    return error?.message ?? null;
  }
  const { data, error: readErr } = await sb.from('page_sections').select('content').eq('id', ref.id).maybeSingle();
  if (readErr) return readErr.message;
  // Read-modify-write on ONE jsonb key: clone, walk to the parent, set the leaf.
  const content = JSON.parse(JSON.stringify((data as { content: unknown }).content)) as Record<string, unknown>;
  let node: Record<string, unknown> = content;
  for (const k of ref.path.slice(0, -1)) node = node[k] as Record<string, unknown>;
  node[ref.path[ref.path.length - 1]] = url;
  const { error } = await sb
    .from('page_sections')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', ref.id);
  return error?.message ?? null;
}

function describeRef(ref: Ref): string {
  return ref.kind === 'cms_content'
    ? `cms_content ${ref.section}/${ref.key}`
    : `page_sections ${ref.id.slice(0, 8)} .${ref.path.join('.')}`;
}

async function main() {
  console.log(APPLY ? 'MODE: APPLY (writes storage + database)\n' : 'MODE: DRY RUN (no writes; pass --apply)\n');

  const rollback: Array<{ ref: string; from: string; to: string }> = [];
  let beforeTotal = 0;
  let afterTotal = 0;

  for (const t of TARGETS) {
    const current = await readRef(t.ref);
    if (!current) { console.log(`SKIP  ${t.label}: reference not found (${describeRef(t.ref)})`); continue; }

    const path = storagePathFromUrl(current);
    if (!path) { console.log(`SKIP  ${t.label}: URL is not a ${BUCKET} object -> ${current}`); continue; }
    if (path.startsWith('optimized/')) { console.log(`SKIP  ${t.label}: already optimized (${path})`); continue; }

    const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(path);
    if (dlErr || !blob) { console.log(`FAIL  ${t.label}: download failed (${dlErr?.message})`); continue; }
    const input = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(input).metadata();

    // Downscale only, aspect ratio untouched.
    const pipeline = sharp(input).resize({ width: t.maxWidth, withoutEnlargement: true, fit: 'inside' });
    const output = t.format === 'png'
      ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
      : await pipeline.webp({ quality: 86, effort: 6 }).toBuffer();
    const outMeta = await sharp(output).metadata();

    beforeTotal += input.length;
    afterTotal += output.length;

    const base = (path.split('/').pop() ?? 'image').replace(/\.[^.]+$/, '');
    const outPath = `optimized/${base}-${outMeta.width}.${t.format}`;
    const publicUrl = sb.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl;

    console.log(
      `${APPLY ? 'WRITE' : 'PLAN '} ${t.label}\n` +
      `        rendered at: ${t.rendered}\n` +
      `        ${String(meta.width)}x${String(meta.height)} ${meta.format} ${kb(input.length)}` +
      `  ->  ${String(outMeta.width)}x${String(outMeta.height)} ${t.format} ${kb(output.length)}` +
      `  (${(100 - (output.length / input.length) * 100).toFixed(1)}% smaller)\n` +
      `        ${describeRef(t.ref)}\n` +
      `        ${outPath}`,
    );

    if (!APPLY) { console.log(''); continue; }

    const { error: upErr } = await sb.storage.from(BUCKET).upload(outPath, output, {
      contentType: t.format === 'png' ? 'image/png' : 'image/webp',
      cacheControl: CACHE_CONTROL,
      upsert: true,
    });
    if (upErr) { console.log(`        UPLOAD FAILED: ${upErr.message}\n`); continue; }

    const wErr = await writeRef(t.ref, publicUrl);
    if (wErr) { console.log(`        DB UPDATE FAILED: ${wErr}\n`); continue; }

    rollback.push({ ref: describeRef(t.ref), from: current, to: publicUrl });
    console.log('        ok\n');
  }

  console.log(`TOTAL ${kb(beforeTotal)} -> ${kb(afterTotal)}  (${(100 - (afterTotal / Math.max(1, beforeTotal)) * 100).toFixed(1)}% smaller)`);

  if (APPLY && rollback.length) {
    const file = 'scripts/.optimize-marketing-images.rollback.json';
    writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`\nROLLBACK MAP (originals untouched in storage) written to ${file}:`);
    for (const r of rollback) console.log(`  ${r.ref}\n    was: ${r.from}\n    now: ${r.to}`);
  }
}

void main();
