/**
 * verify-article-series.ts
 *
 * Proves the article series / reading-sequence feature (migration 200): the pure
 * navigation logic (series ordering, prev/next inside a series, prev/next by date
 * inside a category, more-in-category), plus the wiring that surfaces it (migration,
 * data layer, admin API + manager, editor fields, public page).
 *
 * Pure + source-assertion tests; no DB and no network.
 *
 * Run: npx tsx scripts/verify-article-series.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  orderSeriesParts,
  buildSeriesNav,
  buildCategoryNav,
  moreInCategory,
  type NavArticle,
} from '../src/shared/cms/articleNav';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const A = (id: string, order: number | null, date: string | null, title = id): NavArticle =>
  ({ id, title, slug: id, published_at: date, series_order: order });

console.log('=== 1. orderSeriesParts ===');
{
  // series_order wins over date; ties broken by date (older first), then title.
  const parts = [
    A('c', 2, '2026-01-03'),
    A('a', 0, '2026-01-10'),
    A('b', 1, '2026-01-02'),
  ];
  const ordered = orderSeriesParts(parts).map(p => p.id);
  check('orders by series_order asc regardless of date', ordered.join(',') === 'a,b,c', ordered.join(','));

  const tie = [
    A('y', 0, '2026-02-05'),
    A('x', 0, '2026-02-01'),
  ];
  check('ties on order fall back to older date first', orderSeriesParts(tie).map(p => p.id).join(',') === 'x,y');

  const tie2 = [ A('z', 0, null, 'Zebra'), A('m', 0, null, 'Mango') ];
  check('ties with no dates fall back to title asc', orderSeriesParts(tie2).map(p => p.id).join(',') === 'm,z');

  check('orderSeriesParts does not mutate its input', (() => { const src = [A('a', 1, null), A('b', 0, null)]; orderSeriesParts(src); return src[0].id === 'a'; })());
}

console.log('\n=== 2. buildSeriesNav ===');
{
  const parts = [A('p1', 0, '2026-01-01'), A('p2', 1, '2026-01-02'), A('p3', 2, '2026-01-03')];
  const mid = buildSeriesNav(parts, 'p2');
  check('reports total parts', mid?.total === 3);
  check('reports 0-based current index', mid?.currentIndex === 1);
  check('prev is the earlier part', mid?.prev?.id === 'p1');
  check('next is the later part', mid?.next?.id === 'p3');
  check('parts are in reading order', mid?.parts.map(p => p.id).join(',') === 'p1,p2,p3');

  const first = buildSeriesNav(parts, 'p1');
  check('first part has no prev', first?.prev === null);
  check('first part still has a next', first?.next?.id === 'p2');

  const last = buildSeriesNav(parts, 'p3');
  check('last part has a prev', last?.prev?.id === 'p2');
  check('last part has no next', last?.next === null);

  check('a lone part is not a series (null)', buildSeriesNav([A('only', 0, '2026-01-01')], 'only') === null);
  check('current absent from the set -> null', buildSeriesNav(parts, 'ghost') === null);
  // Membership is by series_order, not array position: an unsorted set still resolves.
  const shuffled = [A('p3', 2, '2026-01-03'), A('p1', 0, '2026-01-01'), A('p2', 1, '2026-01-02')];
  check('nav is computed from order, not array position', buildSeriesNav(shuffled, 'p1')?.next?.id === 'p2');
}

console.log('\n=== 3. buildCategoryNav (by date: prev = older, next = newer) ===');
{
  const cat = [
    A('old',  null, '2026-01-01'),
    A('mid',  null, '2026-03-01'),
    A('new',  null, '2026-06-01'),
  ];
  const nav = buildCategoryNav(cat, 'mid');
  check('prev is the OLDER neighbour', nav.prev?.id === 'old');
  check('next is the NEWER neighbour', nav.next?.id === 'new');

  check('the oldest has no prev', buildCategoryNav(cat, 'old').prev === null);
  check('the oldest has a next', buildCategoryNav(cat, 'old').next?.id === 'mid');
  check('the newest has no next', buildCategoryNav(cat, 'new').next === null);
  check('a single-article category has neither', (() => { const n = buildCategoryNav([A('solo', null, '2026-01-01')], 'solo'); return n.prev === null && n.next === null; })());
  check('current absent -> both null', (() => { const n = buildCategoryNav(cat, 'ghost'); return n.prev === null && n.next === null; })());
}

console.log('\n=== 4. moreInCategory ===');
{
  const cat = [
    A('a', null, '2026-01-01'),
    A('b', null, '2026-05-01'),
    A('c', null, '2026-03-01'),
    A('self', null, '2026-06-01'),
  ];
  const more = moreInCategory(cat, 'self', 6).map(a => a.id);
  check('excludes the current article', !more.includes('self'));
  check('is newest-first', more.join(',') === 'b,c,a', more.join(','));
  check('respects the limit', moreInCategory(cat, 'self', 2).length === 2);
  check('does not mutate input', (() => { const src = [A('x', null, '2026-01-01'), A('y', null, '2026-02-01')]; moreInCategory(src, 'x'); return src[0].id === 'x'; })());
}

console.log('\n=== 5. Migration 200 ===');
{
  const mig = read('supabase/migrations/200_article_series.sql');
  check('creates article_series idempotently', /CREATE TABLE IF NOT EXISTS article_series/.test(mig));
  check('adds series_id FK idempotently', /ALTER TABLE articles ADD COLUMN IF NOT EXISTS series_id\s+uuid REFERENCES article_series\(id\)/.test(mig));
  check('series_id resets on series delete (SET NULL, not cascade delete)', /ON DELETE SET NULL/.test(mig));
  check('adds series_order idempotently', /ALTER TABLE articles ADD COLUMN IF NOT EXISTS series_order integer/.test(mig));
  check('indexes (series_id, series_order)', /CREATE INDEX IF NOT EXISTS idx_articles_series ON articles\(series_id, series_order\)/.test(mig));
  check('public can read the series (nav is public)', /Public read article_series[\s\S]{0,120}FOR SELECT USING \(true\)/.test(mig));
  check('migration is additive only (no DROP/DELETE/TRUNCATE)', !/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i.test(mig));
}

console.log('\n=== 6. Data layer (cms/index.ts) ===');
{
  const cms = read('src/shared/cms/index.ts');
  check('Article type carries series_id + series_order', /series_id\?: string \| null; series_order\?: number \| null/.test(cms));
  check('exposes getArticleReadingContext', /export async function getArticleReadingContext/.test(cms));
  check('reading context uses the pure series nav', /buildSeriesNav\(parts as unknown as NavArticle\[\], article\.id\)/.test(cms));
  check('reading context uses the pure category nav', /buildCategoryNav\(rows as unknown as NavArticle\[\], article\.id\)/.test(cms));
  check('series block is guarded (schema-tolerant try/catch)', /article\.series_id\) \{[\s\S]{0,200}try \{[\s\S]{0,900}catch/.test(cms));
  check('category nav keys on the dual-written text column', /\.eq\('category', primaryCategory\)\.eq\('status', 'published'\)/.test(cms));
  check('only PUBLISHED parts feed the series', /eq\('series_id', article\.series_id\)\.eq\('status', 'published'\)/.test(cms));
  check('never throws (returns EMPTY_READING_CONTEXT on failure)', /catch \{\s*return EMPTY_READING_CONTEXT;/.test(cms));
}

console.log('\n=== 7. Articles API: series persistence ===');
{
  const api = read('app/api/admin/articles/route.ts');
  check('series columns are schema-tolerant (ADDITIVE_KEYS)', /ADDITIVE_KEYS = \[[^\]]*'series_id', 'series_order'/.test(api));
  check('has an append-position helper', /async function nextSeriesOrder/.test(api));
  check('POST appends to the series on assign', /insert\.series_order = series_id \? await nextSeriesOrder\(sb, series_id\) : 0/.test(api));
  check('PATCH recomputes order ONLY when the series changes', /if \(newSeries !== curSeries\) \{[\s\S]{0,160}update\.series_order = newSeries \? await nextSeriesOrder/.test(api));
  check('PATCH leaves order alone when the series is unchanged', /else \{\s*delete update\.series_id;\s*delete update\.series_order;/.test(api));
}

console.log('\n=== 8. Series API (CRUD + reorder) ===');
{
  const api = read('app/api/admin/series/route.ts');
  check('admin-gated', /if \(!await checkAdmin\(\)\) return NextResponse\.json\(\{ error: 'Unauthorized' \}/.test(api));
  check('GET returns each series with its ordered articles', /order\('series_order', \{ ascending: true \}\)/.test(api));
  check('POST creates (idempotent on title)', /ilike\('title', clean\)\.maybeSingle\(\)/.test(api));
  check('PUT reorders by array index', /series_order: i \}\)\.eq\('id', id\)\.eq\('series_id', seriesId\)/.test(api));
  check('reorder is scoped to the series (cannot move a foreign article)', /\.eq\('series_id', seriesId\)/.test(api));
  check('DELETE removes the series only (articles un-group via FK)', /from\('article_series'\)\.delete\(\)\.eq\('id', id\)/.test(api));
}

console.log('\n=== 9. Admin series manager page ===');
{
  const page = read('app/admin/articles/series/page.tsx');
  check('rows are draggable', /draggable/.test(page));
  check('drag start records origin', /onDragStart=\{\(\) => \{ dragRef\.current = \{ seriesId: s\.id, from: i \}; \}\}/.test(page));
  check('drop reorders and persists', /onDrop=\{\(\) => onDrop\(s\.id, i\)\}/.test(page));
  check('reorder PUTs the new order', /method: 'PUT'[\s\S]{0,120}orderedIds: articles\.map\(a => a\.id\)/.test(page));
  check('delete warns articles are un-grouped, not deleted', /un-grouped \(not deleted\)/.test(page));
}

console.log('\n=== 10. Editor wiring (new + edit) ===');
{
  const field = read('src/components/admin/ArticleSeriesField.tsx');
  check('series field offers a None (standalone) option', /None \(standalone article\)/.test(field));
  check('series field can create inline', /fetch\('\/api\/admin\/series', \{ method: 'POST'/.test(field));
  check('series field points at drag-reorder for ordering', /Reading order is set by drag/.test(field));
  for (const [label, path] of [['new', 'app/admin/articles/new/page.tsx'], ['edit', 'app/admin/articles/[id]/page.tsx']] as const) {
    const src = read(path);
    check(`${label} page renders ArticleSeriesField`, /<ArticleSeriesField value=\{seriesId\} onChange=\{setSeriesId\}/.test(src));
    check(`${label} page sends series_id on save`, /series_id: seriesId \|\| null/.test(src));
    check(`${label} page threads seriesId through save deps`, /categoryIds, seriesId,/.test(src));
  }
  check('edit page loads the stored series', /setSeriesId\(a\.series_id \?\? ''\)/.test(read('app/admin/articles/[id]/page.tsx')));
  check('list page links to Manage Series', /href="\/admin\/articles\/series"/.test(read('app/admin/articles/page.tsx')));
}

console.log('\n=== 11. Public article page ===');
{
  const page = read('app/articles/[slug]/page.tsx');
  check('fetches the reading context', /getArticleReadingContext\(article\)/.test(page));
  check('prev/next follow the series when present, else the category', /const navPrev\s+= inSeries \? reading\.series!\.prev : reading\.categoryNav\.prev/.test(page));
  check('renders the series ribbon inside the card', /reading\.series && <ArticleSeriesBanner series=\{reading\.series\}/.test(page));
  check('renders prev/next nav', /<ArticlePrevNext[\s\S]{0,160}prev=\{navPrev\}/.test(page));
  check('labels nav "part" inside a series', /inSeries \? 'Previous part' : 'Previous'/.test(page));
  check('renders more-in-category', /<MoreInCategory category=\{reading\.primaryCategory\} articles=\{reading\.moreInCategory\}/.test(page));

  const comp = read('src/hubs/main/components/landing/ArticleReading.tsx');
  check('series is guidance not a gate (parts are plain links)', /Start with[\s\S]{0,300}Part 1/.test(comp));
  check('the current part is marked "You are here"', /You are here/.test(comp));
  check('components are server-side (no client directive)', !/^'use client'/.test(comp.trim()));
}

console.log('\n=== 12. Sidebar: series accordion + categories ===');
{
  const cms = read('src/shared/cms/index.ts');
  check('exposes getArticleBrowseData', /export async function getArticleBrowseData/.test(cms));
  check('browse data omits lone parts (series need >= 2 published parts)', /\.parts\.length >= 2/.test(cms));
  check('browse series are ordered by the pure orderSeriesParts', /orderSeriesParts\(group as unknown as NavArticle\[\]\)/.test(cms));
  check('browse never throws (returns empty on failure)', /catch \{\s*return \{ categories: \[\], series: \[\] \};/.test(cms));

  const bar = read('src/hubs/main/components/landing/ArticleSidebar.tsx');
  check('sidebar is a client component', /^'use client'/.test(bar.trim()));
  check('current series is EXPANDED by default', /useState<Set<string>>\(\(\) => new Set\(currentSeriesId \? \[currentSeriesId\] : \[\]\)\)/.test(bar));
  check('other series toggle open on click', /const toggle = \(id: string\)/.test(bar) && /onClick=\{\(\) => toggle\(s\.id\)\}/.test(bar));
  check('the current part is marked "You are here"', /You are here/.test(bar));
  check('every part is a link to its article', /href=\{`\/articles\/\$\{p\.slug\}`\}/.test(bar));
  check('categories link to the filtered listing', /href=\{`\/articles\?category=\$\{encodeURIComponent\(c\.name\)\}`\}/.test(bar));

  const page = read('app/articles/[slug]/page.tsx');
  check('article page uses the two-column shell', /className="article-shell"/.test(page) && /className="article-aside"/.test(page));
  check('page renders the sidebar with the current series + article', /<ArticleSidebar[\s\S]{0,160}currentSeriesId=\{article\.series_id \?\? null\}[\s\S]{0,60}currentArticleId=\{article\.id\}/.test(page));
  check('page fetches the browse data alongside the reading context', /Promise\.all\(\[getArticleReadingContext\(article\), getArticleBrowseData\(\)\]\)/.test(page));
  check('the bottom series-contents block is gone (moved to the sidebar)', !/<ArticleSeriesContents/.test(page));

  const css = read('app/globals.css');
  check('the detail sidebar sits in the LEFT column with the article at its natural width', /\.article-shell \{ display: grid; grid-template-columns: 300px minmax\(0, 1025px\)/.test(css) && /\.article-aside \{ grid-column: 1/.test(css));
  check('the detail shell collapses to one column on mobile', /@media \(max-width: 980px\)[\s\S]{0,200}\.article-shell \{ grid-template-columns: 1fr; \}/.test(css));
  check('the listing has a collapsible browse sidebar shell', /\.articles-shell \{ display: flex;[\s\S]{0,200}\.articles-side/.test(css));

  const listPage = read('app/articles/page.tsx');
  check('the listing renders the collapsible browse sidebar', /<ArticleSidebar[\s\S]{0,160}collapsible heading="Browse articles"/.test(listPage));
  check('the listing fetches the browse data', /getArticleBrowseData\(\)/.test(listPage));
  const sidebar = read('src/hubs/main/components/landing/ArticleSidebar.tsx');
  check('the sidebar can collapse to reclaim grid width', /collapsible && !shown/.test(sidebar) && /setShown\(true\)/.test(sidebar));

  const listing = read('app/articles/page.tsx');
  check('the listing reads ?category= and pre-filters', /const selectedCategory = typeof sp\?\.category === 'string'/.test(listing) && /initialCategory=\{selectedCategory\}/.test(listing));
  const client = read('app/articles/ArticlesClient.tsx');
  check('the grid initialises its filter from the URL category', /initialCategory && categories\.includes\(initialCategory\) \? initialCategory : 'All'/.test(client));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
