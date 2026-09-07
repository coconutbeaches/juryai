import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const RESEND_API_URL = "https://api.resend.com/emails";
const AUTH_FROM = "JuryAI <auth@juryai.org>";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const configuredHookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  const from = AUTH_FROM;

  if (!resendApiKey || !configuredHookSecret) {
    console.error("juryai-auth-email: missing required secret", {
      hasResendApiKey: Boolean(resendApiKey),
      hasHookSecret: Boolean(configuredHookSecret),
    });
    return json({ error: "server_not_configured" }, 500);
  }

  const hookSecret = configuredHookSecret.startsWith("v1,whsec_")
    ? configuredHookSecret.slice("v1,whsec_".length)
    : configuredHookSecret;

  const payload = await req.text();
  let verified: unknown;

  try {
    const webhook = new Webhook(hookSecret);
    verified = webhook.verify(payload, Object.fromEntries(req.headers));
  } catch {
    console.error("juryai-auth-email: invalid webhook signature");
    return json({ error: "invalid_signature" }, 401);
  }

  const event = asRecord(verified);
  const user = asRecord(event.user);
  const emailObject = asRecord(event.email);
  const emailData = Object.keys(asRecord(event.email_data)).length > 0
    ? asRecord(event.email_data)
    : emailObject;

  const email =
    (typeof user.email === "string" ? user.email : undefined) ??
    (typeof event.email === "string" ? event.email : undefined) ??
    (typeof emailData.email === "string" ? emailData.email : undefined);

  const token =
    (typeof emailData.token === "string" ? emailData.token : undefined) ??
    (typeof event.token === "string" ? event.token : undefined);

  const action =
    (typeof emailData.email_action_type === "string" ? emailData.email_action_type : undefined) ??
    (typeof event.email_action_type === "string" ? event.email_action_type : undefined);

  const validToken = typeof token === "string" && /^[0-9]{6,10}$/.test(token);

  if (!email || !validToken) {
    console.error("juryai-auth-email: unsupported hook payload", {
      topLevelKeys: Object.keys(event),
      userKeys: Object.keys(user),
      emailDataKeys: Object.keys(emailData),
      recipientPresent: Boolean(email),
      tokenType: typeof token,
      tokenLength: typeof token === "string" ? token.length : null,
      tokenDigitsOnly: typeof token === "string" ? /^[0-9]+$/.test(token) : false,
      action: action ?? null,
    });
    return json({ error: "invalid_auth_email_payload" }, 400);
  }

  const isSignIn = action === "magiclink" || action === "email" || action === "recovery" || !action;
  const subject = isSignIn
    ? "Your JuryAI verification code"
    : "Your JuryAI security code";

  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2521;background:#f5f7f3;padding:32px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dfe5dc;border-radius:12px;padding:32px;">
      <div style="font-size:14px;color:#667066;margin-bottom:8px;">JuryAI</div>
      <h1 style="font-size:24px;margin:0 0 18px;">Sign in to JuryAI</h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 18px;">Enter this verification code in JuryAI:</p>
      <div style="font-size:34px;font-weight:700;letter-spacing:8px;margin:20px 0 24px;">${token}</div>
      <p style="font-size:14px;line-height:1.5;color:#667066;margin:0;">This code expires shortly and can only be used once. If you did not request this, you can ignore this email.</p>
    </div>
  </body>
</html>`;

  const text = `JuryAI verification code: ${token}\n\nThis code expires shortly and can only be used once. If you did not request this, you can ignore this email.`;

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    console.error("juryai-auth-email: Resend delivery failed", {
      status: response.status,
      body: await response.text(),
    });
    return json({ error: "email_delivery_failed" }, 503);
  }

  return json({});
});
