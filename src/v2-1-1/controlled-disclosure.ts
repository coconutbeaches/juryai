import { randomUUID } from 'node:crypto';
import type {
  CommitControlledDisclosureInputV211,
  CommitControlledDisclosureResultV211,
  StoredFormationDisputeV211,
} from './formation-persistence.js';

export interface ControlledDisclosureRepositoryV211 {
  findById(disputeId: string): Promise<StoredFormationDisputeV211 | null>;
  commitControlledDisclosure(
    input: CommitControlledDisclosureInputV211,
  ): Promise<CommitControlledDisclosureResultV211>;
}

const CONTROLLED_DISCLOSURE_APPLICATION_BRAND_V211: unique symbol = Symbol(
  'juryai-controlled-disclosure-application-v2.1.1',
);

export interface TrustedControlledDisclosureApplicationV211 {
  readonly authority_kind: 'trusted_controlled_disclosure_application_v2_1_1';
  readonly [CONTROLLED_DISCLOSURE_APPLICATION_BRAND_V211]: true;
}

/** Server-owned capability; it is never accepted in a request or WebMCP argument. */
export const TRUSTED_CONTROLLED_DISCLOSURE_APPLICATION_V211: TrustedControlledDisclosureApplicationV211 =
  Object.freeze({
    authority_kind: 'trusted_controlled_disclosure_application_v2_1_1',
    [CONTROLLED_DISCLOSURE_APPLICATION_BRAND_V211]: true as const,
  });

export async function openControlledDisclosureV211(input: {
  authority: TrustedControlledDisclosureApplicationV211;
  repository: ControlledDisclosureRepositoryV211;
  dispute_id: string;
}): Promise<CommitControlledDisclosureResultV211> {
  if (input.authority !== TRUSTED_CONTROLLED_DISCLOSURE_APPLICATION_V211) {
    throw new TypeError('Trusted controlled-disclosure application authority is required.');
  }
  const current = await input.repository.findById(input.dispute_id);
  if (!current) return { status: 'conflict', current: null };
  return input.repository.commitControlledDisclosure({
    dispute_id: input.dispute_id,
    command_id: `ceremony_system_${randomUUID()}`,
    expected_internal_envelope_version: current.internal_envelope_version,
    expected_internal_envelope_hash: current.internal_envelope_hash,
  });
}
