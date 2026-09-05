/**
 * Cross-generation compatibility constants.
 *
 * These are NOT generation values and must never be copied into a
 * GenerationSpec. Each one deliberately carries an older version number than
 * the generation it is used by, and each one would break something real if a
 * future generation "corrected" it to match its own version.
 *
 * Every value here is load-bearing precisely because it does NOT move.
 */

/**
 * HMAC domain for the deterministic production start identity.
 *
 * A `start_case` identity is derived from this domain plus the authenticated
 * subject and the client request id. It has read `v2.1.2` since V2.1.2 and has
 * been carried unchanged through V2.1.3 and V2.1.4 on purpose: the identity
 * must be STABLE ACROSS GENERATIONS so that a retry of a start which already
 * created a V2.1.2 or V2.1.3 dispute resolves to that dispute instead of
 * minting a duplicate in the current generation.
 *
 * Regenerating this per generation would silently create twin disputes for
 * every retried start, splitting a live case in two. It is not stale.
 */
export const PRODUCTION_START_IDENTITY_DOMAIN = 'juryai-v2.1.2-production-start';

/**
 * Rollout kill switch for the two-party production flow.
 *
 * Named for V2.1.2 because that is when the flow was activated. It gates the
 * current writer regardless of generation, and renaming it is a deployment
 * concern — environment configuration, not case semantics. Treated as
 * historical cosmetic debt and deliberately left alone.
 */
export const PRODUCTION_ENABLED_ENV_VAR = 'JURYAI_V212_PRODUCTION_ENABLED';

/**
 * Every compatibility constant, for the isolation guards that assert no
 * GenerationSpec and no engine module redeclares one of these values.
 */
export const FORMATION_COMPATIBILITY_CONSTANTS = Object.freeze([
  PRODUCTION_START_IDENTITY_DOMAIN,
  PRODUCTION_ENABLED_ENV_VAR,
] as const);
