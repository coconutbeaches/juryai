import { createClient } from '@supabase/supabase-js';
import type { JuryAiWebServerConfig } from './config.js';

const SUPABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface SupabaseAuthClientLike {
  auth: {
    signInWithOtp(input: {
      email: string;
      options: { shouldCreateUser: false };
    }): Promise<{ error: unknown }>;
    verifyOtp(input: { email: string; token: string; type: 'email' }): Promise<{
      data: { user: { id: string } | null; session?: unknown };
      error: unknown;
    }>;
  };
}

export interface SupabaseAuthGateway {
  requestEmailOtp(email: string): Promise<void>;
  verifyEmailOtp(email: string, token: string): Promise<string | null>;
}

export function createSupabaseAuthGateway(client: SupabaseAuthClientLike): SupabaseAuthGateway {
  return {
    requestEmailOtp: async (email) => {
      await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    },
    verifyEmailOtp: async (email, token) => {
      const result = await client.auth.verifyOtp({ email, token, type: 'email' });
      const subject = result.data.user?.id;
      if (result.error !== null || subject === undefined || !SUPABASE_UUID.test(subject)) {
        return null;
      }
      return subject.toLowerCase();
    },
  };
}

/** A fresh non-persisting client per request; verified sessions are never cached. */
export function supabaseAuthForRequest(config: JuryAiWebServerConfig): SupabaseAuthGateway {
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return createSupabaseAuthGateway(client as unknown as SupabaseAuthClientLike);
}
