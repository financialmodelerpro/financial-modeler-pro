/**
 * verify-marketing-images.ts
 *
 * Checks the images the LIVE marketing site actually serves, on three axes:
 *
 *   1. WEIGHT     no single image over the budget, page total under it too.
 *   2. CACHING    every image carries a real max-age, not Supabase's default
 *                 `no-cache` (which forces a revalidation round-trip per view).
 *   3. FIDELITY   the optimized image still LOOKS like the original. This is
 *                 the half that matters: a size check alone would pass a
 *                 corrupted or wrongly-cropped image. Each optimized image is
 *                 compared against the ORIGINAL it replaced, both resampled to
 *                 the same box, as a mean per-channel difference. Downscaling
 *                 is not lossless, so the bar is "visually indistinguishable"
 *                 (mean diff under ~3/255 and matching aspect ratio), not
 *                 byte equality.
 *
 * Fidelity is skipped, with a printed notice, for any image whose original is
 * no longer in storage: absence of a baseline is reported, never silently
 * treated as a pass.
 *
 * Also asserts the SOURCE rule that produced this state: every public-image
 * upload path passes a cacheControl, so a new upload cannot land back on
 * no-cache and re-open the hole.
 *
 * Run: npx tsx scripts/verify-marketing-images.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

const ROOT = join(__dirname, '..');
const PAGES = [
  'https://financialmodelerpro.com/',
  'https://financialmodelerpro.com/about',
  'https://financialmodelerpro.com/about/ahmad-din',
  'https://financialmodelerpro.com/pricing',
];
// One oversized image is a regression; the whole point of the pass was that
// nothing on a marketing page needs to be a megabyte.
const MAX_IMAGE_BYTES = 400 * 1024;
const MAX_PAGE_IMAGE_BYTES = 900 * 1024;
const MIN_MAX_AGE = 300;
const MAX_MEAN_DIFF = 3.0; // out of 255, per channel

let pass = 0;
let fail = 0;
let skipped = 0;
function ok(label: string, cond: boolean) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}`);
}
function skip(label: string, why: string) {
  skipped++;
  console.warn(`SKIP ${label}: ${why}`);
}
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

function maxAgeOf(cc: string | null): number {
  if (!cc) return 0;
  if (/no-cache|no-store/i.test(cc)) return 0;
  const m = /max-age=(\d+)/i.exec(cc);
  return m ? Number(m[1]) : 0;
}

/**
 * Mean absolute per-channel difference of two images resampled to one box.
 *
 * Both are FLATTENED onto white first. Without that, the comparison reads the
 * RGB hiding under fully transparent pixels, which PNG and lossy WebP are free
 * to encode differently, and a logo that renders identically scores as wildly
 * different. Flattening compares what a viewer can actually see.
 */
