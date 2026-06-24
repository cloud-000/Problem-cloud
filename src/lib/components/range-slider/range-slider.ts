// Pure math + types for the dual-range (two-handle) slider.
// Kept free of Svelte runtime so the push/snap logic stays simple to reason about and reuse.

/** A `[low, high]` pair where `low <= high`. */
export type RangeValue = [number, number];

/** Clamp `v` into the inclusive `[lo, hi]` range. */
export function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Snap `v` to the nearest `step` offset from `min`, then clamp to `[min, max]`.
 * A `step <= 0` is treated as "no snapping" (only clamping is applied).
 */
export function snapToStep(
    v: number,
    min: number,
    max: number,
    step: number,
): number {
    if (step <= 0) return clamp(v, min, max);
    const snapped = min + Math.round((v - min) / step) * step;
    // Guard against floating-point drift from the multiply (e.g. 0.1 steps).
    const rounded = Math.round(snapped * 1e10) / 1e10;
    return clamp(rounded, min, max);
}

/** Convert a value to a 0–100 percent position along the track. */
export function valueToPercent(v: number, min: number, max: number): number {
    if (max <= min) return 0;
    return ((v - min) / (max - min)) * 100;
}

/** Convert a 0–100 percent position along the track back to a value. */
export function percentToValue(pct: number, min: number, max: number): number {
    return min + (clamp(pct, 0, 100) / 100) * (max - min);
}

/**
 * Enforce ordering and a minimum gap on a proposed `[low, high]` pair, given which
 * index the user just moved. The *other* handle is pushed along to preserve `minGap`,
 * and both are clamped so the pair never leaves `[min, max]`. The moved handle yields
 * (back-clamps) when the pushed handle hits a bound, so the range never collapses below
 * `minGap` and never crosses.
 */
export function applyPush(
    next: RangeValue,
    changed: 0 | 1,
    min: number,
    max: number,
    minGap: number,
): RangeValue {
    let [low, high] = next;

    if (changed === 0) {
        low = clamp(low, min, max);
        if (high < low + minGap) {
            high = clamp(low + minGap, min, max);
            low = high - minGap; // back-clamp when high hit `max`
        }
    } else {
        high = clamp(high, min, max);
        if (low > high - minGap) {
            low = clamp(high - minGap, min, max);
            high = low + minGap; // back-clamp when low hit `min`
        }
    }

    return [low, high];
}
