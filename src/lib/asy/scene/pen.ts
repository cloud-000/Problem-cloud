/**
 * Pen helpers and the bidirectional named-color table.
 *
 * Asymptote ships a set of predefined colors (from its `rgb.asy` / `pens.asy`
 * modules). We map the common ones so that `red` parses to an rgb value AND
 * serializes back as `red` (via `Pen.namedColor`), keeping round-trips faithful
 * and human-readable.
 */

import type { Pen, RGB } from "./types";

/** Canonical asy named colors (subset covering the common palette). */
const NAMED_COLORS: Record<string, RGB> = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 1, g: 1, b: 1 },
    gray: { r: 0.5, g: 0.5, b: 0.5 },
    grey: { r: 0.5, g: 0.5, b: 0.5 },
    red: { r: 1, g: 0, b: 0 },
    green: { r: 0, g: 1, b: 0 },
    blue: { r: 0, g: 0, b: 1 },
    cyan: { r: 0, g: 1, b: 1 },
    magenta: { r: 1, g: 0, b: 1 },
    yellow: { r: 1, g: 1, b: 0 },
    orange: { r: 1, g: 0.5, b: 0 },
    purple: { r: 0.5, g: 0, b: 0.5 },
    brown: { r: 0.6, g: 0.4, b: 0.2 },
    pink: { r: 1, g: 0.75, b: 0.8 },
    olive: { r: 0.5, g: 0.5, b: 0 },
    darkgray: { r: 0.25, g: 0.25, b: 0.25 },
    darkgrey: { r: 0.25, g: 0.25, b: 0.25 },
    lightgray: { r: 0.75, g: 0.75, b: 0.75 },
    lightgrey: { r: 0.75, g: 0.75, b: 0.75 },
};

const EPSILON = 1e-4;

/** Look up a named asy color; returns undefined for unknown names. */
export function namedColorToRGB(name: string): RGB | undefined {
    return NAMED_COLORS[name.toLowerCase()];
}

/** Reverse lookup: the canonical name for an rgb value, if one matches exactly. */
export function rgbToNamedColor(color: RGB): string | undefined {
    for (const [name, rgb] of Object.entries(NAMED_COLORS)) {
        // Skip the `grey`/`darkgrey`/`lightgrey` British spellings on reverse
        // lookup so we emit one canonical name per color.
        if (name.endsWith("grey")) continue;
        if (
            Math.abs(rgb.r - color.r) < EPSILON &&
            Math.abs(rgb.g - color.g) < EPSILON &&
            Math.abs(rgb.b - color.b) < EPSILON
        ) {
            return name;
        }
    }
    return undefined;
}

/** True when a pen carries no styling (serializes to nothing / `currentpen`). */
export function isDefaultPen(pen: Pen | undefined): boolean {
    if (!pen) return true;
    return (
        pen.color === undefined &&
        pen.namedColor === undefined &&
        pen.lineWidth === undefined &&
        pen.dash === undefined &&
        pen.opacity === undefined &&
        pen.fontSize === undefined
    );
}

/**
 * Merge two pens, with `override` fields winning over `base`. Used when a tool
 * applies the current pen on top of an element's existing style.
 */
export function mergePen(base: Pen | undefined, override: Pen | undefined): Pen {
    return { ...(base ?? {}), ...(override ?? {}) };
}

/** Resolve a pen's effective rgb color (named color takes precedence). */
export function resolvePenColor(pen: Pen | undefined): RGB | undefined {
    if (!pen) return undefined;
    if (pen.namedColor) return namedColorToRGB(pen.namedColor) ?? pen.color;
    return pen.color;
}
