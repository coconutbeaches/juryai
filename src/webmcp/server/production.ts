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

let productionServer: Promise<JuryAiWebServer> | null = null;

async function buildProductionServer(): Promise<JuryAiWebServer> {
  const config = loadJuryAiWebServerConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5, allowExitOnIdle: true });
  const caseStore = new PostgresCaseRuntimeStore({ pool });
  const webStore = new PostgresWebSessionStore(pool);
  await Promise.all([caseStore.assertReady(), webStore.assertReady()]);

  let runtime: CaseRuntime | null = null;
  const runtimeForRequest = (): CaseRuntime => {
    runtime ??= new CaseRuntime({
      store: caseStore,
      compiler: createLiveSemanticCompiler({ env: process.env }),
      clock: systemClock,
      ids: randomIdFactory(),
      salts: randomSaltFactory(),
      reviewUrl: (caseId) => `${config.publicOrigin}/cases/${encodeURIComponent(caseId)}/review`,
      disclosure: { version: JURYAI_P2_DISCLOSURE_VERSION },
    });
    return runtime;
  };

  return new JuryAiWebServer({
    config,
    persistence: webStore,
    authForRequest: () => supabaseAuthForRequest(config),
    runtime: runtimeForRequest,
    caseStore: () => caseStore,
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
  operation: 'review' | 'corrections' | 'attestations',
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
