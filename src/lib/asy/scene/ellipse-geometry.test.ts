import { describe, expect, test } from "bun:test";
import {
    arcPointAt,
    circlePointAt,
    COINCIDENT_SWEEP_DEGREES,
    ellipsePointAt,
    positiveArcSweep,
} from "./ellipse-geometry";

describe("parametric ellipse points", () => {
    function expectPoint(
        actual: readonly [number, number],
        expected: readonly [number, number],
    ): void {
        expect(actual[0]).toBeCloseTo(expected[0], 12);
        expect(actual[1]).toBeCloseTo(expected[1], 12);
    }

    test("evaluates circle and affine ellipse geometry through one basis helper", () => {
        expectPoint(circlePointAt([1, 2], 3, 90), [1, 5]);
        expectPoint(ellipsePointAt([1, 1], [2, 1], [-1, 2], 90), [0, 3]);
    });

    test("evaluates both Scene arc kinds through the shared wrapper", () => {
        expectPoint(arcPointAt({
            id: "arc",
            kind: "arc",
            center: [1, 2],
            radius: 3,
            angle1: 0,
            angle2: 90,
        }, 180), [-2, 2]);
        expectPoint(arcPointAt({
            id: "ellipse",
            kind: "elliptical-arc",
            center: [1, 1],
            axisX: [2, 1],
            axisY: [-1, 2],
            angle1: 0,
            angle2: 90,
        }, 90), [0, 3]);
    });
});

/**
 * `positiveArcSweep` is the single place a pair of arc angles becomes a drawn
 * sweep, so render, export, hit-test, the overlay guide, the inspector and the
 * select tool all inherit whatever it decides. These cases pin the two ends of
 * the range that collapse to a full turn.
 */
describe("positiveArcSweep", () => {
    test("returns the counterclockwise sweep for an open arc", () => {
        expect(positiveArcSweep(0, 90)).toBe(90);
        expect(positiveArcSweep(20, 200)).toBe(180);
        // A negative raw sweep wraps into [0, 360) rather than going backwards.
        expect(positiveArcSweep(0, -45)).toBe(315);
    });

    test("collapses both ends of the range to a full turn", () => {
        expect(positiveArcSweep(0, 360)).toBe(360);
        expect(positiveArcSweep(90, 450)).toBe(360);
        expect(positiveArcSweep(0, -360)).toBe(360);
        // Coincident endpoints read as ~0 after wrapping, not as a zero-width
        // sliver: an arc dragged shut is a circle, not an invisible degenerate.
        expect(positiveArcSweep(0, 0)).toBe(360);
        expect(positiveArcSweep(30, 30)).toBe(360);
        expect(positiveArcSweep(0, COINCIDENT_SWEEP_DEGREES / 2)).toBe(360);
        // Float drift can put `end` a hair *clockwise* of `start`, which wraps to
        // the top of the range instead of the bottom. Both are the same closed arc.
        expect(positiveArcSweep(0, -COINCIDENT_SWEEP_DEGREES / 2)).toBe(360);
        expect(positiveArcSweep(30, 30 - COINCIDENT_SWEEP_DEGREES / 2)).toBe(360);
    });

    test("keeps a sweep just outside the coincidence window open", () => {
        expect(positiveArcSweep(0, COINCIDENT_SWEEP_DEGREES * 2)).toBeCloseTo(
            COINCIDENT_SWEEP_DEGREES * 2,
            10,
        );
        expect(positiveArcSweep(0, 359)).toBe(359);
    });
});
