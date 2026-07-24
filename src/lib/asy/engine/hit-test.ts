/**
 * Hit-testing a Scene against a point (in asy-space). Returns the topmost
 * element within `tolerance`, or null. Later elements sit on top, so we scan
 * back-to-front.
 */

import type { Pair, Path, Scene, SceneElement } from "../scene/types";
import {
    distance,
    pointInPolygon,
    pointToArc,
    pointToPolyline,
    pointToRing,
} from "./geometry";

function ellipsePoints(
    center: Pair,
    axisX: Pair,
    axisY: Pair,
    angle1 = 0,
    angle2 = 360,
    steps = 96,
): Pair[] {
    const sweep = Math.abs(angle2 - angle1) >= 360
        ? 360
        : ((angle2 - angle1) % 360 + 360) % 360;
    return Array.from({ length: steps + 1 }, (_, index) => {
        const radians = ((angle1 + (sweep * index) / steps) * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        return [
            center[0] + axisX[0] * cos + axisY[0] * sin,
            center[1] + axisX[1] * cos + axisY[1] * sin,
        ] as Pair;
    });
}

/** Distance from `p` to a single element's geometry (Infinity for raw). */
export function distanceToElement(p: Pair, el: SceneElement, flattenTolerance = 0.01): number {
    switch (el.kind) {
        case "dot":
        case "label":
            return distance(p, el.at);
        case "path":
            if (el.path.cyclic && pointInPolygon(p, el.path, flattenTolerance)) return 0;
            return pointToPolyline(p, el.path, flattenTolerance);
        case "circle":
            if (el.fillPen && distance(p, el.center) <= Math.abs(el.radius)) return 0;
            return pointToRing(p, el.center, el.radius);
        case "arc":
            return pointToArc(p, el.center, el.radius, el.angle1, el.angle2);
        case "ellipse": {
            const nodes = ellipsePoints(el.center, el.axisX, el.axisY);
            const path: Path = {
                nodes,
                joins: Array.from({ length: 96 }, () => "--" as const),
                cyclic: true,
            };
            if (el.fillPen && pointInPolygon(p, path, flattenTolerance)) return 0;
            return pointToPolyline(p, path, flattenTolerance);
        }
        case "elliptical-arc":
            return pointToPolyline(p, {
                nodes: ellipsePoints(el.center, el.axisX, el.axisY, el.angle1, el.angle2),
                joins: Array.from({ length: 96 }, () => "--"),
                cyclic: false,
            }, flattenTolerance);
        case "fill":
            // Inside the region counts as a direct hit; otherwise use the outline.
            return pointInPolygon(p, el.path, flattenTolerance)
                ? 0
                : pointToPolyline(p, el.path, flattenTolerance);
        case "raw":
            return Infinity;
    }
}

/**
 * Return the topmost element within `tolerance` of `p`, or null. `tolerance` is
 * in asy-space (the view derives it from its px->asy scale).
 */
export function hitTest(scene: Scene, p: Pair, tolerance: number): SceneElement | null {
    // First pass: check if any dot/label is within tolerance - if so, prefer it
    // This ensures point selection works even when the point is on a curve.
    for (let i = scene.elements.length - 1; i >= 0; i--) {
        const el = scene.elements[i];
        if (el.kind === "dot" || el.kind === "label") {
            const d = distance(p, el.at);
            console.log(`[hit-test] dot/label ${el.id} at ${el.at}, click at ${p}, distance: ${d}, tolerance: ${d <= tolerance}`);
            if (d <= tolerance) return el;
        }
    }

    // Second pass: normal hit-test for other elements
    let best: SceneElement | null = null;
    let bestDist = Infinity;
    for (let i = scene.elements.length - 1; i >= 0; i--) {
        const el = scene.elements[i];
        const d = distanceToElement(p, el, Math.max(tolerance / 4, 1e-4));
        if (d <= tolerance && d < bestDist) {
            best = el;
            bestDist = d;
        }
    }
    console.log(`[hit-test] final result: ${best?.kind} ${best?.id}, distance: ${bestDist}`);
    return best;
}
