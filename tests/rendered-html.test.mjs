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
    readFile(new URL("../supabase/migrations/20260811212721_add_hydra_otp_bridge.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260811213052_deny_client_otp_challenge_access.sql", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /auth\.signInWithOtp/);
  assert.match(page, /functions\.invoke<.*>\("topup-otp"/);
  assert.match(page, /auth\.setSession/);
  assert.match(edgeFunction, /hydra\.unicity\.net\/v6/);
  assert.match(edgeFunction, /OTP_RATE_LIMIT_PER_EMAIL = 50/);
  assert.match(edgeFunction, /OTP_RATE_LIMIT_PER_IP = 100/);
  assert.match(edgeFunction, /new validation code generated/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* anon, authenticated/);
  assert.match(denyPolicy, /to anon, authenticated[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
});
