import {
  buildCompileRunRecord as historicalRecord,
  registerCompilerVersion,
  type CompilerRegistryEntry,
} from '../webmcp/core-v0-3/compiler-contract.js';
import {
  COMPILER_CONTRACT_VERSION_V04,
  validateCompilerOutputForContractVersionV04,
} from '../webmcp/core-v0-4/compiler-contract.js';
import { V215_SPEC } from './generation-spec.js';

export const QUALIFIED_COMPILER_VERSION_ID =
  '7734c54aa9c85d0bde119db2be79f698416e120566d9186744c070582a76d71c';
export const COMPILER_CONTRACT_VERSION = COMPILER_CONTRACT_VERSION_V04;

export function assertQualifiedCompiler(entry: CompilerRegistryEntry): void {
  registerCompilerVersion([], entry);
  if (
    entry.compiler_version_id !== QUALIFIED_COMPILER_VERSION_ID ||
    entry.version.schema_version !== V215_SPEC.compiler.contract_version
  ) {
    throw new TypeError('V2.1.5 requires the qualified V0.4 compiler artifact.');
  }
}

/** Retain the historical record shape/hashing, with explicit V0.4 validation. */
export const buildCompileRunRecord: typeof historicalRecord = (
  input,
  output,
  timing,
  contract = COMPILER_CONTRACT_VERSION,
) => {
  const record = historicalRecord(input, output, timing, contract);
  record.contract_issues = validateCompilerOutputForContractVersionV04(
    record.input,
    record.output,
    contract,
  );
  return record;
};