async function meanDiff(a: Buffer, b: Buffer, w: number, h: number): Promise<number> {
  const norm = (buf: Buffer) =>
    sharp(buf)
      .resize(w, h, { fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .raw()
      .toBuffer();
  const [ra, rb] = await Promise.all([norm(a), norm(b)]);
  const n = Math.min(ra.length, rb.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(ra[i] - rb[i]);
  return sum / n;
}

async function main() {
  // ── 1. Source rule: no public-image upload may omit cacheControl ──────────
  const UPLOAD_ROUTES = [
    'app/api/admin/media/route.ts',
    'app/api/admin/site-settings/route.ts',
    'app/api/admin/generate-images/route.tsx',
    'app/api/admin/live-sessions/route.ts',
    'app/api/user/avatar/route.ts',
    'app/api/training/upload-avatar/route.ts',
  ];
  for (const rel of UPLOAD_ROUTES) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) { skip(`${rel} cacheControl`, 'file not found'); continue; }
    const src = readFileSync(p, 'utf8');
    const uploads = src.split('.upload(').slice(1);
    ok(`${rel}: has an upload call`, uploads.length > 0);
    uploads.forEach((chunk, i) => {
      const args = chunk.slice(0, 400);
      ok(`${rel}: upload #${i + 1} passes a cacheControl`, /cacheControl/.test(args));
    });
  }
  // The constants must stay distinct and correctly ordered, since the whole
  // decision rests on "can these bytes change".
  const constSrc = readFileSync(join(ROOT, 'src/shared/storage/cacheControl.ts'), 'utf8');
  const immutable = Number(/STORAGE_CACHE_IMMUTABLE = '(\d+)'/.exec(constSrc)?.[1] ?? 0);
  const replaceable = Number(/STORAGE_CACHE_REPLACEABLE = '(\d+)'/.exec(constSrc)?.[1] ?? 0);
  ok('immutable cache is at least a year', immutable >= 31536000);
  ok('replaceable cache is short but non-zero', replaceable > 0 && replaceable <= 3600);

  // ── 2. Live pages: weight + caching ───────────────────────────────────────
  const seen = new Map<string, string[]>();
  for (const page of PAGES) {
    let html = '';
    try {
      html = await (await fetch(page)).text();
    } catch {
      skip(`page ${page}`, 'fetch failed');
      continue;
    }
    const urls = new Set<string>();
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1]);
    for (const m of html.matchAll(/https?:\/\/[a-z0-9.-]*supabase\.co\/storage\/[^"'\\\s)]+/gi)) urls.add(m[0]);
    ok(`${page}: serves at least one image`, urls.size > 0);

    let pageBytes = 0;
    for (const u of urls) {
      const abs = u.startsWith('http') ? u : new URL(u, page).toString();
      seen.set(abs, [...(seen.get(abs) ?? []), page]);
      try {
        // A ranged GET, not HEAD. Supabase's CDN answers HEAD with a blanket
        // `no-cache` regardless of the object's stored cacheControl, so a HEAD
        // probe reports every object as uncacheable and the check would fail
        // (or, worse, pass for the wrong reason after someone "fixed" it).
        // `bytes=0-0` returns the real headers plus the full size in
        // Content-Range, for one byte of transfer.
        const res = await fetch(abs, { headers: { Range: 'bytes=0-0' } });
        const size = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1]
          ?? res.headers.get('content-length') ?? 0);
        const age = maxAgeOf(res.headers.get('cache-control'));
        pageBytes += size;
        ok(`${abs.split('/').pop()} is under ${kb(MAX_IMAGE_BYTES)} (is ${kb(size)})`, size <= MAX_IMAGE_BYTES);
        ok(`${abs.split('/').pop()} is cacheable (max-age=${age})`, age >= MIN_MAX_AGE);
      } catch {
        skip(`probe ${abs}`, 'request failed');
      }
    }
    ok(`${page}: total image weight ${kb(pageBytes)} is under ${kb(MAX_PAGE_IMAGE_BYTES)}`,
      pageBytes <= MAX_PAGE_IMAGE_BYTES);
  }

  // ── 3. Fidelity against the original each image replaced ──────────────────
  const rollbackFile = join(ROOT, 'scripts/.optimize-marketing-images.rollback.json');
  if (!existsSync(rollbackFile)) {
    skip('fidelity comparison', 'no rollback map on disk (run optimize-marketing-images.ts --apply)');
  } else {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !key) {
      skip('fidelity comparison', 'no Supabase credentials in env');
    } else {
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const map = JSON.parse(readFileSync(rollbackFile, 'utf8')) as Array<{ ref: string; from: string; to: string }>;
      for (const entry of map) {
        const grab = async (u: string) => {
          const path = /\/object\/public\/cms-assets\/(.+)$/.exec(u)?.[1];
          if (!path) return null;
          const { data } = await sb.storage.from('cms-assets').download(decodeURIComponent(path));
          return data ? Buffer.from(await data.arrayBuffer()) : null;
        };
        const [before, after] = await Promise.all([grab(entry.from), grab(entry.to)]);
        if (!before) { skip(`fidelity ${entry.ref}`, 'original no longer in storage'); continue; }
        if (!after) { ok(`fidelity ${entry.ref}: optimized object exists`, false); continue; }

        const mb = await sharp(before).metadata();
        const ma = await sharp(after).metadata();
        const arBefore = (mb.width ?? 1) / (mb.height ?? 1);
        const arAfter = (ma.width ?? 1) / (ma.height ?? 1);
        ok(`${entry.ref}: aspect ratio preserved (${arBefore.toFixed(3)} vs ${arAfter.toFixed(3)})`,
          Math.abs(arBefore - arAfter) < 0.01);
        ok(`${entry.ref}: not upscaled`, (ma.width ?? 0) <= (mb.width ?? 0));

        const box = Math.min(400, ma.width ?? 400);
        const diff = await meanDiff(before, after, box, Math.max(1, Math.round(box / arAfter)));
        ok(`${entry.ref}: visually unchanged (mean diff ${diff.toFixed(2)}/255)`, diff <= MAX_MEAN_DIFF);

        const bSize = before.length;
        const aSize = after.length;
        ok(`${entry.ref}: got smaller (${kb(bSize)} -> ${kb(aSize)})`, aSize < bSize);
      }
    }
  }

  console.log(`\nverify-marketing-images: ${pass} passed, ${fail} failed, ${skipped} skipped`);
  if (fail > 0) process.exit(1);
}

void main();
