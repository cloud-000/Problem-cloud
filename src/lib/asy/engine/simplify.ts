/** Geometry cleanup for dense freehand pointer samples. */

import type { Join, Pair } from "../scene/types";
import { pointToSegment } from "./geometry";

/** Direction change at or above this angle becomes a deliberate cusp. */
export const FREEHAND_CORNER_THRESHOLD_DEGREES = 60;

/** Independent controls for the pure freehand geometry pipeline. */
export interface StrokeProcessingOptions {
    /** Arc-length interval used to regularize raw pointer samples, in scene units. */
    sampleSpacing: number;
    /** Ramer-Douglas-Peucker tolerance, in scene units. */
    simplifyTolerance: number;
    /** Adaptive neighbour smoothing amount, clamped to 0..1. */
    smoothing: number;
    /** Direction change at or above this angle becomes a cusp, clamped to 0..180. */
    cornerThresholdDegrees: number;
}

/** Scene-unit fallbacks matching the pre-options processing contract. */
export const DEFAULT_STROKE_PROCESSING_OPTIONS: Readonly<StrokeProcessingOptions> = {
    sampleSpacing: 0.2,
    simplifyTolerance: 0.1,
    smoothing: 0.35,
    cornerThresholdDegrees: FREEHAND_CORNER_THRESHOLD_DEGREES,
};

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

/**
 * Sample a polyline at a regular arc-length interval. The exact first and last
 * points are preserved so a stroke still begins and ends under the pointer.
 */
export function resamplePoints(points: Pair[], spacing: number): Pair[] {
    const clean = dedupePoints(points);
    if (clean.length <= 1 || spacing <= 0) return clean;

    const out: Pair[] = [clean[0]];
    let traversed = 0;
    let nextDistance = spacing;

    for (let index = 1; index < clean.length; index++) {
        const start = clean[index - 1];
        const end = clean[index];
        const segmentLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (segmentLength === 0) continue;

        while (nextDistance <= traversed + segmentLength) {
            const t = (nextDistance - traversed) / segmentLength;
            out.push([
                start[0] + (end[0] - start[0]) * t,
                start[1] + (end[1] - start[1]) * t,
            ]);
            nextDistance += spacing;
        }
        traversed += segmentLength;
    }

    const last = clean[clean.length - 1];
    const previous = out[out.length - 1];
    if (Math.hypot(last[0] - previous[0], last[1] - previous[1]) <= 1e-9) {
        out[out.length - 1] = last;
    } else {
        out.push(last);
    }
    return out;
}

/**
 * Lightly pull interior samples toward their neighbours. Smoothing fades out
 * as the local turn gets sharper, retaining intentional corners while removing
 * the small side-to-side jitter most visible on otherwise straight strokes.
 */
export function smoothPointsAdaptive(points: Pair[], strength = 0.35): Pair[] {
    if (points.length <= 2) return points.slice();
    const amount = Math.max(0, Math.min(1, strength));

    return points.map((point, index) => {
        if (index === 0 || index === points.length - 1) return point;
        const previous = points[index - 1];
        const next = points[index + 1];
        const incoming: Pair = [point[0] - previous[0], point[1] - previous[1]];
        const outgoing: Pair = [next[0] - point[0], next[1] - point[1]];
        const incomingLength = Math.hypot(incoming[0], incoming[1]);
        const outgoingLength = Math.hypot(outgoing[0], outgoing[1]);
        if (incomingLength === 0 || outgoingLength === 0) return point;

        const cosine = Math.max(
            0,
            Math.min(
                1,
                (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) /
                    (incomingLength * outgoingLength),
            ),
        );
        const blend = amount * cosine * cosine;
        const midpoint: Pair = [(previous[0] + next[0]) / 2, (previous[1] + next[1]) / 2];
        return [
            point[0] + (midpoint[0] - point[0]) * blend,
            point[1] + (midpoint[1] - point[1]) * blend,
        ];
    });
}

/** Apply the same freehand cleanup pipeline to live and committed geometry. */
export function processStroke(
    points: Pair[],
    options: StrokeProcessingOptions,
): Pair[] {
    const spacing = Math.max(0, options.sampleSpacing);
    const tolerance = Math.max(0, options.simplifyTolerance);
    const resampled = spacing > 0 ? resamplePoints(points, spacing) : dedupePoints(points);
    const smoothed = smoothPointsAdaptive(resampled, options.smoothing);
    return simplifyRDP(smoothed, tolerance);
}

/**
 * Classify an already-processed open stroke into smooth and cusp segments.
 * A cusp needs straight joins on both sides because the v1 scene model stores
 * join kinds per segment rather than an explicit tangent break at a node.
 */
export function classifyStrokeJoins(
    nodes: readonly Pair[],
    cornerThresholdDegrees = FREEHAND_CORNER_THRESHOLD_DEGREES,
): Join[] {
    const joins: Join[] = Array.from(
        { length: Math.max(0, nodes.length - 1) },
        () => "..",
    );
    if (nodes.length < 3) return joins;

    const threshold = Math.max(0, Math.min(180, cornerThresholdDegrees));
    for (let index = 1; index < nodes.length - 1; index++) {
        const previous = nodes[index - 1];
        const point = nodes[index];
        const next = nodes[index + 1];
        const incomingX = point[0] - previous[0];
        const incomingY = point[1] - previous[1];
        const outgoingX = next[0] - point[0];
        const outgoingY = next[1] - point[1];
        const incomingLength = Math.hypot(incomingX, incomingY);
        const outgoingLength = Math.hypot(outgoingX, outgoingY);
        if (incomingLength <= 1e-12 || outgoingLength <= 1e-12) continue;

        const cosine = Math.max(-1, Math.min(1,
            (incomingX * outgoingX + incomingY * outgoingY) /
                (incomingLength * outgoingLength),
        ));
        const turnDegrees = (Math.acos(cosine) * 180) / Math.PI;
        if (turnDegrees + 1e-9 < threshold) continue;
        joins[index - 1] = "--";
        joins[index] = "--";
    }
    return joins;
}
