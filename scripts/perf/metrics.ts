/**
 * Turning a page reading into the numbers we report, and folding several runs
 * into one row. Pure — no browser, no filesystem — so the classifying and
 * aggregating rules are ordinary functions that can be reasoned about (and
 * changed) without a page running.
 */
import { PAGE_ORIGIN } from "./config";
import type {
    LcpElement,
    LcpEntry,
    LoadMetrics,
    PageReading,
    PayloadGroup,
    ResourceEntry,
} from "./types";

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$/i;

/**
 * What class of thing a resource is. Same-origin requests are bucketed by path;
 * anything else is a foreign host. Supabase is identified by its REST/auth path
 * rather than by host, because it arrives on a different port locally and a
 * different domain when hosted — the path is the part that does not move.
 */
export function bucketFor(url: string): string {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return "other";
    }
    const path = u.pathname;
    if (/^\/(rest|auth|storage|graphql)\/v1\//.test(path)) return "api";
    if (u.origin !== PAGE_ORIGIN) return "third-party";
    if (path.startsWith("/vendor/katex")) return "katex";
    if (path.startsWith("/fonts/")) return "fonts";
    if (path.startsWith("/_app/")) return "app-js";
    if (path.startsWith("/icons/") || IMAGE_EXT.test(path)) return "assets";
    return "other";
}

/**
 * Transferred bytes grouped by class, largest first. Read the byte column with
 * care: a cross-origin response reports no `transferSize` without
 * Timing-Allow-Origin, so `api` and `third-party` end up at 0 bytes however much
 * they actually cost. Their `requests` count is real; their bytes are not.
 */
export function payloadByCategory(resources: ResourceEntry[]): PayloadGroup[] {
    const totals = new Map<string, { requests: number; bytes: number }>();
    for (const r of resources) {
        const group = bucketFor(r.url);
        const hit = totals.get(group) ?? { requests: 0, bytes: 0 };
        hit.requests += 1;
        hit.bytes += r.bytes;
        totals.set(group, hit);
    }
    const total = resources.reduce((a, r) => a + r.bytes, 0);
    return [...totals.entries()]
        .map(([group, v]) => ({
            group,
            requests: v.requests,
            bytes: v.bytes,
            share: total > 0 ? Number((v.bytes / total).toFixed(4)) : 0,
        }))
        .sort((a, b) => b.bytes - a.bytes || b.requests - a.requests);
}

