/**
 * The two strings that run *inside the page*.
 *
 * `PERF_INIT` installs the observers; `READ_METRICS` reads them back and hands
 * over plain data. Neither decides what is interesting: `slowest` and
 * `payloadByCategory` are derived in `metrics.ts` so the classifying rules live
 * in typed, testable code rather than in a string.
 *
 * Keep these in lockstep with `types.ts`. A field renamed on one side and not
 * the other does not throw — it shows up as `undefined` in a report, which is
 * the kind of failure nobody notices until the numbers look odd.
 */

/**
 * Installed before any page script. Everything is wrapped in `safe()` because
 * an observer that throws must never break the page being measured.
 */
export const PERF_INIT = `
(() => {
  const state = { lcp: 0, lcpEntries: [], cls: 0, longTasks: [] };
  Object.defineProperty(window, "__pc_perf", { value: state, configurable: true });
  const safe = (fn) => { try { fn(); } catch (e) {} };
  let nodeSeq = 0;
  // Tag each element the first time it wins a paint, so a *repeat* by the same
  // node (a font swap, or a late resize of the same box) is distinguishable from
  // a different, larger element arriving later. One is cosmetic; the other means
  // the page's biggest content was not in the first paint at all.
  const nodeOf = (el) => {
    try {
      if (!el || !el.dataset) return null;
      if (!el.dataset.pcNode) el.dataset.pcNode = "n" + (++nodeSeq);
      return el.dataset.pcNode;
    } catch (e) { return null; }
  };
  const snapshot = (el) => {
    if (!el) return null;
    let rect = null;
    try {
      const r = el.getBoundingClientRect();
      rect = [Math.round(r.width), Math.round(r.height)];
    } catch (e) {}
    let text = null;
    try { text = (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60) || null; } catch (e) {}
    let cls = null;
    try { cls = typeof el.className === "string" ? el.className.slice(0, 80) : null; } catch (e) {}
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      id: el.id || null,
      cls: cls,
      text: text,
      rect: rect,
    };
  };
  safe(() => new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      state.lcp = Math.max(state.lcp, e.startTime);
      state.lcpEntries.push({
        startTime: Math.round(e.startTime),
        renderTime: e.renderTime ? Math.round(e.renderTime) : 0,
        loadTime: e.loadTime ? Math.round(e.loadTime) : 0,
        size: Math.round(e.size || 0),
        url: e.url || null,
        node: nodeOf(e.element),
        el: snapshot(e.element),
      });
    }
  }).observe({ type: "largest-contentful-paint", buffered: true }));
  safe(() => new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) state.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true }));
  safe(() => new PerformanceObserver((list) => {
    for (const e of list.getEntries()) state.longTasks.push({ s: e.startTime, d: e.duration });
  }).observe({ type: "longtask", buffered: true }));
})();
`;

// NOTE: an IIFE, not a bare arrow. page.evaluate(string) evaluates the string as
// an *expression*; a bare `() => {}` yields a function, which cannot cross the
// bridge. The `()` call is what makes it a value.
export const READ_METRICS = `(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const paints = performance.getEntriesByType("paint");
  const fcp = paints.find((p) => p.name === "first-contentful-paint");
  const resources = performance.getEntriesByType("resource");
  const perf = window.__pc_perf || {};
  const lt = perf.longTasks || [];
  const round = (v) => (v == null ? null : Math.round(v));
  return {
    ttfb: round(nav && nav.responseStart),
    responseEnd: round(nav && nav.responseEnd),
    domContentLoaded: round(nav && nav.domContentLoadedEventEnd),
    load: round(nav && nav.loadEventEnd),
    fcp: round(fcp && fcp.startTime),
    lcp: perf.lcp ? Math.round(perf.lcp) : null,
    lcpEntries: perf.lcpEntries || [],
    cls: Number((perf.cls || 0).toFixed(4)),
    tbt: Math.round(lt.reduce((a, b) => a + Math.max(0, b.d - 50), 0)),
    longTaskCount: lt.length,
    maxLongTask: round(lt.reduce((a, b) => Math.max(a, b.d), 0)),
    resources: resources.map((r) => ({
      url: r.name,
      ms: Math.round(r.duration),
      bytes: r.transferSize || 0,
      decoded: r.decodedBodySize || 0,
    })),
  };
})()`;
