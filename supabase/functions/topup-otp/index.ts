import { createClient } from "npm:@supabase/supabase-js@2.112.3";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const HYDRA_API_BASE = "https://hydra.unicity.net/v6";
const EVENTS_AUTH_API_BASE = "https://events.unicity.com/api/auth";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const OTP_RATE_LIMIT_PER_EMAIL = 50;
const OTP_RATE_LIMIT_PER_IP = 100;
const ALLOWED_ORIGINS = new Set([
  "https://topup.colbycook.chatgpt.site",
  "http://terminal.local:4173",
  "http://localhost:3000",
]);

type Json = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient>;

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

function nestedString(payload: unknown, normalizedKey: string, depth = 0): string | null {
  if (depth > 5 || !payload || typeof payload !== "object") return null;
  const entries = Object.entries(payload as Json);
  for (const [key, value] of entries) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, "") !== normalizedKey) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const [, value] of entries) {
    const nested = nestedString(value, normalizedKey, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function hydraMessage(payload: Json): string {
  const nested = record(payload.data);
  return typeof payload.message === "string"
    ? payload.message
    : typeof nested.message === "string"
      ? nested.message
      : "The verification service rejected the request.";
}

function apiMessage(payload: Json, fallback: string): string {
  const nested = record(payload.data);
  return typeof payload.error === "string"
    ? payload.error
    : typeof payload.message === "string"
      ? payload.message
      : typeof nested.message === "string"
        ? nested.message
        : fallback;
}

async function eventsAdminGenerate(email: string): Promise<{ success: boolean; message: string; status: number }> {
  const response = await fetch(`${EVENTS_AUTH_API_BASE}/otp/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const payload = record(await response.json().catch(() => ({})));
  const message = apiMessage(payload, "The administrator verification code could not be sent.");
  const replacementGenerated = message.toLowerCase().includes("new validation code generated");
  return {
    success: (response.ok && payload.success === true) || replacementGenerated,
    message,
    status: response.status,
  };
}

async function eventsAdminVerify(email: string, code: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${EVENTS_AUTH_API_BASE}/otp/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const payload = record(await response.json().catch(() => ({})));
  const token = typeof payload.token === "string" ? payload.token : "";
  if (!response.ok || payload.success !== true || !token) {
    return { success: false, message: apiMessage(payload, "The verification code is invalid or expired.") };
  }
  const identityResponse = await fetch(`${EVENTS_AUTH_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const identityPayload = record(await identityResponse.json().catch(() => ({})));
  const user = record(identityPayload.user);
  const verifiedEmail = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  const role = typeof user.role === "string" ? user.role.toLowerCase() : "";
  if (!identityResponse.ok || verifiedEmail !== email || role !== "admin") {
    return { success: false, message: "The administrator identity could not be confirmed." };
  }
  return { success: true, message: "Administrator identity verified." };
}

async function createSupabaseSession(
  origin: string | null,
  admin: AdminClient,
  supabaseUrl: string,
  publishableKey: string,
  email: string,
  isTopUpAdmin: boolean,
): Promise<Response> {
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

  const fallbackName = email.split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ") || "Team member";
  const { data: directoryEntry } = await admin.from("topup_user_directory").select("display_name").eq("email", email).maybeSingle();
  const displayName = (directoryEntry as { display_name?: string } | null)?.display_name?.trim() || fallbackName;
  const { error: directoryError } = await admin.from("topup_user_directory").upsert({
    email,
    display_name: displayName,
    last_login_at: new Date().toISOString(),
    is_admin: isTopUpAdmin,
  }, { onConflict: "email" });
  const { error: profileError } = await admin.from("profiles").upsert({
    id: verified.session.user.id,
    email,
    full_name: displayName,
  }, { onConflict: "id" });
  if (directoryError || profileError) return json(origin, { error: "The employee profile could not be prepared." }, 500);

  return json(origin, {
    success: true,
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
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

  const { data: topUpAdmin, error: topUpAdminError } = await admin.from("topup_admins").select("email").eq("email", email).maybeSingle();
  if (topUpAdminError) return json(origin, { error: "Administrator access could not be checked." }, 503);
  const isTopUpAdmin = Boolean(topUpAdmin);

  if (action === "generate") {
    if (isTopUpAdmin) {
      const generated = await eventsAdminGenerate(email);
      if (!generated.success) {
        const status = generated.status === 429 ? 429 : 400;
        return json(origin, { error: generated.message }, status, status === 429 ? { "Retry-After": "60" } : {});
      }
      return json(origin, { success: true, message: "Verification code sent." });
    }

    const ip = clientIp(request);
    const now = new Date().toISOString();
    const { data: activeChallenge, error: activeChallengeError } = await admin
      .from("topup_otp_challenges")
      .select("id")
      .eq("email", email)
      .is("verified_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeChallengeError) return json(origin, { error: "The pending verification could not be checked." }, 503);
    if (activeChallenge) {
      return json(origin, { success: true, message: "A valid verification code is already waiting for you." });
    }

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
    // Hydra's normal and resend responses do not always nest the challenge at
    // the same depth. Find the exact validation_id field without accepting an
    // unrelated generic `id` value.
    const validationId = nestedString(hydra, "validationid");
    const generated = Boolean(validationId) && (
      (hydraResponse.ok && hydra.success === true)
      || message.toLowerCase().includes("new validation code generated")
    );
    if (!generated) {
      const retryingTooSoon = message.toLowerCase().includes("wait before requesting");
      if (message.toLowerCase().includes("validation code generated")) {
        console.error("Hydra generated an OTP without a readable validation_id", {
          status: hydraResponse.status,
          topLevelKeys: Object.keys(hydra),
          dataKeys: Object.keys(hydraData),
        });
        return json(origin, { error: "The code was emailed, but its verification challenge could not be saved. Please wait one minute and try again." }, 502);
      }
      return json(origin, { error: message }, retryingTooSoon ? 429 : 400, retryingTooSoon ? { "Retry-After": "60" } : {});
    }

    const suppliedExpiryValue = nestedString(hydra, "expiresat");
    const suppliedExpiry = suppliedExpiryValue ? new Date(suppliedExpiryValue) : null;
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

    if (isTopUpAdmin) {
      const verifiedAdmin = await eventsAdminVerify(email, code);
      if (!verifiedAdmin.success) return json(origin, { error: verifiedAdmin.message }, 400);
      return await createSupabaseSession(origin, admin, supabaseUrl, publishableKey, email, isTopUpAdmin);
    }

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
      body: JSON.stringify({ email, code, validation_id: (challenge as { validation_id: string }).validation_id }),
    });
    const hydra = record(await hydraResponse.json().catch(() => ({})));
    const message = hydraMessage(hydra);
    const verifiedByHydra = hydraResponse.ok && hydra.success === true;
    const verifiedEmployeeWithoutCustomer = message.toLowerCase().includes("customer not found");
    if (!verifiedByHydra && !verifiedEmployeeWithoutCustomer) return json(origin, { error: message }, 400);

    const { error: updateError } = await admin
      .from("topup_otp_challenges")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", (challenge as { id: string }).id)
      .is("verified_at", null);
    if (updateError) return json(origin, { error: "The verification could not be finalized." }, 500);

    return await createSupabaseSession(origin, admin, supabaseUrl, publishableKey, email, isTopUpAdmin);
  }

  return json(origin, { error: "Unknown verification action." }, 400);
});
