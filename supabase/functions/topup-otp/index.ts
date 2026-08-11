import { createClient } from "npm:@supabase/supabase-js@2.112.3";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const HYDRA_API_BASE = "https://hydra.unicity.net/v6";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const OTP_RATE_LIMIT_PER_EMAIL = 50;
const OTP_RATE_LIMIT_PER_IP = 100;
const ALLOWED_ORIGINS = new Set([
  "https://topup.colbycook.chatgpt.site",
  "http://terminal.local:4173",
  "http://localhost:3000",
]);

type Json = Record<string, unknown>;

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://topup.colbycook.chatgpt.site",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
}

function json(origin: string | null, body: Json, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), ...extraHeaders },
  });
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^@\s]+@unicity\.com$/.test(email) && email.length <= 254 ? email : null;
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function hydraMessage(payload: Json): string {
  const nested = record(payload.data);
  return typeof payload.message === "string"
    ? payload.message
    : typeof nested.message === "string"
      ? nested.message
      : "The verification service rejected the request.";
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json(origin, { error: "Method not allowed." }, 405);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(origin, { error: "This sign-in request is not allowed." }, 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
    return json(origin, { error: "The secure session service is not configured." }, 503);
  }

  let body: Json;
  try {
    body = record(await request.json());
  } catch {
    return json(origin, { error: "A valid JSON request is required." }, 400);
  }

  const email = normalizedEmail(body.email);
  if (!email) return json(origin, { error: "Use your @unicity.com employee email." }, 400);
  const action = body.action;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (action === "generate") {
    const ip = clientIp(request);
    const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const [emailQuota, ipQuota] = await Promise.all([
      admin.from("topup_otp_challenges").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", cutoff),
      admin.from("topup_otp_challenges").select("id", { count: "exact", head: true }).eq("client_ip", ip).gte("created_at", cutoff),
    ]);

    if (emailQuota.error || ipQuota.error) return json(origin, { error: "The verification limit could not be checked." }, 503);
    if ((emailQuota.count ?? 0) >= OTP_RATE_LIMIT_PER_EMAIL) {
      return json(origin, { error: "Too many code requests for this email. Please wait 10 minutes and try again." }, 429, { "Retry-After": "600" });
    }
    if ((ipQuota.count ?? 0) >= OTP_RATE_LIMIT_PER_IP) {
      return json(origin, { error: "Too many code requests from this network. Please wait 10 minutes and try again." }, 429, { "Retry-After": "600" });
    }

    const hydraResponse = await fetch(`${HYDRA_API_BASE}/otp/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const hydra = record(await hydraResponse.json().catch(() => ({})));
    const hydraData = record(hydra.data);
    const message = hydraMessage(hydra);
    const validationId = typeof hydraData.validation_id === "string" ? hydraData.validation_id : null;
    const generated = Boolean(validationId) && (
      (hydraResponse.ok && hydra.success === true)
      || message.toLowerCase().includes("new validation code generated")
    );
    if (!generated) {
      const retryingTooSoon = message.toLowerCase().includes("wait before requesting");
      return json(origin, { error: message }, retryingTooSoon ? 429 : 400, retryingTooSoon ? { "Retry-After": "60" } : {});
    }

    const suppliedExpiry = typeof hydraData.expires_at === "string" ? new Date(hydraData.expires_at) : null;
    const expiresAt = suppliedExpiry && Number.isFinite(suppliedExpiry.getTime())
      ? suppliedExpiry.toISOString()
      : new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: insertError } = await admin.from("topup_otp_challenges").insert({
      email,
      client_ip: ip,
      validation_id: validationId,
      expires_at: expiresAt,
    });
    if (insertError) return json(origin, { error: "The verification request could not be saved." }, 503);

    await admin.from("topup_otp_challenges").delete().lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    return json(origin, { success: true, message: "Verification code sent." });
  }

  if (action === "verify") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) return json(origin, { error: "Enter the six-digit code from your email." }, 400);

    const { data: challenge, error: challengeError } = await admin
      .from("topup_otp_challenges")
      .select("id,email,validation_id,expires_at")
      .eq("email", email)
      .is("verified_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (challengeError) return json(origin, { error: "The pending verification could not be read." }, 503);
    if (!challenge) return json(origin, { error: "No active code was found. Request a new code and try again." }, 400);

    const hydraResponse = await fetch(`${HYDRA_API_BASE}/otp/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, validation_id: challenge.validation_id }),
    });
    const hydra = record(await hydraResponse.json().catch(() => ({})));
    const message = hydraMessage(hydra);
    const verifiedByHydra = hydraResponse.ok && hydra.success === true;
    const verifiedEmployeeWithoutCustomer = message.toLowerCase().includes("customer not found");
    if (!verifiedByHydra && !verifiedEmployeeWithoutCustomer) return json(origin, { error: message }, 400);

    let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) {
      const created = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (created.error && !created.error.message.toLowerCase().includes("already")) {
        return json(origin, { error: "The employee account could not be created." }, 500);
      }
      link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    }
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) return json(origin, { error: "The secure sign-in token could not be created." }, 500);

    const sessionClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verified, error: sessionError } = await sessionClient.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (sessionError || !verified.session) return json(origin, { error: "The secure session could not be created." }, 500);

    const { error: updateError } = await admin
      .from("topup_otp_challenges")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", challenge.id)
      .is("verified_at", null);
    if (updateError) return json(origin, { error: "The verification could not be finalized." }, 500);

    return json(origin, {
      success: true,
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    });
  }

  return json(origin, { error: "Unknown verification action." }, 400);
});
