import { relay } from './engine.js';
export const prepareExternalRelaySubmissionV215 = relay.prepareExternalRelaySubmission;
export const rebaseExternalRelaySubmissionV215 = relay.rebaseExternalRelaySubmission;
export const applyExternalRelaySubmissionV215 = relay.applyExternalRelaySubmission;
export const conflictTurnSummariesForPartyV215 = relay.conflictTurnSummariesForParty;
export type { PartyViewCursorRefresh as PartyViewCursorRefreshV215 } from '../formation/relay-submission.js';
export type { ExternalRelaySubmissionIntent as ExternalRelaySubmissionIntentV215 } from '../formation/relay-submission.js';
export type { SemanticAssertionCandidateEffect as SemanticAssertionCandidateEffectV215 } from '../formation/relay-submission.js';
export type { ClarificationRequestEffect as ClarificationRequestEffectV215 } from '../formation/relay-submission.js';
export type { ChallengeCandidateEffect as ChallengeCandidateEffectV215 } from '../formation/relay-submission.js';
export type { ChallengeResponseCandidateEffect as ChallengeResponseCandidateEffectV215 } from '../formation/relay-submission.js';
export type { ExternalRelayEffectCandidate as ExternalRelayEffectCandidateV215 } from '../formation/relay-submission.js';
export type { PreparedSemanticAssertionEffect as PreparedSemanticAssertionEffectV215 } from '../formation/relay-submission.js';
export type { PreparedClarificationRequestEffect as PreparedClarificationRequestEffectV215 } from '../formation/relay-submission.js';
export type { PreparedChallengeEffect as PreparedChallengeEffectV215 } from '../formation/relay-submission.js';
export type { PreparedChallengeResponseEffect as PreparedChallengeResponseEffectV215 } from '../formation/relay-submission.js';
export type { PreparedExternalRelayEffect as PreparedExternalRelayEffectV215 } from '../formation/relay-submission.js';
export type { ExternalRelayCompilerIdentity as ExternalRelayCompilerIdentityV215 } from '../formation/relay-submission.js';
export type { ExternalRelaySubmission as ExternalRelaySubmissionV215 } from '../formation/relay-submission.js';
export const TRUSTED_EXTERNAL_RELAY_BRIDGE_V215 = relay.bridge;
export const trustedExternalRelayRuntimeV215 = relay.mintRuntime;
export type { ExternalRelayCanonicalIds as ExternalRelayCanonicalIdsV215 } from '../formation/relay-runtime.js';
export type { TrustedExternalRelayBridge as TrustedExternalRelayBridgeV215 } from '../formation/relay-runtime.js';
export type { TrustedExternalRelayRuntime as TrustedExternalRelayRuntimeV215 } from '../formation/relay-runtime.js';

export type ExternalRelaySubmissionFailureReasonV215 = Extract<
  ReturnType<typeof relay.applyExternalRelaySubmission>,
  { status: 'rejected' }
>['reason_code'];
