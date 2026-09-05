/**
 * Shared, spec-driven case-envelope contract validator.
 *
 * Extracted from `src/v2-1-4/contract-validator.ts`, which remains the frozen
 * behavioural reference and continues to serve every production V2.1.4
 * dispute. Nothing outside `src/tests/` imports this module in PR 8C0b-1.
 *
 * The extraction changes exactly three things and nothing else:
 *
 *  - every generation-scoped literal now comes from a ValidatedGenerationSpec;
 *  - every contract-issue code is composed from the spec's explicit prefix and
 *    a fixed suffix, never from a transformation of the generation id;
 *  - the live-position slot rule reads `spec.policy.proposition_cardinality`,
 *    and refuses any value it does not implement.
 *
 * Everything else — rule order, issue order, paths, messages, and the decision
 * to validate `unknown` rather than a typed envelope — is preserved verbatim,
 * because those are the observable contract. `formation-validator-parity`
 * compares complete `ContractIssue[]` arrays with no normalisation, and
 * `formation-validator-inventory` proves the emitted code SET matches the
 * frozen validator's, which is what catches a rule dropped rather than
 * mistranslated.
 *
 * The validator deliberately accepts `unknown`: the frozen entry point is a
 * gate over arbitrary decoded JSON, and narrowing its parameter to
 * `CaseEnvelope` would make every shape rule unreachable-by-construction in
 * the type system while remaining necessary at runtime. That property has to
 * reach the PUBLIC type, not just the implementation — a returned type of
 * `FormationEnvelopeValidator<CaseEnvelope>` forces every caller holding
 * decoded JSON to assert `as CaseEnvelope` before it can ask whether the value
 * is a CaseEnvelope, and that assertion is precisely where an admission bypass
 * gets introduced. `FormationValidator` therefore widens `validate` back to
 * `unknown` while remaining assignable to the port the ceremony consumes.
 */

import { canonicalSerialize, sha256, type ContractIssue } from '../v2/case-envelope.js';
import { computeRequestFingerprint } from '../webmcp/core/idempotency.js';
import {
  EPISTEMIC_STRENGTHS,
  PROPOSITION_TYPES,
  SOURCE_CHANNELS,
  issue,
} from '../webmcp/core-v0-3/types.js';
import {
  computePayloadCommitment,
  normalizePayload,
  resolveSpanText,
  validatePayloadShape,
  type TurnSpan,
} from '../webmcp/core/turns.js';
import {
  HASH_PATTERN,
  ID_PATTERN,
  PARTY_IDS,
  hashCaseEnvelope,
  hashDisclosureReviewAcknowledgmentStatement,
  isPartyScopedId,
  otherParty,
  type CaseEnvelope,
  type PartyId,
  type SourceSpanCommitment,
  type SourceTurn,
} from './envelope.js';
import { createIssueCodes } from './issue-codes.js';
import { assertValidGenerationSpec, type GenerationSpec } from './generation-spec.js';
import { hashPartyFormationProjection } from './projection.js';
import { authoritativeFormationExplanatoryState } from './readiness.js';
import {
  currentDisclosureReviewAcknowledgment,
  disclosureReviewClosureCurrent,
} from './disclosure-review.js';
import type { FormationEnvelopeValidator } from './validator-port.js';

type UnknownRecord = Record<string, unknown>;

const AMBIGUITY_REASONS = [
  'answer_does_not_address_requirement',
  'multiple_incompatible_readings',
  'epistemic_strength_indeterminate',
  'contradicts_existing_proposition',
  'type_classification_indeterminate',
] as const;

function object(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function stringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function sortedUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    JSON.stringify(values) === JSON.stringify([...values].sort())
  );
}
/**
 * Builds the validator for one generation.
 *
 * Construction is the fail-closed boundary: a spec whose cardinality policy
 * this validator cannot enforce yields no validator at all, rather than a
 * permissive one. That ordering matters — a validator object that exists but
 * silently skips a rule is far more dangerous than a constructor that throws,
 * because it will be wired in and trusted.
 */
export interface FormationValidator extends FormationEnvelopeValidator<CaseEnvelope> {
  /**
   * Structural issues over ARBITRARY input, empty when the value satisfies the
   * contract. Widened from the port on purpose: the caller with an untrusted
   * value is the one that most needs this, and making it cast first defeats
   * the gate.
   */
  validate(envelope: unknown): ContractIssue[];
  /** Throws when an already-typed envelope is invalid, as the frozen one does. */
  assertValid(envelope: CaseEnvelope): void;
}

