# Monthly Snapshots — Design

- **Status:** Approved (Colby Cook, 2026-08-15)
- **Review copy:** https://claude.ai/code/artifact/492f3f79-d556-4a39-9241-17fd0bc8675e
- **Approach:** A — split the person record from the monthly report data (chosen over per-month row sets and raw-CSV archiving)

## Problem

The app keeps one row per distributor (`distributors.external_id` unique). Every CSV import upserts that row in place, so each month's report data overwrites the last. The July 2026 numbers currently in production exist nowhere else; importing the August file under the current code would erase them. Nothing can be viewed, compared, or aggregated by month.

## Goals

1. Compare a distributor's progress month over month (rank, gap, flags).
2. View each month's report as its own board in the work queue and overview.
3. Aggregate monthly stats (new distributors, opportunities, contacts made).

Work state is continuous: owner, notes, and activity history belong to the distributor, not to a month, and are never reset by an import.

## Non-goals

- No changes to auth, assignment/claim flows, or the activities model.
- No backfill of months earlier than July 2026 (no source data exists).

## Data model

### New table: `distributor_snapshots`

One row per distributor per month.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | default `gen_random_uuid()` |
| `distributor_id` | uuid | FK → `distributors(id)` on delete cascade |
| `period` | date | always first of month; **unique with `distributor_id`** |
| `current_rank`, `target_rank` | text | that month's values |
| `gap_to_rank` | numeric(14,2) | check ≥ 0 or null |
| `is_new_distributor`, `is_rank_opportunity`, `is_pcm_opportunity` | boolean | per-month, not sticky across months |
| `nearest_leader_name`, `highest_rank_name` | text | |
| `first_time_at_rank`, `has_ten_pack` | boolean | |
| `source_contacted_by`, `source_notes` | text | |
| `source_file_name` | text | |
| `import_id` | uuid | FK → `imports(id)` on delete set null |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(period)`, `(distributor_id)`. RLS mirrors `distributors`: authenticated users read; writes happen only inside the import function.

Multiple files in the same month (e.g. rank report + PCM report) merge into the one `(distributor_id, period)` row: booleans OR together, null fields fill in — the same merge the app does today, scoped to the month.

### Changes to `distributors`

- Add `first_seen_period date` and `last_seen_period date`.
- Existing report-metric columns remain as the "latest values" convenience copy so the day-to-day queue reads unchanged.
- "Reappeared" is derived, not stored: `last_seen_period` = newest period AND `first_seen_period` < newest period.

## Import flow

The confirm step moves from the browser into a Postgres function, `import_report(rows jsonb, period date, file_name text, report_type text)`, security definer with an internal admin check. In **one transaction** it:

1. Deduplicates rows by `external_id` (last row wins).
2. Upserts `distributors` — identity and latest-metric fields only. Never writes `assigned_to`, `assigned_email`, `assigned_name`, `notes`, `last_contacted_at`, or `last_outcome`; `status` changes only per the reappearance rule below.
3. Upserts `distributor_snapshots` for `(distributor_id, period)` with the merge semantics above.
4. Applies the reappearance rule and stamps `first_seen_period` / `last_seen_period`.
5. Inserts the `imports` audit row.
6. Returns `{ new_count, update_count, reappear_count }`.

The client's prepare step still parses, validates, dedups, and previews; confirm becomes a single `supabase.rpc()` call.

### Reappearance rule

When an already-known distributor appears in a file for a **new** period:

- **Owner carries over.** `assigned_to`/`assigned_email`/`assigned_name` untouched. Never returned to the unassigned pool.
- **Notes and activities carry over.** Prior months' activity history is never rewritten.
- **Status:** `contacted` or `complete` → `follow-up` (appearing on a new report means re-contact and log a new activity). `assigned` stays `assigned`; `unassigned` stays `unassigned`; `follow-up` stays `follow-up`.
- **Badge:** the UI flags them ("Back in August") via first/last seen periods, with a queue filter.
- Admins can reassign or unassign as usual.

### Preview changes

- New stat alongside new/updated: **reappearing** count.
- **Report-type dropdown**, pre-filled with the app's guess but correctable — replaces trusting the filename-substring heuristic (`Renewals_August.csv` currently misreads as a New Distributor report and mis-flags every row).
- Result banner switches from substring-matching ("stopped"/"failed") to the `{ text, tone }` shape the toast system already uses.

## UI

1. **Month picker** on Overview and Work Queue, defaulting to the latest period, options from existing snapshot periods. A past month shows that month's people with that month's snapshot numbers; owner/status always show current state.
2. **"Back in {month}" badge** on queue rows and the profile drawer, plus a reappeared-only queue filter.
3. **Profile history**: month-by-month table (rank, gap, flags, source file) in the distributor drawer.
4. **Monthly stats**: overview cards computed from the selected month's snapshots; contact counts from activities dated within that month.

## Migration and July backfill

The production table currently holds the July data. The migration:

1. Creates `distributor_snapshots` and the two new `distributors` columns.
2. Backfills one snapshot per existing distributor from current column values with `period = coalesce(source_period, date '2026-07-01')`.
3. Sets `first_seen_period`/`last_seen_period` to the same value.

**Hard constraint: the migration must be applied to production Supabase, and the new import flow deployed, before the August file is uploaded.** Under current code, uploading August permanently destroys July.

## Build order

1. Migration: snapshot table + July backfill (additive; running app unaffected).
2. `import_report` function + rewired client prepare/confirm.
3. UI: month picker, badge + filter, profile history, monthly stats.
4. Upload August.

## Code-review findings closed by this work

The 2026-08-15 review of the import flow found its top defects in the confirm path this design replaces: stale-snapshot overwrite that could silently un-claim distributors (unbounded TOCTOU), non-transactional partial writes with false "nothing written" messaging, duplicate-ID crashes at the database, staged imports surviving sign-out, and errors rendering with success styling. The server-side transactional rewrite closes all of these by construction; sign-out must also clear `pendingImport`/`importResult`.

## Testing

- Unit tests: CSV parsing, dedup (last-row-wins), period inference, reappearance status transitions, report-type detection.
- Staging run of `import_report` against copies of the real July/August CSVs before production.
- Manual checklist: month picker switching, badge appearance, profile history rendering, monthly stat totals.
