# Performance Measurement Harness (`perf:measure`)

ProblemCloud includes an in-tree Playwright-based performance harness (`scripts/perf/measure.ts`) designed to measure cold page load latency, network payload distribution, and in-app interactive gesture responsiveness against a production preview build.

---

## 1. Prerequisites

1. **Local Supabase Instance**:
   The harness logs in as an authenticated user. Ensure local Supabase is up and healthy:
   ```bash
   supabase status
   ```
2. **Playwright Chromium**:
   Install the Playwright Chromium browser if you haven't already:
   ```bash
   bunx playwright install chromium
   ```
3. **Test Credentials**:
   The harness reads test user credentials from `tmp/perf/credentials.json`:
   ```json
   {
     "email": "mobile@example.com",
     "password": "your-password"
   }
   ```
   *(Alternatively, credentials can be provided via the `PC_PERF_EMAIL` and `PC_PERF_PASSWORD` environment variables).*

---

## 2. Running a Performance Benchmark

Because the harness measures real visitor latency and transfer sizes, benchmarks must be executed against a **production build** (`bun run preview`) rather than Vite's unbundled development server.

### Step 1: Build the production bundle
Build against the local Supabase instance:
```bash
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH \
bun run build
```

### Step 2: Start the preview server
In one terminal window (or background process):
```bash
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH \
bun run preview --port 4173 --host 127.0.0.1
```

### Step 3: Run the harness
In another terminal window:
```bash
bun run perf:measure
```

---

## 3. Configuration & Environment Variables

You can customize the measurement run using environment variables:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PC_PERF_BASE_URL` | `http://127.0.0.1:4173` | The target server URL to benchmark. |
| `PC_PERF_LABEL` | `"unlabelled"` | Free-form metadata tag written to the report (e.g. `"baseline"`, `"pre-refactor"`). |
| `PC_PERF_REPEATS` | `3` | Number of iterations per route and action. The median values are reported. |
| `PC_PERF_EMAIL` | *(from credentials file)* | Authenticated test account email. |
| `PC_PERF_PASSWORD` | *(from credentials file)* | Authenticated test account password. |

### Example with custom parameters:
```bash
PC_PERF_LABEL="media-proxy-v2" PC_PERF_REPEATS=5 bun run perf:measure
```

---

## 4. What Gets Measured

### Pass 1: Cold Page Loads
For each of the 10 core routes (`/`, `/practice`, `/library`, `/progress`, `/goals`, `/history`, `/leaderboard`, `/roadmap`, `/settings`, `/coach`), the harness isolates a fresh browser context and measures:
- **TTFB (Time to First Byte)**: Server response latency.
- **FCP (First Contentful Paint)**: Time until the first DOM content paints.
- **LCP (Largest Contentful Paint)**: Time until the largest above-the-fold element renders.
- **LCP Element & Supersession**: Records which DOM node won LCP and flags whether client-side hydration or delayed image loads displaced an earlier paint.
- **CLS (Cumulative Layout Shift)**: Layout stability score.
- **TBT Proxy (Total Blocking Time)**: Accumulated main-thread tasks exceeding 50ms.
- **Transferred Bytes by Category**: Network payload split into `app-js`, `fonts`, `katex`, `assets`, `api`, and `other`.

> **Note on Service Workers:** Service workers are intentionally blocked in Pass 1 so that every run measures a true unprimed cold visit rather than an in-memory or `CacheStorage` hit.

### Pass 2: In-App Actions
Measures Node-side wall-clock time from user input until the application reaches a settled UI state:
- **Sidebar navigation**: `sidebar → Library`, `sidebar → Practice`, `sidebar → Home`.
- **Search responsiveness**: Typing into library search and waiting for filtered result counts to settle.
- **Modal dialogs**: Opening and rendering the filter drawer.
- **Problem session flow**: Starting a session, submitting an answer for automated grading, and advancing to the next problem.

---

## 5. Artifacts and Reports

Every completed run produces timestamped artifacts inside `tmp/perf/reports/`:
- **`tmp/perf/reports/<TIMESTAMP>.json`**: Detailed JSON report containing full run logs, median aggregations, individual request latencies, and git SHA metadata.
- **`tmp/perf/reports/<TIMESTAMP>.csv`**: Tabular export ready for spreadsheet analysis or graphing.

