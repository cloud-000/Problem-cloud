/**
 * Hit-testing a Scene against a point (in asy-space). Returns the topmost
 * element within `tolerance`, or null. Later elements sit on top, so we scan
 * back-to-front.
 */

import type { Pair, Scene, SceneElement } from "../scene/types";
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
            return pointToPolyline(p, el.path, flattenTolerance);
        case "circle":
            return pointToRing(p, el.center, el.radius);
        case "arc":
            return pointToArc(p, el.center, el.radius, el.angle1, el.angle2);
        case "ellipse":
            return pointToPolyline(p, {
                nodes: ellipsePoints(el.center, el.axisX, el.axisY),
                joins: Array.from({ length: 96 }, () => "--"),
                cyclic: false,
            }, flattenTolerance);
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
    let best: SceneElement | null = null;
    let bestDist = Infinity;
    // Back-to-front: prefer elements drawn later (visually on top). Ties go to
    // the topmost element; only a strictly closer element overrides it.
    for (let i = scene.elements.length - 1; i >= 0; i--) {
        const el = scene.elements[i];
        const d = distanceToElement(p, el, Math.max(tolerance / 4, 1e-4));
        if (d <= tolerance && d < bestDist) {
            best = el;
            bestDist = d;
        }
    }
    return best;
}
