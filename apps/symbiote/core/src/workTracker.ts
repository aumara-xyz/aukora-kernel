/**
 * 24Z.88-W — Aukora work tracker seed.
 *
 * The Singularity Path remains the readable story. This module is the structured source underneath it:
 * durable work records, explicit blockers, evidence refs, and a UI-ready projection. It grants no authority.
 */
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';
import { isPlainJsonShaped } from './hrtAccordSchema';

export type WorkStatus = 'inbox' | 'accepted' | 'planned' | 'blocked' | 'active' | 'done' | 'verified' | 'parked' | 'rejected' | 'superseded';
export type WorkKind = 'security' | 'feature' | 'research' | 'donor_absorption' | 'ui' | 'docs' | 'infrastructure';
export type WorkRisk = 'low' | 'medium' | 'high' | 'critical';
export type WorkAdoption = 'none' | 'reference_only' | 'stage_only' | 'operator_approved' | 'live' | 'live_apply_candidate';
export type WorkAgent = 'codex' | 'opus' | 'claude_code' | 'auma_inside' | 'fusion_council' | 'human' | 'unassigned';

export interface WorkReference {
  label: string;
  path?: string;
  note?: string;
}

export interface WorkTrackerItem {
  id: string;
  title: string;
  status: WorkStatus;
  kind: WorkKind;
  risk: WorkRisk;
  stage: string;
  source: string;
  owner: WorkAgent;
  createdAt: string;          // YYYY-MM-DD
  lastVerifiedAt: string;     // YYYY-MM-DD
  summary: string;
  decision: string;
  adoption: WorkAdoption;
  preconditions: string[];
  blockedBy: string[];
  nextActions: string[];
  evidenceRefs: WorkReference[];
  sourceRefs: WorkReference[];
  supersedes: string[];
  supersededBy?: string;
  deferredNotes?: string[];
  grantsAuthority: false;
  uiVisible: boolean;
}

export interface WorkValidationResult {
  ok: boolean;
  item: WorkTrackerItem | null;
  reason: string;
  droppedFields: string[];
  findings: string[];
}

export interface WorkTrackerBoard {
  generatedAt: string;
  total: number;
  byStatus: Record<WorkStatus, number>;
  byKind: Record<WorkKind, number>;
  highRiskOpen: number;
  blocked: WorkTrackerItem[];
  now: WorkTrackerItem[];
  next: WorkTrackerItem[];
  parked: WorkTrackerItem[];
  done: WorkTrackerItem[];
  uiItems: WorkTrackerUiItem[];
  grantsAuthority: false;
}

export interface WorkTrackerUiItem {
  id: string;
  title: string;
  status: WorkStatus;
  kind: WorkKind;
  risk: WorkRisk;
  stage: string;
  owner: WorkAgent;
  decision: string;
  blockedByCount: number;
  preconditionCount: number;
  evidenceCount: number;
  nextActionCount: number;
}

export const WORK_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'id', 'title', 'status', 'kind', 'risk', 'stage', 'source', 'owner', 'createdAt', 'lastVerifiedAt',
  'summary', 'decision', 'adoption', 'preconditions', 'blockedBy', 'nextActions', 'evidenceRefs',
  'sourceRefs', 'supersedes', 'supersededBy', 'deferredNotes', 'grantsAuthority', 'uiVisible',
]);

const STATUSES = new Set<WorkStatus>(['inbox', 'accepted', 'planned', 'blocked', 'active', 'done', 'verified', 'parked', 'rejected', 'superseded']);
const KINDS = new Set<WorkKind>(['security', 'feature', 'research', 'donor_absorption', 'ui', 'docs', 'infrastructure']);
const RISKS = new Set<WorkRisk>(['low', 'medium', 'high', 'critical']);
const ADOPTIONS = new Set<WorkAdoption>(['none', 'reference_only', 'stage_only', 'operator_approved', 'live', 'live_apply_candidate']);
const AGENTS = new Set<WorkAgent>(['codex', 'opus', 'claude_code', 'auma_inside', 'fusion_council', 'human', 'unassigned']);
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,80}$/;
const SAFE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const emptyCounts = <T extends string>(values: readonly T[]): Record<T, number> => {
  const out = {} as Record<T, number>;
  for (const v of values) out[v] = 0;
  return out;
};

const asString = (v: unknown, max = 800): string => (typeof v === 'string' ? v.slice(0, max) : '');
const asStringArray = (v: unknown, maxItems = 20): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, maxItems).map((x) => x.slice(0, 500)) : [];

function sanitizeRefs(v: unknown): WorkReference[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).flatMap((r): WorkReference[] => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return [];
    const rec = r as Record<string, unknown>;
    const label = asString(rec.label, 160);
    if (!label) return [];
    const out: WorkReference = { label };
    const path = asString(rec.path, 500);
    const note = asString(rec.note, 500);
    if (path) out.path = path;
    if (note) out.note = note;
    return [out];
  });
}

