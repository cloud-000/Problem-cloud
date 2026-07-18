/**
 * Pure asy-space -> SVG projection helpers for the whiteboard view. Kept as a
 * plain (framework-free) module so the path math is unit-testable. The view
 * supplies a `Project` (asy-space y-up -> screen px y-down); these helpers emit
 * screen-space SVG so stroke widths stay in px and labels render upright (no
 * transform-group mirroring).
 */

import type { Pair, Path, Pen } from "$lib/asy/scene";
import { normalizeDeg } from "$lib/asy/engine";
import { resolvePenColor } from "$lib/asy/scene";

export type Project = (p: Pair) => [number, number];

function fmt(p: [number, number]): string {
    return `${round(p[0])},${round(p[1])}`;
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * Build an SVG path `d` for a Scene path. `--` joins become straight `L`
 * segments; `..` joins are rendered as a Catmull-Rom cubic (a smooth visual
 * approximation of asy's Hobby spline — v1).
 */
export function pathD(path: Path, project: Project): string {
    const pts = path.nodes.map(project);
    const n = pts.length;
    if (n === 0) return "";
    if (n === 1) return `M ${fmt(pts[0])}`;

    const closed = path.cyclic;
    const segCount = closed ? n : n - 1;
    let d = `M ${fmt(pts[0])}`;

    const at = (i: number): [number, number] => pts[((i % n) + n) % n];

    for (let i = 0; i < segCount; i++) {
        const join = path.joins[i] ?? "--";
        const p1 = at(i);
        const p2 = at(i + 1);
        if (join === "--") {
            d += ` L ${fmt(p2)}`;
            continue;
        }
        // Catmull-Rom -> cubic Bezier, with endpoint clamping for open paths.
        const p0 = closed ? at(i - 1) : pts[Math.max(i - 1, 0)];
        const p3 = closed ? at(i + 2) : pts[Math.min(i + 2, n - 1)];
        const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C ${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`;
    }
    if (closed) d += " Z";
    return d;
}

/** Sample an arc into screen points (avoids SVG arc-flag/handedness ambiguity). */
export function arcD(
    center: Pair,
    radius: number,
    angle1: number,
    angle2: number,
    project: Project,
    steps = 48
): string {
    const rawSweep = angle2 - angle1;
    const sweep = Math.abs(rawSweep) >= 360 ? 360 : normalizeDeg(rawSweep);
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
        const deg = angle1 + (sweep * i) / steps;
        const rad = (deg * Math.PI) / 180;
        pts.push(project([center[0] + radius * Math.cos(rad), center[1] + radius * Math.sin(rad)]));
    }
    return "M " + pts.map(fmt).join(" L ");
}

export interface StrokeStyle {
    stroke: string;
    strokeWidth: number;
    dasharray: string | null;
    opacity: number;
}

const DASH: Record<string, string> = {
    dashed: "6 4",
    dotted: "1 4",
    longdashed: "12 6",
};

/** Resolve a Pen to concrete SVG stroke attributes (screen-space widths). */
export function penStroke(pen: Pen | undefined, fallback = "var(--color-foreground)"): StrokeStyle {
    const rgb = resolvePenColor(pen);
    const stroke = rgb
        ? `rgb(${Math.round(rgb.r * 255)},${Math.round(rgb.g * 255)},${Math.round(rgb.b * 255)})`
        : fallback;
    let dasharray: string | null = null;
    if (pen?.dash && typeof pen.dash === "string" && pen.dash !== "solid") {
        dasharray = DASH[pen.dash] ?? null;
    }
    return {
        stroke,
        strokeWidth: pen?.lineWidth ?? 1.5,
        dasharray,
        opacity: pen?.opacity ?? 1,
    };
}
