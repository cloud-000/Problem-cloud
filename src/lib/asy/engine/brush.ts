import type { Pair, Path } from "../scene/types";
import { dedupePoints, resamplePoints, simplifyRDP, smoothPointsAdaptive } from "./simplify";
import type { PointerInput, PointerSample } from "./tools/types";
import { pointerSample } from "./tools/types";

export interface BrushOptions {
    /** Maximum brush diameter in scene units. */
    size: number;
    /** Scene-space distance represented by one CSS pixel. */
    sceneUnitsPerPixel: number;
    /** Centerline sampling interval in scene units. */
    sampleSpacing: number;
    /** Adaptive centerline smoothing in 0..1. */
    smoothing: number;
}

interface PreparedSample extends PointerSample {
    distance: number;
}

const MIN_DIAMETER_RATIO = 0.6;
const PRESSURE_CARRY = 0.82;
const VELOCITY_FLOOR_PX_PER_MS = 1.25;
const CAP_STEPS = 6;
const OUTLINE_SIMPLIFY_PX = 0.45;
const OUTLINE_SMOOTHING = 0.55;
const OUTLINE_SMOOTHING_PASSES = 2;

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function easePressure(value: number): number {
    const t = clamp01(value);
    return 1 - Math.pow(1 - t, 3);
}

function interpolateSample(a: PointerSample, b: PointerSample, t: number): PointerSample {
    const pressure = a.pressure === undefined && b.pressure === undefined
        ? undefined
        : (a.pressure ?? b.pressure ?? 0.5) +
            ((b.pressure ?? a.pressure ?? 0.5) - (a.pressure ?? b.pressure ?? 0.5)) * t;
    return {
        point: [
            a.point[0] + (b.point[0] - a.point[0]) * t,
            a.point[1] + (b.point[1] - a.point[1]) * t,
        ],
        timestamp: a.timestamp + (b.timestamp - a.timestamp) * t,
        pointerType: b.pointerType || a.pointerType,
        ...(pressure === undefined ? {} : { pressure: clamp01(pressure) }),
    };
}

function prepareSamples(inputs: readonly PointerInput[], spacing: number, smoothing: number): PreparedSample[] {
    const raw = inputs.map((input, index) => pointerSample(input, index * 16));
    const clean: PointerSample[] = [];
    for (const sample of raw) {
        const previous = clean[clean.length - 1];
        if (!previous || Math.hypot(
            sample.point[0] - previous.point[0],
            sample.point[1] - previous.point[1],
        ) > 1e-9) clean.push(sample);
    }
    if (clean.length < 2) return [];

    const resampledPoints = spacing > 0
        ? resamplePoints(clean.map(({ point }) => point), spacing)
        : dedupePoints(clean.map(({ point }) => point));
    const resampled: PointerSample[] = [];
    let sourceIndex = 1;
    let traversed = 0;
    const sourceDistances = [0];
    for (let index = 1; index < clean.length; index++) {
        traversed += Math.hypot(
            clean[index].point[0] - clean[index - 1].point[0],
            clean[index].point[1] - clean[index - 1].point[1],
        );
        sourceDistances.push(traversed);
    }
    let targetDistance = 0;
    for (let index = 0; index < resampledPoints.length; index++) {
        if (index > 0) targetDistance += Math.hypot(
            resampledPoints[index][0] - resampledPoints[index - 1][0],
            resampledPoints[index][1] - resampledPoints[index - 1][1],
        );
        while (sourceIndex < sourceDistances.length - 1 && sourceDistances[sourceIndex] < targetDistance) {
            sourceIndex++;
        }
        const beforeIndex = Math.max(0, sourceIndex - 1);
        const span = sourceDistances[sourceIndex] - sourceDistances[beforeIndex];
        const t = span <= 1e-9 ? 0 : (targetDistance - sourceDistances[beforeIndex]) / span;
        resampled.push({ ...interpolateSample(clean[beforeIndex], clean[sourceIndex], clamp01(t)), point: resampledPoints[index] });
    }

    const points = smoothPointsAdaptive(resampled.map(({ point }) => point), smoothing);
    let distance = 0;
    return resampled.map((sample, index) => {
        if (index > 0) distance += Math.hypot(
            points[index][0] - points[index - 1][0],
            points[index][1] - points[index - 1][1],
        );
        return { ...sample, point: points[index], distance };
    });
}

function tangentAt(samples: readonly PreparedSample[], index: number): Pair {
    const before = samples[Math.max(0, index - 1)].point;
    const after = samples[Math.min(samples.length - 1, index + 1)].point;
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    return length <= 1e-9 ? [1, 0] : [dx / length, dy / length];
}

