/**
 * scripts/generate-handoff.ts
 *
 * Regenerates HANDOFF.md from LIVE, authoritative sources (git, the migrations
 * folder, the email templates, package.json, the verifier scripts, .env.example,
 * the route tree). The old PROJECT_HANDOFF.md was a hand-written snapshot that
 * drifted out of date; this one is DERIVED, so re-running it always reflects the
 * current state of the repo.
 *
 * Run:  npm run handoff
 *
 * DETERMINISTIC: the "as of" marker is the HEAD commit (sha + commit date), NOT a
 * wall-clock time, so regenerating at the same commit produces an identical file
 * (no spurious diffs; safe to run in prebuild). It never throws: any failure is
 * logged and the script still exits 0 so it can never break a build.
 *
 * No em dashes in this file.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function git(cmd: string): string {
  try { return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
function read(path: string): string {
  try { return readFileSync(join(ROOT, path), 'utf8'); } catch { return ''; }
}
function ls(dir: string): string[] {
  try { return readdirSync(join(ROOT, dir)); } catch { return []; }
}
function exists(path: string): boolean {
  return existsSync(join(ROOT, path));
}

/** Recursively count files matching a predicate under a directory. */
function walkCount(dir: string, match: (name: string) => boolean): number {
  let n = 0;
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return 0;
  const stack = [abs];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(cur); } catch { continue; }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
      const p = join(cur, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) stack.push(p);
      else if (match(e)) n++;
    }
  }
  return n;
}

function bullet(label: string, present: boolean, detail = ''): string {
  return `- ${present ? '[x]' : '[ ]'} ${label}${detail ? `: ${detail}` : ''}`;
}

