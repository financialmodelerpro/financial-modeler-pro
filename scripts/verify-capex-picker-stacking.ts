/* eslint-disable no-console */
/**
 * verify-capex-picker-stacking.ts
 *
 * The Module 1 Capex "% of Selected Lines" picker opened its option list
 * BEHIND the cost rows below it, so the method was unusable.
 *
 * THE CAUSE WAS NOT IN THE COMPONENT. `app/globals.css` styles every
 * `td:first-child` as `position: sticky; z-index: 1` with an opaque
 * background, to freeze the label column on the wide period tables. The
 * picker renders as its own row with a single `<td colSpan={9}>`, which is a
 * first child, so the rule caught it and turned it into a stacking context at
 * level 1. That SCOPED the popover's `z-index: 20` inside the cell. The next
 * cost row's first cell is another sticky level-1 context, a later sibling at
 * the same level, so it painted on top, and its opaque background hid the
 * options completely.
 *
 * WHY THIS TEST EXISTS. The fix is one CSS property (`position: static` on
 * that cell) and it looks like dead code, so it is exactly the kind of line a
 * later cleanup deletes. A source grep alone would not prove anything: the
 * question is what the BROWSER paints, so this drives a real Chromium and hit
 * tests the point an option occupies.
 *
 * IT CANNOT PASS VACUOUSLY. The global rule is read out of app/globals.css
 * rather than restated here, so if that rule is ever removed this file fails
 * loudly instead of silently testing a condition that no longer exists.
 *
 * Run: npx tsx scripts/verify-capex-picker-stacking.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { chromium } from '@playwright/test';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};

const GLOBALS = 'app/globals.css';
const COMPONENT = 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx';

/** The live `td:first-child { ... }` block, so the fixture cannot drift from
 *  the stylesheet that actually ships. */
function readStickyRule(): string {
  const css = readFileSync(GLOBALS, 'utf8');
  const i = css.indexOf('td:first-child {');
  if (i < 0) return '';
  const end = css.indexOf('}', i);
  return end < 0 ? '' : css.slice(i, end + 1);
}

/** The repro: the REFM ancestor chain (zoom shell, scrolling main, the cost
 *  table) with the real rule applied. `fixed` toggles the opt-out. */
