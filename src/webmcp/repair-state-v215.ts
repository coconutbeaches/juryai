import * as base from './public-contract-v0-3.js';
// Browser-safe copies of the established case-data delimiters. The core module
// has Node dependencies and must not enter this public decoder graph.
const AGENT_DATA_BLOCK_OPEN = '<<<JURYAI_CASE_DATA';
const AGENT_DATA_BLOCK_CLOSE = 'JURYAI_CASE_DATA>>>';

export const REPAIR_STATE_SCHEMA_V215 = 'juryai-webmcp-v2.1.5-repair-state-v1';
export const OWN_REPAIR_PAGE_SIZE = 50;
// Match the independent V2.1.5 review boundary; never silently truncate a target.
const OWN_STATEMENT_LIMIT = 50_000;
export function wrapOwnRepairStatement(text: string): string {
  if (!text || text.length > OWN_STATEMENT_LIMIT)
    throw new TypeError('Own repair statement exceeds its bound.');
  const content = text.split(AGENT_DATA_BLOCK_OPEN).join('').split(AGENT_DATA_BLOCK_CLOSE).join('');
  return `${AGENT_DATA_BLOCK_OPEN}\n${content}\n${AGENT_DATA_BLOCK_CLOSE}`;
}
export interface OwnPositionCursor {
  party_visible_version: number;
  after_position_id: string;
}
export interface RepairStateQuery extends base.GetCaseStateQuery {
  own_position_cursor?: OwnPositionCursor;
}
export interface RepairCaseStateV215 extends base.CaseStateResponse {
  own_repair_targets: {
    party_id: 'party_a' | 'party_b';
    requirements: base.NextRequirementSlot[];
    positions: base.RecentInterpretationSlot[];
    next_cursor: OwnPositionCursor | null;
  };
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  )
    throw new TypeError('Invalid repair state shape.');
  return value as Record<string, unknown>;
}
export function decodeOwnPositionCursor(value: unknown): OwnPositionCursor {
  const cursor = object(value, ['party_visible_version', 'after_position_id']);
  if (
    !Number.isSafeInteger(cursor.party_visible_version) ||
    (cursor.party_visible_version as number) < 1 ||
    typeof cursor.after_position_id !== 'string' ||
    cursor.after_position_id.length > 160 ||
    !base.ID_PATTERN.test(cursor.after_position_id)
  )
    throw new TypeError('Invalid own-position cursor.');
  return cursor as unknown as OwnPositionCursor;
}
export function decodeRepairStateQuery(value: unknown): RepairStateQuery {
  if (value && typeof value === 'object' && 'own_position_cursor' in value) {
    const query = object(value, ['case_id', 'own_position_cursor']);
    if (typeof query.case_id !== 'string') throw new TypeError('A cursor requires a case ID.');
    return {
      ...base.decodeGetCaseStateQuery({ case_id: query.case_id }),
      own_position_cursor: decodeOwnPositionCursor(query.own_position_cursor),
    };
  }
  return base.decodeGetCaseStateQuery(value);
}
export function decodeRepairCaseStateV215(value: unknown): RepairCaseStateV215 {
  const state = object(value, [...base.PERMITTED_CASE_STATE_SLOTS, 'own_repair_targets']);
  if (
    state.schema_version !== REPAIR_STATE_SCHEMA_V215 ||
    typeof state.case_id !== 'string' ||
    !state.case_id.startsWith('dispute_')
  )
    throw new TypeError('Invalid V2.1.5 repair state.');
  const { own_repair_targets: raw, ...common } = state;
  const decoded = base.decodeCaseStateResponse({
    ...common,
    schema_version: base.WEBMCP_CORE_SCHEMA_VERSION,
  });
  const page = object(raw, ['party_id', 'requirements', 'positions', 'next_cursor']);
  if (page.party_id !== 'party_a' && page.party_id !== 'party_b')
    throw new TypeError('Invalid repair party.');
  if (
    !Array.isArray(page.positions) ||
    page.positions.length > OWN_REPAIR_PAGE_SIZE ||
    !Array.isArray(page.requirements) ||
    page.requirements.length > 100
  )
    throw new TypeError('Repair page exceeds its bound.');
  const statements = page.positions.map((position) => {
    if (!position || typeof position !== 'object' || Array.isArray(position))
      throw new TypeError('Invalid own repair position.');
    const statement = (position as Record<string, unknown>).statement;
    if (
      typeof statement !== 'string' ||
      !statement.length ||
      statement.length >
        OWN_STATEMENT_LIMIT + AGENT_DATA_BLOCK_OPEN.length + AGENT_DATA_BLOCK_CLOSE.length + 2
    )
      throw new TypeError('Invalid own repair statement.');
    return statement;
  });
  // Reuse historical slot shape/ID validators; only this versioned page permits
  // complete statements up to the existing V2.1.5 independent-review bound.
  const slots = base.decodeCaseStateResponse({
    ...decoded,
    recent_interpretations: page.positions.map((position) => ({
      ...position,
      statement: 'validated own statement',
    })),
    next_requirements: page.requirements,
  });
  const requirements = new Set(slots.next_requirements.map((r) => r.requirement_id));
  if (
    requirements.size !== slots.next_requirements.length ||
    [...requirements].some((id) => !id.startsWith(`req_${page.party_id}_`))
  )
    throw new TypeError('Repair requirement scope is invalid.');
  const ids = slots.recent_interpretations.map((p) => p.proposition_id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some(
      (id, i) => !id.startsWith(`position_${page.party_id}_`) || (i > 0 && ids[i - 1]! >= id),
    ) ||
    slots.recent_interpretations.some((p) => !requirements.has(p.requirement_id))
  )
    throw new TypeError('Repair position scope/order is invalid.');
  const next = page.next_cursor === null ? null : decodeOwnPositionCursor(page.next_cursor);
  if (
    next &&
    (next.party_visible_version !== decoded.case_version ||
      ids.length !== OWN_REPAIR_PAGE_SIZE ||
      next.after_position_id !== ids.at(-1))
  )
    throw new TypeError('Repair cursor does not bind this page.');
  return {
    ...decoded,
    schema_version: REPAIR_STATE_SCHEMA_V215,
    own_repair_targets: {
      party_id: page.party_id,
      requirements: slots.next_requirements,
      positions: slots.recent_interpretations.map((position, index) => ({
        ...position,
        statement: statements[index]!,
      })),
      next_cursor: next,
    },
  };
}
