/**
 * Ramer–Douglas–Peucker polyline simplification. Turns a dense freehand pointer
 * sample into a handful of nodes, so a hand-drawn stroke becomes a normal,
 * editable, cleanly-serializable path. (Bezier/Hobby fitting is the v2 upgrade;
 * v1 keeps `--` joins.)
 */

import type { Pair } from "../scene/types";
import { pointToSegment } from "./geometry";

/**
 * Simplify `points` with tolerance `epsilon` (asy-space). Endpoints are always
 * preserved. Returns a new array; input is not mutated.
 */
export function simplifyRDP(points: Pair[], epsilon: number): Pair[] {
    if (points.length <= 2) return points.slice();

    // Find the point farthest from the chord between the endpoints.
    let maxDist = 0;
    let index = 0;
    const first = points[0];
    const last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
        const d = pointToSegment(points[i], first, last);
        if (d > maxDist) {
            maxDist = d;
            index = i;
        }
    }

    if (maxDist > epsilon) {
        const left = simplifyRDP(points.slice(0, index + 1), epsilon);
        const right = simplifyRDP(points.slice(index), epsilon);
        // Drop the duplicated join point.
        return left.slice(0, -1).concat(right);
    }
    return [first, last];
}

/** Drop consecutive duplicate points (within `epsilon`). */
export function dedupePoints(points: Pair[], epsilon = 1e-9): Pair[] {
    const out: Pair[] = [];
    for (const p of points) {
        const prev = out[out.length - 1];
        if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > epsilon) out.push(p);
    }
    return out;
}
