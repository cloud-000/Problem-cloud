/**
 * Turning measurements into text: the console table and CSV cells. Kept apart
 * from `metrics.ts` so changing how something is *written* cannot change how it
 * is *computed*.
 */
import type { ActionSample, LcpElement, LoadMetrics, RouteSample } from "./types";

/** Playwright rejects with real Errors, but a bare `throw` must not read as "undefined". */
export function describeError(e: unknown): string {
    if (e instanceof Error) return (e.message || e.name).split("\n")[0];
    if (e === undefined) return "rejected with undefined";
    return String(e);
}

/** One-line human name for an LCP element, used in the console table and the CSV. */
export function describeLcpElement(el: LcpElement | null): string {
    if (!el) return "(none)";
    const name = el.id ? `#${el.id}` : el.cls ? `.${el.cls.split(/\s+/)[0]}` : "";
    const rect = el.rect ? ` ${el.rect[0]}x${el.rect[1]}` : "";
    const text = el.text ? ` "${el.text.slice(0, 44)}"` : "";
    const src = el.url ? ` ${el.url.split("/").pop()}` : "";
    return `${el.tag ?? "?"}${name}${rect}${text}${src}`.trim();
}

/** The indented console line under each route: what won LCP, and how. */
export function lcpDetail(m: LoadMetrics, varies: boolean): string {
    const el = m.lcpElement;
    if (!el) return "(no LCP element recorded)";
    const bits = [describeLcpElement(el), `@${el.startTime}ms`];
    // A non-zero loadTime means LCP was a resource — i.e. the page's biggest
    // paint was a download, not text.
    if (el.loadTime > 0) bits.push(`load ${el.loadTime}ms`);
    bits.push(`size ${el.size}`);
    bits.push(`${m.lcpCandidates} candidate${m.lcpCandidates === 1 ? "" : "s"}`);
    if (m.lcpSuperseded) bits.push("superseded an earlier paint");
    if (varies) bits.push("VARIES between runs");
    return bits.join("  ·  ");
}

/** Quote a CSV cell only when it would otherwise break the row. */
export function csvCell(v: unknown): string {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const kb = (bytes: number) => {
    const v = bytes / 1024;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)} KB`;
};

/**
 * `fonts 603 KB (54%) · app-js 426 KB (38%)`. A group whose bytes we cannot see
 * (cross-origin, no Timing-Allow-Origin) is shown by request count instead of
 * pretending it weighs nothing.
 */
export function payloadSummary(m: LoadMetrics): string {
    return m.payloadByCategory
        .filter((g) => g.requests > 0)
        .map((g) =>
            g.bytes > 0
                ? `${g.group} ${kb(g.bytes)} (${Math.round(g.share * 100)}%)`
                : `${g.group} ${g.requests} req (bytes n/a)`,
        )
        .join("  ·  ");
}

export function printRouteSample(sample: RouteSample): void {
    const m = sample.median;
    const label = m
        ? `ttfb ${m.ttfb}ms  fcp ${m.fcp}ms  lcp ${m.lcp}ms  load ${m.load}ms  cls ${m.cls}  tbt ${m.tbt}ms`
        : `FAILED: ${sample.error}`;
    const pad = "".padEnd(14);
    console.log(`  ${sample.route.padEnd(14)} ${label}`);
    if (!m) return;
    console.log(`  ${pad} lcp <- ${lcpDetail(m, sample.lcpElementVaries === true)}`);
    const payload = payloadSummary(m);
    if (payload) console.log(`  ${pad} bytes  ${payload}`);
}

export function printActionSample(sample: ActionSample): void {
    const value = sample.ok ? `${sample.medianMs}ms` : `FAILED: ${sample.error}`;
    const extra = sample.extra ? ` ${JSON.stringify(sample.extra)}` : "";
    console.log(`  ${sample.name.padEnd(34)} ${value}${extra}`);
}
