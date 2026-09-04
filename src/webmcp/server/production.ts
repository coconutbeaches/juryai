import { Pool } from 'pg';
import { createLiveSemanticCompiler } from '../compiler/index.js';
import {
  CaseRuntime,
  PostgresCaseRuntimeStore,
  randomIdFactory,
  randomSaltFactory,
  systemClock,
} from '../runtime/index.js';
import { loadJuryAiWebServerConfig } from './config.js';
import { JURYAI_P2_DISCLOSURE_VERSION } from './disclosure.js';
import { errorResponse, jsonResponse, requireMethod } from './http.js';
import { JuryAiWebServer } from './server.js';
import { readSessionCookie } from './session.js';
import { supabaseAuthForRequest } from './supabase-auth.js';
import { PostgresWebSessionStore } from './web-session-store.js';
import { createRuntimeCaseService } from '../service/index.js';
import { principalForSupabaseSubject, sessionRuntimeContextProvider } from './session.js';
import { PostgresDisclosureReviewRepositoryV212 } from '../../v2-1-2/postgres-disclosure-review-repository.js';
import {
  PostgresFormationInvitationRepositoryV212,
  productionInvitationAuthorityV212,
} from '../../v2-1-2/postgres-formation-invitation-repository.js';
import { createProductionCaseServiceV212 } from '../../v2-1-2/production-case-service.js';
import { createProductionFirstPartyServiceV212 } from '../../v2-1-2/production-first-party.js';
import { PostgresDisclosureReviewRepositoryV213 } from '../../v2-1-3/postgres-disclosure-review-repository.js';
import {
  PostgresFormationInvitationRepositoryV213,
  productionInvitationAuthorityV213,
} from '../../v2-1-3/postgres-formation-invitation-repository.js';
import {
  createInitialProductionDisputeV213,
  createProductionCaseServiceV213,
} from '../../v2-1-3/production-case-service.js';
import { createProductionFirstPartyServiceV213 } from '../../v2-1-3/production-first-party.js';
import {
  createProductionVersionedCaseServiceV213,
  createVersionedFirstPartyService,
} from '../../v2-1-3/production-routing.js';
import { createLiveSemanticCompiler as createAbsenceCompiler } from '../compiler-v0-3/config.js';
import { postgresContractResolution } from '../../v2-1-3/postgres-contract-resolution.js';

let productionServer: Promise<JuryAiWebServer> | null = null;

async function buildProductionServer(): Promise<JuryAiWebServer> {
  const config = loadJuryAiWebServerConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5, allowExitOnIdle: true });
  const caseStore = new PostgresCaseRuntimeStore({ pool });
  const webStore = new PostgresWebSessionStore(pool);
  await Promise.all([caseStore.assertReady(), webStore.assertReady()]);
  const compiler = createLiveSemanticCompiler({ env: process.env });
  const absenceCompiler = config.v212ProductionEnabled
    ? createAbsenceCompiler({ env: process.env })
    : null;
  const currentFormationStore = config.v212ProductionEnabled
    ? new PostgresDisclosureReviewRepositoryV213({ pool })
    : null;
  const currentInvitationStore =
    config.v212ProductionEnabled && config.invitationAccountCommitmentSecret
      ? new PostgresFormationInvitationRepositoryV213({
          pool,
          account_commitment_secret: config.invitationAccountCommitmentSecret,
        })
      : null;
  if (currentFormationStore && currentInvitationStore)
    await Promise.all([currentFormationStore.assertReady(), currentInvitationStore.assertReady()]);
  const { resolveVersion, resolveInvitationVersion } = postgresContractResolution(pool);

  const formationStore = config.v212ProductionEnabled
    ? new PostgresDisclosureReviewRepositoryV212({ pool })
    : null;
  const invitationStore =
    config.v212ProductionEnabled && config.invitationAccountCommitmentSecret
      ? new PostgresFormationInvitationRepositoryV212({
          pool,
          account_commitment_secret: config.invitationAccountCommitmentSecret,
        })
      : null;
  if (formationStore && invitationStore) {
    await Promise.all([formationStore.assertReady(), invitationStore.assertReady()]);
  }

  let runtime: CaseRuntime | null = null;
  const runtimeForRequest = (): CaseRuntime => {
    runtime ??= new CaseRuntime({
      store: caseStore,
      compiler,
      clock: systemClock,
      ids: randomIdFactory(),
      salts: randomSaltFactory(),
      reviewUrl: (caseId) => `${config.publicOrigin}/cases/${encodeURIComponent(caseId)}/review`,
      disclosure: { version: JURYAI_P2_DISCLOSURE_VERSION },
    });
    return runtime;
  };

  const legacyForSession = async (session: Parameters<typeof sessionRuntimeContextProvider>[0]) =>
    createRuntimeCaseService({
      runtime: runtimeForRequest(),
      contextProvider: sessionRuntimeContextProvider(session),
    });

  return new JuryAiWebServer({
    config,
    persistence: webStore,
    authForRequest: () => supabaseAuthForRequest(config),
    runtime: runtimeForRequest,
    caseStore: () => caseStore,
    caseServiceForSession: async (session) => {
      const legacy = await legacyForSession(session);
      const v212 =
        config.v212ProductionEnabled && formationStore && config.invitationAccountCommitmentSecret
          ? createProductionCaseServiceV212({
              authenticated_subject_id: session.principal_id,
              repository: formationStore,
              compiler,
              review_url: (disputeId) =>
                `${config.publicOrigin}/cases/${encodeURIComponent(disputeId)}/review`,
              idempotency_secret: config.invitationAccountCommitmentSecret,
            })
          : null;
      const v213 =
        config.v212ProductionEnabled &&
        currentFormationStore &&
        absenceCompiler &&
        config.invitationAccountCommitmentSecret
          ? createProductionCaseServiceV213({
              authenticated_subject_id: session.principal_id,
              repository: currentFormationStore,
              compiler: absenceCompiler,
              review_url: (id) => `${config.publicOrigin}/cases/${encodeURIComponent(id)}/review`,
              idempotency_secret: config.invitationAccountCommitmentSecret,
            })
          : null;
      return createProductionVersionedCaseServiceV213({
        enabled: config.v212ProductionEnabled === true,
        legacy,
        v212,
        v213,
        resolveVersion,
        startCaseId: (client_request_id) =>
          createInitialProductionDisputeV213({
            authenticated_subject_id: session.principal_id,
            client_request_id,
            idempotency_secret: config.invitationAccountCommitmentSecret!,
          }).control.case_id,
      });
    },
    v212FirstPartyForSubject:
      config.v212ProductionEnabled &&
      formationStore &&
      invitationStore &&
      currentFormationStore &&
      currentInvitationStore
        ? (subject) =>
            createVersionedFirstPartyService({
              resolveVersion,
              resolveInvitationVersion,
              v213: createProductionFirstPartyServiceV213({
                enabled: true,
                authenticated_subject_id: principalForSupabaseSubject(subject),
                repository: currentFormationStore,
                invitations: currentInvitationStore,
                invitation_authority: productionInvitationAuthorityV213(true),
              }),
              v212: createProductionFirstPartyServiceV212({
                enabled: true,
                authenticated_subject_id: principalForSupabaseSubject(subject),
                repository: formationStore,
                invitations: invitationStore,
                invitation_authority: productionInvitationAuthorityV212(true),
              }),
            })
        : undefined,
  });
}

