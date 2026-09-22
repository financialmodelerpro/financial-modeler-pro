/** Pure verifier: npm exec --package tsx -- tsx tests/erm/verify-data-contract.ts
 * Synthetic values below are test fixtures only, never application seed data.
 */
import assert from 'node:assert/strict';
import { companySchema, instrumentSchema, segmentSchema } from '../../src/hubs/modeling/platforms/erm/lib/domain/company';
import { conceptSchema } from '../../src/hubs/modeling/platforms/erm/lib/domain/concept';
import { reportedFactSchema, normalizedFactSchema } from '../../src/hubs/modeling/platforms/erm/lib/domain/facts';
import { sourceDocumentSchema, sourceLocationSchema, provenanceSchema } from '../../src/hubs/modeling/platforms/erm/lib/domain/lineage';
import { reportingPeriodSchema, type ReportingPeriod } from '../../src/hubs/modeling/platforms/erm/lib/domain/period';
import { unitSchema, valueSchema } from '../../src/hubs/modeling/platforms/erm/lib/domain/primitives';
import { canonicalFactKey, detectDuplicateFacts, validateNormalizedFact, validatePeriod, validateReportedFact, validateSupersession } from '../../src/hubs/modeling/platforms/erm/lib/data/validation';
import { prepareManualSubmission } from '../../src/hubs/modeling/platforms/erm/lib/ingestion/manualEntry';

