export const API_SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store',
  Pragma: 'no-cache',
  'Content-Security-Policy':
    "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
} as const;

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(API_SECURITY_HEADERS);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [name, value] of new Headers(extraHeaders)) headers.set(name, value);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

export function requireMethod(request: Request, method: 'GET' | 'POST'): Response | null {
  return request.method === method
    ? null
    : errorResponse(405, 'METHOD_NOT_ALLOWED', `Use ${method} for this endpoint.`);
}

export function requireSameOrigin(request: Request, publicOrigin: string): Response | null {
  return request.headers.get('Origin') === publicOrigin
    ? null
    : errorResponse(403, 'ORIGIN_REJECTED', 'The request origin is not permitted.');
}

export async function readJsonBody(request: Request, maximumBytes = 65_536): Promise<unknown> {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json')
    throw new TypeError('Content-Type must be application/json.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new TypeError('Request body is too large.');
  }
  return JSON.parse(text) as unknown;
}
