/**
 * The V0.4 holdout corpus.
 *
 * DELIBERATELY EMPTY UNTIL THE PRIMARY RUNS ARE GREEN. The holdout is authored
 * only after the primary corpus is frozen, the prompt candidate is final, and
 * two consecutive full primary live runs have passed — and the prompt is never
 * edited afterwards on the strength of what the holdout shows.
 *
 * The ordering is the whole value. If these cases existed while the prompt was
 * still moving, any prompt correction made after a failing primary run would be
 * made with holdout knowledge, and the holdout would stop being a held-out
 * measurement. An empty module that refuses to run is a smaller cost than a
 * holdout that silently became a second training set.
 *
 * `HOLDOUT_CORPUS_FROZEN_HASH` stays null until the cases are authored, and the
 * live command refuses to run a holdout that is empty or unfrozen.
 */

import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';

export const HOLDOUT_CORPUS_VERSION = 'juryai-semantic-eval-holdout-v0.4.0';

export const HOLDOUT_CORPUS: readonly SemanticEvalCaseV04[] = Object.freeze([]);

/** Set when the holdout is authored and frozen. Null means "not yet authored". */
export const HOLDOUT_CORPUS_FROZEN_HASH: string | null = null;
