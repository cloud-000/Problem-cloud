/**
 * Pure 2D geometry helpers, all in asy-space. No DOM, no framework. Shared by
 * hit-testing and the tools.
 */

import type { Pair, Path, SceneElement } from "../scene/types";
import { flattenPath } from "../scene/path-geometry";
import { positiveArcSweep } from "../scene/ellipse-geometry";

export function distance(a: Pair, b: Pair): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export interface ScalarSnapResult {
    value: number;
    /** The target retained for hysteresis on the next pointer sample. */
    target: number | null;
}

/**
 * Snap a measured scalar to the nearest configured increment when it enters
 * the fixed scene-unit threshold while moving toward that target. Moving away
 * releases an engaged target immediately, so snapping never pulls backward.
 */
export function snapConstructionScalar(
    value: number,
    previousValue: number | null = null,
    engagedTarget: number | null = null,
    threshold = 0.1,
    step = 0.5,
): ScalarSnapResult {
    const snapDistance = Math.max(0, threshold);
    const snapStep = Math.max(Number.EPSILON, Math.abs(step));
    if (engagedTarget !== null) {
        const distanceNow = Math.abs(value - engagedTarget);
        const distanceBefore = previousValue === null
            ? Infinity
            : Math.abs(previousValue - engagedTarget);
        if (distanceNow <= distanceBefore) return { value: engagedTarget, target: engagedTarget };
        return { value, target: null };
    }

    const target = Math.round(value / snapStep) * snapStep;
    const distanceNow = Math.abs(value - target);
    const movingToward = previousValue === null ||
        distanceNow < Math.abs(previousValue - target);
    return target > 0 && distanceNow <= snapDistance && movingToward
        ? { value: target, target }
        : { value, target: null };
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
 * Shortest distance from `p` to a path's rendered geometry. Curves are
 * adaptively flattened using the shared in-app cubic interpretation.
 */
export function pointToPolyline(p: Pair, path: Path, flattenTolerance = 0.01): number {
    const nodes = flattenPath(path, flattenTolerance);
    if (nodes.length === 0) return Infinity;
    if (nodes.length === 1) return distance(p, nodes[0]);
    let best = Infinity;
    for (let i = 0; i < nodes.length - 1; i++) {
        best = Math.min(best, pointToSegment(p, nodes[i], nodes[i + 1]));
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
    const sweep = positiveArcSweep(angle1, angle2);
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

/** Even-odd point-in-polygon test against a path's rendered boundary. */
export function pointInPolygon(p: Pair, path: Path, flattenTolerance = 0.01): boolean {
    const n = flattenPath(path, flattenTolerance);
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

/** Uniformly scale a point around `origin`. */
export function scalePair(p: Pair, origin: Pair, factor: number): Pair {
    return [
        origin[0] + (p[0] - origin[0]) * factor,
        origin[1] + (p[1] - origin[1]) * factor,
    ];
}

/** Independently scale a point's x/y offsets around `origin`. */
export function scalePairBy(p: Pair, origin: Pair, factors: Pair): Pair {
    return [
        origin[0] + (p[0] - origin[0]) * factors[0],
        origin[1] + (p[1] - origin[1]) * factors[1],
    ];
}

function scaleVectorBy(vector: Pair, factors: Pair): Pair {
    return [vector[0] * factors[0], vector[1] * factors[1]];
}

/** Rotate a point around `origin` by `degrees` counter-clockwise in asy-space. */
export function rotatePair(p: Pair, origin: Pair, degrees: number): Pair {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = p[0] - origin[0];
    const dy = p[1] - origin[1];
    return [origin[0] + dx * cos - dy * sin, origin[1] + dx * sin + dy * cos];
}

function scalePath(path: Path, origin: Pair, factor: number): Path {
    return { ...path, nodes: path.nodes.map((node) => scalePair(node, origin, factor)) };
}

function rotatePath(path: Path, origin: Pair, degrees: number): Path {
    return { ...path, nodes: path.nodes.map((node) => rotatePair(node, origin, degrees)) };
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
        case "ellipse":
        case "elliptical-arc":
            return { ...el, center: translatePair(el.center, dx, dy) };
        case "raw":
            return el;
    }
}

/**
 * Return a uniformly scaled copy of `el`. Pens, dots, and label glyph sizes stay
 * screen-sized; only their scene-space anchors/geometry are transformed.
 */
export function scaleElement(el: SceneElement, origin: Pair, factor: number): SceneElement {
    switch (el.kind) {
        case "dot":
        case "label":
            return { ...el, at: scalePair(el.at, origin, factor) };
        case "path":
            return { ...el, path: scalePath(el.path, origin, factor) };
        case "fill":
            return { ...el, path: scalePath(el.path, origin, factor) };
        case "circle":
        case "arc":
            return {
                ...el,
                center: scalePair(el.center, origin, factor),
                radius: el.radius * factor,
            };
        case "ellipse":
        case "elliptical-arc":
            return {
                ...el,
                center: scalePair(el.center, origin, factor),
                axisX: scalePair(el.axisX, [0, 0], factor),
                axisY: scalePair(el.axisY, [0, 0], factor),
            };
        case "raw":
            return el;
    }
}


/**
 * Return an anisotropically scaled copy of `el`. Circular primitives remain
 * circles for a uniform factor and become affine ellipse primitives otherwise.
 */
export function scaleElementBy(
    el: SceneElement,
    origin: Pair,
    factors: Pair,
): SceneElement {
    const [scaleX, scaleY] = factors;
    if (Math.abs(scaleX - scaleY) <= 1e-9) return scaleElement(el, origin, scaleX);
    switch (el.kind) {
        case "dot":
        case "label":
            return { ...el, at: scalePairBy(el.at, origin, factors) };
        case "path":
            return {
                ...el,
                path: { ...el.path, nodes: el.path.nodes.map((node) => scalePairBy(node, origin, factors)) },
            };
        case "fill":
            return {
                ...el,
                path: { ...el.path, nodes: el.path.nodes.map((node) => scalePairBy(node, origin, factors)) },
            };
        case "circle": {
            const { radius, ...base } = el;
            return {
                ...base,
                kind: "ellipse",
                center: scalePairBy(el.center, origin, factors),
                axisX: [radius * scaleX, 0],
                axisY: [0, radius * scaleY],
            };
        }
        case "arc": {
            const { radius, ...base } = el;
            return {
                ...base,
                kind: "elliptical-arc",
                center: scalePairBy(el.center, origin, factors),
                axisX: [radius * scaleX, 0],
                axisY: [0, radius * scaleY],
            };
        }
        case "ellipse":
        case "elliptical-arc":
            return {
                ...el,
                center: scalePairBy(el.center, origin, factors),
                axisX: scaleVectorBy(el.axisX, factors),
                axisY: scaleVectorBy(el.axisY, factors),
            };
        case "raw":
            return el;
    }
}

/**
 * Return a rotated copy of `el`. Label glyphs remain upright, but their anchor
 * and optional alignment direction rotate with the rest of the selection.
 */
export function rotateElement(el: SceneElement, origin: Pair, degrees: number): SceneElement {
    switch (el.kind) {
        case "dot":
            return { ...el, at: rotatePair(el.at, origin, degrees) };
        case "label":
            return {
                ...el,
                at: rotatePair(el.at, origin, degrees),
                ...(el.align ? { align: rotatePair(el.align, [0, 0], degrees) } : {}),
            };
        case "path":
            return { ...el, path: rotatePath(el.path, origin, degrees) };
        case "fill":
            return { ...el, path: rotatePath(el.path, origin, degrees) };
        case "circle":
            return { ...el, center: rotatePair(el.center, origin, degrees) };
        case "arc":
            return {
                ...el,
                center: rotatePair(el.center, origin, degrees),
                angle1: el.angle1 + degrees,
                angle2: el.angle2 + degrees,
            };
        case "ellipse":
        case "elliptical-arc":
            return {
                ...el,
                center: rotatePair(el.center, origin, degrees),
                axisX: rotatePair(el.axisX, [0, 0], degrees),
                axisY: rotatePair(el.axisY, [0, 0], degrees),
            };
        case "raw":
            return el;
    }
}
