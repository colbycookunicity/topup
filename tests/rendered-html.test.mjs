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
  assert.match(page, /assigned_to: null, assigned_email: null, assigned_name: null, status: "unassigned"/);
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

test("allows existing admins to add Unicity administrators", async () => {
  const [page, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260813213500_add_admin_management.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Add administrator/);
  assert.match(page, /\.from\("topup_admins"\)\.insert/);
  assert.match(page, /@unicity\\\.com/);
  assert.match(migration, /admins can add Top Up administrators/);
  assert.match(migration, /sam\.hughes@unicity\.com/);
  assert.match(migration, /revoke all on function private\.sync_topup_directory_admin_role\(\) from public, anon, authenticated/);
});

test("shows pre-provisioned administrators and treats duplicate grants as success", async () => {
  const [page, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260814163802_repair_admin_directory_visibility.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /error\.code !== "23505"/);
  assert.match(page, /await loadUsers\(\)/);
  assert.match(migration, /admins can view all admin records/);
  assert.match(migration, /insert into public\.topup_user_directory/);
  assert.match(migration, /'sam\.hughes@unicity\.com', 'Sam Hughes', true/);
});

test("links distributor UIDs to Portal and keeps email copy beside the visible address", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /portal\.unicity\.com\/#\/customers\/\$\{encodeURIComponent\(distributorId\)\}\/overview/);
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  assert.match(page, /UID: \{person\.external_id\}/);
  assert.match(page, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(page, /label=\{`UID \$\{person\.external_id\}`\}/);
  assert.match(page, /label=\{`\$\{person\.email\} email`\}/);
  assert.match(page, /className="profile-email"/);
  assert.match(page, /https:\/\/mail\.google\.com\/mail\/u\/0\/#inbox/);
  assert.doesNotMatch(page, /mailto:/);
  assert.doesNotMatch(page, /contact-copy-button/);
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
  assert.match(page, /profileMenuRef\.current\?\.contains/);
  assert.match(page, /syncVisibleName\(session\.user\.id, nextName\)/);
  assert.match(page, /localStorage\.getItem\(`\$\{TAB_STORAGE_KEY\}:\$\{sessionEmail\.toLowerCase\(\)\}`\)/);
  assert.match(page, /person\.assigned_to \? `user:\$\{person\.assigned_to\}`/);
  assert.match(page, /const identityKey = `user:\$\{activity\.user_id\}`/);
  assert.match(migration, /employees can update their own display name/);
  assert.match(migration, /update public\.profiles[\s\S]*set full_name = new\.display_name/);
  assert.match(boardMigration, /update public\.distributors[\s\S]*set assigned_name = new\.display_name/);
  assert.match(migration, /revoke all on function private\.sync_topup_directory_display_name\(\) from public, anon, authenticated/);
});

test("keeps the current board visible during background auth refreshes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /event === "TOKEN_REFRESHED"/);
  assert.match(page, /current\?\.user\.id === next\?\.user\.id/);
  assert.doesNotMatch(page, /const loadPeople[\s\S]*?setDataReady\(false\)/);
});

test("makes queue search matches and scoped counts understandable", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /personMatchesQuery\(person, query\)/);
  assert.match(page, /count: scopedPeople\.length/);
  assert.match(page, /results"} for “\{searchTerm\}”/);
  assert.match(page, /Leader: \$\{person\.nearest_leader_name\}/);
});

