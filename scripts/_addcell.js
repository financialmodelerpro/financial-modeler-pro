const fs = require('fs');
const p = 'app/admin/users/page.tsx';
let s = fs.readFileSync(p, 'utf8');

const a = "  const [cancelFilter, setCancelFilter]     = useState('all');";
if (!s.includes(a)) { console.error('STATE MISS'); process.exit(1); }
s = s.replace(a, a + `
  // Signup qualification (mig 216): filter and sort, so every active real
  // estate user reads at a glance rather than being hunted for one by one.
  const [reFilter, setReFilter]             = useState('all');
  const [sortByRe, setSortByRe]             = useState(false);`);

const b = `                        {savingField === 'role' && <span style={{ fontSize: 11, color: '#6B7280' }}>Saving…</span>}
                      </div>
                    </td>`;
if (!s.includes(b)) { console.error('CELL ANCHOR MISS'); process.exit(1); }

const cell = b + `

                    {/* Signup qualification. THREE states shown as three
                        different things: yes, no, and a dash for a user who
                        registered before the question existed. A blank for the
                        third would read as "no", which is an answer they never
                        gave. The note is the cell's tooltip, so the detail is
                        one hover away without widening the table. */}
                    <td style={{ padding: '12px 16px' }} data-testid={'user-real-estate-' + u.id}>
                      {u.works_in_real_estate === true ? (
                        <span title={u.real_estate_role_note ?? undefined} style={{ fontSize: 11, fontWeight: 800, color: '#166534', background: '#DCFCE7', padding: '3px 8px', borderRadius: 999 }}>Yes</span>
                      ) : u.works_in_real_estate === false ? (
                        <span title={u.real_estate_role_note ?? undefined} style={{ fontSize: 11, fontWeight: 800, color: '#92400e', background: '#FEF3C7', padding: '3px 8px', borderRadius: 999 }}>No</span>
                      ) : (
                        <span title="Registered before this question was asked" style={{ fontSize: 12, color: '#9CA3AF' }}>-</span>
                      )}
                    </td>`;
s = s.replace(b, cell);

// The filter control, beside the cancellation filter.
const c = `            <option value="canceled">Canceled</option>
          </select>`;
if (!s.includes(c)) { console.error('FILTER ANCHOR MISS'); process.exit(1); }
s = s.replace(c, c + `
          {/* Qualification filter + sort. 'unknown' is offered deliberately:
              the users who predate the question are a real cohort to chase,
              not a gap to hide. */}
          <select value={reFilter} onChange={e => { setReFilter(e.target.value); setPage(0); }}
            data-testid="real-estate-filter"
            style={{ padding: '8px 14px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            <option value="all">All industries</option>
            <option value="yes">In real estate</option>
            <option value="no">Not in real estate</option>
            <option value="unknown">Not asked</option>
          </select>
          <button type="button" onClick={() => { setSortByRe(v => !v); setPage(0); }}
            data-testid="real-estate-sort"
            aria-pressed={sortByRe}
            style={{
              padding: '8px 14px', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 700,
              border: sortByRe ? '1px solid #1B4F8A' : '1px solid #D1D5DB',
              background: sortByRe ? '#1B4F8A' : '#fff',
              color: sortByRe ? '#fff' : '#374151',
            }}>
            Sort by real estate
          </button>`);

fs.writeFileSync(p, s);
console.log('list column, filter and sort added');
