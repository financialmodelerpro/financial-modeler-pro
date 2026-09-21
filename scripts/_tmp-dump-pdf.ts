/* Temporary: dump the PDF report content for the live Marina Gate fixture. Not committed. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { collectModuleContent, generateProjectPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { pdfText } from './pdfTextExtract';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { modelFromSnapshot, pickModel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { baseCaseId, normaliseCases } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
const out = process.argv[2] ?? '.pdfdump';
mkdirSync(out, { recursive: true });
const raw = JSON.parse(readFileSync('scripts/marinaGateSnapshot.json', 'utf8'));
const migrated = loadStoredModel(raw.snapshot ?? raw).snapshot;
const cases = normaliseCases(migrated.cases);
const activeId = migrated.activeCaseId && cases.some((c) => c.id === migrated.activeCaseId) ? migrated.activeCaseId : baseCaseId(cases);
const base = pickModel(migrated as unknown as Record<string, unknown>);
const state = modelFromSnapshot(migrated) as any;
const cc = { baseModel: base as any, cases, activeCaseId: activeId };
const content = collectModuleContent(state, cc, 'full');
for (const [mod, items] of Object.entries(content)) {
  const lines: string[] = [];
  let lastTab = '';
  for (const ti of items) {
    if (ti.tab !== lastTab) { lines.push(`\n######## TAB: ${ti.tab}`); lastTab = ti.tab; }
    const it: any = ti.item;
    if (it.type === 'paragraph') { lines.push(`--- [${ti.part}] PARAGRAPH ${it.title ?? ''}: ${it.text}`); continue; }
    if (it.type === 'cards') { lines.push(`--- [${ti.part}] CARDS ${it.title}: ${it.cards.map((c: any) => `${c.label}=${c.value}${c.sub ? ' (' + c.sub + ')' : ''}`).join(' | ')}`); continue; }
    const t = it.table;
    lines.push(`--- [${ti.part}] TABLE ${t.title}  cols: ${t.columns.join(' | ')}`);
    for (const r of t.rows) lines.push(`   ${r.emphasis ? '<' + r.emphasis + '> ' : ''}${r.cells.map((c: any) => (typeof c === 'number' ? (Math.abs(c) >= 1000 ? c.toFixed(0) : String(Math.round(c * 1e4) / 1e4)) : c ?? '')).join(' | ')}`);
  }
  writeFileSync(`${out}/${mod}.txt`, lines.join('\n'));
}
(async () => {
  const bytes = await generateProjectPdf({ state, projectName: 'FMP - MARINA GATE', dateLabel: '17 September 2026', selectedModuleKeys: ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'], caseComparison: cc, includeSensitivity: true, displayScale: 'millions' });
  writeFileSync(`${out}/report.pdf`, bytes);
  writeFileSync(`${out}/fulltext.txt`, pdfText(bytes));
  console.log('pages text bytes', pdfText(bytes).length);
})();
