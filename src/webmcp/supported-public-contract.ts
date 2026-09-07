import {
  REPAIR_STATE_SCHEMA_V215,
  decodeRepairCaseStateV215,
  decodeRepairStateQuery,
  type RepairStateQuery,
} from './repair-state-v215.js';
/** Additive transport dispatch. Historical decoders remain the historical authority. */
import * as legacy from './public-contract.js';
import * as current from './public-contract-v0-3.js';
export * from './public-contract-v0-3.js';
export type GetCaseStateQuery = RepairStateQuery;
export interface CaseServicePort extends Omit<current.CaseServicePort, 'getCaseState'> {
  getCaseState(
    query: RepairStateQuery,
    options?: current.ServiceCallOptions,
  ): Promise<current.GetCaseStateResult>;
}

function isRepair(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schema_version' in value &&
    value.schema_version === REPAIR_STATE_SCHEMA_V215
  );
}

export function decodeCaseServiceHttpRequest(value: unknown): current.CaseServiceHttpRequest {
  if (
    value &&
    typeof value === 'object' &&
    'operation' in value &&
    value.operation === 'getCaseState' &&
    'input' in value
  ) {
    const query = decodeRepairStateQuery(value.input);
    const checked = current.decodeCaseServiceHttpRequest({
      ...value,
      input: query.case_id === undefined ? {} : { case_id: query.case_id },
    });
    return { ...checked, operation: 'getCaseState', input: query };
  }
  return current.decodeCaseServiceHttpRequest(value);
}

function isCurrent(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schema_version' in value &&
    value.schema_version === current.WEBMCP_CORE_SCHEMA_VERSION
  );
}

export function decodeCaseStateResponse(value: unknown): current.CaseStateResponse {
  if (isRepair(value)) return decodeRepairCaseStateV215(value);
  return isCurrent(value)
    ? current.decodeCaseStateResponse(value)
    : legacy.decodeCaseStateResponse(value);
}

export function decodeCaseServiceResult(
  operation: 'startCase',
  value: unknown,
): current.StartCaseResult;
export function decodeCaseServiceResult(
  operation: 'getCaseState',
  value: unknown,
): current.GetCaseStateResult;
export function decodeCaseServiceResult(
  operation: 'submitTurn',
  value: unknown,
): current.SubmitTurnResult;
export function decodeCaseServiceResult(
  operation: current.CaseServiceOperation,
  value: unknown,
): current.StartCaseResult | current.GetCaseStateResult | current.SubmitTurnResult;
export function decodeCaseServiceResult(
  operation: current.CaseServiceOperation,
  value: unknown,
): current.StartCaseResult | current.GetCaseStateResult | current.SubmitTurnResult {
  const caseValue =
    typeof value === 'object' && value !== null && 'case' in value ? value.case : null;
  if (isRepair(caseValue)) {
    const state = decodeRepairCaseStateV215(caseValue);
    const { own_repair_targets: _repair, ...common } = state;
    const body = {
      ...(value as object),
      case: { ...common, schema_version: current.WEBMCP_CORE_SCHEMA_VERSION },
    };
    const checked =
      operation === 'startCase'
        ? current.decodeCaseServiceResult('startCase', body)
        : operation === 'getCaseState'
          ? current.decodeCaseServiceResult('getCaseState', body)
          : current.decodeCaseServiceResult('submitTurn', body);
    return { ...checked, case: state };
  }
  const decoder = isCurrent(caseValue) ? current : legacy;
  switch (operation) {
    case 'startCase':
      return decoder.decodeCaseServiceResult('startCase', value);
    case 'getCaseState':
      return decoder.decodeCaseServiceResult('getCaseState', value);
    case 'submitTurn':
      return decoder.decodeCaseServiceResult('submitTurn', value);
  }
}
