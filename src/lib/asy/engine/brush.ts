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
const PRESSURE_CARRY = 0.90;
const VELOCITY_FLOOR_PX_PER_MS = 1.25;
const CAP_STEPS = 6;
const OUTLINE_SIMPLIFY_PX = 0.35;
const OUTLINE_SMOOTHING = 0.6;
const OUTLINE_SMOOTHING_PASSES = 3;

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

/** Corner-aware Gaussian filter to eliminate high-frequency digitizer stepping and hand tremors. */
function smoothRawWithCorners(points: readonly Pair[], radius = 2): Pair[] {
    const n = points.length;
    if (n <= 2) return points.slice();

    const isCorner = new Array(n).fill(false);
    isCorner[0] = true;
    isCorner[n - 1] = true;
    for (let i = 1; i < n - 1; i++) {
        const pPrev = points[i - 1];
        const pCurr = points[i];
        const pNext = points[i + 1];
        const v1 = [pCurr[0] - pPrev[0], pCurr[1] - pPrev[1]];
        const v2 = [pNext[0] - pCurr[0], pNext[1] - pCurr[1]];
        const l1 = Math.hypot(v1[0], v1[1]);
        const l2 = Math.hypot(v2[0], v2[1]);
        if (l1 > 1e-4 && l2 > 1e-4) {
            const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
            const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
            if (angle >= 65) isCorner[i] = true;
        }
    }

    const out: Pair[] = [];
    const sigma = Math.max(1, radius / 1.5);
    for (let i = 0; i < n; i++) {
        if (isCorner[i]) {
            out.push(points[i]);
            continue;
        }
        let leftLimit = i;
        while (leftLimit > 0 && !isCorner[leftLimit]) leftLimit--;
        let rightLimit = i;
        while (rightLimit < n - 1 && !isCorner[rightLimit]) rightLimit++;

        const start = Math.max(leftLimit, i - radius);
        const end = Math.min(rightLimit, i + radius);
        let sumX = 0, sumY = 0, sumW = 0;
        for (let j = start; j <= end; j++) {
            const dist = Math.abs(i - j);
            const w = Math.exp(-(dist * dist) / (2 * sigma * sigma));
            sumX += points[j][0] * w;
            sumY += points[j][1] * w;
            sumW += w;
        }
        out.push([sumX / sumW, sumY / sumW]);
    }
    return out;
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

    // Eliminate hand tremor and digitizer stepping before resampling
    const rawSmoothed = smoothRawWithCorners(clean.map(({ point }) => point), 2);
    const cleanPoints = smoothPointsAdaptive(rawSmoothed, smoothing);
    const smoothedClean = clean.map((sample, index) => ({
        ...sample,
        point: cleanPoints[index],
    }));

    const resampledPoints = spacing > 0
        ? resamplePoints(smoothedClean.map(({ point }) => point), spacing)
        : dedupePoints(smoothedClean.map(({ point }) => point));
    const resampled: PointerSample[] = [];
    let sourceIndex = 1;
    const sourceDistances = [0];
    let traversed = 0;
    for (let index = 1; index < smoothedClean.length; index++) {
        traversed += Math.hypot(
            smoothedClean[index].point[0] - smoothedClean[index - 1].point[0],
            smoothedClean[index].point[1] - smoothedClean[index - 1].point[1],
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
        resampled.push({ ...interpolateSample(smoothedClean[beforeIndex], smoothedClean[sourceIndex], clamp01(t)), point: resampledPoints[index] });
    }

    let points = resampled.map(({ point }) => point);
    for (let pass = 0; pass < 2; pass++) {
        points = smoothPointsAdaptive(points, smoothing);
    }

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
    const count = samples.length;
    let dx = 0;
    let dy = 0;
    const maxLook = Math.min(3, Math.max(1, count - 1));
    for (let offset = 1; offset <= maxLook; offset++) {
        const before = samples[Math.max(0, index - offset)].point;
        const after = samples[Math.min(count - 1, index + offset)].point;
        const weight = (maxLook - offset + 1) / offset;
        dx += (after[0] - before[0]) * weight;
        dy += (after[1] - before[1]) * weight;
    }
    const length = Math.hypot(dx, dy);
    return length <= 1e-9 ? [1, 0] : [dx / length, dy / length];
}

/** Velocity calculation windowed over multiple samples to filter frame-rate jitter. */
function velocityAt(samples: readonly PreparedSample[], index: number, sceneUnitsPerPixel: number): number {
    const window = Math.min(3, Math.max(1, samples.length - 1));
    const start = Math.max(0, index - window);
    const end = Math.min(samples.length - 1, index + window);
    const elapsed = Math.max(1, samples[end].timestamp - samples[start].timestamp);
    const travelledPx = (samples[end].distance - samples[start].distance) / sceneUnitsPerPixel;
    return clamp01(1 - travelledPx / elapsed / VELOCITY_FLOOR_PX_PER_MS);
}

function smoothWidths(values: readonly number[]): number[] {
    if (values.length < 3) return [...values];
    return values.map((value, index) => index === 0 || index === values.length - 1
        ? value
        : values[index - 1] * 0.25 + value * 0.5 + values[index + 1] * 0.25);
}

function smoothNormals(normals: readonly Pair[]): Pair[] {
    if (normals.length < 3) return [...normals];
    return normals.map((normal, index) => {
        if (index === 0 || index === normals.length - 1) return normal;
        const prev = normals[index - 1];
        const next = normals[index + 1];
        const nx = prev[0] * 0.25 + normal[0] * 0.5 + next[0] * 0.25;
        const ny = prev[1] * 0.25 + normal[1] * 0.5 + next[1] * 0.25;
        const len = Math.hypot(nx, ny);
        return len <= 1e-9 ? normal : [nx / len, ny / len];
    });
}

function smoothContour(points: Pair[]): Pair[] {
    let smoothed = points;
    for (let pass = 0; pass < OUTLINE_SMOOTHING_PASSES; pass++) {
        smoothed = smoothPointsAdaptive(smoothed, OUTLINE_SMOOTHING);
    }
    return smoothed;
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
        const velocityPressure = velocityAt(samples, index, sceneUnitsPerPixel);
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
    const smoothedRadii = smoothWidths(radii);
    const tangents = samples.map((_, index) => tangentAt(samples, index));
    const rawNormals = tangents.map(([x, y]) => [-y, x] as Pair);
    const normals = smoothNormals(rawNormals);
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
        joins: Array.from({ length: nodes.length }, () => ".." as const),
        cyclic: true,
    };
}