export function validateWorkItem(raw: unknown): WorkValidationResult {
  if (raw === null || typeof raw !== 'object') return { ok: false, item: null, reason: 'not an object', droppedFields: [], findings: [] };
  if (!isPlainJsonShaped(raw)) return { ok: false, item: null, reason: 'work item must be plain JSON', droppedFields: [], findings: [] };

  const r = raw as Record<string, unknown>;
  const droppedFields = Object.keys(r).filter((k) => !WORK_ALLOWED_FIELDS.has(k));
  const findings = [...scanForbiddenKeys(r), ...scanForbiddenValues(r).map((p) => `value@${p}`)];
  if (findings.length) return { ok: false, item: null, reason: `forbidden content: ${findings.join(', ')}`, droppedFields, findings };

  const id = asString(r.id, 100);
  if (!SAFE_ID_RE.test(id)) return { ok: false, item: null, reason: 'id must be a safe stable identifier', droppedFields, findings };

  const status = STATUSES.has(r.status as WorkStatus) ? (r.status as WorkStatus) : undefined;
  const kind = KINDS.has(r.kind as WorkKind) ? (r.kind as WorkKind) : undefined;
  const risk = RISKS.has(r.risk as WorkRisk) ? (r.risk as WorkRisk) : undefined;
  const adoption = ADOPTIONS.has(r.adoption as WorkAdoption) ? (r.adoption as WorkAdoption) : undefined;
  const owner = AGENTS.has(r.owner as WorkAgent) ? (r.owner as WorkAgent) : undefined;
  if (!status || !kind || !risk || !adoption || !owner) return { ok: false, item: null, reason: 'status/kind/risk/adoption/owner enum required', droppedFields, findings };

  const createdAt = asString(r.createdAt, 10);
  const lastVerifiedAt = asString(r.lastVerifiedAt, 10);
  if (!SAFE_DATE_RE.test(createdAt) || !SAFE_DATE_RE.test(lastVerifiedAt)) return { ok: false, item: null, reason: 'createdAt and lastVerifiedAt must be YYYY-MM-DD', droppedFields, findings };

  const item: WorkTrackerItem = {
    id,
    title: asString(r.title, 160),
    status,
    kind,
    risk,
    stage: asString(r.stage, 80),
    source: asString(r.source, 120),
    owner,
    createdAt,
    lastVerifiedAt,
    summary: asString(r.summary),
    decision: asString(r.decision, 500),
    adoption,
    preconditions: asStringArray(r.preconditions),
    blockedBy: asStringArray(r.blockedBy),
    nextActions: asStringArray(r.nextActions),
    evidenceRefs: sanitizeRefs(r.evidenceRefs),
    sourceRefs: sanitizeRefs(r.sourceRefs),
    supersedes: asStringArray(r.supersedes, 20),
    deferredNotes: asStringArray(r.deferredNotes, 20),
    grantsAuthority: false,
    uiVisible: r.uiVisible !== false,
  };
  const supersededBy = asString(r.supersededBy, 100);
  if (supersededBy) item.supersededBy = supersededBy;

  if (!item.title || !item.stage || !item.source || !item.summary || !item.decision) return { ok: false, item: null, reason: 'title/stage/source/summary/decision required', droppedFields, findings };
  if ((status === 'done' || status === 'verified') && item.evidenceRefs.length === 0) return { ok: false, item: null, reason: 'done/verified items require evidenceRefs', droppedFields, findings };
  if (status === 'blocked' && item.blockedBy.length === 0) return { ok: false, item: null, reason: 'blocked items require blockedBy', droppedFields, findings };
  if (status === 'superseded' && !item.supersededBy) return { ok: false, item: null, reason: 'superseded items require supersededBy', droppedFields, findings };
  if ((risk === 'high' || risk === 'critical') && status !== 'done' && item.preconditions.length === 0) return { ok: false, item: null, reason: 'open high/critical items require preconditions', droppedFields, findings };
  if (adoption === 'live_apply_candidate' && status !== 'blocked') return { ok: false, item: null, reason: 'live apply candidates must stay blocked until separately approved', droppedFields, findings };

  return { ok: true, item, reason: 'ok', droppedFields, findings };
}

export function buildWorkTrackerBoard(items: WorkTrackerItem[], generatedAt: string): WorkTrackerBoard {
  const byStatus = emptyCounts([...STATUSES] as WorkStatus[]);
  const byKind = emptyCounts([...KINDS] as WorkKind[]);
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  for (const item of sorted) {
    byStatus[item.status] += 1;
    byKind[item.kind] += 1;
  }
  const open = sorted.filter((i) => !['done', 'verified', 'rejected', 'superseded'].includes(i.status));
  const uiItems = sorted.filter((i) => i.uiVisible).map(projectWorkItemForUi);
  return {
    generatedAt,
    total: sorted.length,
    byStatus,
    byKind,
    highRiskOpen: open.filter((i) => i.risk === 'high' || i.risk === 'critical').length,
    blocked: sorted.filter((i) => i.status === 'blocked'),
    now: sorted.filter((i) => i.status === 'active'),
    next: sorted.filter((i) => i.status === 'planned' || i.status === 'accepted'),
    parked: sorted.filter((i) => i.status === 'parked'),
    done: sorted.filter((i) => i.status === 'done' || i.status === 'verified'),
    uiItems,
    grantsAuthority: false,
  };
}

export function projectWorkItemForUi(item: WorkTrackerItem): WorkTrackerUiItem {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    kind: item.kind,
    risk: item.risk,
    stage: item.stage,
    owner: item.owner,
    decision: item.decision,
    blockedByCount: item.blockedBy.length,
    preconditionCount: item.preconditions.length,
    evidenceCount: item.evidenceRefs.length,
    nextActionCount: item.nextActions.length,
  };
}
