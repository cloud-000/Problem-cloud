/**
 * Pass 1: cold page loads. Each route is opened in a fresh, service-worker-free
 * context, waited on until the heading that proves arrival is present, settled,
 * then read.
 */
import type { Browser } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { newContext, settle } from "./browser";
import { BASE_URL, REPEATS } from "./config";
import { describeError, printRouteSample } from "./format";
import { finalize, lcpSignature, medianMetrics } from "./metrics";
import { READ_METRICS } from "./probes";
import type { LoadMetrics, PageReading, RouteRun, RouteSample } from "./types";

/** The authenticated shell's destinations, and the heading that proves arrival. */
export const ROUTES: { route: string; name: string; heading: RegExp }[] = [
    { route: "/", name: "Home", heading: /Welcome back|Practice as a guest/ },
    { route: "/practice", name: "Practice hub", heading: /^Practice$/ },
    { route: "/library", name: "Library", heading: /^Library$/ },
    { route: "/progress", name: "Progress", heading: /^Progress$/ },
    { route: "/goals", name: "Goals", heading: /^Goals$/ },
    { route: "/history", name: "History", heading: /^History$/ },
    { route: "/leaderboard", name: "Leaderboard", heading: /^Leaderboard$/ },
    { route: "/roadmap", name: "Roadmap", heading: /^Product roadmap$/ },
    { route: "/settings", name: "Settings", heading: /^Settings$/ },
    { route: "/coach", name: "Coach", heading: /^Coach$/ },
];

export async function measureRoutes(browser: Browser, state: object): Promise<RouteSample[]> {
    const samples: RouteSample[] = [];
    for (const { route, name, heading } of ROUTES) {
        const runs: RouteRun[] = [];
        let lastError: string | undefined;
        for (let i = 0; i < REPEATS; i += 1) {
            const context = await newContext(browser, state);
            const page = await context.newPage();
            const pageErrors: string[] = [];
            page.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));
            const started = performance.now();
            let metrics: LoadMetrics | null = null;
            let runError: string | undefined;
            try {
                await page.goto(`${BASE_URL}${route}`, { waitUntil: "load", timeout: 30000 });
                await page.getByRole("heading", { name: heading }).first().waitFor({ timeout: 20000 });
                await settle(page);
                metrics = finalize((await page.evaluate(READ_METRICS)) as PageReading);
            } catch (e) {
                runError = describeError(e);
                if (pageErrors.length) runError += ` (pageerror: ${pageErrors[0]})`;
                lastError = runError;
            }
            const wallMs = Math.round(performance.now() - started);
            await context.close();
            runs.push({ metrics, error: runError, wallMs });
        }
        const successful = runs.map((r) => r.metrics).filter((m): m is LoadMetrics => m !== null);
        const signatures = new Set(successful.map((m) => lcpSignature(m.lcpElement) ?? "(none)"));
        const sample: RouteSample = {
            route,
            name,
            runs,
            median: medianMetrics(successful),
            error: successful.length > 0 ? undefined : lastError,
            lcpElementVaries: signatures.size > 1 || undefined,
        };
        samples.push(sample);
        printRouteSample(sample);
    }
    return samples;
}
