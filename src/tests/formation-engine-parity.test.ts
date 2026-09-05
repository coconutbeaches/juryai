/**
 * PR 8C0a — byte-identical parity between the frozen V2.1.4 implementation and
 * the shared future engine driven by the test-only V2.1.4 spec.
 *
 * Both sides receive the SAME caller-supplied identifiers and timestamps, and
 * outputs are compared without any post-hoc normalisation. Every canonical
 * identifier on the surfaces exercised here is caller-supplied, so no clock,
 * salt or RNG injection is needed; generated values live in relay-submission,
 * which is PR 8C0b.
 *
 * The end-to-end script uses NON-required requirements so the ceremony can be
 * driven all the way to reopen without recording positions — recording a
 * position requires relay-submission, which this PR deliberately does not
 * touch. A separate suite uses required requirements to prove the blocked
 * paths reject with identical reason codes.
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '../v2/case-envelope.js';

// --- frozen V2.1.4 (reference implementation) ---
import {
  TRUSTED_SYSTEM_AUTHORITY_V214,
  hashCaseEnvelopeV214,
  partyAuthorityV214,
  type CaseEnvelopeV214,
  type FormationRequirementV214,
  type PartyIdV214,
} from '../v2-1-4/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV214,
  ceremonyCommandForV214,
  createInitialCaseEnvelopeV214,
  type EnvelopeCeremonyOperationV214,
} from '../v2-1-4/envelope-ceremony.js';
import {
  derivePartyIndependentFormationCompleteV214,
  evaluatePartyFormationRequirementsV214,
} from '../v2-1-4/formation-requirements.js';
import {
  authoritativeFormationExplanatoryStateV214,
  deriveFormationReadinessV214,
} from '../v2-1-4/formation-readiness.js';
import {
  hashPartyFormationProjectionV214,
  projectPartyFormationV214,
  renderPartyFormationReadbackV214,
} from '../v2-1-4/party-projection.js';
import {
  currentDisclosureReviewAcknowledgmentV214,
  disclosureReviewClosureCurrentV214,
} from '../v2-1-4/disclosure-review.js';

// --- shared future engine ---
import {
  hashCaseEnvelope,
  partyAuthority,
  trustedSystemAuthority,
  type CaseEnvelope,
} from '../formation/envelope.js';
import { createFormationCeremony } from '../formation/ceremony.js';
import {
  derivePartyIndependentFormationComplete,
  evaluatePartyFormationRequirements,
} from '../formation/requirements.js';
import {
  authoritativeFormationExplanatoryState,
  deriveFormationReadiness,
} from '../formation/readiness.js';
import {
  hashPartyFormationProjection,
  projectPartyFormation,
  renderPartyFormationReadback,
} from '../formation/projection.js';
import {
  currentDisclosureReviewAcknowledgment,
  disclosureReviewClosureCurrent,
} from '../formation/disclosure-review.js';
import { V214_PARITY_SPEC, v214ValidatorAdapter } from './formation-v214-parity-spec.js';

const spec = V214_PARITY_SPEC;
const engine = createFormationCeremony({ spec, validator: v214ValidatorAdapter });

/** Identical literal identifiers for both sides. Never randomised. */
const CASE_ID = 'dispute_parity_0f583dff3897dc0209e548b52882a60eba215d71';
const SUBJECT_A = 'supabase:parity_subject_a';
const SUBJECT_B = 'supabase:parity_subject_b';
const IDS = {
  bind_a: 'binding_party_a_parity_0001',
  bind_b: 'binding_party_b_parity_0001',
  cmd_bind_a: 'command_parity_bind_a',
  cmd_bind_b: 'command_parity_bind_b',
  cmd_disclose: 'command_parity_disclose',
  cmd_ack_a: 'command_parity_ack_a',
  cmd_ack_b: 'command_parity_ack_b',
  cmd_final: 'command_parity_final',
  cmd_confirm_a: 'command_parity_confirm_a',
  cmd_reopen_a: 'command_parity_reopen_a',
  ack_a: 'disclosure_ack_party_a_parity_0001',
  ack_a_event: 'disclosure_ack_event_party_a_parity_0001',
  ack_b: 'disclosure_ack_party_b_parity_0001',
  ack_b_event: 'disclosure_ack_event_party_b_parity_0001',
  confirm_a: 'confirmation_party_a_parity_0001',
  confirm_a_event: 'confirmation_event_party_a_parity_0001',
  reopen_a_event: 'reopen_event_party_a_parity_0001',
} as const;
const ACKED_AT = '2026-09-05T00:00:00.000Z';
const CONFIRMED_AT = '2026-09-05T00:05:00.000Z';
const REOPENED_AT = '2026-09-05T00:10:00.000Z';
const ADOPTION = 'I adopt this exact account as my statement of the dispute.';

