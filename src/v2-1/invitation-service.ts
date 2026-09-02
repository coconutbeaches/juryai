import {
  TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21,
  isAuthenticatedInvitationPrincipalV21,
  isTestOnlyInvitationFeatureEnabledV21,
  isTrustedFirstPartyInvitationActionV21,
  testOnlyInvitationFeatureAuthorityV21,
  type AuthenticatedInvitationPrincipalV21,
  type TestOnlyInvitationFeatureAuthorityV21,
  type TrustedFirstPartyInvitationActionV21,
} from './invitation-contract.js';
import {
  invitationUnavailableResultV21,
  type InvitationUnavailableResultV21,
} from './invitation-public-contract.js';

export {
  INVITATION_UNAVAILABLE_CODE_V21,
  INVITATION_UNAVAILABLE_MESSAGE_V21,
  invitationUnavailableResultV21,
  type InvitationUnavailableResultV21,
} from './invitation-public-contract.js';

export interface InvitationIssuedResultV21 {
  status: 'issued';
  invitation_id: string;
  opaque_token: string;
  csurl_path: string;
  expires_at: string;
}

export interface InvitationRedeemedResultV21 {
  status: 'redeemed';
}

export type IssueFormationInvitationResultV21 =
  InvitationIssuedResultV21 | InvitationUnavailableResultV21;
export type RedeemFormationInvitationResultV21 =
  InvitationRedeemedResultV21 | InvitationUnavailableResultV21;

export interface IssueFormationInvitationRequestV21 {
  dispute_id: string;
  authenticated_principal: AuthenticatedInvitationPrincipalV21;
  intended_account_email: string;
}

export interface RedeemFormationInvitationRequestV21 {
  opaque_token: string;
  authenticated_principal: AuthenticatedInvitationPrincipalV21;
}

export interface IssueFormationInvitationPersistenceInputV21 extends IssueFormationInvitationRequestV21 {
  feature_authority: TestOnlyInvitationFeatureAuthorityV21 | null;
  first_party_authority: TrustedFirstPartyInvitationActionV21 | null;
}

export interface RedeemFormationInvitationPersistenceInputV21 extends RedeemFormationInvitationRequestV21 {
  feature_authority: TestOnlyInvitationFeatureAuthorityV21 | null;
  first_party_authority: TrustedFirstPartyInvitationActionV21 | null;
}

export interface FormationInvitationPersistencePortV21 {
  issueInvitation(
    input: IssueFormationInvitationPersistenceInputV21,
  ): Promise<IssueFormationInvitationResultV21>;
  redeemInvitation(
    input: RedeemFormationInvitationPersistenceInputV21,
  ): Promise<RedeemFormationInvitationResultV21>;
}

export class FormationInvitationServiceV21 {
  readonly #persistence: FormationInvitationPersistencePortV21;
  readonly #featureAuthority: TestOnlyInvitationFeatureAuthorityV21 | null;
  readonly #firstPartyAuthority: TrustedFirstPartyInvitationActionV21 | null;

  constructor(input: {
    persistence: FormationInvitationPersistencePortV21;
    feature_authority: TestOnlyInvitationFeatureAuthorityV21 | null;
    first_party_authority: TrustedFirstPartyInvitationActionV21 | null;
  }) {
    this.#persistence = input.persistence;
    this.#featureAuthority = input.feature_authority;
    this.#firstPartyAuthority = input.first_party_authority;
  }

  async issueInvitation(
    input: IssueFormationInvitationRequestV21,
  ): Promise<IssueFormationInvitationResultV21> {
    if (
      !isTestOnlyInvitationFeatureEnabledV21(this.#featureAuthority) ||
      !isTrustedFirstPartyInvitationActionV21(this.#firstPartyAuthority) ||
      !isAuthenticatedInvitationPrincipalV21(input.authenticated_principal)
    ) {
      return invitationUnavailableResultV21();
    }
    return this.#persistence.issueInvitation({
      ...input,
      feature_authority: this.#featureAuthority,
      first_party_authority: this.#firstPartyAuthority,
    });
  }

  async redeemInvitation(
    input: RedeemFormationInvitationRequestV21,
  ): Promise<RedeemFormationInvitationResultV21> {
    if (
      !isTestOnlyInvitationFeatureEnabledV21(this.#featureAuthority) ||
      !isTrustedFirstPartyInvitationActionV21(this.#firstPartyAuthority) ||
      !isAuthenticatedInvitationPrincipalV21(input.authenticated_principal)
    ) {
      return invitationUnavailableResultV21();
    }
    return this.#persistence.redeemInvitation({
      ...input,
      feature_authority: this.#featureAuthority,
      first_party_authority: this.#firstPartyAuthority,
    });
  }
}

export function productionDisabledInvitationServiceV21(
  persistence: FormationInvitationPersistencePortV21,
): FormationInvitationServiceV21 {
  return new FormationInvitationServiceV21({
    persistence,
    feature_authority: null,
    first_party_authority: null,
  });
}

export function testOnlyInvitationServiceV21(
  persistence: FormationInvitationPersistencePortV21,
): FormationInvitationServiceV21 {
  return new FormationInvitationServiceV21({
    persistence,
    feature_authority: testOnlyInvitationFeatureAuthorityV21(),
    first_party_authority: TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21,
  });
}
