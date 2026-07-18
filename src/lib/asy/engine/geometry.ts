/**
 * Pure 2D geometry helpers, all in asy-space. No DOM, no framework. Shared by
 * hit-testing and the tools.
 */

import type { Pair, Path, SceneElement } from "../scene/types";

export function distance(a: Pair, b: Pair): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Shortest distance from point `p` to segment `a`-`b`. */
export function pointToSegment(p: Pair, a: Pair, b: Pair): number {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const lenSq = abx * abx + aby * aby;
    if (lenSq === 0) return distance(p, a);
    let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return distance(p, [a[0] + t * abx, a[1] + t * aby]);
}

/**
 * Shortest distance from `p` to a path's polyline (nodes connected in order,
 * closing the loop when cyclic). `..` spline joins are approximated by their
 * chord — good enough for hit-testing tolerance.
 */
export function pointToPolyline(p: Pair, path: Path): number {
    const { nodes, cyclic } = path;
    if (nodes.length === 0) return Infinity;
    if (nodes.length === 1) return distance(p, nodes[0]);
    let best = Infinity;
    for (let i = 0; i < nodes.length - 1; i++) {
        best = Math.min(best, pointToSegment(p, nodes[i], nodes[i + 1]));
    }
    if (cyclic) {
        best = Math.min(best, pointToSegment(p, nodes[nodes.length - 1], nodes[0]));
    }
    return best;
}

/** Distance from `p` to a circle's outline (0 when exactly on the ring). */
export function pointToRing(p: Pair, center: Pair, radius: number): number {
    return Math.abs(distance(p, center) - radius);
}

/**
 * Distance from `p` to an arc outline. Returns the ring distance when the point's
 * angle falls within [angle1, angle2] (degrees, CCW); otherwise the distance to
 * the nearer endpoint.
 */
export function pointToArc(
    p: Pair,
    center: Pair,
    radius: number,
    angle1: number,
    angle2: number
): number {
    const ang = normalizeDeg((Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI);
    const a1 = normalizeDeg(angle1);
    const rawSweep = angle2 - angle1;
    const sweep = Math.abs(rawSweep) >= 360 ? 360 : normalizeDeg(rawSweep);
    const rel = normalizeDeg(ang - a1);
    if (rel <= sweep) return pointToRing(p, center, radius);
    const e1: Pair = [
        center[0] + radius * Math.cos((angle1 * Math.PI) / 180),
        center[1] + radius * Math.sin((angle1 * Math.PI) / 180),
    ];
    const e2: Pair = [
        center[0] + radius * Math.cos((angle2 * Math.PI) / 180),
        center[1] + radius * Math.sin((angle2 * Math.PI) / 180),
    ];
    return Math.min(distance(p, e1), distance(p, e2));
}

/** Even-odd point-in-polygon test against a path's node ring. */
export function pointInPolygon(p: Pair, path: Path): boolean {
    const n = path.nodes;
    if (n.length < 3) return false;
    let inside = false;
    for (let i = 0, j = n.length - 1; i < n.length; j = i++) {
        const [xi, yi] = n[i];
        const [xj, yj] = n[j];
        const intersects =
            yi > p[1] !== yj > p[1] &&
            p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside;
    }
    return inside;
}

/** Normalize an angle to [0, 360). */
export function normalizeDeg(deg: number): number {
    return ((deg % 360) + 360) % 360;
}

export function translatePair(p: Pair, dx: number, dy: number): Pair {
    return [p[0] + dx, p[1] + dy];
}

function translatePath(path: Path, dx: number, dy: number): Path {
    return { ...path, nodes: path.nodes.map((n) => translatePair(n, dx, dy)) };
}

/** Return a copy of `el` translated by (dx, dy). `raw` elements are unchanged. */
export function translateElement(el: SceneElement, dx: number, dy: number): SceneElement {
    switch (el.kind) {
        case "dot":
        case "label":
            return { ...el, at: translatePair(el.at, dx, dy) };
        case "path":
            return { ...el, path: translatePath(el.path, dx, dy) };
        case "fill":
            return { ...el, path: translatePath(el.path, dx, dy) };
        case "circle":
        case "arc":
            return { ...el, center: translatePair(el.center, dx, dy) };
        case "raw":
            return el;
    }
}