try {
  // ── Git snapshot ───────────────────────────────────────────────────────────
  const branch = git('rev-parse --abbrev-ref HEAD') || '(unknown)';
  const headShort = git('rev-parse --short HEAD') || '(unknown)';
  const headDate = git('log -1 --format=%cs') || '(unknown)';
  // Tab-delimited (%x09) so the shell does not interpret a `|` in the format as a
  // pipe (which silently emptied the table). Escape any `|` in the subject so it
  // does not break the markdown table cell.
  const commits = git('log -15 --pretty=format:%h%x09%cs%x09%s').split('\n').filter(Boolean)
    .map((l) => { const [h, d, ...s] = l.split('\t'); return `| \`${h}\` | ${d} | ${s.join(' ').replace(/\|/g, '\\|')} |`; });

  // ── Stack (package.json) ────────────────────────────────────────────────────
  const pkg = JSON.parse(read('package.json') || '{}') as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const dep = (n: string): string | null => pkg.dependencies?.[n] ?? pkg.devDependencies?.[n] ?? null;
  const stackRows = [
    ['Next.js', dep('next')],
    ['React', dep('react')],
    ['Supabase JS', dep('@supabase/supabase-js')],
    ['NextAuth', dep('next-auth')],
    ['Email (Brevo)', dep('@getbrevo/brevo')],
    ['Anthropic SDK', dep('@anthropic-ai/sdk')],
    ['pdf-lib', dep('pdf-lib')],
  ].filter(([, v]) => v).map(([k, v]) => `| ${k} | \`${v}\` |`);
  const usesResend = !!dep('resend');

  // ── Database / migrations ───────────────────────────────────────────────────
  const migFiles = ls('supabase/migrations').filter((f) => f.endsWith('.sql'));
  const numberedMigs = migFiles
    .filter((f) => /^\d+/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const latestMig = numberedMigs.length ? parseInt(numberedMigs[numberedMigs.length - 1], 10) : 0;
  const recentMigs = numberedMigs.slice(-8);

  // ── Email templates ─────────────────────────────────────────────────────────
  const templates = ls('src/shared/email/templates').filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, '')).sort();
  const subTemplates = templates.filter((t) => /subscription|invoice|plan|trial|grace|renewal|welcome|cancel/i.test(t));

  // ── Payments / subscription surface (presence-detected) ─────────────────────
  const paymentBullets = [
    bullet('Paddle adapter', exists('src/shared/payments/adapters/paddle.ts')),
    bullet('Provider webhook', exists('app/api/payments/webhook/[provider]/route.ts')),
    bullet('Entitlement gate', exists('src/shared/entitlements/gate.ts')),
    bullet('Single plan-write path (setUserPlan)', exists('src/shared/entitlements/setUserPlan.ts')),
    bullet('Subscription lifecycle emails', exists('src/shared/email/subscriptionEmails.ts')),
    bullet('Reminder cron', exists('app/api/cron/subscription-reminders/route.ts')),
    bullet('Discounts auto-linked to Paddle', exists('src/shared/payments/coupons.ts')),
    bullet('Admin revenue', exists('app/api/admin/revenue/route.ts') || exists('app/admin/revenue')),
    bullet('Manual invoices', exists('src/shared/payments/manualInvoice.ts')),
  ];

  // ── Verifiers ───────────────────────────────────────────────────────────────
  const verifiers = ls('scripts').filter((f) => /^verify-.*\.ts$/.test(f)).sort();

  // ── Route counts ────────────────────────────────────────────────────────────
  const apiRoutes = walkCount('app/api', (n) => n === 'route.ts' || n === 'route.tsx');
  const pages = walkCount('app', (n) => n === 'page.tsx');

  // ── Env (names only, from .env.example) ─────────────────────────────────────
  const envVars = Array.from(new Set(
    read('.env.example').split('\n').map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1]).filter(Boolean) as string[],
  )).sort();

  // ── Docs index ──────────────────────────────────────────────────────────────
  const docs = ['CLAUDE.md', 'CLAUDE-DB.md', 'CLAUDE-FEATURES.md', 'CLAUDE-ROUTES.md', 'CLAUDE-TODO.md', 'CLAUDE-REFM.md', 'CLAUDE-MODELING-HUB.md', 'ARCHITECTURE.md', 'PLATFORM_INVENTORY.md']
    .filter((f) => exists(f)).map((f) => `- [${f}](${f})`);

  // ── Assemble ────────────────────────────────────────────────────────────────
  const md = `# Project Handoff

> AUTO-GENERATED by \`npm run handoff\` (scripts/generate-handoff.ts) from live sources: git, the migrations folder, email templates, package.json, the verifier scripts, .env.example, and the route tree. DO NOT hand-edit, re-run to refresh. This replaces the old static PROJECT_HANDOFF.md that drifted out of date.

**Repository state:** branch \`${branch}\`, commit \`${headShort}\` (${headDate}).
**Deployed revision:** compare the above to \`GET /api/health\` on the live site (its \`commit\` field is \`VERCEL_GIT_COMMIT_SHA\`), so you can tell whether production matches this tree.

## Stack

| Component | Version |
|-----------|---------|
${stackRows.join('\n')}

Email provider is **Brevo**${usesResend ? ' (WARNING: a `resend` dependency is still present in package.json)' : ' (no `resend` dependency present)'}.

## Payments / subscriptions

${paymentBullets.join('\n')}

## Database

Latest migration on disk: **${latestMig}** (${migFiles.length} .sql files total). Most recent:

${recentMigs.map((f) => `- \`${f}\``).join('\n')}

## Email templates (${templates.length})

Subscription / billing: ${subTemplates.map((t) => `\`${t}\``).join(', ') || '(none)'}.
All: ${templates.map((t) => `\`${t}\``).join(', ')}.

## Verifiers (${verifiers.length})

Run any with \`npx tsx scripts/<name>\`. Present scripts:

${verifiers.map((v) => `- \`${v}\``).join('\n')}

## Routes

- API route handlers: **${apiRoutes}**
- Pages: **${pages}**

## Environment variables (from .env.example)

${envVars.map((v) => `- \`${v}\``).join('\n')}

## Documentation

${docs.join('\n')}

## Recent commits

| Commit | Date | Subject |
|--------|------|---------|
${commits.join('\n')}

## How to verify locally

\`\`\`bash
npm run type-check     # tsc --noEmit (zero errors expected)
npm run build          # next build --webpack
npx tsx scripts/verify-<name>.ts   # a specific verifier
npm run handoff        # regenerate THIS file from the live repo state
\`\`\`
`;

  writeFileSync(join(ROOT, 'HANDOFF.md'), md);
  console.log(`HANDOFF.md written (commit ${headShort}, ${headDate}). Latest migration ${latestMig}, ${templates.length} templates, ${verifiers.length} verifiers, ${apiRoutes} API routes.`);
  process.exit(0);
} catch (e) {
  console.error('[handoff] generation failed (non-fatal):', e instanceof Error ? e.message : String(e));
  process.exit(0);
}
