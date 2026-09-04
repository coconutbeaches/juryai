import type { Pool } from 'pg';
import { hashOpaqueInvitationTokenV21 } from '../v2-1/invitation-contract.js';
import type { ProductionFormationVersion } from './production-routing.js';

function supportedVersion(value: unknown): ProductionFormationVersion | null {
  return value === 'juryai-case-envelope-v2.1.2' ||
    value === 'juryai-case-envelope-v2.1.3' ||
    value === 'juryai-case-envelope-v2.1.4'
    ? value
    : null;
}

/** Read-only version selection. Each selected repository still authenticates
 * the party and validates its own exact persisted envelope; this grants no access.
 */
export function postgresContractResolution(pool: Pool) {
  return {
    resolveVersion: async (disputeId: string): Promise<ProductionFormationVersion | null> => {
      const result = await pool.query(
        'select schema_version from juryai_v21.formation_disputes where dispute_id = $1',
        [disputeId],
      );
      return supportedVersion(result.rows[0]?.schema_version);
    },
    resolveInvitationVersion: async (token: string): Promise<ProductionFormationVersion | null> => {
      const result = await pool.query(
        'select d.schema_version from juryai_v21.formation_invitations i join juryai_v21.formation_disputes d on d.dispute_id = i.dispute_id where i.token_hash = $1',
        [hashOpaqueInvitationTokenV21(token)],
      );
      return supportedVersion(result.rows[0]?.schema_version);
    },
  };
}