export function createFormationValidator(input: { spec: GenerationSpec }): FormationValidator {
  // Validated, defensively copied and deeply frozen once, at construction.
  const spec = assertValidGenerationSpec(input.spec);
  const codes = createIssueCodes(spec.contracts.contract_issue_code_prefix);

  if (spec.policy.proposition_cardinality !== 'single_live_per_slot') {
    throw new TypeError(
      `Proposition cardinality policy "${spec.policy.proposition_cardinality}" is not implemented by the shared validator.`,
    );
  }

  function exactKeys(
    value: UnknownRecord,
    expected: readonly string[],
    path: string,
    issues: ContractIssue[],
  ): void {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      issues.push(issue(codes.exact_keys, path, `Expected keys ${wanted.join(', ')}.`));
    }
  }

  function validateSpanCommitment(
    span: unknown,
    source: SourceTurn | undefined,
    path: string,
  ): ContractIssue[] {
    const issues: ContractIssue[] = [];
    if (!object(span))
      return [issue(codes.span_object, path, 'Span commitment must be an object.')];
    exactKeys(
      span,
      ['encoding', 'end', 'message_index', 'quote_hash', 'region', 'start', 'turn_id'],
      path,
      issues,
    );
    if (typeof span.turn_id !== 'string' || !ID_PATTERN.test(span.turn_id)) {
      issues.push(issue(codes.span_turn_id, `${path}.turn_id`, 'Span turn id is invalid.'));
    }
    if (!['answer', 'context'].includes(String(span.region))) {
      issues.push(issue(codes.span_region, `${path}.region`, 'Span region is invalid.'));
    }
    if (span.encoding !== 'utf16') {
      issues.push(issue(codes.span_encoding, `${path}.encoding`, "Span encoding must be 'utf16'."));
    }
    if (!safeInteger(span.start) || !safeInteger(span.end) || span.end <= span.start) {
      issues.push(issue(codes.span_bounds, path, 'Span offsets are invalid.'));
    }
    if (typeof span.quote_hash !== 'string' || !HASH_PATTERN.test(span.quote_hash)) {
      issues.push(
        issue(codes.span_quote_hash, `${path}.quote_hash`, 'Span quote hash is invalid.'),
      );
    }
    if (span.region === 'answer' && span.message_index !== null) {
      issues.push(
        issue(codes.span_answer_index, `${path}.message_index`, 'Answer span index must be null.'),
      );
    }
    if (span.region === 'context' && !safeInteger(span.message_index)) {
      issues.push(
        issue(
          codes.span_context_index,
          `${path}.message_index`,
          'Context span index must be a non-negative integer.',
        ),
      );
    }
    if (source && issues.length === 0) {
      if (span.turn_id !== source.turn_id) {
        issues.push(issue(codes.span_source_mismatch, path, 'Span names a different source turn.'));
      } else {
        const committed = span as unknown as SourceSpanCommitment;
        let length: number | undefined;
        if (committed.region === 'answer') {
          length = source.payload_layout.answer_utf16_length;
        } else if (committed.message_index !== null) {
          length = source.payload_layout.context_utf16_lengths[committed.message_index];
        }
        if (length === undefined || committed.end > length) {
          issues.push(
            issue(codes.span_out_of_bounds, path, 'Span exceeds its canonical payload region.'),
          );
        } else if (source.payload !== null) {
          const turnSpan: TurnSpan = { ...committed, quote: '' };
          const text = resolveSpanText(source.payload, turnSpan);
          if (
            text === null ||
            sha256(text.slice(committed.start, committed.end)) !== committed.quote_hash
          ) {
            issues.push(
              issue(
                codes.span_commitment_mismatch,
                path,
                'Span quote commitment does not match payload.',
              ),
            );
          }
        }
      }
    }
    return issues;
  }

  function validateSourceTurn(
    key: string,
    value: unknown,
    envelope: CaseEnvelope,
    path: string,
  ): ContractIssue[] {
    const issues: ContractIssue[] = [];
    if (!object(value)) return [issue(codes.source_object, path, 'Source turn must be an object.')];
    exactKeys(
      value,
      [
        'attributed_party_id',
        'authenticated_subject_id_at_receipt',
        'client_turn_id',
        'compile_run_id',
        'dispute_id',
        'in_reply_to',
        'party_visible_version_before',
        'payload',
        'payload_commitment',
        'payload_commitment_salt',
        'payload_layout',
        'received_at',
        'redacted_at',
        'redacted_at_envelope_version',
        'relaying_agent',
        'request_fingerprint',
        'source_channel',
        'source_language',
        'translation_indicated',
        'turn_id',
      ],
      path,
      issues,
    );
    const partyId = value.attributed_party_id as PartyId;
    if (!PARTY_IDS.includes(partyId)) {
      issues.push(
        issue(codes.source_party, `${path}.attributed_party_id`, 'Source party is invalid.'),
      );
    }
    if (
      typeof value.turn_id !== 'string' ||
      value.turn_id !== key ||
      !PARTY_IDS.includes(partyId) ||
      !isPartyScopedId('turn', partyId, value.turn_id)
    ) {
      issues.push(
        issue(codes.source_id_scope, `${path}.turn_id`, 'Source turn id scope is invalid.'),
      );
    }
    if (value.dispute_id !== envelope.control.case_id) {
      issues.push(
        issue(codes.source_dispute, `${path}.dispute_id`, 'Source dispute id is invalid.'),
      );
    }
    if (
      PARTY_IDS.includes(partyId) &&
      (typeof value.authenticated_subject_id_at_receipt !== 'string' ||
        value.authenticated_subject_id_at_receipt !==
          envelope.parties[partyId].authenticated_subject_id)
    ) {
      issues.push(
        issue(
          codes.source_subject,
          `${path}.authenticated_subject_id_at_receipt`,
          'Source subject does not match its canonical party binding.',
        ),
      );
    }
    if (
      !safeInteger(value.party_visible_version_before, 1) ||
      (PARTY_IDS.includes(partyId) &&
        value.party_visible_version_before >
          envelope.control.party_views[partyId].party_visible_version)
    ) {
      issues.push(
        issue(
          codes.source_visible_version,
          `${path}.party_visible_version_before`,
          'Source party-visible version is invalid.',
        ),
      );
    }
    if (!validIso(value.received_at)) {
      issues.push(
        issue(codes.source_received_at, `${path}.received_at`, 'Received time is invalid.'),
      );
    }
    if (!SOURCE_CHANNELS.includes(value.source_channel as never)) {
      issues.push(
        issue(codes.source_channel, `${path}.source_channel`, 'Source channel is invalid.'),
      );
    }
    if (!stringOrNull(value.relaying_agent) || !stringOrNull(value.source_language)) {
      issues.push(issue(codes.source_metadata, path, 'Source relay/language metadata is invalid.'));
    }
    if (typeof value.translation_indicated !== 'boolean') {
      issues.push(
        issue(
          codes.source_translation,
          `${path}.translation_indicated`,
          'Translation flag is invalid.',
        ),
      );
    }
    if (
      !stringArray(value.in_reply_to) ||
      !sortedUnique(value.in_reply_to) ||
      !value.in_reply_to.every((entry) => ID_PATTERN.test(entry))
    ) {
      issues.push(
        issue(codes.source_reply_targets, `${path}.in_reply_to`, 'Reply targets are invalid.'),
      );
    }
    if (
      typeof value.client_turn_id !== 'string' ||
      value.client_turn_id.trim().length === 0 ||
      value.client_turn_id.length > 200
    ) {
      issues.push(
        issue(codes.source_client_turn, `${path}.client_turn_id`, 'Client turn id is invalid.'),
      );
    }
    if (
      typeof value.request_fingerprint !== 'string' ||
      !HASH_PATTERN.test(value.request_fingerprint)
    ) {
      issues.push(
        issue(codes.source_fingerprint, `${path}.request_fingerprint`, 'Fingerprint is invalid.'),
      );
    }
    if (
      typeof value.payload_commitment_salt !== 'string' ||
      value.payload_commitment_salt.length < 16 ||
      typeof value.payload_commitment !== 'string' ||
      !HASH_PATTERN.test(value.payload_commitment)
    ) {
      issues.push(issue(codes.source_commitment, path, 'Payload commitment material is invalid.'));
    }
    if (typeof value.compile_run_id !== 'string' || !ID_PATTERN.test(value.compile_run_id)) {
      issues.push(
        issue(codes.source_compile_run, `${path}.compile_run_id`, 'Compile run id is invalid.'),
      );
    }
    if (!object(value.payload_layout)) {
      issues.push(
        issue(codes.source_layout, `${path}.payload_layout`, 'Payload layout is invalid.'),
      );
    } else {
      exactKeys(
        value.payload_layout,
        ['answer_utf16_length', 'context_utf16_lengths'],
        `${path}.payload_layout`,
        issues,
      );
      if (
        !Array.isArray(value.payload_layout.context_utf16_lengths) ||
        !value.payload_layout.context_utf16_lengths.every((entry) => safeInteger(entry)) ||
        !safeInteger(value.payload_layout.answer_utf16_length)
      ) {
        issues.push(
          issue(codes.source_layout, `${path}.payload_layout`, 'Payload layout is invalid.'),
        );
      }
    }
    if (value.payload !== null) {
      if (!object(value.payload)) {
        issues.push(issue(codes.source_payload, `${path}.payload`, 'Payload is invalid.'));
      } else {
        const payload = value.payload as unknown as SourceTurn['payload'];
        try {
          issues.push(...validatePayloadShape(payload!, `${path}.payload`));
          if (canonicalSerialize(normalizePayload(payload!)) !== canonicalSerialize(payload)) {
            issues.push(
              issue(
                codes.source_payload_not_normalized,
                `${path}.payload`,
                'Payload is not normalized.',
              ),
            );
          }
          if (
            object(value.payload_layout) &&
            (JSON.stringify(value.payload_layout.context_utf16_lengths) !==
              JSON.stringify(payload!.context.map((message) => message.text.length)) ||
              value.payload_layout.answer_utf16_length !== payload!.answer.text.length)
          ) {
            issues.push(
              issue(
                codes.source_layout_mismatch,
                `${path}.payload_layout`,
                'Layout mismatches payload.',
              ),
            );
          }
          if (
            typeof value.payload_commitment_salt === 'string' &&
            value.payload_commitment !==
              computePayloadCommitment(payload!, value.payload_commitment_salt)
          ) {
            issues.push(
              issue(
                codes.source_payload_commitment,
                `${path}.payload_commitment`,
                'Commitment mismatches payload.',
              ),
            );
          }
          if (
            typeof value.authenticated_subject_id_at_receipt === 'string' &&
            typeof value.dispute_id === 'string' &&
            stringArray(value.in_reply_to) &&
            value.request_fingerprint !==
              computeRequestFingerprint({
                principal_id: value.authenticated_subject_id_at_receipt,
                case_id: value.dispute_id,
                in_reply_to: value.in_reply_to,
                payload: payload!,
              })
          ) {
            issues.push(
              issue(
                codes.source_fingerprint_mismatch,
                `${path}.request_fingerprint`,
                'Request fingerprint does not match canonical source input.',
              ),
            );
          }
        } catch {
          issues.push(issue(codes.source_payload, `${path}.payload`, 'Payload is invalid.'));
        }
      }
    }
    const redacted = value.payload === null;
    if (
      redacted !== (value.redacted_at !== null) ||
      redacted !== (value.redacted_at_envelope_version !== null) ||
      (value.redacted_at !== null && !validIso(value.redacted_at)) ||
      (value.redacted_at_envelope_version !== null &&
        (!safeInteger(value.redacted_at_envelope_version, 1) ||
          value.redacted_at_envelope_version > envelope.control.envelope_version))
    ) {
      issues.push(
        issue(codes.source_redaction, path, 'Source redaction metadata is inconsistent.'),
      );
    }
    return issues;
  }

  function validateEnvelope(value: unknown): ContractIssue[] {
    const issues: ContractIssue[] = [];
    try {
      canonicalSerialize(value as never);
    } catch {
      return [issue(codes.envelope_json, 'envelope', 'Envelope must be canonical JSON data.')];
    }
    if (!object(value))
      return [issue(codes.envelope_object, 'envelope', 'Envelope must be an object.')];
    exactKeys(
      value,
      [
        'challenges',
        'clarifications',
        'control',
        'evidence',
        'formation',
        'parties',
        'positions',
        'requirements',
        'source_turns',
      ],
      'envelope',
      issues,
    );
    if (!object(value.control)) {
      return [
        ...issues,
        issue(codes.control_object, 'envelope.control', 'Control must be an object.'),
      ];
    }
    exactKeys(
      value.control,
      [
        'case_id',
        'command_contract_version',
        'disclosure_state',
        'envelope_hash',
        'envelope_version',
        'external_submission_contract_version',
        'party_views',
        'projection_contract_version',
        'protocol_version',
        'readiness_contract_version',
        'schema_version',
        'workflow_state',
      ],
      'envelope.control',
      issues,
    );
    const versions = [
      ['schema_version', spec.identity.envelope_schema_version],
      ['protocol_version', spec.identity.formation_protocol_version],
      ['command_contract_version', spec.contracts.command_version],
      ['external_submission_contract_version', spec.contracts.external_relay_submission_version],
      ['projection_contract_version', spec.contracts.projection_version],
      ['readiness_contract_version', spec.contracts.readiness_version],
    ] as const;
    for (const [key, expected] of versions) {
      if (value.control[key] !== expected) {
        issues.push(
          issue(codes.contract_version, `envelope.control.${key}`, `Expected ${expected}.`),
        );
      }
    }
    if (
      typeof value.control.case_id !== 'string' ||
      !/^dispute_[A-Za-z0-9_.:-]+$/u.test(value.control.case_id) ||
      value.control.case_id.length > 160
    ) {
      issues.push(issue(codes.case_id, 'envelope.control.case_id', 'Dispute id is invalid.'));
    }
    if (
      ![
        'independent_formation',
        'challenge_response',
        'final_confirmation',
        'ready_for_lock',
      ].includes(String(value.control.workflow_state))
    ) {
      issues.push(
        issue(codes.workflow, 'envelope.control.workflow_state', 'Workflow state is invalid.'),
      );
    }
    if (!safeInteger(value.control.envelope_version, 1)) {
      issues.push(
        issue(
          codes.envelope_version,
          'envelope.control.envelope_version',
          'Envelope version is invalid.',
        ),
      );
    }
    if (
      typeof value.control.envelope_hash !== 'string' ||
      !HASH_PATTERN.test(value.control.envelope_hash)
    ) {
      issues.push(
        issue(codes.envelope_hash, 'envelope.control.envelope_hash', 'Envelope hash is invalid.'),
      );
    }
    if (!['embargoed', 'disclosed'].includes(String(value.control.disclosure_state))) {
      issues.push(
        issue(
          codes.disclosure,
          'envelope.control.disclosure_state',
          'Disclosure state is invalid.',
        ),
      );
    }
    if (!object(value.control.party_views)) {
      issues.push(
        issue(codes.party_views, 'envelope.control.party_views', 'Party views are invalid.'),
      );
    } else {
      exactKeys(value.control.party_views, PARTY_IDS, 'envelope.control.party_views', issues);
      for (const partyId of PARTY_IDS) {
        const cursor = value.control.party_views[partyId];
        if (!object(cursor)) {
          issues.push(
            issue(
              codes.party_cursor,
              `envelope.control.party_views.${partyId}`,
              'Cursor is invalid.',
            ),
          );
          continue;
        }
        exactKeys(
          cursor,
          ['party_projection_hash', 'party_visible_version'],
          `envelope.control.party_views.${partyId}`,
          issues,
        );
        if (
          !safeInteger(cursor.party_visible_version, 1) ||
          typeof cursor.party_projection_hash !== 'string' ||
          !HASH_PATTERN.test(cursor.party_projection_hash)
        ) {
          issues.push(
            issue(
              codes.party_cursor,
              `envelope.control.party_views.${partyId}`,
              'Cursor is invalid.',
            ),
          );
        }
      }
    }

    if (!object(value.parties)) {
      issues.push(issue(codes.parties, 'envelope.parties', 'Parties are invalid.'));
    } else {
      exactKeys(value.parties, PARTY_IDS, 'envelope.parties', issues);
      for (const partyId of PARTY_IDS) {
        const party = value.parties[partyId];
        if (!object(party)) {
          issues.push(
            issue(codes.party, `envelope.parties.${partyId}`, 'Party binding is invalid.'),
          );
          continue;
        }
        exactKeys(
          party,
          [
            'authenticated_subject_id',
            'binding_event_id',
            'edit_state',
            'formation_epoch',
            'identity_assurance',
            'party_id',
            'role',
          ],
          `envelope.parties.${partyId}`,
          issues,
        );
        if (party.party_id !== partyId || party.role !== partyId)
          issues.push(
            issue(codes.party_role, `envelope.parties.${partyId}`, 'Party role is invalid.'),
          );
        if (
          !['unbound', 'authenticated'].includes(String(party.identity_assurance)) ||
          !['open', 'confirmed', 'reopened'].includes(String(party.edit_state)) ||
          !safeInteger(party.formation_epoch, 1)
        ) {
          issues.push(
            issue(codes.party_state, `envelope.parties.${partyId}`, 'Party state is invalid.'),
          );
        }
        const bound = party.identity_assurance === 'authenticated';
        if (
          bound !==
            (typeof party.authenticated_subject_id === 'string' &&
              party.authenticated_subject_id.length > 0) ||
          bound !==
            (typeof party.binding_event_id === 'string' &&
              isPartyScopedId('binding', partyId, party.binding_event_id))
        ) {
          issues.push(
            issue(
              codes.party_binding,
              `envelope.parties.${partyId}`,
              'Party binding shape is inconsistent.',
            ),
          );
        }
        if (
          !bound &&
          (party.authenticated_subject_id !== null ||
            party.binding_event_id !== null ||
            party.edit_state !== 'open' ||
            party.formation_epoch !== 1)
        ) {
          issues.push(
            issue(
              codes.unbound_party_state,
              `envelope.parties.${partyId}`,
              'Unbound party carries authority or history.',
            ),
          );
        }
      }
      const a = object(value.parties.party_a)
        ? value.parties.party_a.authenticated_subject_id
        : null;
      const b = object(value.parties.party_b)
        ? value.parties.party_b.authenticated_subject_id
        : null;
      if (typeof a === 'string' && a === b) {
        issues.push(
          issue(
            codes.duplicate_authenticated_subject,
            'envelope.parties',
            'Party principals must be distinct.',
          ),
        );
      }
    }

    const envelope = value as unknown as CaseEnvelope;
    for (const collection of [
      'source_turns',
      'positions',
      'requirements',
      'clarifications',
      'evidence',
      'challenges',
    ] as const) {
      if (!object(value[collection]))
        issues.push(
          issue(codes.collection, `envelope.${collection}`, `${collection} must be an object.`),
        );
    }
    if (object(value.source_turns)) {
      for (const [key, source] of Object.entries(value.source_turns)) {
        issues.push(...validateSourceTurn(key, source, envelope, `envelope.source_turns.${key}`));
      }
    }

    if (object(value.requirements)) {
      for (const [key, raw] of Object.entries(value.requirements)) {
        const path = `envelope.requirements.${key}`;
        if (!object(raw)) {
          issues.push(issue(codes.requirement_object, path, 'Requirement must be an object.'));
          continue;
        }
        exactKeys(
          raw,
          [
            'adverse_fact_probe',
            'label',
            'max_propositions',
            'min_propositions',
            'party_id',
            'prompt',
            'reopened_from',
            'required',
            'requirement_id',
            'satisfying_types',
          ],
          path,
          issues,
        );
        if (
          raw.requirement_id !== key ||
          !ID_PATTERN.test(key) ||
          !PARTY_IDS.includes(raw.party_id as PartyId) ||
          typeof raw.label !== 'string' ||
          raw.label.length === 0 ||
          typeof raw.prompt !== 'string' ||
          raw.prompt.length === 0 ||
          typeof raw.required !== 'boolean' ||
          typeof raw.adverse_fact_probe !== 'boolean' ||
          !stringOrNull(raw.reopened_from)
        ) {
          issues.push(issue(codes.requirement_shape, path, 'Requirement shape is invalid.'));
        }
        if (typeof raw.reopened_from === 'string') {
          const prior = envelope.requirements[raw.reopened_from];
          if (
            !prior ||
            prior.party_id !== raw.party_id ||
            prior.requirement_id === raw.requirement_id
          ) {
            issues.push(
              issue(
                codes.requirement_reopen_link,
                `${path}.reopened_from`,
                'Reopened requirement must link to a distinct same-party requirement.',
              ),
            );
          }
        }
        if (
          !Array.isArray(raw.satisfying_types) ||
          raw.satisfying_types.length === 0 ||
          !raw.satisfying_types.every((entry) => PROPOSITION_TYPES.includes(entry as never)) ||
          new Set(raw.satisfying_types).size !== raw.satisfying_types.length
        ) {
          issues.push(
            issue(
              codes.requirement_types,
              `${path}.satisfying_types`,
              'Requirement satisfying types are invalid.',
            ),
          );
        }
        if (
          !safeInteger(raw.min_propositions, raw.required === true ? 1 : 0) ||
          (raw.max_propositions !== null &&
            (!safeInteger(raw.max_propositions) || raw.max_propositions < raw.min_propositions))
        ) {
          issues.push(
            issue(codes.requirement_cardinality, path, 'Requirement cardinality is invalid.'),
          );
        }
      }
    }

    if (object(value.positions)) {
      for (const [key, raw] of Object.entries(value.positions)) {
        const path = `envelope.positions.${key}`;
        if (!object(raw)) {
          issues.push(issue(codes.position_object, path, 'Position must be an object.'));
          continue;
        }
        exactKeys(
          raw,
          [
            'attributed_party_id',
            'compile_run_id',
            'compiler_version_id',
            'epistemic_strength',
            'evidence_ref_id',
            'introduced_envelope_version',
            'last_material_envelope_version',
            'position_id',
            'proposition_type',
            'requirement_id',
            'resolution_status',
            'source_span_commitments',
            'source_turn_id',
            'statement',
            'superseded_at_envelope_version',
            'superseded_by',
            'supersedes',
          ],
          path,
          issues,
        );
        const partyId = raw.attributed_party_id as PartyId;
        if (
          raw.position_id !== key ||
          !PARTY_IDS.includes(partyId) ||
          typeof raw.position_id !== 'string' ||
          !isPartyScopedId('position', partyId, raw.position_id)
        )
          issues.push(
            issue(codes.position_id_scope, `${path}.position_id`, 'Position id scope is invalid.'),
          );
        if (
          typeof raw.requirement_id !== 'string' ||
          envelope.requirements[raw.requirement_id]?.party_id !== partyId
        )
          issues.push(
            issue(
              codes.position_requirement,
              `${path}.requirement_id`,
              'Position requirement is invalid.',
            ),
          );
        if (
          !PROPOSITION_TYPES.includes(raw.proposition_type as never) ||
          !EPISTEMIC_STRENGTHS.includes(raw.epistemic_strength as never)
        )
          issues.push(
            issue(
              codes.position_semantics,
              path,
              'Position type or epistemic strength is invalid.',
            ),
          );
        if (
          typeof raw.statement !== 'string' ||
          raw.statement.trim().length === 0 ||
          !['disputed', 'unresolved', 'procedurally_resolved'].includes(
            String(raw.resolution_status),
          )
        )
          issues.push(
            issue(codes.position_statement, path, 'Position statement or resolution is invalid.'),
          );
        const source =
          typeof raw.source_turn_id === 'string'
            ? envelope.source_turns[raw.source_turn_id]
            : undefined;
        if (
          !source ||
          source.attributed_party_id !== partyId ||
          source.compile_run_id !== raw.compile_run_id ||
          typeof raw.compiler_version_id !== 'string' ||
          !HASH_PATTERN.test(raw.compiler_version_id)
        )
          issues.push(issue(codes.position_provenance, path, 'Position provenance is invalid.'));
        if (!Array.isArray(raw.source_span_commitments) || raw.source_span_commitments.length === 0)
          issues.push(
            issue(
              codes.position_spans,
              `${path}.source_span_commitments`,
              'Position needs source spans.',
            ),
          );
        else
          raw.source_span_commitments.forEach((span, index) =>
            issues.push(
              ...validateSpanCommitment(span, source, `${path}.source_span_commitments[${index}]`),
            ),
          );
        if (
          raw.proposition_type === 'explicit_absence' &&
          (raw.epistemic_strength === 'non_recollection' ||
            raw.epistemic_strength === 'declined' ||
            !source ||
            !Array.isArray(raw.source_span_commitments) ||
            !raw.source_span_commitments.some(
              (span) =>
                object(span) &&
                span.region === 'answer' &&
                span.message_index === null &&
                span.start === 0 &&
                span.end === source.payload_layout.answer_utf16_length &&
                span.end !== 0,
            ))
        )
          issues.push(
            issue(
              codes.explicit_absence_source,
              path,
              'Explicit absence must retain the complete answer commitment and factual strength.',
            ),
          );
        if (
          !safeInteger(raw.introduced_envelope_version, 1) ||
          !safeInteger(
            raw.last_material_envelope_version,
            raw.introduced_envelope_version as number,
          ) ||
          raw.last_material_envelope_version > envelope.control.envelope_version ||
          !stringOrNull(raw.supersedes) ||
          !stringOrNull(raw.superseded_by) ||
          !stringOrNull(raw.evidence_ref_id)
        )
          issues.push(issue(codes.position_history, path, 'Position history is invalid.'));
        if (typeof raw.evidence_ref_id === 'string') {
          const evidence = envelope.evidence[raw.evidence_ref_id];
          if (!evidence || evidence.attributed_party_id !== partyId) {
            issues.push(
              issue(
                codes.position_evidence,
                `${path}.evidence_ref_id`,
                'Position evidence must resolve to same-party canonical evidence.',
              ),
            );
          }
        }
        const superseded = raw.superseded_by !== null;
        if (
          superseded !== (raw.superseded_at_envelope_version !== null) ||
          (raw.superseded_at_envelope_version !== null &&
            (!safeInteger(raw.superseded_at_envelope_version, 1) ||
              raw.superseded_at_envelope_version > envelope.control.envelope_version))
        )
          issues.push(
            issue(
              codes.position_supersession_shape,
              path,
              'Position supersession shape is invalid.',
            ),
          );
      }
      /**
       * THE one generation-semantic seam in this validator.
       *
       * `multi_live` is already refused when the validator is constructed; this
       * second, redundant guard exists because the tempting way to "support"
       * multi_live later is to make the block below conditional — which turns a
       * refusal into a silent skip and leaves a validator that admits exactly
       * the envelopes it exists to reject. Failing loudly here means a future
       * mode can never be introduced by omission.
       */
      if (spec.policy.proposition_cardinality !== 'single_live_per_slot') {
        throw new TypeError(
          `Proposition cardinality policy "${spec.policy.proposition_cardinality}" is not implemented by the shared validator.`,
        );
      }
      const liveSlots = new Set<string>();
      for (const position of Object.values(envelope.positions)) {
        if (!object(position)) continue;
        if (position.superseded_by === null) {
          const slot = `${position.attributed_party_id}|${position.requirement_id}|${position.proposition_type}`;
          if (liveSlots.has(slot))
            issues.push(
              issue(
                codes.live_position_slot_duplicate,
                'envelope.positions',
                `Duplicate live position slot ${slot}.`,
              ),
            );
          liveSlots.add(slot);
        }
        if (position.supersedes !== null) {
          const prior = envelope.positions[position.supersedes];
          if (
            !prior ||
            prior.superseded_by !== position.position_id ||
            prior.attributed_party_id !== position.attributed_party_id ||
            prior.requirement_id !== position.requirement_id ||
            prior.superseded_at_envelope_version !== position.introduced_envelope_version
          )
            issues.push(
              issue(
                codes.supersession_link,
                `envelope.positions.${position.position_id}`,
                'Supersession link is invalid.',
              ),
            );
        }
        if (position.superseded_by !== null) {
          const next = envelope.positions[position.superseded_by];
          if (!next || next.supersedes !== position.position_id)
            issues.push(
              issue(
                codes.supersession_reverse_link,
                `envelope.positions.${position.position_id}`,
                'Reverse supersession link is invalid.',
              ),
            );
        }
      }
    }

    if (object(value.clarifications)) {
      const openByRequirement = new Set<string>();
      for (const [key, raw] of Object.entries(value.clarifications)) {
        const path = `envelope.clarifications.${key}`;
        if (!object(raw)) {
          issues.push(issue(codes.clarification_object, path, 'Clarification must be an object.'));
          continue;
        }
        exactKeys(
          raw,
          [
            'clarification_id',
            'opened_at_envelope_version',
            'party_id',
            'prompt',
            'reason',
            'reopened_as',
            'requirement_id',
            'resolved_at_envelope_version',
          ],
          path,
          issues,
        );
        const partyId = raw.party_id as PartyId;
        if (
          raw.clarification_id !== key ||
          !PARTY_IDS.includes(partyId) ||
          typeof raw.clarification_id !== 'string' ||
          !isPartyScopedId('clarification', partyId, raw.clarification_id) ||
          typeof raw.requirement_id !== 'string' ||
          envelope.requirements[raw.requirement_id]?.party_id !== partyId ||
          !AMBIGUITY_REASONS.includes(raw.reason as never) ||
          typeof raw.prompt !== 'string' ||
          raw.prompt.trim().length === 0 ||
          !safeInteger(raw.opened_at_envelope_version, 1) ||
          raw.opened_at_envelope_version > envelope.control.envelope_version ||
          (raw.resolved_at_envelope_version !== null &&
            (!safeInteger(
              raw.resolved_at_envelope_version,
              raw.opened_at_envelope_version as number,
            ) ||
              raw.resolved_at_envelope_version > envelope.control.envelope_version)) ||
          !stringOrNull(raw.reopened_as)
        )
          issues.push(issue(codes.clarification_shape, path, 'Clarification shape is invalid.'));
        if (typeof raw.reopened_as === 'string') {
          const reopened = envelope.requirements[raw.reopened_as];
          if (!reopened || reopened.party_id !== partyId) {
            issues.push(
              issue(
                codes.clarification_reopen_link,
                `${path}.reopened_as`,
                'Clarification reopen target must be a same-party requirement.',
              ),
            );
          }
        }
        if (raw.resolved_at_envelope_version === null && typeof raw.requirement_id === 'string') {
          if (openByRequirement.has(raw.requirement_id))
            issues.push(
              issue(
                codes.duplicate_open_clarification,
                path,
                'Only one open clarification is allowed per requirement.',
              ),
            );
          openByRequirement.add(raw.requirement_id);
        }
      }
    }

    if (object(value.evidence)) {
      for (const [key, raw] of Object.entries(value.evidence)) {
        const path = `envelope.evidence.${key}`;
        if (!object(raw)) {
          issues.push(issue(codes.evidence_object, path, 'Evidence must be an object.'));
          continue;
        }
        exactKeys(
          raw,
          [
            'attributed_party_id',
            'description',
            'eligibility',
            'evidence_id',
            'required_for_readiness',
          ],
          path,
          issues,
        );
        if (
          raw.evidence_id !== key ||
          typeof raw.evidence_id !== 'string' ||
          !ID_PATTERN.test(raw.evidence_id) ||
          !PARTY_IDS.includes(raw.attributed_party_id as PartyId) ||
          typeof raw.description !== 'string' ||
          typeof raw.required_for_readiness !== 'boolean' ||
          !['pending', 'eligible', 'ineligible', 'not_required'].includes(String(raw.eligibility))
        )
          issues.push(issue(codes.evidence_shape, path, 'Evidence shape is invalid.'));
      }
    }

    if (object(value.challenges)) {
      for (const [key, raw] of Object.entries(value.challenges)) {
        const path = `envelope.challenges.${key}`;
        if (!object(raw)) {
          issues.push(issue(codes.challenge_object, path, 'Challenge must be an object.'));
          continue;
        }
        exactKeys(
          raw,
          [
            'challenge_id',
            'challenging_party_id',
            'compile_run_id',
            'compiler_version_id',
            'introduced_envelope_version',
            'response',
            'source_span_commitments',
            'source_turn_id',
            'statement',
            'status',
            'target_party_id',
            'target_position_id',
          ],
          path,
          issues,
        );
        const challenger = raw.challenging_party_id as PartyId;
        const targetParty = raw.target_party_id as PartyId;
        const target =
          typeof raw.target_position_id === 'string'
            ? envelope.positions[raw.target_position_id]
            : undefined;
        const source =
          typeof raw.source_turn_id === 'string'
            ? envelope.source_turns[raw.source_turn_id]
            : undefined;
        if (
          raw.challenge_id !== key ||
          !PARTY_IDS.includes(challenger) ||
          typeof raw.challenge_id !== 'string' ||
          !isPartyScopedId('challenge', challenger, raw.challenge_id) ||
          targetParty !== otherParty(challenger) ||
          !target ||
          target.attributed_party_id !== targetParty ||
          !source ||
          source.attributed_party_id !== challenger ||
          source.compile_run_id !== raw.compile_run_id ||
          typeof raw.statement !== 'string' ||
          raw.statement.trim().length === 0 ||
          typeof raw.compiler_version_id !== 'string' ||
          !HASH_PATTERN.test(raw.compiler_version_id) ||
          !safeInteger(raw.introduced_envelope_version, 1) ||
          raw.introduced_envelope_version > envelope.control.envelope_version ||
          !['open', 'resolved', 'withdrawn'].includes(String(raw.status))
        )
          issues.push(
            issue(codes.challenge_shape, path, 'Challenge shape or provenance is invalid.'),
          );
        if (!Array.isArray(raw.source_span_commitments) || raw.source_span_commitments.length === 0)
          issues.push(issue(codes.challenge_spans, path, 'Challenge needs source spans.'));
        else
          raw.source_span_commitments.forEach((span, index) =>
            issues.push(
              ...validateSpanCommitment(span, source, `${path}.source_span_commitments[${index}]`),
            ),
          );
        if (raw.response === null) {
          if (raw.status === 'resolved')
            issues.push(
              issue(codes.challenge_response_missing, path, 'Resolved challenge needs a response.'),
            );
        } else if (!object(raw.response)) {
          issues.push(
            issue(
              codes.challenge_response_object,
              `${path}.response`,
              'Challenge response is invalid.',
            ),
          );
        } else {
          exactKeys(
            raw.response,
            [
              'compile_run_id',
              'compiler_version_id',
              'introduced_envelope_version',
              'responding_party_id',
              'response_id',
              'semantic_position_id',
              'source_span_commitments',
              'source_turn_id',
              'statement',
            ],
            `${path}.response`,
            issues,
          );
          const responseSource =
            typeof raw.response.source_turn_id === 'string'
              ? envelope.source_turns[raw.response.source_turn_id]
              : undefined;
          if (
            raw.status !== 'resolved' ||
            raw.response.responding_party_id !== targetParty ||
            typeof raw.response.response_id !== 'string' ||
            !isPartyScopedId('challenge_response', targetParty, raw.response.response_id) ||
            !responseSource ||
            responseSource.attributed_party_id !== targetParty ||
            responseSource.compile_run_id !== raw.response.compile_run_id ||
            typeof raw.response.compiler_version_id !== 'string' ||
            !HASH_PATTERN.test(raw.response.compiler_version_id) ||
            typeof raw.response.statement !== 'string' ||
            raw.response.statement.trim().length === 0 ||
            !safeInteger(raw.response.introduced_envelope_version, 1) ||
            raw.response.introduced_envelope_version > envelope.control.envelope_version ||
            !stringOrNull(raw.response.semantic_position_id)
          )
            issues.push(
              issue(
                codes.challenge_response_shape,
                `${path}.response`,
                'Challenge response shape or provenance is invalid.',
              ),
            );
          if (
            !Array.isArray(raw.response.source_span_commitments) ||
            raw.response.source_span_commitments.length === 0
          )
            issues.push(
              issue(
                codes.challenge_response_spans,
                `${path}.response`,
                'Challenge response needs source spans.',
              ),
            );
          else
            raw.response.source_span_commitments.forEach((span, index) =>
              issues.push(
                ...validateSpanCommitment(
                  span,
                  responseSource,
                  `${path}.response.source_span_commitments[${index}]`,
                ),
              ),
            );
          if (typeof raw.response.semantic_position_id === 'string') {
            const correction = envelope.positions[raw.response.semantic_position_id];
            if (
              !correction ||
              correction.attributed_party_id !== targetParty ||
              correction.supersedes !== raw.target_position_id
            )
              issues.push(
                issue(
                  codes.challenge_response_position,
                  `${path}.response.semantic_position_id`,
                  'Challenge correction position is invalid.',
                ),
              );
          }
        }
      }
      if (
        Object.keys(value.challenges).length > 0 &&
        envelope.control.disclosure_state !== 'disclosed'
      )
        issues.push(
          issue(
            codes.challenge_before_disclosure,
            'envelope.challenges',
            'Challenges require controlled disclosure.',
          ),
        );
    }

    if (!object(value.formation)) {
      issues.push(issue(codes.formation, 'envelope.formation', 'Formation state is invalid.'));
    } else {
      exactKeys(
        value.formation,
        ['confirmations', 'disclosure_review_acknowledgments', 'explanatory', 'reopen_events'],
        'envelope.formation',
        issues,
      );
      if (!object(value.formation.confirmations))
        issues.push(
          issue(
            codes.confirmations,
            'envelope.formation.confirmations',
            'Confirmations are invalid.',
          ),
        );
      else {
        exactKeys(
          value.formation.confirmations,
          PARTY_IDS,
          'envelope.formation.confirmations',
          issues,
        );
        const ids = new Set<string>();
        const events = new Set<string>();
        for (const partyId of PARTY_IDS) {
          const receipts = value.formation.confirmations[partyId];
          if (!Array.isArray(receipts)) {
            issues.push(
              issue(
                codes.confirmations,
                `envelope.formation.confirmations.${partyId}`,
                'Confirmations must be an array.',
              ),
            );
            continue;
          }
          for (const [index, raw] of receipts.entries()) {
            const path = `envelope.formation.confirmations.${partyId}[${index}]`;
            if (!object(raw)) {
              issues.push(
                issue(codes.confirmation_object, path, 'Confirmation must be an object.'),
              );
              continue;
            }
            exactKeys(
              raw,
              [
                'adoption_statement_hash',
                'authenticated_subject_id',
                'confirmation_id',
                'confirmation_version',
                'confirmed_at',
                'event_id',
                'formation_epoch',
                'party_id',
                'party_projection_hash',
                'party_projection_version',
                'party_readback_hash',
                'party_readback_version',
                'party_visible_version',
                'shared_envelope_hash',
                'shared_envelope_version',
              ],
              path,
              issues,
            );
            if (
              raw.confirmation_version !== spec.contracts.confirmation_version ||
              raw.party_id !== partyId ||
              typeof raw.confirmation_id !== 'string' ||
              !isPartyScopedId('confirmation', partyId, raw.confirmation_id) ||
              typeof raw.event_id !== 'string' ||
              !isPartyScopedId('confirmation_event', partyId, raw.event_id) ||
              raw.party_projection_version !== spec.contracts.projection_version ||
              raw.party_readback_version !== spec.contracts.readback_version ||
              typeof raw.authenticated_subject_id !== 'string' ||
              !safeInteger(raw.party_visible_version, 1) ||
              !safeInteger(raw.formation_epoch, 1) ||
              !safeInteger(raw.shared_envelope_version, 1) ||
              !validIso(raw.confirmed_at) ||
              ![
                raw.party_projection_hash,
                raw.party_readback_hash,
                raw.adoption_statement_hash,
                raw.shared_envelope_hash,
              ].every((hash) => typeof hash === 'string' && HASH_PATTERN.test(hash))
            )
              issues.push(
                issue(codes.confirmation_shape, path, 'Confirmation receipt is invalid.'),
              );
            if (ids.has(String(raw.confirmation_id)) || events.has(String(raw.event_id)))
              issues.push(
                issue(codes.confirmation_id_collision, path, 'Confirmation identities collide.'),
              );
            ids.add(String(raw.confirmation_id));
            events.add(String(raw.event_id));
          }
        }
      }
      if (!Array.isArray(value.formation.reopen_events))
        issues.push(
          issue(
            codes.reopen_events,
            'envelope.formation.reopen_events',
            'Reopen events are invalid.',
          ),
        );
      else {
        const ids = new Set<string>();
        for (const [index, raw] of value.formation.reopen_events.entries()) {
          const path = `envelope.formation.reopen_events[${index}]`;
          if (!object(raw)) {
            issues.push(issue(codes.reopen_object, path, 'Reopen event must be an object.'));
            continue;
          }
          exactKeys(
            raw,
            [
              'authenticated_subject_id',
              'event_id',
              'occurred_at',
              'party_id',
              'prior_formation_epoch',
              'reason',
              'resulting_formation_epoch',
            ],
            path,
            issues,
          );
          const partyId = raw.party_id as PartyId;
          if (
            !PARTY_IDS.includes(partyId) ||
            typeof raw.event_id !== 'string' ||
            !isPartyScopedId('reopen_event', partyId, raw.event_id) ||
            raw.authenticated_subject_id !== envelope.parties[partyId]?.authenticated_subject_id ||
            !safeInteger(raw.prior_formation_epoch, 1) ||
            raw.resulting_formation_epoch !== (raw.prior_formation_epoch as number) + 1 ||
            typeof raw.reason !== 'string' ||
            raw.reason.trim().length === 0 ||
            !validIso(raw.occurred_at) ||
            ids.has(String(raw.event_id))
          )
            issues.push(issue(codes.reopen_shape, path, 'Reopen event is invalid.'));
          ids.add(String(raw.event_id));
        }
        for (const partyId of PARTY_IDS) {
          if (envelope.parties[partyId]?.edit_state === 'reopened') {
            const last = [...(value.formation.reopen_events as unknown[])]
              .reverse()
              .find((entry) => object(entry) && entry.party_id === partyId);
            if (
              !object(last) ||
              last.resulting_formation_epoch !== envelope.parties[partyId].formation_epoch
            )
              issues.push(
                issue(
                  codes.reopen_history_missing,
                  `envelope.parties.${partyId}.edit_state`,
                  'Reopened state requires matching first-party history.',
                ),
              );
          }
        }
      }
      if (!object(value.formation.explanatory))
        issues.push(
          issue(
            codes.explanatory,
            'envelope.formation.explanatory',
            'Explanatory state is invalid.',
          ),
        );
      else {
        exactKeys(
          value.formation.explanatory,
          ['lock_blockers', 'lock_prerequisites', 'open_required_fields'],
          'envelope.formation.explanatory',
          issues,
        );
        if (
          ![
            value.formation.explanatory.lock_blockers,
            value.formation.explanatory.lock_prerequisites,
            value.formation.explanatory.open_required_fields,
          ].every((entry) => stringArray(entry) && sortedUnique(entry))
        )
          issues.push(
            issue(
              codes.explanatory_shape,
              'envelope.formation.explanatory',
              'Explanatory arrays are invalid.',
            ),
          );
      }
    }

    try {
      validateAcknowledgmentHistory(envelope, issues);
    } catch {
      issues.push(
        issue(
          codes.disclosure_acknowledgments,
          'envelope.formation.disclosure_review_acknowledgments',
          'Disclosure-review acknowledgment history references malformed envelope state.',
        ),
      );
    }
    if (
      envelope.control.disclosure_state !== 'disclosed' &&
      object(envelope.formation.disclosure_review_acknowledgments) &&
      PARTY_IDS.some(
        (partyId) =>
          Array.isArray(envelope.formation.disclosure_review_acknowledgments[partyId]) &&
          envelope.formation.disclosure_review_acknowledgments[partyId].length > 0,
      )
    ) {
      issues.push(
        issue(
          codes.disclosure_ack_before_disclosure,
          'envelope.formation.disclosure_review_acknowledgments',
          'Disclosure-review acknowledgments require disclosed state.',
        ),
      );
    }

    if (
      issues.length === 0 &&
      ['final_confirmation', 'ready_for_lock'].includes(envelope.control.workflow_state) &&
      !disclosureReviewClosureCurrent(spec, envelope)
    )
      issues.push(
        issue(
          codes.disclosure_review_closure_missing,
          'envelope.control.workflow_state',
          'Current bilateral disclosure review is required.',
        ),
      );
    if (issues.length === 0) {
      for (const partyId of PARTY_IDS) {
        if (
          envelope.control.party_views[partyId].party_projection_hash !==
          hashPartyFormationProjection(spec, envelope, partyId)
        )
          issues.push(
            issue(
              codes.party_projection_hash,
              `envelope.control.party_views.${partyId}.party_projection_hash`,
              'Stored party projection hash is stale.',
            ),
          );
      }
      const expectedExplanatory = authoritativeFormationExplanatoryState(spec, envelope);
      if (
        canonicalSerialize(envelope.formation.explanatory) !==
        canonicalSerialize(expectedExplanatory)
      )
        issues.push(
          issue(
            codes.explanatory_mismatch,
            'envelope.formation.explanatory',
            'Stored explanatory state is stale.',
          ),
        );
      if (envelope.control.envelope_hash !== hashCaseEnvelope(envelope))
        issues.push(
          issue(
            codes.envelope_hash_mismatch,
            'envelope.control.envelope_hash',
            'Envelope hash does not match canonical state.',
          ),
        );
    }
    return issues;
  }

  function assertValidEnvelope(envelope: CaseEnvelope): void {
    const issues = validateEnvelope(envelope);
    if (issues.length > 0) throw new TypeError(`${issues[0]!.code}: ${issues[0]!.message}`);
  }

  function validateAcknowledgmentHistory(envelope: CaseEnvelope, issues: ContractIssue[]): void {
    const history = envelope.formation.disclosure_review_acknowledgments;
    if (!object(history)) {
      issues.push(
        issue(
          codes.disclosure_acknowledgments,
          'envelope.formation.disclosure_review_acknowledgments',
          'Disclosure-review acknowledgment history must be party-scoped.',
        ),
      );
      return;
    }
    exactKeys(history, PARTY_IDS, 'envelope.formation.disclosure_review_acknowledgments', issues);
    const acknowledgmentIds = new Set<string>();
    const eventIds = new Set<string>();
    const statementHash = hashDisclosureReviewAcknowledgmentStatement(
      spec.contracts.disclosure_acknowledgment_statement,
    );
    for (const partyId of PARTY_IDS) {
      const entries = history[partyId];
      if (!Array.isArray(entries)) {
        issues.push(
          issue(
            codes.disclosure_acknowledgments,
            `envelope.formation.disclosure_review_acknowledgments.${partyId}`,
            'Acknowledgment history must be an array.',
          ),
        );
        continue;
      }
      let priorEnvelopeVersion = 0;
      for (const [index, raw] of entries.entries()) {
        const path = `envelope.formation.disclosure_review_acknowledgments.${partyId}[${index}]`;
        if (!object(raw)) {
          issues.push(
            issue(codes.disclosure_ack_object, path, 'Acknowledgment must be an object.'),
          );
          continue;
        }
        exactKeys(
          raw,
          [
            'acknowledged_at',
            'acknowledged_at_envelope_version',
            'acknowledgment_id',
            'acknowledgment_statement_hash',
            'acknowledgment_version',
            'authenticated_subject_id',
            'dispute_id',
            'event_id',
            'formation_epoch',
            'party_id',
            'party_projection_hash',
            'party_projection_version',
            'party_readback_hash',
            'party_readback_version',
            'party_visible_version',
          ],
          path,
          issues,
        );
        const envelopeVersion = raw.acknowledged_at_envelope_version;
        const shapeValid =
          raw.acknowledgment_version === spec.contracts.disclosure_acknowledgment_version &&
          raw.dispute_id === envelope.control.case_id &&
          raw.party_id === partyId &&
          typeof raw.acknowledgment_id === 'string' &&
          isPartyScopedId('disclosure_ack', partyId, raw.acknowledgment_id) &&
          typeof raw.event_id === 'string' &&
          isPartyScopedId('disclosure_ack_event', partyId, raw.event_id) &&
          raw.authenticated_subject_id === envelope.parties[partyId].authenticated_subject_id &&
          safeInteger(raw.formation_epoch, 1) &&
          raw.formation_epoch <= envelope.parties[partyId].formation_epoch &&
          raw.party_projection_version === spec.contracts.projection_version &&
          typeof raw.party_projection_hash === 'string' &&
          HASH_PATTERN.test(raw.party_projection_hash) &&
          safeInteger(raw.party_visible_version, 1) &&
          raw.party_visible_version <=
            envelope.control.party_views[partyId].party_visible_version &&
          raw.party_readback_version === spec.contracts.readback_version &&
          typeof raw.party_readback_hash === 'string' &&
          HASH_PATTERN.test(raw.party_readback_hash) &&
          raw.acknowledgment_statement_hash === statementHash &&
          validIso(raw.acknowledged_at) &&
          safeInteger(envelopeVersion, 2) &&
          envelopeVersion <= envelope.control.envelope_version &&
          envelopeVersion > priorEnvelopeVersion;
        const currentCommitBindingValid =
          envelopeVersion !== envelope.control.envelope_version ||
          currentDisclosureReviewAcknowledgment(spec, envelope, partyId)?.acknowledgment_id ===
            raw.acknowledgment_id;
        if (!shapeValid || !currentCommitBindingValid) {
          issues.push(
            issue(
              codes.disclosure_ack_shape,
              path,
              'Disclosure-review acknowledgment shape or canonical binding is invalid.',
            ),
          );
        }
        if (
          acknowledgmentIds.has(String(raw.acknowledgment_id)) ||
          eventIds.has(String(raw.event_id))
        ) {
          issues.push(
            issue(
              codes.disclosure_ack_id_collision,
              path,
              'Disclosure-review acknowledgment identities collide.',
            ),
          );
        }
        acknowledgmentIds.add(String(raw.acknowledgment_id));
        eventIds.add(String(raw.event_id));
        if (safeInteger(envelopeVersion, 2)) priorEnvelopeVersion = envelopeVersion;
      }
    }
  }

  return { validate: validateEnvelope, assertValid: assertValidEnvelope };
}
