import { JURYAI_P2_DISCLOSURE_VERSION } from './disclosure.js';

export type ServerEnvironment = Record<string, string | undefined>;

export interface JuryAiCookieConfig {
  name: '__Host-juryai_session' | 'juryai_session_dev';
  secure: boolean;
}

export interface JuryAiWebServerConfig {
  publicOrigin: string;
  databaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  production: boolean;
  cookie: JuryAiCookieConfig;
}

function required(env: ServerEnvironment, name: string): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function absoluteOrigin(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute origin.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.origin === 'null'
  ) {
    throw new Error(`${name} must contain only scheme, host, and optional port.`);
  }
  return parsed;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function loadJuryAiWebServerConfig(
  env: ServerEnvironment = process.env,
): JuryAiWebServerConfig {
  const production = env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';
  const publicUrl = absoluteOrigin(required(env, 'JURYAI_PUBLIC_ORIGIN'), 'JURYAI_PUBLIC_ORIGIN');

  if (publicUrl.protocol !== 'https:') {
    if (production) throw new Error('JURYAI_PUBLIC_ORIGIN must use HTTPS in production.');
    if (publicUrl.protocol !== 'http:' || !isLoopback(publicUrl.hostname)) {
      throw new Error('Plain HTTP is permitted only for loopback development origins.');
    }
  }

  if (env.JURYAI_PERSISTENCE_ADAPTER !== 'postgres') {
    throw new Error('JURYAI_PERSISTENCE_ADAPTER=postgres is required by the web server.');
  }

  const configuredDisclosure = env.JURYAI_DISCLOSURE_VERSION;
  if (configuredDisclosure !== undefined && configuredDisclosure !== JURYAI_P2_DISCLOSURE_VERSION) {
    throw new Error('JURYAI_DISCLOSURE_VERSION does not match the server-owned P2 version.');
  }

  const supabaseUrl = absoluteOrigin(required(env, 'JURYAI_SUPABASE_URL'), 'JURYAI_SUPABASE_URL');
  if (supabaseUrl.protocol !== 'https:') {
    throw new Error('JURYAI_SUPABASE_URL must use HTTPS.');
  }

  const secure = publicUrl.protocol === 'https:';
  return {
    publicOrigin: publicUrl.origin,
    databaseUrl: required(env, 'JURYAI_DATABASE_URL'),
    supabaseUrl: supabaseUrl.origin,
    supabasePublishableKey: required(env, 'JURYAI_SUPABASE_PUBLISHABLE_KEY'),
    production,
    cookie: secure
      ? { name: '__Host-juryai_session', secure: true }
      : { name: 'juryai_session_dev', secure: false },
  };
}
