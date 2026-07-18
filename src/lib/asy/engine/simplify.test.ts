import { describe, expect, test } from "bun:test";
import {
    classifyStrokeJoins,
    DEFAULT_STROKE_PROCESSING_OPTIONS,
    dedupePoints,
    processStroke,
    resamplePoints,
    simplifyRDP,
    smoothPointsAdaptive,
} from "./simplify";
import type { Pair } from "../scene/types";

describe("simplifyRDP", () => {
    test("keeps 2 or fewer points as-is", () => {
        expect(simplifyRDP([[0, 0]], 0.1)).toEqual([[0, 0]]);
        expect(simplifyRDP([[0, 0], [1, 1]], 0.1)).toEqual([[0, 0], [1, 1]]);
    });

    test("collapses a nearly-straight run to its endpoints", () => {
        const line: Pair[] = [[0, 0], [1, 0.001], [2, -0.001], [3, 0], [4, 0]];
        expect(simplifyRDP(line, 0.1)).toEqual([[0, 0], [4, 0]]);
    });

    test("preserves a sharp corner", () => {
        const corner: Pair[] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]];
        const out = simplifyRDP(corner, 0.1);
        expect(out).toContainEqual([2, 0]); // the corner survives
        expect(out[0]).toEqual([0, 0]);
        expect(out[out.length - 1]).toEqual([2, 2]);
    });

    test("does not mutate its input", () => {
        const input: Pair[] = [[0, 0], [1, 1], [2, 2]];
        const copy = input.map((p) => [...p] as Pair);
        simplifyRDP(input, 0.1);
        expect(input).toEqual(copy);
    });
});

describe("dedupePoints", () => {
    test("drops consecutive duplicates", () => {
        expect(dedupePoints([[0, 0], [0, 0], [1, 1], [1, 1], [2, 2]])).toEqual([
            [0, 0],
            [1, 1],
            [2, 2],
        ]);
    });
});

describe("freehand cleanup", () => {
    test("keeps the former numerical defaults", () => {
        expect(DEFAULT_STROKE_PROCESSING_OPTIONS).toEqual({
            sampleSpacing: 0.2,
            simplifyTolerance: 0.1,
            smoothing: 0.35,
            cornerThresholdDegrees: 60,
        });
    });

    test("resamples uneven input at regular arc-length intervals", () => {
        expect(resamplePoints([[0, 0], [0.25, 0], [3, 0]], 1)).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
        ]);
    });

    test("adaptive smoothing reduces jitter without rounding a right-angle corner", () => {
        const jitter = smoothPointsAdaptive([[0, 0], [1, 0.4], [2, 0]]);
        expect(jitter[1][1]).toBeLessThan(0.4);

        const corner = smoothPointsAdaptive([[0, 0], [1, 0], [1, 1]]);
        expect(corner[1]).toEqual([1, 0]);
    });

    test("the combined pipeline preserves the exact endpoints", () => {
        const processed = processStroke(
            [[0, 0], [0.7, 0.2], [2.3, 1]],
            { ...DEFAULT_STROKE_PROCESSING_OPTIONS },
        );
        expect(processed[0]).toEqual([0, 0]);
        expect(processed.at(-1)).toEqual([2.3, 1]);
    });

    test("sample spacing independently controls resampling", () => {
        const points: Pair[] = [[0, 0], [0.2, 1], [2, 0]];
        const unspaced = processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0,
            simplifyTolerance: 0,
            smoothing: 0,
        });
        const spaced = processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0.25,
            simplifyTolerance: 0,
            smoothing: 0,
        });
        expect(unspaced).toEqual(points);
        expect(spaced.length).toBeGreaterThan(unspaced.length);
    });

    test("simplification tolerance independently controls RDP", () => {
        const points: Pair[] = [[0, 0], [1, 0.2], [2, -0.2], [3, 0]];
        const exact = processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0,
            simplifyTolerance: 0,
            smoothing: 0,
        });
        const simplified = processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0,
            simplifyTolerance: 0.25,
            smoothing: 0,
        });
        expect(exact).toEqual(points);
        expect(simplified).toEqual([[0, 0], [3, 0]]);
    });

    test("smoothing independently controls adaptive neighbour blending", () => {
        const points: Pair[] = [[0, 0], [1, 0.4], [2, 0]];
        const unsmoothed = processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0,
            simplifyTolerance: 0,
            smoothing: 0,
        });
        const smoothed = processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0,
            simplifyTolerance: 0,
            smoothing: 1,
        });
        expect(unsmoothed).toEqual(points);
        expect(smoothed[1][1]).toBeLessThan(unsmoothed[1][1]);
    });

    test("zero and out-of-range processing values use their clamped edges", () => {
        const points: Pair[] = [[0, 0], [1, 0.4], [2, 0]];
        expect(processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: -1,
            simplifyTolerance: -1,
            smoothing: -1,
        })).toEqual(processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0,
            simplifyTolerance: 0,
            smoothing: 0,
        }));
        expect(processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0,
            simplifyTolerance: 0,
            smoothing: 2,
        })).toEqual(processStroke(points, {
            ...DEFAULT_STROKE_PROCESSING_OPTIONS,
            sampleSpacing: 0,
            simplifyTolerance: 0,
            smoothing: 1,
        }));
    });

    test("the separated defaults reproduce the former combined pipeline", () => {
        const points: Pair[] = [[0, 0], [0.1, 0.2], [0.8, -0.1], [1.7, 0.5], [2, 1]];
        const former = simplifyRDP(
            smoothPointsAdaptive(resamplePoints(points, 0.2), 0.35),
            0.1,
        );
        expect(processStroke(points, { ...DEFAULT_STROKE_PROCESSING_OPTIONS })).toEqual(former);
    });
});

describe("classifyStrokeJoins", () => {
    test("keeps shallow turns smooth", () => {
        const nodes: Pair[] = [[0, 0], [1, 0], [2, 0.5], [3, 1.25]];
        expect(classifyStrokeJoins(nodes)).toEqual(["..", "..", ".."]);
    });

    test("makes both sides of a sharp turn straight while preserving unrelated curves", () => {
        const nodes: Pair[] = [[0, 0], [1, 0], [2, 0], [2, 1], [2.5, 2]];
        const joins = classifyStrokeJoins(nodes);
        expect(joins).toEqual(["..", "--", "--", ".."]);
    });

    test("honors the threshold boundary and tolerates duplicate nodes", () => {
        const sixtyDegrees: Pair[] = [[0, 0], [1, 0], [1.5, Math.sqrt(3) / 2]];
        expect(classifyStrokeJoins(sixtyDegrees)).toEqual(["--", "--"]);
        expect(classifyStrokeJoins([[0, 0], [0, 0], [1, 0]])).toEqual(["..", ".."]);
    });

    test("corner threshold independently controls cusp classification", () => {
        const turn: Pair[] = [[0, 0], [1, 0], [1.5, Math.sqrt(3) / 2]];
        expect(classifyStrokeJoins(turn, 59)).toEqual(["--", "--"]);
        expect(classifyStrokeJoins(turn, 61)).toEqual(["..", ".."]);
    });

    test("clamps corner thresholds to the zero and 180 degree edges", () => {
        const straight: Pair[] = [[0, 0], [1, 0], [2, 0]];
        const reversal: Pair[] = [[0, 0], [1, 0], [0, 0]];
        expect(classifyStrokeJoins(straight, -1)).toEqual(["--", "--"]);
        expect(classifyStrokeJoins(reversal, 181)).toEqual(["--", "--"]);
    });
});
