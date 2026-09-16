/**
 * verify-project-duplicate.ts (2026-09-16)
 *
 * A PROJECT CAN BE COPIED AND VARIED, AND A COPY COSTS A SLOT.
 *
 * The duplicate route has existed since M1.6/3 and NOTHING called it: the API
 * shipped and was unreachable from the UI, so a user who wanted to try a variant
 * rebuilt the project by hand. Wiring it onto the project card also made a gap
 * matter that did not before: the route never checked the project CAP, which the
 * create route has always done, so the card would otherwise have been the way
 * past a plan's project limit.
 *
 *  A  the route gates: ownership, read-only grace, and the cap
 *  B  what a copy IS: the current snapshot as version 1, the card metadata, the
 *     duplicator as author, and a rollback if the version write fails
 *  C  the UI reaches it, and withholds it in read-only grace
 *  D  live, READ ONLY: what a copy of each real project would carry. This never
 *     creates a project (a guard check for a create must not send the payload);
 *     it reads the snapshot a copy would be made from and measures it.
 *
 * WHAT A COPY DOES NOT CARRY, by design or by gap: version history (one row,
 * version_number 1, deliberate), and anything kept OUTSIDE the snapshot, which
 * is the durable fund terms row, report decks and their versions, report inputs,
 * members, comments, the change log and delete requests. D3 measures the fund
 * terms case on live data, because that is the one that silently changes a
 * model rather than just losing history.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-project-duplicate.ts
 * No em dashes in this file.
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ''}`); }
};
const src = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

async function main(): Promise<void> {
  const ROUTE = src('app/api/refm/projects/[id]/duplicate/route.ts');
  const CLIENT = src('src/hubs/modeling/platforms/refm/lib/persistence/client.ts');
  const DASH = src('src/hubs/modeling/platforms/refm/components/Dashboard.tsx');
  const SHELL = src('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');

  console.log('A. The route gates');
  check('A1 ownership, through the write resolver that names the permission',
    /getProjectForWrite\(userId, sourceId, 'canCreateProject'\)/.test(ROUTE), 'not gated on a named permission');
  check('A2 read-only grace and lapse cannot duplicate', /writeBlockReason\(gate\)/.test(ROUTE), 'no lapse gate');
  check('A3 THE CAP: a duplicate is a create, so it costs a slot',
    /canAddActiveProject\(gate\.activeProjectCount, gate\.projectLimit\)/.test(ROUTE), 'the cap is not checked');
  check('A4 and it refuses with the same machine code the client already maps',
    /code: 'CAP_REACHED'/.test(ROUTE), 'no CAP_REACHED code');
  // THE CALL SITES, NOT THE FIRST MENTION: both names appear in the import block
  // first, and the entitlements import sits below the server one, so comparing
  // first occurrences reports the order of the imports rather than the order of
  // the work.
  check('A5 the cap is checked BEFORE the project is read or written',
    ROUTE.indexOf('canAddActiveProject(gate.') < ROUTE.indexOf('getProjectForWrite(userId'), 'checked too late');

  console.log('\nB. What a copy is');
  check('B1 the copy is the source current snapshot, preferring the pointer and falling back to the latest',
    /current_version_id/.test(ROUTE) && /getLatestVersion\(source\.id\)/.test(ROUTE));
  check('B2 it refuses rather than seeding a default when there is no snapshot to copy',
    /no snapshot to clone/.test(ROUTE));
  check('B3 the snapshot lands as version 1, so the history does not come with it',
    /version_number: 1/.test(ROUTE));
  check('B4 the card metadata comes across', ['location:', 'status:', 'asset_mix:', 'schema_version:'].every((k) => ROUTE.includes(k)));
  check('B5 the name says it is a copy', /name:\s+`Copy of \$\{source\.name\}`/.test(ROUTE));
  check('B6 the DUPLICATOR is the author, not the author of the source version',
    /created_by:\s+userId/.test(ROUTE));
  check('B7 a failed version write rolls the project back rather than leaving a husk',
    /hardDeleteProject\(userId, clone\.id\)/.test(ROUTE));
  check('B8 the client posts to that route', /\/duplicate`/.test(CLIENT) && /duplicateProject/.test(CLIENT));

  console.log('\nC. The UI reaches it');
  check('C1 the card offers Duplicate, gated on the handler being supplied',
    /onDuplicateProject && \(/.test(DASH) && /dashboard-duplicate-\$\{p\.id\}/.test(DASH));
  check('C2 the shell wires it to the client', /pclient\.duplicateProject\(projectId\)/.test(SHELL));
  check('C3 and withholds it in read-only grace, like every other create',
    /onDuplicateProject=\{graceReadOnly \? undefined :/.test(SHELL));
  check('C4 a cap refusal becomes the upgrade prompt, not a raw error',
    /handleDuplicateProject[\s\S]{0,1200}?CAP_REACHED[\s\S]{0,200}?setUpgradePrompt/.test(SHELL));
  check('C5 the new card appears without opening the copy',
    /handleDuplicateProject[\s\S]{0,1600}?setServerProjects\(\(prev\) => \[\.\.\.prev, res\.data!\.project\]\)/.test(SHELL));

  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('D needs credentials (run with --env-file=.env.local)', false); return; }
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const get = async (p: string): Promise<any[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: h });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  console.log('\nD. Live, read only: what a copy of each real project would carry');
  const projects = await get('refm_projects?select=id,name,current_version_id&deleted_at=is.null&order=name');
  let measured = 0; let withModel = 0;
  const losesFund: string[] = [];
  for (const p of projects) {
    const rows = p.current_version_id
      ? await get(`refm_project_versions?id=eq.${p.current_version_id}&select=snapshot`)
      : await get(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`);
    const snap = rows[0]?.snapshot;
    if (!snap) continue;
    measured++;
    // The model a copy carries: the scenarios, the project's own type list and
    // values, the cost lines and the assets all live INSIDE the snapshot, so a
    // copy of the snapshot is a copy of the model.
    if (Array.isArray(snap.costLines) && Array.isArray(snap.assets) && snap.project) withModel++;
    // THE ONE THAT CHANGES A MODEL RATHER THAN LOSING HISTORY: fund terms live
    // in their own table and are folded in at load only when the snapshot does
    // not already carry them, so a project relying on the row would open its
    // copy with no fund layer.
    const carries = snap.project?.fundTerms !== undefined;
    if (!carries) {
      const terms = await get(`refm_fund_terms?project_id=eq.${p.id}&select=project_id`);
      if (terms.length > 0) losesFund.push(p.name);
    }
  }
  check(`D1 the census reached a real snapshot per project (${measured} of ${projects.length})`, measured > 0, 'no snapshots');
  check(`D2 a copy carries the model: cost lines, assets and the project (${withModel} of ${measured})`, measured > 0 && withModel === measured);
  check('D3 no project would silently lose its fund layer in a copy', losesFund.length === 0,
    `${losesFund.join(' | ')} keep fund terms in refm_fund_terms, which a copy does not carry`);
}

main().then(() => { console.log(`\n=== ${pass} passed, ${fail} failed ===`); process.exit(fail ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
