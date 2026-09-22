import { z } from 'zod';
import { companySchema, instrumentSchema, segmentSchema, type Company, type ListedInstrument, type Segment } from '../domain/company';
import { conceptAcceptsUnit, conceptSchema, type FinancialConcept } from '../domain/concept';
import { normalizedFactSchema, reportedFactSchema, type NormalizedFact, type ReportedFact } from '../domain/facts';
import { sourceDocumentSchema, type SourceDocument } from '../domain/lineage';
import { periodKey, reportingPeriodSchema } from '../domain/period';
import { timestampBefore, type Unit } from '../domain/primitives';

export interface ValidationIssue {
  code: string;
  path: string;
  severity: 'error' | 'warning';
  message: string;
}
export interface ValidationReport {
  ruleSetVersion: 'erm-foundation-1';
  valid: boolean;
  issues: ValidationIssue[];
}
export type ValidationResult<T> = { ok: true; value: T; report: ValidationReport } | { ok: false; report: ValidationReport };

export function report(issues: ValidationIssue[]): ValidationReport {
  return { ruleSetVersion: 'erm-foundation-1', valid: !issues.some((issue) => issue.severity === 'error'), issues };
}

export function validateContract<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data, report: report([]) };
  return { ok: false, report: report(parsed.error.issues.map((issue) => ({
    code: 'invalid_contract', path: issue.path.map(String).join('.'), severity: 'error', message: issue.message,
  }))) };
}

export const validatePeriod = (input: unknown) => validateContract(reportingPeriodSchema, input);

function error(issues: ValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message, severity: 'error' });
}

export interface FactContext {
  company: Company;
  document: SourceDocument;
  segments: readonly Segment[];
  instruments: readonly ListedInstrument[];
}

export function validateReportedFact(input: unknown, context: FactContext): ValidationResult<ReportedFact> {
  const parsed = validateContract(reportedFactSchema, input);
  if (!parsed.ok) return parsed;
  const fact = parsed.value;
  const issues: ValidationIssue[] = [];
  const contextResult = validateContract(z.strictObject({
    company: companySchema, document: sourceDocumentSchema,
    segments: z.array(segmentSchema), instruments: z.array(instrumentSchema),
  }), context);
  if (!contextResult.ok) return contextResult;
  if (fact.companyId !== context.company.id || fact.companyId !== context.document.companyId || fact.sourceDocumentId !== context.document.id) {
    error(issues, 'lineage_mismatch', 'sourceDocumentId', 'Fact, issuer and source document must agree');
  }
  if (fact.scope.segmentId) {
    const segment = context.segments.find((row) => row.id === fact.scope.segmentId);
    const start = fact.period.kind === 'instant' ? fact.period.date : fact.period.startDate;
    const end = fact.period.kind === 'instant' ? fact.period.date : fact.period.endDate;
    if (!segment || segment.companyId !== fact.companyId || start < segment.validFrom || (segment.validTo && end > segment.validTo)) {
      error(issues, 'segment_scope', 'scope.segmentId', 'Segment must belong to this issuer and cover the fact period');
    }
  }
  if (fact.scope.instrumentId && !context.instruments.some((row) => row.id === fact.scope.instrumentId && row.companyId === fact.companyId)) {
    error(issues, 'instrument_scope', 'scope.instrumentId', 'Instrument must belong to this issuer');
  }
  if (fact.revision.origin.kind === 'taxonomy_remap') error(issues, 'reported_remap', 'revision.origin', 'Taxonomy remaps create normalized revisions, not reported revisions');
  if (timestampBefore(fact.revision.recordedAt, fact.provenance.enteredAt)) error(issues, 'recording_order', 'revision.recordedAt', 'Recording cannot precede entry');
  if (fact.revision.origin.kind !== 'original' && fact.revision.origin.previousFactId === fact.id) error(issues, 'self_revision', 'revision.origin', 'Fact cannot revise itself');
  if (fact.revision.lifecycle.status === 'superseded' && fact.revision.lifecycle.supersededBy === fact.id) error(issues, 'self_revision', 'revision.lifecycle', 'Fact cannot supersede itself');
  if (fact.review.status === 'approved' || fact.review.status === 'rejected') {
    if (timestampBefore(fact.review.reviewedAt, fact.revision.recordedAt)) error(issues, 'review_order', 'review.reviewedAt', 'Review cannot precede recording');
  }
  if (fact.review.status === 'submitted' && timestampBefore(fact.review.submittedAt, fact.revision.recordedAt)) error(issues, 'review_order', 'review.submittedAt', 'Submission cannot precede recording');
  return issues.length ? { ok: false, report: report(issues) } : { ok: true, value: fact, report: report([]) };
}

// Scale and representation are omitted because identity is independent of presentation.
export function unitKey(unit: Unit): string {
  if (unit.kind === 'money' || unit.kind === 'money_per_share') return JSON.stringify([unit.kind, unit.currency]);
  if (unit.kind === 'quantity') return JSON.stringify([unit.kind, unit.code]);
  return JSON.stringify([unit.kind]);
}

