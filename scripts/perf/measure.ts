/**
 * Local latency harness for ProblemCloud.
 *
 * Records, against a **production build** served by `vite preview`:
 *
 *   1. cold page loads  — TTFB, FCP, LCP, CLS, TBT proxy per route, plus *which
 *      element* won LCP and whether a later one displaced it
 *   2. payload per route — transferred bytes bucketed by class (fonts, app-js,
 *      katex, …) and the slowest individual resources
 *   3. in-app actions   — wall time to a named completion signal (click → settled)
 *
 * It writes `tmp/perf/reports/<stamp>.{json,csv}` and prints a table. Nothing is
 * asserted: this is a measurement tool, not a test, so it deliberately does not
 * use the `.test.ts` / `.e2e.ts` suffixes and is not collected by `bun test` or
 * `playwright test`.
 *
 * Layout — this file is only the entry point:
 *
 *   config.ts    env, paths, credentials, git sha
 *   types.ts     the report format (the one place a field is defined)
 *   probes.ts    the two strings that run *inside the page*
 *   metrics.ts   reading → metrics, and several runs → one row (pure)
 *   format.ts    metrics → console text and CSV cells (pure)
 *   browser.ts   context creation, settle, login, sidebar locator
 *   routes.ts    pass 1: cold page loads
 *   actions.ts   pass 2: in-app gestures
 *   report.ts    the JSON + CSV artifacts
 *
 * The split is by *kind of knowledge*, not by size: what the page measures, what
 * we compute from it, how it is written, and what drives the browser are four
 * different reasons to change a file.
 *
 * Usage:
 *
 *     # 1. production build against LOCAL Supabase (see docs below), then:
 *     bun run preview --port 4173
 *     # 2. in another shell:
 *     bun scripts/perf/measure.ts        # or: bun run perf:measure
 *
 * Config (env):
 *   PC_PERF_BASE_URL   default http://127.0.0.1:4173
 *   PC_PERF_EMAIL      default from tmp/perf/credentials.json
 *   PC_PERF_PASSWORD   default from tmp/perf/credentials.json
 *   PC_PERF_LABEL      free-form label recorded in the report (e.g. "baseline")
 *   PC_PERF_REPEATS    runs per measurement (default 3); medians are reported
 *
 * Caveats, all deliberate:
 *   - Service workers are **blocked**, so every load is a true cold load rather
 *     than a CacheStorage hit. That measures first-visit cost, which is the
 *     number a new user pays.
 *   - Action timings include the Playwright→CDP round trip (sub-millisecond to
 *     low-single-digit ms) and are measured in the Node process. They are for
 *     relative comparison between runs, not absolute tap latency.
 *   - Long-task time (TBT proxy) counts main-thread work over 50ms; it is not
 *     the official TBT metric but tracks it closely enough for regression work.
 *   - LCP is read without ever interacting with the page, so it is the largest
 *     paint *so far* rather than a finalized value. That is deliberate: it is
 *     what a visitor pays before they touch anything. `lcpElement` names the
 *     winner, and `lcpSuperseded` distinguishes "the first paint was already the
 *     biggest" from "something larger arrived afterwards" — the second is a
 *     hydration or data-gating cost, not a paint cost, and is the reason a bare
 *     `lcp` number is not actionable on its own.
 *   - Cross-origin bytes are invisible unless the host sends
 *     Timing-Allow-Origin, so `api` and `third-party` show 0 bytes in the
 *     payload breakdown no matter what they cost. Their request count is real.
 */
import { chromium } from "@playwright/test";
import { measureActions } from "./actions";
import { login } from "./browser";
import { BASE_URL } from "./config";
import { writeReport } from "./report";
import { measureRoutes } from "./routes";

const browser = await chromium.launch();
try {
    console.log(`\nProblemCloud latency harness → ${BASE_URL}\n`);

    console.log("authenticating…");
    const state = await login(browser);
    console.log("  ok\n");

    console.log("pass 1: cold page loads (service worker blocked)");
    const routes = await measureRoutes(browser, state);

    console.log("\npass 2: in-app actions");
    const actions = await measureActions(browser, state);

    const { jsonPath, csvPath } = writeReport(routes, actions);
    console.log(`\nwrote ${jsonPath}`);
    console.log(`wrote ${csvPath}`);
} finally {
    await browser.close();
}
