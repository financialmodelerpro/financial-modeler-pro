/**
 * optimize-uploaded-images.ts: re-compresses images uploaded before every
 * upload was compressed (2026-11-10): the founder photos (home page founder
 * section, instructor record) and every live session and live course image.
 *
 * NON-DESTRUCTIVE. The original object is never touched. The compressed copy
 * is a NEW object at `optimized/<original path>.webp` in the same bucket, made
 * by the same helper the upload routes use (src/shared/storage/optimizeImage),
 * and only the reference is re-pointed. Every change is written to a rollback
 * map (old URL -> new URL) in scripts/.optimize-uploaded-images.rollback.json.
 * Idempotent: a reference already on an `optimized/` object, or an image that
 * is already small, is skipped.
 *
 * Run:  npx tsx --env-file=.env.local scripts/optimize-uploaded-images.ts           (dry run)
 *       npx tsx --env-file=.env.local scripts/optimize-uploaded-images.ts --apply   (writes)
 */
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { getServerClient } from '../src/core/db/supabase';
import { optimizeImage, withExt, IMAGE_WIDTH, TARGET_MAX_BYTES } from '../src/shared/storage/optimizeImage';

const KNOWN = ['--apply'];
const unknown = process.argv.slice(2).filter((a) => !KNOWN.includes(a));
if (unknown.length) { console.error(`Unknown flag(s): ${unknown.join(' ')}. Known: --apply. Nothing was written.`); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const ROLLBACK = 'scripts/.optimize-uploaded-images.rollback.json';

const sb = getServerClient();
const PUBLIC = '/storage/v1/object/public/';

/** bucket + path from one of our public storage URLs, else null. */
function parse(url: string | null | undefined): { bucket: string; path: string } | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC);
  if (i < 0 || !url.startsWith(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) return null;
  const rest = decodeURIComponent(url.slice(i + PUBLIC.length).split('?')[0]);
  const slash = rest.indexOf('/');
  return slash > 0 ? { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) } : null;
}

const done = new Map<string, string | null>(); // old URL -> new URL (null = left as is)
const rollback: Record<string, string> = existsSync(ROLLBACK) ? JSON.parse(readFileSync(ROLLBACK, 'utf8')) : {};
let savedBytes = 0;

/** The compressed URL for an image URL, or null when it is left as it is. */
async function compressed(url: string, maxWidth: number): Promise<string | null> {
  if (done.has(url)) return done.get(url)!;
  const loc = parse(url);
  if (!loc || loc.path.startsWith('optimized/') || loc.path.startsWith('originals/')) { done.set(url, null); return null; }
  const res = await fetch(url);
  if (!res.ok) { console.log(`  skip     ${url} (download ${res.status})`); done.set(url, null); return null; }
  const type = res.headers.get('content-type') ?? 'image/png';
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length <= TARGET_MAX_BYTES) { console.log(`  small    ${loc.path} (${Math.round(bytes.length / 1024)} KB)`); done.set(url, null); return null; }
  const img = await optimizeImage(bytes, type, { maxWidth });
  if (!img.optimized) { console.log(`  kept     ${loc.path} (${type}, not compressible)`); done.set(url, null); return null; }
  const newPath = withExt(`optimized/${loc.path}`, img.ext);
  console.log(`  compress ${loc.bucket}/${loc.path}: ${Math.round(bytes.length / 1024)} KB -> ${Math.round(img.buffer.length / 1024)} KB (${img.width}px)`);
  savedBytes += bytes.length - img.buffer.length;
  const newUrl = sb.storage.from(loc.bucket).getPublicUrl(newPath).data.publicUrl;
  if (APPLY) {
    const { error } = await sb.storage.from(loc.bucket).upload(newPath, img.buffer, { contentType: img.contentType, upsert: true, cacheControl: '31536000' });
    if (error) throw new Error(`upload ${newPath}: ${error.message}`);
    rollback[newUrl] = url;
  }
  done.set(url, newUrl);
  return newUrl;
}

(async () => {
  let refs = 0;
  // 1. Session images (single and course sessions).
  const { data: sessions } = await sb.from('live_sessions').select('id, title, banner_url').not('banner_url', 'is', null);
  for (const s of sessions ?? []) {
    const nu = await compressed(s.banner_url as string, IMAGE_WIDTH.session);
    if (!nu) continue;
    refs++;
    if (APPLY) { const { error } = await sb.from('live_sessions').update({ banner_url: nu }).eq('id', s.id); if (error) throw new Error(error.message); }
  }
  // 2. Live course banner and card images.
  const { data: courses } = await sb.from('training_course_settings').select('course_code, banner_url, card_image_url');
  for (const c of courses ?? []) {
    const upd: Record<string, string> = {};
    const b = c.banner_url ? await compressed(c.banner_url as string, IMAGE_WIDTH.banner) : null;
    const k = c.card_image_url ? await compressed(c.card_image_url as string, IMAGE_WIDTH.card) : null;
    if (b) upd.banner_url = b;
    if (k) upd.card_image_url = k;
    if (!Object.keys(upd).length) continue;
    refs += Object.keys(upd).length;
    if (APPLY) { const { error } = await sb.from('training_course_settings').update(upd).eq('course_code', c.course_code); if (error) throw new Error(error.message); }
  }
  // 3. Instructor photos (the founder's included).
  const { data: insts } = await sb.from('instructors').select('id, name, photo_url').not('photo_url', 'is', null);
  for (const i of insts ?? []) {
    const nu = await compressed(i.photo_url as string, IMAGE_WIDTH.media);
    if (!nu) continue;
    refs++;
    if (APPLY) { const { error } = await sb.from('instructors').update({ photo_url: nu }).eq('id', i.id); if (error) throw new Error(error.message); }
  }
  // 4. The home page founder section (page_sections 'team'): every storage image URL in its content.
  const { data: secs } = await sb.from('page_sections').select('id, page_slug, section_type, content').eq('section_type', 'team');
  for (const sec of secs ?? []) {
    let text = JSON.stringify(sec.content ?? {});
    const urls = [...new Set(text.match(/https:\/\/[^"\s]+\.(?:png|jpe?g|webp)/gi) ?? [])];
    let changed = false;
    for (const u of urls) {
      const nu = await compressed(u, IMAGE_WIDTH.media);
      if (nu) { text = text.split(u).join(nu); changed = true; refs++; }
    }
    if (changed && APPLY) { const { error } = await sb.from('page_sections').update({ content: JSON.parse(text) }).eq('id', sec.id); if (error) throw new Error(error.message); }
  }
  if (APPLY) writeFileSync(ROLLBACK, JSON.stringify(rollback, null, 2));
  console.log(`\n${APPLY ? '' : '[dry run] '}${refs} reference(s) ${APPLY ? 're-pointed' : 'would be re-pointed'}, ${Math.round(savedBytes / 1024)} KB saved per full set of downloads. Originals untouched.${APPLY ? ` Rollback map: ${ROLLBACK}` : ''}`);
})().catch((e) => { console.error(e); process.exit(1); });
