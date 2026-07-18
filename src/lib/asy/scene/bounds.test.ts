import { describe, expect, test } from "bun:test";
import { sceneBounds } from "./bounds";
import { createArc, createCircle, createDot, createPath, createRaw, emptyScene, makePath } from "./factory";
import type { Scene } from "./types";

function scene(...elements: Scene["elements"]): Scene {
    return { elements };
}

describe("sceneBounds", () => {
    test("returns null for an empty scene", () => {
        expect(sceneBounds(emptyScene())).toBeNull();
    });

    test("returns null for a scene with only raw elements", () => {
        expect(sceneBounds(scene(createRaw("size(200);")))).toBeNull();
    });

    test("bounds a set of dots", () => {
        const b = sceneBounds(scene(createDot([-1, 2]), createDot([3, -4])));
        expect(b).toEqual({ min: [-1, -4], max: [3, 2] });
    });

    test("bounds a straight path by its nodes", () => {
        const b = sceneBounds(scene(createPath(makePath([[0, 0], [10, 5], [2, 8]]))));
        expect(b).toEqual({ min: [0, 0], max: [10, 8] });
    });

    test("bounds a curved path by its cubic extrema", () => {
        const b = sceneBounds(scene(createPath(makePath(
            [[0, 0], [1, 1], [2, 1], [3, 0]],
            { join: ".." },
        ))));
        expect(b?.min).toEqual([0, 0]);
        expect(b?.max[0]).toBe(3);
        expect(b?.max[1]).toBeCloseTo(1.125, 8);
    });

    test("bounds a circle by center +/- radius", () => {
        const b = sceneBounds(scene(createCircle([5, 5], 3)));
        expect(b).toEqual({ min: [2, 2], max: [8, 8] });
    });

    test("uses the full circle box for an arc (conservative)", () => {
        const b = sceneBounds(scene(createArc([0, 0], 2, 0, 90)));
        expect(b).toEqual({ min: [-2, -2], max: [2, 2] });
    });

    test("ignores raw elements when other geometry is present", () => {
        const b = sceneBounds(scene(createRaw("unitsize(1cm);"), createDot([1, 1])));
        expect(b).toEqual({ min: [1, 1], max: [1, 1] });
    });
});
