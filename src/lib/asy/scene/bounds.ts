/**
 * Derived bounding box of a Scene, in asy-space. Used by the view to compute
 * its SVG viewBox and by PNG export to size the raster. Bounds are never stored
 * on the Scene — they are always recomputed from the elements.
 */

import type { Pair, Path, Scene, SceneElement } from "./types";

export interface Bounds {
    min: Pair;
    max: Pair;
}

function grow(box: MutableBox, x: number, y: number): void {
    if (x < box.minX) box.minX = x;
    if (y < box.minY) box.minY = y;
    if (x > box.maxX) box.maxX = x;
    if (y > box.maxY) box.maxY = y;
}

interface MutableBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

function growPath(box: MutableBox, path: Path): void {
    for (const [x, y] of path.nodes) grow(box, x, y);
}

function growElement(box: MutableBox, el: SceneElement): void {
    switch (el.kind) {
        case "dot":
        case "label":
            grow(box, el.at[0], el.at[1]);
            break;
        case "path":
            growPath(box, el.path);
            break;
        case "fill":
            growPath(box, el.path);
            break;
        case "circle": {
            const [cx, cy] = el.center;
            grow(box, cx - el.radius, cy - el.radius);
            grow(box, cx + el.radius, cy + el.radius);
            break;
        }
        case "arc": {
            // Conservative: use the full circle bbox. Exact arc extent would
            // require checking which axis-crossings fall within [angle1,angle2];
            // the enclosing box is always safe for a viewBox.
            const [cx, cy] = el.center;
            grow(box, cx - el.radius, cy - el.radius);
            grow(box, cx + el.radius, cy + el.radius);
            break;
        }
        case "raw":
            // Raw asy has no known geometry; contributes nothing to bounds.
            break;
    }
}

/** Compute one element's conservative bounds, or null for non-geometric raw Asymptote. */
export function elementBounds(el: SceneElement): Bounds | null {
    const box: MutableBox = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
    };
    growElement(box, el);
    if (!Number.isFinite(box.minX)) return null;
    return {
        min: [box.minX, box.minY],
        max: [box.maxX, box.maxY],
    };
}

/**
 * Compute the bounding box of a scene. Returns `null` for a scene with no
 * positioned geometry (empty, or only `raw` elements) so callers can fall back
 * to a default viewport.
 */
export function sceneBounds(scene: Scene): Bounds | null {
    const box: MutableBox = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
    };
    for (const el of scene.elements) growElement(box, el);
    if (!Number.isFinite(box.minX)) return null;
    return {
        min: [box.minX, box.minY],
        max: [box.maxX, box.maxY],
    };
}
