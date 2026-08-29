/**
 * The semantic compiler boundary.
 *
 * The runtime never lets a compiler touch canonical state. A compiler receives
 * a `CompilerInput` and returns a `CompilerOutput`; everything after that —
 * id minting, supersession, clarification opening, version movement — is the
 * runtime's, and every output is checked against the core contract before any
 * of it happens.
 *
 * Obligations on any implementation, restated here because a future model
 * adapter will be written against this file and not against the core:
 *
 *  - Echo `compile_run_id` and `compiler_version_id` from the input. They are
 *    independent: the run identifies one execution, the version identifies the
 *    prompt/config/model artefact that executed.
 *  - Every assertion must cite at least one exact span in the ANSWER region of
 *    the supplied turn. Assertions grounded only in relayed assistant context
 *    are assertions about the relay's words, not the user's.
 *  - Fail closed. If the reading is not determinate — including "is this a
 *    correction, a refinement, or a genuine inconsistency?" — emit verdict
 *    `ambiguous` with a clarification, not a guess. An `ambiguous` verdict may
 *    carry no assertions at all.
 *  - Consequently, an accepted assertion carrying `supersedes_candidate` is a
 *    positive claim that the named proposition is REPLACED by this one. The
 *    runtime records that structural link and does not itself classify the
 *    relationship; a compiler that cannot make that call must go ambiguous.
 *  - `no_assertions` means the answer carried nothing canonical. It must never
 *    be used to manufacture a proposition that closes a requirement.
 */

import type {
  CompilerInput,
  CompilerOutput,
  CompilerRegistryEntry,
} from '../core/compiler-contract.js';

export interface CompileOptions {
  signal?: AbortSignal;
}

export interface SemanticCompilerPort {
  /**
   * The reproducible artefact for this compiler: prompt text, config and the
   * version hash over them. The runtime registers it, so a stored compile run
   * can be re-executed rather than merely identified.
   */
  readonly registryEntry: CompilerRegistryEntry;
  compile(input: CompilerInput, options?: CompileOptions): Promise<CompilerOutput>;
}
