import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("contains no demo, fixture, or fabricated distributor data", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const source = `${page}\n${readme}`;

  assert.doesNotMatch(source, /DEMO_PEOPLE|Demo Distributor|Demo Coach|Explore the product demo/i);
  assert.doesNotMatch(source, /example\.invalid|202\s*555\s*01\d{2}/i);
  assert.doesNotMatch(source, /import-\$\{Date\.now\(\)\}|Unnamed distributor/i);
});

test("serves Supabase browser configuration from runtime environment", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("config-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/supabase-config"),
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_test",
  });
});

test("configures Supabase Auth for production code-based email sign-in", async () => {
  const [config, template] = await Promise.all([
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../supabase/templates/magic_link.html", import.meta.url), "utf8"),
  ]);

  assert.match(config, /site_url = "https:\/\/topup\.colbycook\.chatgpt\.site"/);
  assert.match(config, /\[auth\.email\.template\.confirmation\]/);
  assert.match(config, /\[auth\.email\.template\.magic_link\]/);
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(template, /ConfirmationURL/);
});

test("uses Hydra for OTP delivery and keeps Supabase sessions for RLS", async () => {
  const [page, edgeFunction, migration, denyPolicy] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/topup-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260811212936_add_hydra_otp_bridge.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260811213112_deny_client_otp_challenge_access.sql", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /auth\.signInWithOtp/);
  assert.match(page, /functions\.invoke<.*>\("topup-otp"/);
  assert.match(page, /auth\.setSession/);
  assert.match(edgeFunction, /hydra\.unicity\.net\/v6/);
  assert.match(edgeFunction, /OTP_RATE_LIMIT_PER_EMAIL = 50/);
  assert.match(edgeFunction, /OTP_RATE_LIMIT_PER_IP = 100/);
  assert.match(edgeFunction, /new validation code generated/);
  assert.match(edgeFunction, /nestedString\(hydra, "validationid"\)/);
  assert.match(edgeFunction, /A valid verification code is already waiting for you/);
  assert.match(edgeFunction, /events\.unicity\.com\/api\/auth/);
  assert.match(edgeFunction, /eventsAdminGenerate/);
  assert.match(edgeFunction, /eventsAdminVerify/);
  assert.match(edgeFunction, /verifiedEmail !== email \|\| role !== "admin"/);
  assert.match(page, /result\.success !== true/);
  assert.match(page, /setAuthStep\("code"\)/);
  assert.match(page, /Verify your email/);
  assert.match(page, /code-cells/);
  assert.match(page, /Resend code/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* anon, authenticated/);
  assert.match(denyPolicy, /to anon, authenticated[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
});

test("supports personal boards, shared activity, and location filters", async () => {
  const [page, releaseMigration, sharingMigration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260812010754_add_distributor_release_and_private_queues.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260812012409_shared_activity_and_location_filters.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /My Board/);
  assert.match(page, /Only distributors you have claimed and are actively working with/);
  assert.match(page, /assigned_to: null, assigned_name: null, status: "unassigned"/);
  assert.doesNotMatch(page, /update\(\{[^}]*notes:\s*null[^}]*\}\)/);
  assert.match(page, /All activity notes and history will be preserved/);
  assert.match(page, /Activity history/);
  assert.match(page, /All distributors/);
  assert.match(page, /Filter by country/i);
  assert.match(page, /Filter by state/i);
  assert.match(page, /Add team note/);
  assert.match(page, /\.is\("assigned_name", null\)/);
  assert.match(page, /teamActivities/);
  assert.match(releaseMigration, /assigned_to = \(select auth\.uid\(\)\)/);
  assert.match(releaseMigration, /assigned_to is null and assigned_name is null/);
  assert.match(sharingMigration, /employees can view all distributors/);
  assert.match(sharingMigration, /employees can view all team activity/);
  assert.match(sharingMigration, /employees can add team activity/);
  assert.match(sharingMigration, /user_id = \(select auth\.uid\(\)\)/);
});

test("supports named users and protected admin user management", async () => {
  const [page, edgeFunction, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/topup-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260812014831_add_user_directory_and_last_login.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Manage users/);
  assert.match(page, /Last login/);
  assert.match(page, /topup_user_directory/);
  assert.match(edgeFunction, /last_login_at/);
  assert.match(migration, /alexandra\.rodriguez@unicity\.com', 'Alexa'/);
  assert.match(migration, /carolina\.martinez@unicity\.com', 'Caro'/);
  assert.match(migration, /admins can update user display names/);
});

test("allows users to edit their own case-preserved display name", async () => {
  const [page, migration, boardMigration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260812015501_allow_self_service_display_names.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260812015642_sync_display_names_to_current_board.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Your profile/);
  assert.match(page, /Capitalization is preserved exactly as entered/);
  assert.match(page, /profileName\.trim\(\)/);
  assert.match(migration, /employees can update their own display name/);
  assert.match(migration, /update public\.profiles[\s\S]*set full_name = new\.display_name/);
  assert.match(boardMigration, /update public\.distributors[\s\S]*set assigned_name = new\.display_name/);
  assert.match(migration, /revoke all on function private\.sync_topup_directory_display_name\(\) from public, anon, authenticated/);
});