### Comparing Two Runs

To quickly compare a new run with a previous baseline, you can inspect the generated JSON files:
```bash
node -e '
const fs = require("fs");
const prev = JSON.parse(fs.readFileSync("tmp/perf/reports/<PREVIOUS>.json", "utf8"));
const curr = JSON.parse(fs.readFileSync("tmp/perf/reports/<CURRENT>.json", "utf8"));

for (const p of prev.routes) {
  const c = curr.routes.find(r => r.route === p.route);
  console.log(`${p.route}: LCP ${p.median.lcp}ms -> ${c.median.lcp}ms | CLS ${p.median.cls} -> ${c.median.cls}`);
}
'
```

---

## 6. Architecture & File Structure

The harness code is organized under `scripts/perf/` by concern:
- [`scripts/perf/config.ts`](file:///Users/cloud/CodeProjects/MathApp/problem-cloud/scripts/perf/config.ts): Environment configuration, paths, and default options.
- [`scripts/perf/types.ts`](file:///Users/cloud/CodeProjects/MathApp/problem-cloud/scripts/perf/types.ts): TypeScript interfaces for metrics, routes, actions, and reports.
- [`scripts/perf/browser.ts`](file:///Users/cloud/CodeProjects/MathApp/problem-cloud/scripts/perf/browser.ts): Playwright browser initialization, context sandboxing, and login workflows.
- [`scripts/perf/routes.ts`](file:///Users/cloud/CodeProjects/MathApp/problem-cloud/scripts/perf/routes.ts): Implementation of Pass 1 (cold route navigations).
- [`scripts/perf/actions.ts`](file:///Users/cloud/CodeProjects/MathApp/problem-cloud/scripts/perf/actions.ts): Implementation of Pass 2 (in-app interactive gestures).
- [`scripts/perf/metrics.ts`](file:///Users/cloud/CodeProjects/MathApp/problem-cloud/scripts/perf/metrics.ts): Statistical calculation functions (median computations, metric parsing).
- [`scripts/perf/report.ts`](file:///Users/cloud/CodeProjects/MathApp/problem-cloud/scripts/perf/report.ts): Disk writing for JSON and CSV output files.

## 7. Database query probes

Database plans can be measured without a dev server, preview, or build:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -X -f scripts/perf/database-queries.sql
```

The script runs in a read-only transaction as `authenticated`, with the JWT
subject set to the local user with the most submissions. Pass `-v user_id=<uuid>`
to select another account. It covers Library pagination, the all-time progress
summary, and the seven-day progress breakdown. Repeat runs to distinguish cold
reads from warm-cache execution. These are database execution times, not HTTP
or page-load latency. SQL functions with `SET search_path` show a `Function Scan`;
inspect their bodies separately when diagnosing internal scans and joins.

### October 22, 2026 query audit

On the local catalog of 31,650 placements, five warm runs after one warm-up showed:

- Library's first 20 IDs: median **13.727 ms → 0.016 ms**; buffer accesses
  **13,522 → 3**. The new `(n, id) INCLUDE (test_id, canonical_id)` index replaces
  the full catalog scan and sort with an index-only scan. The included keys let
  the caller-scoped view's joins be eliminated without a heap fetch.
- Library at offset 1,000: median **12.346 ms → 0.126 ms**. Offset paging still
  walks the preceding index entries; this is not constant-time keyset paging.
- All-time problem-state summary: median **18.873 ms → 4.317 ms**. Its catalog
  scan also benefits from the narrow covering index. Counts still represent
  placements, including aliases sharing canonical progress.

Oldest-first practice draws no longer issue an exact-count request before
reading candidates. They retain the same ordering and continue past invalid
candidates until exhaustion. Random draws still count to preserve their uniform
starting offset and wraparound. The practice screen also reuses an already-loaded
problem rating, including a known `null`, instead of fetching the entire problem
again; fixed-test and older-history rows retain the lookup when the rating field
is absent. Successful online grades invalidate retained ratings for every
placement of the affected canonical problem. Test history and test problems now
load concurrently.

The progress breakdown now filters submission dates/source before resolving
dimensions, groups the selected user/problem pairs, and performs one indexed
lifetime-first graded lookup per pair. It retains the lifetime definition of
"first attempt" even when an older attempt is outside the report filters.
`submission_facts` keeps its original sequence semantics for other callers.
The partial graded index supports the `(user_id, problem_id, created_at, id)`
lookup and excludes skips/ungraded rows.

A separate transaction-rolled-back fixture with 20,000 submissions across 500
problems (200 submissions in the last seven days) compared the original function
with the revised one in the same connection. Five warm-run medians were
**11.743 ms → 1.753 ms** for the seven-day report and **21.601 ms → 19.070 ms**
for all-time. Deduplicating pairs explicitly matters: relying on planner
memoization alone regressed the all-time case in an earlier experiment. These
fixture results are not production measurements. The 45 SQL regression
assertions compare counts with the unchanged lifetime-window view and cover
timestamp ties, skipped/ungraded attempts, prior attempts outside date/source
filters, canonical aliases, and row-level isolation between users.

The audit also identified follow-up work beyond these changes:

- Public Library difficulty filtering occurs after pagination, which can hide
  later matches; its query needs canonical-aware filtering before the page limit.
- Session exclusion IDs and rating history can hit the API's 1,000-row cap.
  Session exclusions also produce long query URLs; a server-side anti-join would
  avoid transferring and repeating the full list.
- Guest practice repeatedly hydrates the first 100 candidates, and adaptive
  fallback hydrates up to 50 candidates to choose one. Both should choose from
  lightweight candidates before fetching full content.
- Coach history previews fetch complete message bodies for the page of threads.
  Counts and bounded preview text should be computed near the data.
- The existing gradeability expression index did not produce an index-only scan
  in the measured full-catalog projection. A stored generated flag is a candidate
  for a separate schema change; adding large statement/choice columns to an index
  would defeat the purpose.

Earlier October 17 optimizations (JWT InitPlans, canonical joins, catalog filter
indexes, and raw-submission goal queries) were already present and are retained.

### Production before/after: October 22, 2026

Code commit `278e2ff` was pushed to `main`; the three query migrations were
applied to the linked production Supabase project. These measurements isolate
the database rollout. After correcting Wrangler account access, the production
application was deployed successfully to Cloudflare Pages as
`47953f37` (`https://47953f37.problem-cloud.pages.dev`), serving
`https://problem-cloud.pages.dev`.

The comparison uses 20 measured runs after two warm-ups per query and phase,
the same authenticated database role/user, and a fixed report cutoff. Production
had 31,650 problems and 259 submissions. The selected account had 198 submissions,
46 within seven days. No synthetic production data was inserted. The original
and revised analytics functions returned identical results for the measured
seven-day and all-time reports.

| PostgreSQL query | Median before → after | p95 before → after |
| --- | --- | --- |
| Library first 20 IDs | 18.127 → 0.058 ms | 22.442 → 0.066 ms |
| Library offset 1,000 | 20.034 → 0.376 ms | 22.541 → 0.408 ms |
| All-time state summary | 28.976 → 15.868 ms | 29.786 → 16.511 ms |
| Seven-day analytics | 2.933 → 2.507 ms | 3.380 → 2.607 ms |
| All-time analytics | 3.221 → 4.208 ms | 3.528 → 4.330 ms |

These are `EXPLAIN ANALYZE` execution times, excluding network latency. The
all-time analytics query regressed by about 1 ms on this small account; its
explicit deduplication has overhead that the larger local fixture amortized.
The live seven-day improvement is modest, unlike the 20,000-submission fixture.

For an independent HTTP measurement, the anonymous catalog-ID endpoint
(`/rest/v1/problems?select=id&order=n.asc,id.asc&limit=20`) improved from
**83.271 → 61.119 ms median**, with **131.062 → 102.867 ms p95**, over a reused
HTTPS connection. Response hashes matched. This is a public catalog probe, not
an authenticated Library page-load measurement: available local benchmark
credentials did not authenticate against production. Twenty samples provide
a spot check, not a long-term latency SLO or controlled concurrent-load test.

[Sanitized samples and measurement metadata](./performance/cloud-query-benchmark-2026-10-22.json)
include server execution and SQL EXPLAIN round-trip samples. The latter include
plan serialization/transfer and should not be treated as application request
latency. Raw plans and the temporary measurement harness remain under ignored
`tmp/cloud-query-performance/` locally.