/**
 * Cardinality rule: `min_propositions` must be >= 1 when `required` is true.
 * The end-to-end script therefore uses NON-required requirements, which are
 * satisfiable with no positions, so the ceremony is reachable without
 * relay-submission (PR 8C0b). A separate suite below uses REQUIRED
 * requirements to prove the blocked paths reject identically.
 */
function requirement(id: string, required = false): Omit<FormationRequirementV214, 'party_id'> {
  return {
    requirement_id: id,
    label: id,
    prompt: `Parity prompt for ${id}.`,
    required,
    satisfying_types: ['narrative_fact'],
    min_propositions: required ? 1 : 0,
    max_propositions: null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}
const INITIAL = {
  party_a: [requirement('req_parity_a_one'), requirement('req_parity_a_two')],
  party_b: [requirement('req_parity_b_one')],
};
/** Required variants: formation cannot complete without recorded positions. */
const INITIAL_REQUIRED = {
  party_a: [requirement('req_parity_a_one', true)],
  party_b: [requirement('req_parity_b_one', true)],
};

function frozenApply(
  envelope: CaseEnvelopeV214,
  commandId: string,
  operation: EnvelopeCeremonyOperationV214,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV214>[0]['execution_authority'],
) {
  return applyEnvelopeCeremonyCommandV214({
    envelope,
    command: ceremonyCommandForV214(envelope, commandId, operation),
    execution_authority: authority,
  });
}
function engineApply(
  envelope: CaseEnvelope,
  commandId: string,
  operation: Parameters<typeof engine.ceremonyCommandFor>[2],
  authority: Parameters<typeof engine.applyEnvelopeCeremonyCommand>[0]['execution_authority'],
) {
  return engine.applyEnvelopeCeremonyCommand({
    envelope,
    command: engine.ceremonyCommandFor(envelope, commandId, operation),
    execution_authority: authority,
  });
}

const frozenSystem = TRUSTED_SYSTEM_AUTHORITY_V214;
const engineSystem = trustedSystemAuthority(spec.authority.trusted_system_authority_kind);

/** Drives both implementations through the identical script, in lockstep. */
function runBoth() {
  let a: CaseEnvelopeV214 = createInitialCaseEnvelopeV214(CASE_ID, INITIAL as never);
  let b: CaseEnvelope = engine.createInitialCaseEnvelope(CASE_ID, INITIAL as never);
  const steps: { label: string; a: string; b: string }[] = [];
  const record = (label: string) =>
    steps.push({ label, a: canonicalSerialize(a as never), b: canonicalSerialize(b as never) });
  record('initial_envelope');

  const bind = (slot: PartyIdV214, subject: string, eventId: string, commandId: string) => {
    const op = {
      type: 'bind_party' as const,
      party_slot: slot,
      authenticated_subject_id: subject,
      binding_event_id: eventId,
    };
    const ra = frozenApply(a, commandId, op, frozenSystem);
    const rb = engineApply(b, commandId, op as never, engineSystem);
    expect(ra.status).toBe('applied');
    expect(rb.status).toBe('applied');
    if (ra.status !== 'applied' || rb.status !== 'applied') throw new Error('bind failed');
    a = ra.envelope;
    b = rb.envelope;
    record(`bind_${slot}`);
  };
  bind('party_a', SUBJECT_A, IDS.bind_a, IDS.cmd_bind_a);
  bind('party_b', SUBJECT_B, IDS.bind_b, IDS.cmd_bind_b);

  const disclose = { type: 'open_controlled_disclosure' as const };
  const da = frozenApply(a, IDS.cmd_disclose, disclose, frozenSystem);
  const db = engineApply(b, IDS.cmd_disclose, disclose as never, engineSystem);
  expect(da.status).toBe('applied');
  expect(db.status).toBe('applied');
  if (da.status !== 'applied' || db.status !== 'applied') throw new Error('disclosure failed');
  a = da.envelope;
  b = db.envelope;
  record('controlled_disclosure');

  const ack = (party: PartyIdV214, id: string, eventId: string, commandId: string) => {
    const op = {
      type: 'record_disclosure_review_acknowledgment' as const,
      acknowledgment_id: id,
      event_id: eventId,
      acknowledged_at: ACKED_AT,
    };
    const ra = frozenApply(a, commandId, op, partyAuthorityV214(a, party, 'first_party_human'));
    const rb = engineApply(
      b,
      commandId,
      op as never,
      partyAuthority(b, party, 'first_party_human'),
    );
    expect(ra.status, `frozen ack ${party}`).toBe('applied');
    expect(rb.status, `engine ack ${party}`).toBe('applied');
    if (ra.status !== 'applied' || rb.status !== 'applied') throw new Error('ack failed');
    a = ra.envelope;
    b = rb.envelope;
    record(`disclosure_ack_${party}`);
  };
  ack('party_a', IDS.ack_a, IDS.ack_a_event, IDS.cmd_ack_a);
  ack('party_b', IDS.ack_b, IDS.ack_b_event, IDS.cmd_ack_b);

  const final = { type: 'enter_final_confirmation' as const };
  const fa = frozenApply(a, IDS.cmd_final, final, frozenSystem);
  const fb = engineApply(b, IDS.cmd_final, final as never, engineSystem);
  expect(fa.status).toBe('applied');
  expect(fb.status).toBe('applied');
  if (fa.status !== 'applied' || fb.status !== 'applied') throw new Error('final failed');
  a = fa.envelope;
  b = fb.envelope;
  record('enter_final_confirmation');

  const confirm = {
    type: 'record_party_confirmation' as const,
    confirmation_id: IDS.confirm_a,
    event_id: IDS.confirm_a_event,
    adoption_statement: ADOPTION,
    confirmed_at: CONFIRMED_AT,
  };
  const ca = frozenApply(
    a,
    IDS.cmd_confirm_a,
    confirm,
    partyAuthorityV214(a, 'party_a', 'first_party_human'),
  );
  const cb = engineApply(
    b,
    IDS.cmd_confirm_a,
    confirm as never,
    partyAuthority(b, 'party_a', 'first_party_human'),
  );
  expect(ca.status).toBe('applied');
  expect(cb.status).toBe('applied');
  if (ca.status !== 'applied' || cb.status !== 'applied') throw new Error('confirm failed');
  a = ca.envelope;
  b = cb.envelope;
  record('party_a_confirmation');

  const reopen = {
    type: 'reopen_own_formation' as const,
    event_id: IDS.reopen_a_event,
    reason: 'Parity reopen: the account needs an addition.',
    occurred_at: REOPENED_AT,
  };
  const ra = frozenApply(
    a,
    IDS.cmd_reopen_a,
    reopen,
    partyAuthorityV214(a, 'party_a', 'first_party_human'),
  );
  const rb = engineApply(
    b,
    IDS.cmd_reopen_a,
    reopen as never,
    partyAuthority(b, 'party_a', 'first_party_human'),
  );
  expect(ra.status).toBe('applied');
  expect(rb.status).toBe('applied');
  if (ra.status !== 'applied' || rb.status !== 'applied') throw new Error('reopen failed');
  a = ra.envelope;
  b = rb.envelope;
  record('party_a_reopen');

  return { a, b, steps };
}

describe('PR 8C0a: shared engine reproduces frozen V2.1.4 byte-for-byte', () => {
  const { a, b, steps } = runBoth();

  it.each(steps.map((s) => s.label))('canonical envelope is identical after %s', (label) => {
    const step = steps.find((s) => s.label === label)!;
    expect(step.b).toBe(step.a);
  });

  it('produces an identical envelope hash at every step', () => {
    // Recomputed from the serialized state captured in lockstep above.
    expect(hashCaseEnvelope(b)).toBe(hashCaseEnvelopeV214(a));
  });

  it.each(['party_a', 'party_b'] as const)('projects %s identically', (party) => {
    expect(canonicalSerialize(projectPartyFormation(spec, b, party) as never)).toBe(
      canonicalSerialize(projectPartyFormationV214(a, party as PartyIdV214) as never),
    );
    expect(hashPartyFormationProjection(spec, b, party)).toBe(
      hashPartyFormationProjectionV214(a, party as PartyIdV214),
    );
  });

  it.each(['party_a', 'party_b'] as const)('renders the %s readback identically', (party) => {
    const engineReadback = renderPartyFormationReadback(spec, b, party);
    const frozenReadback = renderPartyFormationReadbackV214(a, party as PartyIdV214);
    expect(engineReadback.document).toBe(frozenReadback.document);
    expect(engineReadback.document_hash).toBe(frozenReadback.document_hash);
    expect(engineReadback.party_projection_hash).toBe(frozenReadback.party_projection_hash);
  });

  it.each(['party_a', 'party_b'] as const)('evaluates %s requirements identically', (party) => {
    expect(canonicalSerialize(evaluatePartyFormationRequirements(b, party) as never)).toBe(
      canonicalSerialize(evaluatePartyFormationRequirementsV214(a, party as PartyIdV214) as never),
    );
    expect(derivePartyIndependentFormationComplete(b, party)).toBe(
      derivePartyIndependentFormationCompleteV214(a, party as PartyIdV214),
    );
  });

  it('derives identical readiness and explanatory state', () => {
    expect(canonicalSerialize(deriveFormationReadiness(spec, b) as never)).toBe(
      canonicalSerialize(deriveFormationReadinessV214(a) as never),
    );
    expect(canonicalSerialize(authoritativeFormationExplanatoryState(spec, b) as never)).toBe(
      canonicalSerialize(authoritativeFormationExplanatoryStateV214(a) as never),
    );
  });

  it('derives identical disclosure-review state', () => {
    expect(disclosureReviewClosureCurrent(spec, b)).toBe(disclosureReviewClosureCurrentV214(a));
    for (const party of ['party_a', 'party_b'] as const) {
      expect(
        canonicalSerialize(currentDisclosureReviewAcknowledgment(spec, b, party) as never),
      ).toBe(
        canonicalSerialize(
          currentDisclosureReviewAcknowledgmentV214(a, party as PartyIdV214) as never,
        ),
      );
    }
  });

  it('stamps the generation identifiers from the spec, not from hardcoded literals', () => {
    expect(b.control.schema_version).toBe('juryai-case-envelope-v2.1.4');
    expect(b.control.protocol_version).toBe('juryai-formation-protocol-v2.1.4');
    expect(b.control.command_contract_version).toBe('juryai-envelope-command-v2.1.4');
    expect(b.control.projection_contract_version).toBe('juryai-party-formation-projection-v2.1.4');
    expect(b.control.readiness_contract_version).toBe('juryai-formation-readiness-v2.1.4');
    expect(b.control.external_submission_contract_version).toBe(
      'juryai-external-relay-submission-v2.1.4',
    );
  });
});

describe('PR 8C0a: ceremony-level rejections match reason code for reason code', () => {
  const freshFrozen = () => createInitialCaseEnvelopeV214(CASE_ID, INITIAL as never);
  const freshEngine = () => engine.createInitialCaseEnvelope(CASE_ID, INITIAL as never);

  it('rejects disclosure before both parties are bound, with the same reason', () => {
    const op = { type: 'open_controlled_disclosure' as const };
    const ra = frozenApply(freshFrozen(), IDS.cmd_disclose, op, frozenSystem);
    const rb = engineApply(freshEngine(), IDS.cmd_disclose, op as never, engineSystem);
    expect(ra.status).toBe('rejected');
    expect(rb.status).toBe('rejected');
    if (ra.status !== 'rejected' || rb.status !== 'rejected') throw new Error('expected rejection');
    expect(rb.reason_code).toBe(ra.reason_code);
    expect(rb.message).toBe(ra.message);
  });

  it('rejects a party acknowledgment before disclosure, with the same reason', () => {
    let a = freshFrozen();
    let b = freshEngine();
    for (const [slot, subject, eventId, commandId] of [
      ['party_a', SUBJECT_A, IDS.bind_a, IDS.cmd_bind_a],
      ['party_b', SUBJECT_B, IDS.bind_b, IDS.cmd_bind_b],
    ] as const) {
      const op = {
        type: 'bind_party' as const,
        party_slot: slot,
        authenticated_subject_id: subject,
        binding_event_id: eventId,
      };
      const ra = frozenApply(a, commandId, op, frozenSystem);
      const rb = engineApply(b, commandId, op as never, engineSystem);
      if (ra.status !== 'applied' || rb.status !== 'applied') throw new Error('bind failed');
      a = ra.envelope;
      b = rb.envelope;
    }
    const op = {
      type: 'record_disclosure_review_acknowledgment' as const,
      acknowledgment_id: IDS.ack_a,
      event_id: IDS.ack_a_event,
      acknowledged_at: ACKED_AT,
    };
    const ra = frozenApply(
      a,
      IDS.cmd_ack_a,
      op,
      partyAuthorityV214(a, 'party_a', 'first_party_human'),
    );
    const rb = engineApply(
      b,
      IDS.cmd_ack_a,
      op as never,
      partyAuthority(b, 'party_a', 'first_party_human'),
    );
    expect(ra.status).toBe('rejected');
    expect(rb.status).toBe('rejected');
    if (ra.status !== 'rejected' || rb.status !== 'rejected') throw new Error('expected rejection');
    expect(rb.reason_code).toBe(ra.reason_code);
    expect(rb.message).toBe(ra.message);
  });

  it('rejects a party operation carried by system authority, with the same reason', () => {
    const a = freshFrozen();
    const b = freshEngine();
    const op = {
      type: 'reopen_own_formation' as const,
      event_id: IDS.reopen_a_event,
      reason: 'No binding yet.',
      occurred_at: REOPENED_AT,
    };
    const ra = frozenApply(a, IDS.cmd_reopen_a, op, frozenSystem);
    const rb = engineApply(b, IDS.cmd_reopen_a, op as never, engineSystem);
    expect(ra.status).toBe('rejected');
    expect(rb.status).toBe('rejected');
    if (ra.status !== 'rejected' || rb.status !== 'rejected') throw new Error('expected rejection');
    expect(rb.reason_code).toBe(ra.reason_code);
    expect(rb.message).toBe(ra.message);
  });

  it('rejects disclosure while a required requirement is unsatisfied, identically', () => {
    let a = createInitialCaseEnvelopeV214(CASE_ID, INITIAL_REQUIRED as never);
    let b = engine.createInitialCaseEnvelope(CASE_ID, INITIAL_REQUIRED as never);
    for (const [slot, subject, eventId, commandId] of [
      ['party_a', SUBJECT_A, IDS.bind_a, IDS.cmd_bind_a],
      ['party_b', SUBJECT_B, IDS.bind_b, IDS.cmd_bind_b],
    ] as const) {
      const op = {
        type: 'bind_party' as const,
        party_slot: slot,
        authenticated_subject_id: subject,
        binding_event_id: eventId,
      };
      const ra = frozenApply(a, commandId, op, frozenSystem);
      const rb = engineApply(b, commandId, op as never, engineSystem);
      if (ra.status !== 'applied' || rb.status !== 'applied') throw new Error('bind failed');
      a = ra.envelope;
      b = rb.envelope;
    }
    // Both parties bound, but neither formation is complete.
    expect(derivePartyIndependentFormationCompleteV214(a, 'party_a')).toBe(false);
    expect(derivePartyIndependentFormationComplete(b, 'party_a')).toBe(false);
    const op = { type: 'open_controlled_disclosure' as const };
    const ra = frozenApply(a, IDS.cmd_disclose, op, frozenSystem);
    const rb = engineApply(b, IDS.cmd_disclose, op as never, engineSystem);
    expect(ra.status).toBe('rejected');
    expect(rb.status).toBe('rejected');
    if (ra.status !== 'rejected' || rb.status !== 'rejected') throw new Error('expected rejection');
    expect(rb.reason_code).toBe(ra.reason_code);
    expect(rb.message).toBe(ra.message);
  });

  it('rejects an unknown dispute id shape identically', () => {
    expect(() => createInitialCaseEnvelopeV214('not_a_dispute', INITIAL as never)).toThrow();
    expect(() => engine.createInitialCaseEnvelope('not_a_dispute', INITIAL as never)).toThrow();
  });
});

describe('PR 8C0a: the parity spec is the only source of generation values', () => {
  it('rejects a spec carrying a cross-generation compatibility constant', () => {
    expect(() =>
      createFormationCeremony({
        spec: {
          ...spec,
          identity: { ...spec.identity, generation_id: 'juryai-v2.1.2-production-start' },
        },
        validator: v214ValidatorAdapter,
      }),
    ).toThrow(/compatibility constant/u);
  });

  it('rejects a spec whose persisted pairing disagrees with its contracts', () => {
    expect(() =>
      createFormationCeremony({
        spec: {
          ...spec,
          persistence: {
            contract_pair: {
              ...spec.persistence.contract_pair,
              command_version: 'juryai-envelope-command-v2.1.3',
            },
          },
        },
        validator: v214ValidatorAdapter,
      }),
    ).toThrow(/disagrees with the contract/u);
  });
});