function page(rule: string, fixed: boolean): string {
  const optOut = fixed ? "td.style.position='static'; td.style.zIndex='auto';" : '';
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;font-family:system-ui,sans-serif}
    table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
    th{background:#1B4F8A;color:#fff;padding:6px;text-align:left}
    td{padding:4px}
    ${rule}
  </style>
  <div id="shell" style="display:flex;flex-direction:column;height:calc(100vh / 0.8);width:calc(100vw / 0.8);overflow:hidden;zoom:0.8;">
    <div style="height:48px;background:#0D2E5A"></div>
    <div style="display:flex;flex:1;min-height:0">
      <div style="width:180px;background:#eef2f6"></div>
      <main id="scroller" style="flex:1;padding:16px;min-height:0;overflow:auto">
        <div style="background:#fff;border:1px solid #d8dee6;border-radius:6px;padding:12px">
          <table><colgroup>
            <col style="width:240px"><col style="width:220px"><col style="width:140px"><col style="width:60px">
            <col style="width:60px"><col style="width:110px"><col style="width:160px"><col style="width:60px"><col style="width:40px">
          </colgroup>
          <thead><tr><th>Cost Line</th><th>Method</th><th>Value</th><th>Start</th><th>End</th><th>Phasing</th><th>Total</th><th>Toggle</th><th></th></tr></thead>
          <tbody id="tb"></tbody></table>
        </div>
        <div style="height:400px"></div>
      </main>
    </div>
  </div>
  <script>
  var tb = document.getElementById('tb');
  function costRow(i){
    var tr=document.createElement('tr'); tr.dataset.testid='cost-row-'+i;
    tr.style.background='#f3f6fa'; tr.style.opacity='1';
    var oh=' style="overflow:hidden"';
    tr.innerHTML='<td'+oh+'><input value="Line '+i+'" style="width:100%"></td>'
      +'<td'+oh+'><select style="width:100%"><option>Fixed</option></select></td>'
      +'<td'+oh+'>1,000</td><td>0</td><td>2</td><td>even</td><td>1,000</td><td'+oh+'>on</td><td'+oh+'>x</td>';
    return tr;
  }
  function pickerRow(id){
    var tr=document.createElement('tr'); tr.style.background='#eef2f6';
    var td=document.createElement('td'); td.colSpan=9; td.style.padding='8px 12px';
    ${optOut}
    td.innerHTML='<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">'
      +'<strong style="font-size:11px;padding-top:6px">Apply to:</strong>'
      +'<div style="position:relative;flex:1;min-width:240px">'
      +'<button id="trigger-'+id+'" style="font-size:11px;padding:6px 12px">Select lines</button>'
      +'<div id="pop-'+id+'" style="position:absolute;top:calc(100% + 4px);left:0;min-width:320px;max-width:480px;'
      +'background:#fff;border:1px solid #d8dee6;border-radius:6px;z-index:20;padding:8px;display:none">'
      +'<div style="max-height:240px;overflow-y:auto;border:1px solid #d8dee6;padding:4px">'
      + Array.from({length:8},function(_,k){return '<label style="display:flex;gap:6px;padding:4px 6px"><input type="checkbox" id="cb-'+id+'-'+k+'"><span>Sibling '+k+'</span></label>';}).join('')
      +'</div></div></div></div>';
    tr.appendChild(td); return tr;
  }
  for(var i=0;i<2;i++) tb.appendChild(costRow(i));
  tb.appendChild(pickerRow('mid'));
  for(var j=2;j<9;j++) tb.appendChild(costRow(j));
  tb.appendChild(costRow(9));
  tb.appendChild(pickerRow('last'));
  window.openPicker=function(w){document.getElementById('pop-'+w).style.display='block';};
  </script>`;
}

/** Is the first option actually the thing painted at its own coordinates, and
 *  does clicking there toggle its checkbox? */
const PROBE = (w: string): string => `(() => {
  var pop=document.getElementById('pop-${w}');
  var label=pop.querySelector('label');
  var lr=label.getBoundingClientRect();
  var cx=lr.left+lr.width/2, cy=lr.top+lr.height/2;
  var hit=document.elementFromPoint(cx,cy);
  return { visible: hit ? pop.contains(hit) : false, x: cx, y: cy,
           hitTag: hit ? hit.tagName.toLowerCase() : 'none',
           hitRow: hit && hit.closest('tr') && hit.closest('tr').dataset.testid ? hit.closest('tr').dataset.testid : '' };
})()`;

async function main(): Promise<void> {
  console.log('=== Capex "% of Selected Lines" picker: popover stacking ===');
  const rule = readStickyRule();

  console.log('\n-- The condition this test is about still exists --');
  check('the global td:first-child rule is present in globals.css', rule.length > 0);
  check('it is what makes a cell a stacking context (sticky + z-index)',
    /position:\s*sticky/.test(rule) && /z-index:\s*1/.test(rule), rule.replace(/\s+/g, ' '));
  check('and it paints an opaque background over what is behind it',
    /background:/.test(rule), rule.replace(/\s+/g, ' '));

  const browser = await chromium.launch();
  try {
    console.log('\n-- Without the opt-out, the bug reproduces --');
    {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await p.setContent(page(rule, false));
      await p.evaluate("window.openPicker('mid')");
      const mid = await p.evaluate(PROBE('mid')) as any;
      check('a picker with rows beneath it is OCCLUDED', mid.visible === false,
        `something else is painted at the option: ${mid.hitTag} in ${mid.hitRow || 'n/a'}`);
      check('and what covers it is one of the rows below', /^cost-row-/.test(mid.hitRow), mid.hitRow);
      await p.evaluate("window.openPicker('last')");
      const last = await p.evaluate(PROBE('last')) as any;
      // The asymmetry is the signature of the diagnosis: the last row has no
      // later sibling to paint over it. If this ever fails, the cause moved.
      check('the LAST row is unaffected, which is the signature of this cause', last.visible === true);
      await p.close();
    }

    console.log('\n-- With the opt-out, every option is visible and clickable --');
    {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await p.setContent(page(rule, true));
      for (const w of ['mid', 'last']) {
        await p.evaluate(`window.openPicker('${w}')`);
        const r = await p.evaluate(PROBE(w)) as any;
        check(`${w} row: the option is the element at its own coordinates`, r.visible === true,
          `${r.hitTag} in ${r.hitRow || 'n/a'}`);
        // Not just visible: actually CLICK it and confirm the checkbox toggled.
        // A hit test proves paint order; a click proves the option is usable.
        await p.mouse.click(r.x, r.y);
        const checked = await p.evaluate(`document.getElementById('cb-${w}-0').checked`);
        check(`${w} row: clicking the option selects it`, checked === true);
      }
      // Every option in the list, not just the first.
      await p.evaluate("window.openPicker('mid')");
      const all = await p.evaluate(`(() => {
        var pop=document.getElementById('pop-mid');
        var labels=Array.prototype.slice.call(pop.querySelectorAll('label'));
        return labels.map(function(l){
          var r=l.getBoundingClientRect();
          var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
          return hit ? pop.contains(hit) : false;
        });
      })()`) as boolean[];
      check('EVERY option in the list is hit-testable, not just the first',
        all.length === 8 && all.every(Boolean), `${all.filter(Boolean).length}/${all.length}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }

  console.log('\n-- The component actually applies the opt-out --');
  {
    const src = readFileSync(COMPONENT, 'utf8');
    const i = src.indexOf('-pct-picker`}');
    const block = i < 0 ? '' : src.slice(i, i + 2200);
    check('the picker cell sets position static', /position:\s*'static'/.test(block));
    check('and clears the z-index it would otherwise inherit', /zIndex:\s*'auto'/.test(block));
    check('the popover flips up when there is no room below', /dropUp \? \{ bottom:/.test(src));
    check('the flip listens on the capture phase, since the scroll is not on window',
      /addEventListener\('scroll', decide, true\)/.test(src));
    check('no em dash in the component', !src.includes(String.fromCharCode(0x2014)));
    check('no em dash in this verifier', !readFileSync('scripts/verify-capex-picker-stacking.ts', 'utf8').includes(String.fromCharCode(0x2014)));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
