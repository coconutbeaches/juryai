/**
 * The offline V0.4 compiler: the real compiler, with a scripted provider.
 *
 * The completion is selected by `compile_run_id`, which the V0.4 renderer emits
 * into the request and which is derived from the case id. Keying on the request
 * the compiler actually built — rather than passing the case in alongside —
 * means a renderer that stopped emitting the run id would break the offline run
 * loudly instead of silently replaying the wrong fixture.
 */

import { replayModelClient, type ScriptedSemanticModelClient } from '../compiler/replay-client.js';
import { ModelSemanticCompilerV04 } from '../compiler-v0-4/model-compiler.js';
import { compileRunId } from '../eval-v0-4/scenario.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';
import { OFFLINE_COMPLETIONS } from './offline-completions.js';
import { HOLDOUT_OFFLINE_COMPLETIONS } from './holdout-completions.js';

/** Primary and holdout fixtures share one lookup; ids never collide. */
const ALL_COMPLETIONS = { ...OFFLINE_COMPLETIONS, ...HOLDOUT_OFFLINE_COMPLETIONS };

const RUN_ID = /^compile_run_id: (\S+)$/m;

export function offlineCompletionsFor(
  cases: readonly SemanticEvalCaseV04[],
): ReadonlyMap<string, string> {
  const completions = new Map<string, string>();
  for (const item of cases) {
    const draft = ALL_COMPLETIONS[item.id];
    if (draft === undefined) {
      throw new TypeError(`no offline completion scripted for corpus case '${item.id}'`);
    }
    completions.set(compileRunId(item.id), JSON.stringify(draft));
  }
  return completions;
}

export function offlineClientFor(
  cases: readonly SemanticEvalCaseV04[],
): ScriptedSemanticModelClient {
  return replayModelClient(
    (request) => {
      const match = RUN_ID.exec(request.input);
      if (match === null) {
        throw new TypeError('rendered V0.4 input carries no compile_run_id; cannot replay');
      }
      return match[1] as string;
    },
    offlineCompletionsFor(cases),
    { provider_id: 'juryai.replay.v04' },
  );
}

export function createOfflineCompilerV04(
  cases: readonly SemanticEvalCaseV04[],
): ModelSemanticCompilerV04 {
  return new ModelSemanticCompilerV04({
    client: offlineClientFor(cases),
    model_id: 'offline-replay',
    model_snapshot: null,
    // A replayed completion never needs a retry, and allowing one would let a
    // scripting mistake be papered over by a second attempt.
    max_transient_retries: 0,
  });
}
