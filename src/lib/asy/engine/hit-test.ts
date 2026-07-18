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

/** Distance from `p` to a single element's geometry (Infinity for raw). */
export function distanceToElement(p: Pair, el: SceneElement): number {
    switch (el.kind) {
        case "dot":
        case "label":
            return distance(p, el.at);
        case "path":
            return pointToPolyline(p, el.path);
        case "circle":
            return pointToRing(p, el.center, el.radius);
        case "arc":
            return pointToArc(p, el.center, el.radius, el.angle1, el.angle2);
        case "fill":
            // Inside the region counts as a direct hit; otherwise use the outline.
            return pointInPolygon(p, el.path) ? 0 : pointToPolyline(p, el.path);
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
        const d = distanceToElement(p, el);
        if (d <= tolerance && d < bestDist) {
            best = el;
            bestDist = d;
        }
    }
    return best;
}
