import type { ArcElement, EllipticalArcElement, Pair } from "./types";

const EPSILON = 1e-9;

export interface PrincipalEllipseGeometry {
    semiMajor: number;
    semiMinor: number;
    majorDirection: Pair;
    minorDirection: Pair;
    eccentricity: number;
    foci: readonly [Pair, Pair];
}

function normalize(vector: Pair, fallback: Pair): Pair {
    const length = Math.hypot(vector[0], vector[1]);
    return length > EPSILON
        ? [vector[0] / length, vector[1] / length]
        : fallback;
}

/** Resolve the true principal axes of an affine image of the unit circle. */
export function principalEllipseGeometry(
    element: ArcElement | EllipticalArcElement,
): PrincipalEllipseGeometry {
    if (element.kind === "arc") {
        const radius = Math.abs(element.radius);
        return {
            semiMajor: radius,
            semiMinor: radius,
            majorDirection: [1, 0],
            minorDirection: [0, 1],
            eccentricity: 0,
            foci: [element.center, element.center],
        };
    }

    const [x, y] = element.axisX;
    const [u, v] = element.axisY;
    const xx = x * x + u * u;
    const xy = x * y + u * v;
    const yy = y * y + v * v;
    const trace = xx + yy;
    const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy * xy));
    const majorSquared = Math.max(0, (trace + discriminant) / 2);
    const minorSquared = Math.max(0, (trace - discriminant) / 2);
    const semiMajor = Math.sqrt(majorSquared);
    const semiMinor = Math.sqrt(minorSquared);

    const candidate: Pair = Math.abs(xy) > EPSILON
        ? [xy, majorSquared - xx]
        : xx >= yy
          ? [1, 0]
          : [0, 1];
    let majorDirection = normalize(candidate, [1, 0]);
    // Keep the axis orientation stable relative to the stored x basis.
    if (majorDirection[0] * x + majorDirection[1] * y < 0) {
        majorDirection = [-majorDirection[0], -majorDirection[1]];
    }
    const determinant = x * v - y * u;
    const orientation = determinant < 0 ? -1 : 1;
    const minorDirection: Pair = [
        -majorDirection[1] * orientation,
        majorDirection[0] * orientation,
    ];
    const focalDistance = Math.sqrt(Math.max(0, majorSquared - minorSquared));
    const eccentricity = semiMajor > EPSILON ? focalDistance / semiMajor : 0;
    const focusOffset: Pair = [
        majorDirection[0] * focalDistance,
        majorDirection[1] * focalDistance,
    ];

    return {
        semiMajor,
        semiMinor,
        majorDirection,
        minorDirection,
        eccentricity,
        foci: [
            [element.center[0] - focusOffset[0], element.center[1] - focusOffset[1]],
            [element.center[0] + focusOffset[0], element.center[1] + focusOffset[1]],
        ],
    };
}

/**
 * Sweep (degrees) at or below which an arc's two rim endpoints are coincident,
 * i.e. the arc closed on itself and reads as a full turn rather than a zero-width
 * sliver. Shared with `SelectTool`, which applies the same rule to the candidate
 * sweep mid-drag.
 */
export const COINCIDENT_SWEEP_DEGREES = 1e-4;

/**
 * Remaining gap (degrees) within which an open arc endpoint snaps shut into a
 * full turn. Shared by arc creation and endpoint editing so both gestures feel
 * identical near the seam.
 */
export const FULL_TURN_SNAP_DEGREES = 8;

/**
 * The one place a pair of arc angles becomes a drawn sweep in `(0, 360]`.
 *
 * Every consumer — render, export, hit-test, the overlay guide, the inspector,
 * and the select tool — must agree on this, or an arc draws as one shape and
 * hit-tests or reports as another. Two angles that coincide (`angle2 - angle1`
 * of ~0 or ~±360) mean a closed arc, so both ends of the range collapse to a
 * full 360 turn.
 */
export function positiveArcSweep(angle1: number, angle2: number): number {
    const raw = angle2 - angle1;
    // A whole number of turns (or more) is a full turn, not the `raw % 360` remainder.
    if (Math.abs(raw) >= 360 - EPSILON) return 360;
    const sweep = ((raw % 360) + 360) % 360;
    // Coincident endpoints wrap to *either* end of the range depending on which
    // side of `start` the drifting `end` lands on, so measure the gap to the
    // nearest full turn rather than only the distance up from zero.
    return Math.min(sweep, 360 - sweep) < COINCIDENT_SWEEP_DEGREES ? 360 : sweep;
}
