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