function cap(center: Pair, normal: Pair, tangent: Pair, radius: number, end: boolean): Pair[] {
    const points: Pair[] = [];
    for (let index = 1; index < CAP_STEPS; index++) {
        const angle = (Math.PI * index) / CAP_STEPS;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = end ? normal[0] * cos + tangent[0] * sin : -normal[0] * cos - tangent[0] * sin;
        const ny = end ? normal[1] * cos + tangent[1] * sin : -normal[1] * cos - tangent[1] * sin;
        points.push([center[0] + nx * radius, center[1] + ny * radius]);
    }
    return points;
}

function smoothWidths(values: readonly number[]): number[] {
    if (values.length < 3) return [...values];
    return values.map((value, index) => index === 0 || index === values.length - 1
        ? value
        : values[index - 1] * 0.25 + value * 0.5 + values[index + 1] * 0.25);
}

function smoothContour(points: Pair[]): Pair[] {
    let smoothed = points;
    for (let pass = 0; pass < OUTLINE_SMOOTHING_PASSES; pass++) {
        smoothed = smoothPointsAdaptive(smoothed, OUTLINE_SMOOTHING);
    }
    return smoothed;
}

/** Convert enriched centerline samples into a balanced, pressure-sensitive filled silhouette. */
export function brushOutline(inputs: readonly PointerInput[], options: BrushOptions): Path | null {
    const sceneUnitsPerPixel = Math.max(1e-9, options.sceneUnitsPerPixel);
    const samples = prepareSamples(inputs, Math.max(0, options.sampleSpacing), options.smoothing);
    if (samples.length < 2) return null;

    const totalLength = samples[samples.length - 1].distance;
    const taperLength = Math.min(
        totalLength / 2,
        Math.max(8 * sceneUnitsPerPixel, Math.max(0, options.size) * 2),
    );
    const radii: number[] = [];
    let filteredPressure = 0.5;
    for (let index = 0; index < samples.length; index++) {
        const previous = samples[Math.max(0, index - 1)];
        const elapsed = Math.max(1, samples[index].timestamp - previous.timestamp);
        const travelledPx = (samples[index].distance - previous.distance) / sceneUnitsPerPixel;
        const velocityPressure = clamp01(1 - travelledPx / elapsed / VELOCITY_FLOOR_PX_PER_MS);
        const hardwarePressure = samples[index].pointerType === "pen" ? samples[index].pressure : undefined;
        const target = hardwarePressure === undefined
            ? velocityPressure
            : 0.75 * clamp01(hardwarePressure) + 0.25 * velocityPressure;
        filteredPressure = index === 0
            ? (hardwarePressure ?? 0.5)
            : PRESSURE_CARRY * filteredPressure + (1 - PRESSURE_CARRY) * target;
        const diameterRatio = MIN_DIAMETER_RATIO + (1 - MIN_DIAMETER_RATIO) * easePressure(filteredPressure);
        const startTaper = taperLength <= 1e-9 ? 1 : smoothstep(samples[index].distance / taperLength);
        const endTaper = taperLength <= 1e-9 ? 1 : smoothstep((totalLength - samples[index].distance) / taperLength);
        const taper = 0.15 + 0.85 * Math.min(startTaper, endTaper);
        radii.push(Math.max(1e-6, options.size * diameterRatio * taper / 2));
    }

    // Pressure filtering removes high-frequency thickness noise before the two
    // outline sides are offset from the centerline. Preserve endpoint radii so
    // the rounded caps still meet the contours exactly.
    const smoothedRadii = smoothWidths(smoothWidths(radii));
    const tangents = samples.map((_, index) => tangentAt(samples, index));
    const normals = tangents.map(([x, y]) => [-y, x] as Pair);
    const left = samples.map((sample, index) => [
        sample.point[0] + normals[index][0] * smoothedRadii[index],
        sample.point[1] + normals[index][1] * smoothedRadii[index],
    ] as Pair);
    const right = samples.map((sample, index) => [
        sample.point[0] - normals[index][0] * smoothedRadii[index],
        sample.point[1] - normals[index][1] * smoothedRadii[index],
    ] as Pair);
    const last = samples.length - 1;
    // Each side is a smooth open contour, so simplify it independently before
    // adding the caps. This avoids storing two points every 1.5 px forever
    // while preserving the silhouette endpoints and cyclic topology.
    const outlineTolerance = OUTLINE_SIMPLIFY_PX * sceneUnitsPerPixel;
    const simplifiedLeft = simplifyRDP(smoothContour(left), outlineTolerance);
    const simplifiedRight = simplifyRDP(smoothContour(right), outlineTolerance);
    const nodes = [
        ...simplifiedLeft,
        ...cap(samples[last].point, normals[last], tangents[last], smoothedRadii[last], true),
        ...simplifiedRight.slice().reverse(),
        ...cap(samples[0].point, normals[0], tangents[0], smoothedRadii[0], false),
    ].filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (nodes.length < 3) return null;
    return {
        nodes,
        joins: Array.from({ length: nodes.length }, () => "--" as const),
        cyclic: true,
    };
}