function server(): Promise<JuryAiWebServer> {
  productionServer ??= buildProductionServer();
  return productionServer;
}

async function handle(
  request: Request,
  operation: (server: JuryAiWebServer, request: Request) => Promise<Response>,
): Promise<Response> {
  try {
    return await operation(await server(), request);
  } catch {
    return errorResponse(500, 'SERVER_UNAVAILABLE', 'The JuryAI server is unavailable.');
  }
}

export const handleRequestOtp = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) => instance.requestOtp(incoming));

export const handleVerifyOtp = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) => instance.verifyOtp(incoming));

export const handleLogout = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) => instance.logout(incoming));

export const handleBootstrap = (request: Request): Promise<Response> => {
  const rejected = requireMethod(request, 'GET');
  if (rejected) return Promise.resolve(rejected);
  const cookie = request.headers.get('Cookie');
  if (
    readSessionCookie(cookie, '__Host-juryai_session') === null &&
    readSessionCookie(cookie, 'juryai_session_dev') === null
  ) {
    return Promise.resolve(jsonResponse({ authenticated: false }));
  }
  return handle(request, (instance, incoming) => instance.bootstrap(incoming));
};

export const handleDisclosure = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) => instance.acceptDisclosure(incoming));

export const handleCaseService = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) => instance.caseService(incoming));

function caseIdFromPath(
  request: Request,
  operation:
    | 'review'
    | 'corrections'
    | 'attestations'
    | 'invitations'
    | 'disclosure-review'
    | 'review-challenges'
    | 'review-actions',
): string {
  const match = new RegExp(`/api/juryai/cases/([^/]+)/${operation}$`, 'u').exec(
    new URL(request.url).pathname,
  );
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return '';
  }
}

export const handleCaseReview = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) =>
    instance.reviewCase(incoming, caseIdFromPath(incoming, 'review')),
  );

export const handleCaseCorrection = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) =>
    instance.correctCase(incoming, caseIdFromPath(incoming, 'corrections')),
  );

export const handleCaseAttestation = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) =>
    instance.attestCase(incoming, caseIdFromPath(incoming, 'attestations')),
  );

export const handleFormationInvitation = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) =>
    instance.issueFormationInvitation(incoming, caseIdFromPath(incoming, 'invitations')),
  );

export const handleDisclosureReviewAcknowledgment = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) =>
    instance.acknowledgeDisclosureReview(incoming, caseIdFromPath(incoming, 'disclosure-review')),
  );

export const handlePartyReviewChallenge = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) =>
    instance.issuePartyReviewChallenge(incoming, caseIdFromPath(incoming, 'review-challenges')),
  );

export const handlePartyReviewAction = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) =>
    instance.executePartyReviewAction(incoming, caseIdFromPath(incoming, 'review-actions')),
  );

export const handleJoinInvitation = (request: Request): Promise<Response> => {
  const match = /\/api\/juryai\/join\/([^/]+)$/u.exec(new URL(request.url).pathname);
  let token = '';
  try {
    token = match ? decodeURIComponent(match[1]!) : '';
  } catch {
    token = '';
  }
  return handle(request, (instance, incoming) =>
    instance.redeemFormationInvitation(incoming, token),
  );
};
