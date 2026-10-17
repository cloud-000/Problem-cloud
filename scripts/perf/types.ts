/**
 * The shapes the harness records, in one module so the report format has a
 * single definition. `measure.ts` writes these verbatim to
 * `tmp/perf/reports/<stamp>.json`, so a field renamed here is a field renamed
 * in every future report — and in the CSV reader that consumes them.
 */
import type { Page } from "@playwright/test";

/**
 * The element that won the largest-contentful-paint race, snapshotted at read
 * time. A text LCP carries no `loadTime` (it stays 0) — that field is only
 * populated when LCP *is* a resource, so a non-zero `loadTime` means the page's
 * biggest paint was a download, and `startTime` is when that download finished.
 */
export interface LcpElement {
    tag: string | null;
    id: string | null;
    cls: string | null;
    /** first 60 chars of the element's text, for identification */
    text: string | null;
    /** [width, height] of the painted box */
    rect: [number, number] | null;
    /** the LCP `size` score, in CSS px² */
    size: number;
    startTime: number;
    renderTime: number;
    loadTime: number;
    url: string | null;
    /** in-page id, so a repeat win by the *same* node is provable */
    node: string | null;
}

/**
 * Transferred bytes for one class of resource. Read the byte column carefully:
 * a cross-origin response reports no `transferSize` unless the host sends
 * Timing-Allow-Origin, so `api` and `third-party` are a *request* tally and
 * their 0 bytes means "unmeasurable", never "free". The same-origin groups
 * (`fonts`, `app-js`, `katex`, `assets`) are the ones whose bytes are real.
 */
export interface PayloadGroup {
    group: string;
    requests: number;
    bytes: number;
    /** share of the run's transferred bytes, 0..1 */
    share: number;
}

/** One resource timing entry, as the page hands it over. */
export interface ResourceEntry {
    url: string;
    /** duration in ms */
    ms: number;
    /** transferSize; 0 for cross-origin without Timing-Allow-Origin */
    bytes: number;
    /** decodedBodySize */
    decoded: number;
}

/**
 * What `READ_METRICS` returns: scalars the page already knows, plus the raw
 * resource list. `metrics.ts` turns this into a `LoadMetrics`, which is where
 * `slowest` and `payloadByCategory` are derived — the page does not decide what
 * is interesting.
 */
export interface PageReading {
    ttfb: number | null;
    responseEnd: number | null;
    domContentLoaded: number | null;
    load: number | null;
    fcp: number | null;
    lcp: number | null;
    /** every LCP candidate, in paint order, with its element */
    lcpEntries: LcpEntry[];
    cls: number;
    tbt: number;
    longTaskCount: number;
    maxLongTask: number;
    resources: ResourceEntry[];
}

/** One largest-contentful-paint paint. */
export interface LcpEntry {
    startTime: number;
    renderTime: number;
    loadTime: number;
    size: number;
    url: string | null;
    node: string | null;
    el: Omit<LcpElement, "size" | "startTime" | "renderTime" | "loadTime" | "url" | "node"> | null;
}

/** One cold load of a route, after the page reading has been interpreted. */
export interface LoadMetrics {
    /** ms after navigationStart */
    ttfb: number | null;
    responseEnd: number | null;
    domContentLoaded: number | null;
    load: number | null;
    fcp: number | null;
    lcp: number | null;
    lcpElement: LcpElement | null;
    /** how many LCP candidates painted; >1 means the first paint was not the biggest */
    lcpCandidates: number;
    /** true when the winner was *not* the first largest paint */
    lcpSuperseded: boolean;
    cls: number;
    tbt: number;
    longTaskCount: number;
    maxLongTask: number;
    resourceCount: number;
    transferBytes: number;
    decodedBytes: number;
    slowest: { url: string; ms: number; bytes: number }[];
    payloadByCategory: PayloadGroup[];
}

/** One cold load of a route. */
export interface RouteRun {
    metrics: LoadMetrics | null;
    error?: string;
    /** time between goto() starting and the metrics read finishing, Node-side */
    wallMs: number;
}

export interface RouteSample {
    route: string;
    name: string;
    runs: RouteRun[];
    /** median across successful runs; null if every run failed */
    median: LoadMetrics | null;
    error?: string;
    /** set when the successful runs disagree about which element won LCP */
    lcpElementVaries?: boolean;
}

/** One attempt at an in-app gesture. */
export interface ActionRun {
    ok: boolean;
    wallMs: number;
    error?: string;
    /** secondary measurements an action wants to record (e.g. TTFT) */
    extra?: Record<string, number>;
}

export interface ActionSample {
    group: string;
    name: string;
    runs: ActionRun[];
    medianMs: number | null;
    ok: boolean;
    error?: string;
    extra?: Record<string, number>;
}

/** A gesture the harness knows how to drive, plus how to reach its start state. */
export interface Action {
    group: string;
    name: string;
    /** Brings the app to the state the gesture needs. Runs before the timer. */
    setup?: (page: Page) => Promise<void>;
    run: (page: Page) => Promise<{ extra?: Record<string, number> } | void>;
}