let passed = 0;
let failed = 0;
function test(name: string, run: () => void) {
  try { run(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
}
const at = '2025-04-01T12:00:00Z';
const later = '2025-04-02T12:00:00Z';
const calendar = { fiscalYear: 2024, startDate: '2024-01-01', endDate: '2024-12-31', quarterEnds: ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31'] };
const annual = reportingPeriodSchema.parse({ kind: 'duration', calendar, startDate: calendar.startDate, endDate: calendar.endDate, coverage: { kind: 'annual' } });
const quarter = reportingPeriodSchema.parse({ kind: 'duration', calendar, startDate: '2024-04-01', endDate: '2024-06-30', coverage: { kind: 'quarterly', quarter: 2 } });
const interim = reportingPeriodSchema.parse({ kind: 'duration', calendar, startDate: '2024-01-01', endDate: '2024-06-30', coverage: { kind: 'interim', span: 'H1', basis: 'cumulative' } });
const company = companySchema.parse({ id: 'test-company', legalName: 'Test Issuer', displayName: 'Test Issuer', country: 'SA', sectorId: 'test-sector', status: 'active', fiscalYearEnd: { month: 12, day: 31 }, reportingCurrency: 'SAR' });
const document = sourceDocumentSchema.parse({ id: 'test-document', companyId: company.id, title: 'Synthetic test source', documentType: 'annual_report', reportingPeriod: annual, publicationDate: '2025-03-01', language: 'en', assurance: 'audited', classification: 'issuer_publication', rights: { kind: 'public_reference', basis: 'Test fixture only' }, version: 1 });
const concept = conceptSchema.parse({ code: 'statement.revenue', taxonomyVersion: 'test-v1', label: 'Revenue', definition: 'Test definition', statement: 'income_statement', periodKind: 'duration', canonicalUnit: { kind: 'money' }, signConvention: 'positive', applicability: { kind: 'general' } });
const context = { company, document, segments: [], instruments: [] };
const source = reportedFactSchema.parse({ id: 'reported-1', companyId: company.id, issuerLabel: 'Test sales', value: { kind: 'known', decimal: '1200' }, reportedText: '1,200', reportedUnitLabel: 'SAR', unit: { kind: 'money', currency: 'SAR', scale: 0 }, period: annual, scope: { consolidation: 'consolidated' }, sourceDocumentId: document.id, sourceLocation: { page: 10, statement: 'Income statement' }, provenance: { method: 'manual', enteredBy: 'test-actor', enteredAt: at }, revision: { chainId: 'reported-chain', number: 1, recordedAt: at, effectiveFrom: at, origin: { kind: 'original' }, lifecycle: { status: 'current' } }, review: { status: 'approved', reviewedBy: 'test-reviewer', reviewedAt: at } });
const normalized = normalizedFactSchema.parse({ id: 'normalized-1', reportedFactId: source.id, concept: { code: concept.code, taxonomyVersion: concept.taxonomyVersion }, value: source.value, unit: source.unit, mapping: { version: 'test-map-v1', mappedBy: 'test-reviewer', mappedAt: at, transformations: [{ kind: 'identity', ruleVersion: 'test-1', explanation: 'Source already in base units' }] }, revision: { ...source.revision, chainId: 'normalized-chain' }, review: source.review });
const validate = (input: unknown, reported: unknown = source) => validateNormalizedFact(input, reported, concept, context);

test('valid annual period', () => assert.equal(validatePeriod(annual).ok, true));
test('valid standalone Q2', () => assert.equal(validatePeriod(quarter).ok, true));
test('valid cumulative H1', () => assert.equal(validatePeriod(interim).ok, true));
test('six months cannot be Q2', () => assert.equal(validatePeriod({ ...quarter, startDate: '2024-01-01' }).ok, false));
test('Q4 is standalone, not FY', () => assert.equal(validatePeriod({ ...annual, coverage: { kind: 'quarterly', quarter: 4 } }).ok, false));
test('valid Q4', () => assert.equal(validatePeriod({ ...annual, startDate: '2024-10-01', coverage: { kind: 'quarterly', quarter: 4 } }).ok, true));
test('valid 9M', () => assert.equal(validatePeriod({ ...interim, endDate: '2024-09-30', coverage: { kind: 'interim', span: '9M', basis: 'cumulative' } }).ok, true));
test('valid standalone H2', () => assert.equal(validatePeriod({ ...annual, startDate: '2024-07-01', coverage: { kind: 'interim', span: 'H2', basis: 'standalone' } }).ok, true));
test('H2 cannot be cumulative', () => assert.equal(validatePeriod({ ...annual, coverage: { kind: 'interim', span: 'H2', basis: 'cumulative' } }).ok, false));
test('custom cumulative must start at fiscal start', () => assert.equal(validatePeriod({ ...quarter, coverage: { kind: 'interim', span: 'custom', basis: 'cumulative' } }).ok, false));
test('reverse duration rejected', () => assert.equal(validatePeriod({ ...annual, startDate: '2024-12-31', endDate: '2024-01-01' }).ok, false));
test('impossible date rejected', () => assert.equal(validatePeriod({ ...quarter, endDate: '2024-02-30' }).ok, false));
test('invalid quarter is a result, not exception', () => assert.equal(validatePeriod({ ...quarter, coverage: { kind: 'quarterly', quarter: 6 } }).ok, false));
test('invalid calendar is a result, not exception', () => assert.equal(validatePeriod({ ...quarter, calendar: { ...calendar, quarterEnds: ['bad', '2024-06-30', '2024-09-30', '2024-12-31'] } }).ok, false));
test('instant is not a duration', () => assert.equal(validatePeriod({ kind: 'instant', date: '2024-06-30', calendar, startDate: '2024-01-01' }).ok, false));
test('valid instant', () => assert.equal(validatePeriod({ kind: 'instant', date: '2024-06-30', calendar }).ok, true));
test('instant outside calendar rejected', () => assert.equal(validatePeriod({ kind: 'instant', date: '2025-01-01', calendar }).ok, false));
test('non-calendar 53-week fiscal year', () => assert.equal(validatePeriod({ kind: 'duration', startDate: '2023-07-02', endDate: '2024-07-06', calendar: { fiscalYear: 2024, startDate: '2023-07-02', endDate: '2024-07-06', quarterEnds: ['2023-09-30', '2023-12-30', '2024-03-30', '2024-07-06'] }, coverage: { kind: 'annual' } }).ok, true));
test('non-calendar quarter uses declared boundaries', () => assert.equal(validatePeriod({ kind: 'duration', startDate: '2024-03-31', endDate: '2024-07-06', calendar: { fiscalYear: 2024, startDate: '2023-07-02', endDate: '2024-07-06', quarterEnds: ['2023-09-30', '2023-12-30', '2024-03-30', '2024-07-06'] }, coverage: { kind: 'quarterly', quarter: 4 } }).ok, true));

test('GCC company supported', () => assert.equal(companySchema.safeParse({ ...company, country: 'AE', reportingCurrency: 'AED' }).success, true));
test('impossible fiscal year end rejected', () => assert.equal(companySchema.safeParse({ ...company, fiscalYearEnd: { month: 4, day: 31 } }).success, false));
test('unsafe website scheme rejected', () => assert.equal(companySchema.safeParse({ ...company, website: 'javascript:alert(1)' }).success, false));
const instrument = { id: 'instrument-1', companyId: company.id, ticker: 'TEST', mic: 'XSAU', exchangeName: 'Test exchange', shareClass: 'ordinary', tradingCurrency: 'SAR', status: 'active' };
test('listed instrument without optional ISIN', () => assert.equal(instrumentSchema.safeParse(instrument).success, true));
test('delisting chronology rejected', () => assert.equal(instrumentSchema.safeParse({ ...instrument, status: 'delisted', listingDate: '2025-01-01', delistingDate: '2024-01-01' }).success, false));

test('mandatory document ID', () => assert.equal(validateReportedFact({ ...source, sourceDocumentId: undefined }, context).ok, false));
test('mandatory nonempty source location', () => assert.equal(sourceLocationSchema.safeParse({}).success, false));
test('page zero rejected', () => assert.equal(sourceLocationSchema.safeParse({ page: 0 }).success, false));
test('text locator supports non-paginated source', () => assert.equal(sourceLocationSchema.safeParse({ reference: 'Record test-1' }).success, true));
test('source issuer mismatch rejected', () => assert.equal(validateReportedFact(source, { ...context, document: { ...document, companyId: 'other' } }).ok, false));
test('comparative period may differ from document headline', () => assert.equal(validateReportedFact({ ...source, period: quarter }, context).ok, true));
test('manual actor required', () => assert.equal(provenanceSchema.safeParse({ method: 'manual', enteredAt: at }).success, false));
test('invalid checksum rejected', () => assert.equal(sourceDocumentSchema.safeParse({ ...document, sha256: 'short' }).success, false));
test('document self replacement rejected', () => assert.equal(sourceDocumentSchema.safeParse({ ...document, version: 2, replacesDocumentId: document.id }).success, false));
test('confidential source cannot claim public rights', () => assert.equal(sourceDocumentSchema.safeParse({ ...document, classification: 'advisory_confidential' }).success, false));

test('exact large decimal survives', () => assert.deepEqual(valueSchema.parse({ kind: 'known', decimal: '900719925474099312345.123456789' }), { kind: 'known', decimal: '900719925474099312345.123456789' }));
test('null is not zero', () => assert.equal(valueSchema.safeParse({ kind: 'known', decimal: null }).success, false));
test('NaN rejected', () => assert.equal(valueSchema.safeParse({ kind: 'known', decimal: 'NaN' }).success, false));
test('numeric coercion rejected', () => assert.equal(valueSchema.safeParse({ kind: 'known', decimal: 1 }).success, false));
test('currency required for monetary units', () => assert.equal(unitSchema.safeParse({ kind: 'money', scale: 0 }).success, false));
test('canonical scale enforced', () => assert.equal(normalizedFactSchema.safeParse({ ...normalized, unit: { kind: 'money', currency: 'SAR', scale: 3 } }).success, false));
test('valid reported to normalized relationship', () => assert.equal(validate(normalized).ok, true));
test('exact source revision required', () => assert.equal(validate({ ...normalized, reportedFactId: 'wrong' }).ok, false));
test('exact taxonomy version required', () => assert.equal(validate({ ...normalized, concept: { ...normalized.concept, taxonomyVersion: 'wrong' } }).ok, false));
test('unit must match concept', () => assert.equal(validate({ ...normalized, unit: { kind: 'shares', scale: 0 } }).ok, false));
test('instant concept rejects duration fact', () => assert.equal(validateNormalizedFact(normalized, source, { ...concept, periodKind: 'instant' }, context).ok, false));
test('identity cannot change source number', () => assert.equal(validate({ ...normalized, value: { kind: 'known', decimal: '2000' } }).ok, false));
test('missing cannot become a known zero', () => assert.equal(validate({ ...normalized, value: { kind: 'known', decimal: '0' } }, { ...source, value: { kind: 'missing', reason: 'not_reported' } }).ok, false));
test('missing survives normalization', () => {
  const value = { kind: 'missing', reason: 'not_reported' };
  assert.equal(validate({ ...normalized, value }, { ...source, value }).ok, true);
});
test('approval cannot bypass raw review', () => assert.equal(validate(normalized, { ...source, review: { status: 'draft' } }).ok, false));
test('unknown rights block canonical approval', () => assert.equal(validateNormalizedFact(normalized, source, concept, { ...context, document: { ...document, rights: { kind: 'unknown' } } }).ok, false));
test('review cannot precede recording', () => assert.equal(validate({ ...normalized, review: { status: 'approved', reviewedBy: 'r', reviewedAt: '2024-01-01T00:00:00Z' } }).ok, false));

test('duplicate identity ignores source and value', () => assert.equal(detectDuplicateFacts([{ normalized, reported: source }, { normalized: { ...normalized, id: 'another', value: { kind: 'known', decimal: '1300' } }, reported: source }]).valid, false));
test('quarter and cumulative interim remain distinct identities', () => assert.notEqual(canonicalFactKey(normalized, { ...source, period: quarter }), canonicalFactKey(normalized, { ...source, period: interim })));
test('same dates with different display coverage collide', () => {
  const custom: ReportingPeriod = { ...quarter, kind: 'duration', startDate: '2024-04-01', endDate: '2024-06-30', coverage: { kind: 'interim', span: 'custom', basis: 'standalone' } };
  assert.equal(canonicalFactKey(normalized, { ...source, period: quarter }), canonicalFactKey(normalized, { ...source, period: custom }));
});
test('standalone and consolidated distinct', () => assert.notEqual(canonicalFactKey(normalized, source), canonicalFactKey(normalized, { ...source, scope: { consolidation: 'standalone' } })));
test('segment identity differs', () => assert.notEqual(canonicalFactKey(normalized, source), canonicalFactKey(normalized, { ...source, scope: { ...source.scope, segmentId: 'segment' } })));
test('draft candidates do not collide with approved set', () => assert.equal(detectDuplicateFacts([{ normalized, reported: source }, { normalized: { ...normalized, review: { status: 'draft' } }, reported: source }]).valid, true));

const restated = reportedFactSchema.parse({ ...source, id: 'reported-2', value: { kind: 'known', decimal: '1250' }, revision: { ...source.revision, number: 2, recordedAt: later, effectiveFrom: later, origin: { kind: 'issuer_restatement', previousFactId: source.id, explanation: 'Synthetic restatement test' } }, review: { status: 'approved', reviewedBy: 'reviewer', reviewedAt: later } });
const superseded = reportedFactSchema.parse({ ...source, revision: { ...source.revision, lifecycle: { status: 'superseded', supersededBy: restated.id, effectiveAt: later, reason: 'issuer_restatement' } } });
test('restatement reciprocal history', () => assert.equal(validateSupersession(superseded, restated).valid, true));
test('restatement does not mutate original', () => { assert.deepEqual(source.value, { kind: 'known', decimal: '1200' }); assert.equal(source.revision.lifecycle.status, 'current'); });
test('destructive same ID revision rejected', () => assert.equal(validateSupersession(superseded, { ...restated, id: source.id }).valid, false));
test('unrelated chain rejected', () => assert.equal(validateSupersession(superseded, { ...restated, revision: { ...restated.revision, chainId: 'other' } }).valid, false));
test('draft cannot supersede', () => assert.equal(validateSupersession(superseded, { ...restated, review: { status: 'draft' } }).valid, false));
test('changed issuer cannot supersede', () => assert.equal(validateSupersession(superseded, { ...restated, companyId: 'other' }).valid, false));
test('original version cannot claim predecessor', () => assert.equal(reportedFactSchema.safeParse({ ...source, revision: { ...source.revision, origin: restated.revision.origin } }).success, false));
test('superseded reported source cannot feed new approval', () => assert.equal(validate(normalized, superseded).ok, false));
test('reported facts cannot taxonomy-remap', () => assert.equal(validateReportedFact({ ...restated, revision: { ...restated.revision, origin: { kind: 'taxonomy_remap', previousFactId: source.id, explanation: 'test' } } }, context).ok, false));

const segment = segmentSchema.parse({ id: 'segment', companyId: company.id, issuerCode: 'test-business', name: 'Test business', kind: 'business', validFrom: '2024-01-01' });
test('segment cannot parent itself', () => assert.equal(segmentSchema.safeParse({ ...segment, parentId: segment.id }).success, false));
test('wrong company segment rejected', () => assert.equal(validateReportedFact({ ...source, scope: { ...source.scope, segmentId: segment.id } }, { ...context, segments: [{ ...segment, companyId: 'other' }] }).ok, false));
test('segment validity enforced', () => assert.equal(validateReportedFact({ ...source, scope: { ...source.scope, segmentId: segment.id } }, { ...context, segments: [{ ...segment, validFrom: '2024-07-01' }] }).ok, false));
test('sector KPI extension supported', () => assert.equal(conceptSchema.safeParse({ ...concept, code: 'telecom.subscribers', statement: 'kpi', applicability: { kind: 'sector', sectorId: company.sectorId }, canonicalUnit: { kind: 'quantity', code: 'subscribers' } }).success, true));
test('company KPI cannot be used by another issuer', () => assert.equal(validateNormalizedFact(normalized, source, { ...concept, applicability: { kind: 'company', companyId: 'other' } }, context).ok, false));

const entry = { companyId: source.companyId, issuerLabel: source.issuerLabel, value: source.value, reportedText: source.reportedText, reportedUnitLabel: source.reportedUnitLabel, unit: source.unit, period: source.period, scope: source.scope, sourceDocumentId: source.sourceDocumentId, sourceLocation: source.sourceLocation, proposedConcept: normalized.concept };
const actor = { factId: 'manual-fact', chainId: 'manual-chain', actorId: 'operator', at };
test('manual preparation submits without approval or normalization', () => {
  const result = prepareManualSubmission(entry, actor, { ...context, concept });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reported.review.status, 'submitted');
  assert.deepEqual(result.value.reported.provenance, { method: 'manual', enteredBy: 'operator', enteredAt: at });
  assert.equal('normalized' in result.value, false);
});
test('manual input cannot forge approval', () => assert.equal(prepareManualSubmission({ ...entry, review: source.review }, actor, { ...context, concept }).ok, false));
test('manual input cannot forge actor', () => assert.equal(prepareManualSubmission({ ...entry, provenance: source.provenance }, actor, { ...context, concept }).ok, false));
test('manual input requires lineage', () => assert.equal(prepareManualSubmission({ ...entry, sourceLocation: {} }, actor, { ...context, concept }).ok, false));
test('manual input validates concept selection', () => assert.equal(prepareManualSubmission({ ...entry, proposedConcept: { ...entry.proposedConcept, code: 'other.metric' } }, actor, { ...context, concept }).ok, false));
test('manual entry rejects wrong unit dimension', () => assert.equal(prepareManualSubmission({ ...entry, unit: { kind: 'shares', scale: 0 } }, actor, { ...context, concept }).ok, false));
test('manual entry accepts source scale for later normalization', () => assert.equal(prepareManualSubmission({ ...entry, unit: { kind: 'money', currency: 'SAR', scale: 3 } }, actor, { ...context, concept }).ok, true));
test('manual submission is deterministic and does not mutate inputs', () => {
  const before = JSON.stringify({ entry, context, actor });
  assert.deepEqual(prepareManualSubmission(entry, actor, { ...context, concept }), prepareManualSubmission(entry, actor, { ...context, concept }));
  assert.equal(JSON.stringify({ entry, context, actor }), before);
});

test('concept reused across GCC currencies', () => {
  const unit = { kind: 'money', currency: 'AED', scale: 0 };
  assert.equal(validate({ ...normalized, unit }, { ...source, unit }).ok, true);
});
test('scaling alone cannot hide a currency conversion', () => {
  assert.equal(validate({ ...normalized, unit: { kind: 'money', currency: 'AED', scale: 0 }, mapping: { ...normalized.mapping, transformations: [{ kind: 'unit_scale', ruleVersion: 'v1', explanation: 'test' }] } }).ok, false);
});
test('changed scale requires unit_scale', () => {
  assert.equal(validate(normalized, { ...source, unit: { kind: 'money', currency: 'SAR', scale: 3 } }).ok, false);
});
test('documented scaling retains source', () => {
  const raw = { ...source, value: { kind: 'known', decimal: '1.2' }, reportedText: '1.2', unit: { kind: 'money', currency: 'SAR', scale: 3 } };
  assert.equal(validate({ ...normalized, mapping: { ...normalized.mapping, transformations: [{ kind: 'unit_scale', ruleVersion: 'v1', explanation: 'Thousands to base units' }] } }, raw).ok, true);
  assert.deepEqual(raw.value, { kind: 'known', decimal: '1.2' });
});
test('concept sign convention rejects negative revenue', () => {
  assert.equal(validate({ ...normalized, value: { kind: 'known', decimal: '-1200' } }, { ...source, value: { kind: 'known', decimal: '-1200' } }).ok, false);
});
test('zero is permitted by positive sign convention', () => {
  const value = { kind: 'known', decimal: '0' };
  assert.equal(validate({ ...normalized, value }, { ...source, value }).ok, true);
});
test('normalization cannot change physical dimensions', () => {
  const mapping = { ...normalized.mapping, transformations: [{ kind: 'unit_scale', ruleVersion: 'v1', explanation: 'test' }] };
  assert.equal(validateNormalizedFact({ ...normalized, unit: { kind: 'shares', scale: 0 }, mapping }, source, { ...concept, canonicalUnit: { kind: 'shares' } }, context).ok, false);
});
test('milliseconds compare chronologically', () => {
  assert.equal(validate({ ...normalized, review: { status: 'approved', reviewedBy: 'reviewer', reviewedAt: '2025-04-01T12:00:00.100Z' } }).ok, true);
});
test('normalized value property ordering has no significance', () => {
  assert.equal(validate({ ...normalized, value: { decimal: '1200', kind: 'known' } }).ok, true);
});
for (const reason of ['extraction_correction', 'reviewer_correction', 'unit_correction'] as const) {
  test(`${reason} uses non-destructive revision chain`, () => {
    const replacement = reportedFactSchema.parse({ ...restated, revision: { ...restated.revision, origin: { kind: reason, previousFactId: source.id, explanation: 'Test correction' } } });
    const previous = reportedFactSchema.parse({ ...superseded, revision: { ...superseded.revision, lifecycle: { status: 'superseded', supersededBy: replacement.id, effectiveAt: later, reason } } });
    assert.equal(validateSupersession(previous, replacement).valid, true);
  });
}
const remapped = normalizedFactSchema.parse({ ...normalized, id: 'normalized-2', concept: { ...normalized.concept, code: 'statement.other_revenue' }, revision: { ...normalized.revision, number: 2, recordedAt: later, effectiveFrom: later, origin: { kind: 'taxonomy_remap', previousFactId: normalized.id, explanation: 'Test remap' } }, review: { status: 'approved', reviewedBy: 'reviewer', reviewedAt: later } });
const oldMapping = normalizedFactSchema.parse({ ...normalized, revision: { ...normalized.revision, lifecycle: { status: 'superseded', supersededBy: remapped.id, effectiveAt: later, reason: 'taxonomy_remap' } } });
test('taxonomy remap preserves exact reported source', () => assert.equal(validateSupersession(oldMapping, remapped).valid, true));
test('taxonomy remap cannot silently change source revision', () => assert.equal(validateSupersession(oldMapping, { ...remapped, reportedFactId: restated.id }).valid, false));
test('superseded canonical rows do not collide', () => assert.equal(detectDuplicateFacts([{ normalized: oldMapping, reported: source }, { normalized, reported: source }]).valid, true));
test('historical normalization retains superseded source', () => assert.equal(validateNormalizedFact(oldMapping, superseded, concept, context).ok, true));
test('wrong supersession boundary rejected', () => assert.equal(validateSupersession(superseded, { ...restated, revision: { ...restated.revision, effectiveFrom: at } }).valid, false));
test('backwards revision recording rejected', () => assert.equal(validateSupersession(superseded, { ...restated, revision: { ...restated.revision, recordedAt: '2024-01-01T00:00:00Z' } }).valid, false));
test('unknown fields are rejected rather than silently discarded', () => assert.equal(validateReportedFact({ ...source, approvalBypass: true }, context).ok, false));
test('missing manual value is preserved', () => {
  const result = prepareManualSubmission({ ...entry, value: { kind: 'missing', reason: 'not_reported' }, reportedText: 'Not disclosed' }, actor, { ...context, concept });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.reported.value, { kind: 'missing', reason: 'not_reported' });
});

console.log(`ERFM data contract: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
