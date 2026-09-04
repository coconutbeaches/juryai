/** Additive transport dispatch. Historical decoders remain the historical authority. */
import * as legacy from './public-contract.js';
import * as current from './public-contract-v0-3.js';
export * from './public-contract-v0-3.js';

function isCurrent(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schema_version' in value &&
    value.schema_version === current.WEBMCP_CORE_SCHEMA_VERSION
  );
}

export function decodeCaseStateResponse(value: unknown): current.CaseStateResponse {
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