export function scopeKey(fact: ReportedFact): string {
  return JSON.stringify([fact.companyId, periodKey(fact.period), fact.scope.consolidation,
    fact.scope.segmentId ?? null, fact.scope.instrumentId ?? null]);
}

/** Semantic identity: competing sources/versions must not yield two active canonical facts. */
export function canonicalFactKey(fact: NormalizedFact, reported: ReportedFact): string {
  return JSON.stringify([scopeKey(reported), fact.concept.code, unitKey(fact.unit)]);
}

export function validateNormalizedFact(input: unknown, reportedInput: unknown, conceptInput: unknown, context: FactContext): ValidationResult<NormalizedFact> {
  const parsed = validateContract(normalizedFactSchema, input);
  if (!parsed.ok) return parsed;
  const source = validateReportedFact(reportedInput, context);
  if (!source.ok) return source;
  const definition = validateContract(conceptSchema, conceptInput);
  if (!definition.ok) return definition;
  const fact = parsed.value;
  const reported = source.value;
  const concept = definition.value;
  const issues: ValidationIssue[] = [];
  if (fact.reportedFactId !== reported.id) error(issues, 'reported_link', 'reportedFactId', 'Normalization must link to the exact reported revision');
  if (fact.concept.code !== concept.code || fact.concept.taxonomyVersion !== concept.taxonomyVersion) error(issues, 'concept_link', 'concept', 'Concept and taxonomy version must resolve exactly');
  if (concept.periodKind !== reported.period.kind) error(issues, 'concept_period', 'concept', 'Concept measurement kind disagrees with source period');
  if (!conceptAcceptsUnit(concept, fact.unit)) {
    error(issues, 'concept_unit', 'unit', 'Unit must match the concept dimension');
  }
  if (concept.applicability.kind === 'company' && concept.applicability.companyId !== reported.companyId) error(issues, 'concept_scope', 'concept', 'Company KPI belongs to another issuer');
  if (concept.applicability.kind === 'sector' && concept.applicability.sectorId !== context.company.sectorId) error(issues, 'concept_scope', 'concept', 'Sector KPI does not apply to this issuer');
  if (fact.value.kind !== reported.value.kind || (fact.value.kind === 'missing' && reported.value.kind === 'missing' && fact.value.reason !== reported.value.reason)) {
    error(issues, 'missing_preservation', 'value', 'Normalization cannot fill or erase a missing reported value');
  }
  const transformations = new Set(fact.mapping.transformations.map((step) => step.kind));
  const identityOnly = [...transformations].every((kind) => kind === 'identity' || kind === 'concept_mapping');
  const sameValue = fact.value.kind === 'known' && reported.value.kind === 'known'
    ? fact.value.decimal === reported.value.decimal
    : fact.value.kind === 'missing' && reported.value.kind === 'missing' && fact.value.reason === reported.value.reason;
  if (identityOnly && (!sameValue || !sameUnit(fact.unit, reported.unit))) {
    error(issues, 'undocumented_transform', 'mapping', 'A changed value or unit requires an explicit transformation');
  }
  if (fact.unit.kind !== reported.unit.kind ||
      (fact.unit.kind === 'quantity' && reported.unit.kind === 'quantity' && fact.unit.code !== reported.unit.code)) {
    error(issues, 'dimension_change', 'unit', 'Normalization cannot change the physical dimension');
  }
  if ('currency' in fact.unit && 'currency' in reported.unit && fact.unit.currency !== reported.unit.currency && !transformations.has('currency_conversion')) {
    error(issues, 'currency_transform', 'mapping', 'Currency changes require a documented conversion');
  }
  if ((('scale' in fact.unit && 'scale' in reported.unit && fact.unit.scale !== reported.unit.scale) ||
       (fact.unit.kind === 'ratio' && reported.unit.kind === 'ratio' && fact.unit.representation !== reported.unit.representation)) && !transformations.has('unit_scale')) {
    error(issues, 'scale_transform', 'mapping', 'Scale changes require a documented unit transformation');
  }
  if (fact.value.kind === 'known' && reported.value.kind === 'known') {
    const negative = (value: string) => value.startsWith('-') && /[1-9]/.test(value);
    if (negative(fact.value.decimal) !== negative(reported.value.decimal) && !transformations.has('sign_change')) {
      error(issues, 'sign_transform', 'mapping', 'A sign change requires an explicit transformation');
    }
    const nonzero = /[1-9]/.test(fact.value.decimal);
    if (nonzero && ((concept.signConvention === 'positive' && negative(fact.value.decimal)) ||
        (concept.signConvention === 'negative' && !negative(fact.value.decimal)))) {
      error(issues, 'concept_sign', 'value', 'Normalized sign disagrees with the concept convention');
    }
  }
  if (timestampBefore(fact.mapping.mappedAt, reported.revision.recordedAt) || timestampBefore(fact.revision.recordedAt, fact.mapping.mappedAt)) error(issues, 'mapping_order', 'mapping.mappedAt', 'Mapping must follow source recording and precede normalized recording');
  if (fact.revision.origin.kind !== 'original' && fact.revision.origin.previousFactId === fact.id) error(issues, 'self_revision', 'revision.origin', 'Fact cannot revise itself');
  if (fact.revision.lifecycle.status === 'superseded' && fact.revision.lifecycle.supersededBy === fact.id) error(issues, 'self_revision', 'revision.lifecycle', 'Fact cannot supersede itself');
  if (fact.review.status === 'approved') {
    if (timestampBefore(fact.review.reviewedAt, fact.revision.recordedAt)) error(issues, 'review_order', 'review.reviewedAt', 'Review cannot precede recording');
    if (reported.review.status !== 'approved' || (fact.revision.lifecycle.status === 'current' && reported.revision.lifecycle.status !== 'current')) error(issues, 'unapproved_source', 'reportedFactId', 'Current approved normalization requires a current approved reported fact');
    if (context.document.classification === 'advisory_confidential' || ['unknown', 'internal_only'].includes(context.document.rights.kind)) error(issues, 'source_rights', 'reportedFactId', 'Source is not eligible for shared canonical approval');
  }
  return issues.length ? { ok: false, report: report(issues) } : { ok: true, value: fact, report: report([]) };
}

