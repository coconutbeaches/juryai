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
import { errorResponse } from './http.js';
import { JuryAiWebServer } from './server.js';
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

export const handleBootstrap = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) => instance.bootstrap(incoming));

export const handleDisclosure = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) => instance.acceptDisclosure(incoming));

export const handleCaseService = (request: Request): Promise<Response> =>
  handle(request, (instance, incoming) => instance.caseService(incoming));