const slowestResources = (resources: ResourceEntry[], n = 5) =>
    [...resources]
        .map((r) => ({ url: r.url, ms: r.ms, bytes: r.bytes }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, n);

/**
 * The LCP winner and how it got there. `lcpSuperseded` compares the *first*
 * candidate against the last: same node means the same box grew (a font swap or
 * a late resize); a different node means the page's biggest content was not in
 * the first paint, which is a hydration or data-gating cost rather than a paint
 * cost.
 */
function deriveLcp(entries: LcpEntry[]): Pick<
    LoadMetrics,
    "lcpElement" | "lcpCandidates" | "lcpSuperseded"
> {
    const first = entries[0] ?? null;
    const last = entries[entries.length - 1] ?? null;
    // Prefer the in-page node id; fall back to the element's own identity for
    // entries that carry no element.
    const idOf = (e: LcpEntry | null) =>
        e == null ? null : e.node || (e.el ? [e.el.tag, e.el.id, e.el.text].join("|") : null);
    return {
        lcpElement: last
            ? {
                  tag: last.el?.tag ?? null,
                  id: last.el?.id ?? null,
                  cls: last.el?.cls ?? null,
                  text: last.el?.text ?? null,
                  rect: last.el?.rect ?? null,
                  size: last.size,
                  startTime: last.startTime,
                  renderTime: last.renderTime,
                  loadTime: last.loadTime,
                  url: last.url,
                  node: last.node,
              }
            : null,
        lcpCandidates: entries.length,
        lcpSuperseded: entries.length > 1 && idOf(first) !== idOf(last),
    };
}

/** A page reading becomes the run's record; the raw resource list is dropped. */
export function finalize(reading: PageReading): LoadMetrics {
    return {
        ttfb: reading.ttfb,
        responseEnd: reading.responseEnd,
        domContentLoaded: reading.domContentLoaded,
        load: reading.load,
        fcp: reading.fcp,
        lcp: reading.lcp,
        ...deriveLcp(reading.lcpEntries),
        cls: reading.cls,
        tbt: reading.tbt,
        longTaskCount: reading.longTaskCount,
        maxLongTask: reading.maxLongTask,
        resourceCount: reading.resources.length,
        transferBytes: reading.resources.reduce((a, r) => a + r.bytes, 0),
        decodedBytes: reading.resources.reduce((a, r) => a + r.decoded, 0),
        slowest: slowestResources(reading.resources),
        payloadByCategory: payloadByCategory(reading.resources),
    };
}

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------

export function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Median that keeps fractional precision. `median` rounds, which is right for
 * millisecond counts but silently loses a CLS score entirely: 0.0733 averaged
 * with 0.0733 and rounded is 0. Only use this for unitless ratios.
 */
export function medianFloat(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const v = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return Number(v.toFixed(4));
}

/** Identity of an LCP element, for comparing one run's winner against another's. */
export function lcpSignature(el: LcpElement | null): string | null {
    if (!el) return null;
    return [el.tag ?? "", el.id ?? "", el.cls ?? "", el.text ?? ""].join("|");
}

/** The element that won in the most runs; ties go to the first seen. */
function modalLcpElement(runs: LoadMetrics[]): LcpElement | null {
    const counts = new Map<string, { n: number; el: LcpElement }>();
    for (const r of runs) {
        const el = r.lcpElement;
        const sig = lcpSignature(el);
        if (!el || !sig) continue;
        const hit = counts.get(sig);
        if (hit) hit.n += 1;
        else counts.set(sig, { n: 1, el });
    }
    let best: { n: number; el: LcpElement } | null = null;
    for (const v of counts.values()) if (!best || v.n > best.n) best = v;
    return best ? best.el : null;
}

/**
 * Per-group median. Payload is a map rather than a number, so it cannot be
 * medianed as a whole; a group missing from a run counts as 0, which is what
 * "this run did not fetch any". Shares are recomputed from the medians so the
 * breakdown still adds to 100%.
 */
function medianPayload(runs: LoadMetrics[]): PayloadGroup[] {
    const groups = new Set<string>();
    for (const r of runs) for (const g of r.payloadByCategory) groups.add(g.group);
    const rows: PayloadGroup[] = [];
    for (const group of groups) {
        const of = (r: LoadMetrics) => r.payloadByCategory.find((g) => g.group === group);
        rows.push({
            group,
            requests: median(runs.map((r) => of(r)?.requests ?? 0)) ?? 0,
            bytes: median(runs.map((r) => of(r)?.bytes ?? 0)) ?? 0,
            share: 0,
        });
    }
    const total = rows.reduce((a, g) => a + g.bytes, 0);
    for (const g of rows) g.share = total > 0 ? Number((g.bytes / total).toFixed(4)) : 0;
    return rows.sort((a, b) => b.bytes - a.bytes || b.requests - a.requests);
}

/**
 * Median of each numeric metric. `slowest` comes from the median-load run, and
 * the LCP element is the modal winner: neither is a number, so neither can be
 * medianed, but "what usually wins here" is the question being asked.
 */
export function medianMetrics(runs: LoadMetrics[]): LoadMetrics | null {
    if (runs.length === 0) return null;
    const keys: (keyof LoadMetrics)[] = [
        "ttfb",
        "responseEnd",
        "domContentLoaded",
        "load",
        "fcp",
        "lcp",
        "lcpCandidates",
        "cls",
        "tbt",
        "longTaskCount",
        "maxLongTask",
        "resourceCount",
        "transferBytes",
        "decodedBytes",
    ];
    const out: Record<string, number | null> = {};
    for (const key of keys) {
        const values = runs
            .map((r) => r[key] as number | null)
            .filter((v): v is number => typeof v === "number");
        out[key as string] = median(values);
    }
    const byLoad = [...runs].sort((a, b) => (a.load ?? 0) - (b.load ?? 0));
    const medianRun = byLoad[Math.floor(byLoad.length / 2)];
    // CLS is a ratio, not a count: take it unrounded, or an even repeat count
    // reports a perfect 0 for a page that visibly shifts.
    out.cls = medianFloat(runs.map((r) => r.cls));
    // A superseded paint in *most* runs is the stable property; a single flake is
    // not worth reporting as one.
    const superseded = runs.filter((r) => r.lcpSuperseded).length * 2 >= runs.length;
    return {
        ...out,
        lcpElement: modalLcpElement(runs) ?? medianRun.lcpElement,
        lcpSuperseded: superseded,
        slowest: medianRun.slowest,
        payloadByCategory: medianPayload(runs),
    } as unknown as LoadMetrics;
}