function sameUnit(a: Unit, b: Unit): boolean {
  return unitKey(a) === unitKey(b) && (a.kind === 'ratio' && b.kind === 'ratio'
    ? a.representation === b.representation : 'scale' in a && 'scale' in b && a.scale === b.scale);
}

export function detectDuplicateFacts(rows: readonly { normalized: NormalizedFact; reported: ReportedFact }[]): ValidationReport {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  rows.forEach(({ normalized, reported }, index) => {
    if (normalized.reportedFactId !== reported.id) {
      error(issues, 'reported_link', String(index), 'Cannot compute identity with an unrelated reported fact');
      return;
    }
    if (normalized.review.status !== 'approved' || normalized.revision.lifecycle.status !== 'current') return;
    const key = canonicalFactKey(normalized, reported);
    if (seen.has(key)) error(issues, 'duplicate_fact', String(index), 'Multiple current approved facts have the same canonical identity');
    seen.add(key);
  });
  return report(issues);
}

/** Checks an explicit historical pair; does not mutate, select, or delete either row. */
export function validateSupersession(previous: ReportedFact | NormalizedFact, next: ReportedFact | NormalizedFact): ValidationReport {
  const previousContract = validateContract<ReportedFact | NormalizedFact>('companyId' in previous ? reportedFactSchema : normalizedFactSchema, previous);
  if (!previousContract.ok) return previousContract.report;
  const nextContract = validateContract<ReportedFact | NormalizedFact>('companyId' in next ? reportedFactSchema : normalizedFactSchema, next);
  if (!nextContract.ok) return nextContract.report;
  const issues: ValidationIssue[] = [];
  const oldRevision = previous.revision;
  const newRevision = next.revision;
  if (previous.id === next.id || oldRevision.chainId !== newRevision.chainId || newRevision.number !== oldRevision.number + 1 ||
      newRevision.origin.kind === 'original' || newRevision.origin.previousFactId !== previous.id ||
      oldRevision.lifecycle.status !== 'superseded' || oldRevision.lifecycle.supersededBy !== next.id) {
    error(issues, 'revision_chain', 'revision', 'Supersession requires different IDs, one chain, consecutive versions and reciprocal links');
  }
  if (oldRevision.lifecycle.status === 'superseded' && newRevision.origin.kind !== 'original' &&
      (oldRevision.lifecycle.reason !== newRevision.origin.kind || Date.parse(oldRevision.lifecycle.effectiveAt) !== Date.parse(newRevision.effectiveFrom))) {
    error(issues, 'revision_reason', 'revision', 'Supersession reason and effective boundary must agree');
  }
  if (timestampBefore(newRevision.recordedAt, oldRevision.recordedAt) || timestampBefore(newRevision.effectiveFrom, oldRevision.effectiveFrom)) error(issues, 'revision_order', 'revision', 'Revision times must not move backwards');
  if (next.review.status !== 'approved') error(issues, 'revision_approval', 'review', 'A draft or rejected correction cannot supersede accepted history');
  if ('companyId' in previous && 'companyId' in next) {
    if (scopeKey(previous) !== scopeKey(next)) error(issues, 'revision_identity', 'scope', 'Reported revision must preserve issuer, period and scope');
  } else if ('reportedFactId' in previous && 'reportedFactId' in next) {
    if (previous.reportedFactId !== next.reportedFactId) error(issues, 'revision_identity', 'reportedFactId', 'Normalized remaps retain the exact source revision; restated sources start a new normalization chain');
    if (previous.concept.code !== next.concept.code && newRevision.origin.kind !== 'taxonomy_remap') error(issues, 'revision_identity', 'concept', 'Concept changes require taxonomy_remap');
  } else error(issues, 'revision_layer', 'revision', 'Reported and normalized histories are separate');
  return report(issues);
}

export type ConceptContext = FactContext & { concept: FinancialConcept };