test("animates the distributor drawer in and out accessibly", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /closing \? "is-closing" : "is-opening"/);
  assert.match(page, /window\.setTimeout\(onClose, 250\)/);
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(styles, /drawer-panel-in 300ms cubic-bezier\(\.22,1,\.36,1\)/);
  assert.match(styles, /drawer-panel-out 250ms cubic-bezier\(\.4,0,1,1\)/);
  assert.match(styles, /drawer-panel-in \{ from \{ transform: translate3d\(100%,0,0\); \}/);
  assert.doesNotMatch(styles, /drawer-panel-in \{[^}]*opacity/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("links source-assigned distributors to personal boards", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260814195500_link_source_assignments_to_profiles.sql", import.meta.url), "utf8");
  assert.match(migration, /link_source_assignments_to_profile/);
  assert.match(migration, /set assigned_to = new\.id/);
  assert.match(migration, /after insert or update of email, full_name on public\.profiles/);
  assert.match(migration, /update public\.distributors distributors/);
  assert.match(migration, /where distributors\.assigned_to is null/);
  assert.match(migration, /count\(\*\).*topup_user_directory peers/s);
});

test("supports pre-login ownership and bulk admin assignment", async () => {
  const [page, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260814211500_add_email_ownership_and_bulk_assignment.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /assigned_email\?: string \| null/);
  assert.doesNotMatch(page, /function BulkAssignTool/);
  assert.match(page, /Select all visible distributors/);
  assert.match(page, /Assign selected/);
  assert.match(page, /Unassign selected/);
  assert.match(page, /bulkUnassign/);
  assert.match(page, /\.in\("id", selectedQueueIds\)/);
  assert.match(page, /assigned_email: entry\.email/);
  assert.match(migration, /add column if not exists assigned_email text/);
  assert.match(migration, /assigned_email = lower\(coalesce\(\(select auth\.jwt\(\)\) ->> 'email'/);
  assert.match(migration, /unique_directory_names/);
});

test("uses a standard mobile hamburger menu instead of bottom navigation", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /className="mobile-menu-button"/);
  assert.match(page, /mobileMenuOpen \? "mobile-open" : ""/);
  assert.match(page, /className="mobile-nav-backdrop"/);
  assert.match(styles, /\.sidebar\.mobile-open \{ transform: translate3d\(0,0,0\)/);
  assert.match(styles, /transform: translate3d\(-105%,0,0\)/);
  assert.doesNotMatch(styles, /height: 58px; width: 100%; bottom: 0; top: auto/);
});

test("admin checks bypass recursive topup_admins row security", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260814223000_fix_admin_policy_recursion.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /create or replace function private\.is_topup_admin\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /grant execute on function private\.is_topup_admin\(\) to authenticated/);
});

test("uses standard queue checkboxes for filtered bulk assignment", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /ADMIN ASSIGNMENT TOOL/);
  assert.match(page, /className="select-cell"/);
  assert.match(page, /Select all visible distributors/);
  assert.match(page, /Choose assignment/);
  assert.match(styles, /\.queue-selectable \.queue-row \{ grid-template-columns: 34px minmax\(0,1fr\) 18px/);
  assert.match(styles, /\.uid-line \{ max-width: 100%; overflow: hidden !important; \}/);
});

test("lets admins open an employee queue from team coverage", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /onOpenBoard\(member\.name\)/);
  assert.match(page, /#queue\/owner\/\$\{encodeURIComponent\(ownerQueueName\)\}/);
  assert.match(page, /Showing <strong>\{ownerScope\}<\/strong>’s queue/);
  assert.match(page, /View full queue/);
});

test("does not apply an employee queue scope to My Board", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /tab !== "queue" \|\| !ownerQueueName/);
  assert.match(page, /if \(nextTab !== "queue"\) setOwnerQueueName\(""\)/);
});

test("locks activity submission immediately and shows saving feedback", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /activitySubmitLock\.current \|\| !selected/);
  assert.match(page, /activitySubmitLock\.current = true/);
  assert.match(page, /aria-busy=\{saving\}/);
  assert.match(page, /saving \? "Saving…" : "Save activity"/);
  assert.match(page, /disabled=\{saving\}/);
});

test("places search first and sorts queue columns", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /queue-toolbar"><div className="toolbar-actions"><div className="search-box"/);
  assert.match(page, /function changeSort/);
  assert.match(page, /<QueueSortHeader field="name" label="Distributor"/);
  assert.match(page, /<QueueSortHeader field="touch" label="Last touch"/);
  assert.match(page, /sortedPeople\.map/);
});

test("imports monthly reports atomically into preserved snapshots", async () => {
  const [page, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260815171418_monthly_snapshots.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\.rpc\("import_report"/);
  assert.doesNotMatch(page, /\.from\("distributors"\)\.upsert/);
  assert.match(migration, /create table if not exists public\.distributor_snapshots/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /on conflict \(distributor_id, period\) do update/);
  assert.match(migration, /status in \('contacted'::public\.contact_status, 'complete'::public\.contact_status\)/);
  assert.match(migration, /grant execute on function public\.import_report/);
});

test("shows monthly selection, reappearances, and profile snapshot history", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function PeriodPicker/);
  assert.match(page, /label: "Reappeared"/);
  assert.match(page, /Back in \{formatPeriod\(person\.snapshot_period\)/);
  assert.match(page, /<h3>Monthly history<\/h3>/);
  assert.match(page, /monthlyActivities/);
});
