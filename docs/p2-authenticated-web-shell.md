# P2 authenticated frameworkless web shell

Step 63.5 composes the completed P2 runtime into a deployable, same-origin
Vercel artifact. It does not create a Vercel or Supabase project, deploy an
environment, call a live model, or implement Step 64 review and attestation.

## Browser and server boundary

The browser loads static HTML plus a small Vite bundle. It talks only to the
same-origin JuryAI endpoints under `/api/juryai`. It has no Supabase client and
receives no Supabase access token, refresh token, user UUID, principal, session
database identity, database credential, or compiler credential.

Supabase Auth is used server-side for invite-only email OTP proof. The request
uses `shouldCreateUser: false`. A successful six-digit email OTP verification
provides the Supabase user UUID to the server, which derives
`supabase:<verified-user-uuid>` and issues a separate opaque JuryAI session.
Only the session token's SHA-256 hex digest is stored.

HTTPS uses the `__Host-juryai_session` cookie with `HttpOnly`, `Secure`,
`SameSite=Strict`, `Path=/`, no `Domain`, and a fixed seven-day lifetime.
Loopback HTTP development uses the visibly separate `juryai_session_dev`
cookie without `Secure`. Non-loopback HTTP and production HTTP fail closed.

## Disclosure and tools

The server owns disclosure version `juryai-p2-disclosure-v0.1.0` and its frozen
copy. Authentication may precede acceptance, but the server rejects every
case-service operation until the current version has an append-only acceptance
record. The browser does not construct the HTTP `CaseServicePort` or register
WebMCP tools before that acceptance.

After acceptance, the browser independently calls `getCaseState({})`, then
feature-detects `document.modelContext` and reuses
`registerJuryAiWebMcpTools(...)`. Exactly `start_case`, `get_case_state`, and
`submit_turn` are registered. Browsers without WebMCP retain authentication,
disclosure, and active-draft discovery.

Registration and HTTP requests share a page-lifetime `AbortController`.
Logout, session invalidation, `pagehide`, hot reinitialization, and BFCache
restoration unregister stale tools and abort stale requests before a fresh
initialization.

## Deployment contract

Required server configuration:

```text
JURYAI_PUBLIC_ORIGIN=https://the-exact-vercel-production-hostname
JURYAI_PERSISTENCE_ADAPTER=postgres
JURYAI_DATABASE_URL=postgresql://...
JURYAI_COMPILER_API_KEY=...
JURYAI_COMPILER_MODEL=gpt-5.6-sol
JURYAI_COMPILER_OMIT_SAMPLING_PARAMS=1
JURYAI_SUPABASE_URL=https://project-ref.supabase.co
JURYAI_SUPABASE_PUBLISHABLE_KEY=...
JURYAI_DISCLOSURE_VERSION=juryai-p2-disclosure-v0.1.0
```

No secret uses a `VITE_` name. The canonical review URL is generated only by
the server as `${JURYAI_PUBLIC_ORIGIN}/cases/:caseId/review`. The route is
reserved by the static shell; Step 64 owns the substantive read-back and
attestation surface.

Build the browser artifact with:

```bash
npm run build:web
```

The Vercel Node Functions use the Web `Request`/`Response` signature. Every
state-changing endpoint validates `Origin` exactly against
`JURYAI_PUBLIC_ORIGIN`; authenticated responses are `private, no-store` and
carry defense-in-depth CSP, nosniff, no-referrer, and framing protections.
