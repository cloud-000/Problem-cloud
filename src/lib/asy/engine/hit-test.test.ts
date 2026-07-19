import { describe, expect, test } from "bun:test";
import { hitTest } from "./hit-test";
import { createCircle, createDot, createEllipse, createFill, createPath, createRaw, makePath } from "../scene/factory";
import type { Scene } from "../scene/types";

function scene(...elements: Scene["elements"]): Scene {
    return { elements };
}

describe("hitTest", () => {
    test("returns null when nothing is within tolerance", () => {
        expect(hitTest(scene(createDot([0, 0])), [10, 10], 0.5)).toBeNull();
    });

    test("hits a dot within tolerance", () => {
        const dot = createDot([1, 1]);
        expect(hitTest(scene(dot), [1.2, 1.1], 0.5)?.id).toBe(dot.id);
    });

    test("hits a path along its polyline", () => {
        const path = createPath(makePath([[0, 0], [4, 0]]));
        expect(hitTest(scene(path), [2, 0.1], 0.5)?.id).toBe(path.id);
    });

    test("hits inside a closed path polygon even when it is not filled", () => {
        const path = createPath(
            makePath([[0, 0], [4, 0], [4, 4], [0, 4]], { cyclic: true }),
        );
        expect(hitTest(scene(path), [2, 2], 0.1)?.id).toBe(path.id);
        expect(hitTest(scene(path), [5, 2], 0.1)).toBeNull();
    });

    test("does not treat an open path as a polygon", () => {
        const path = createPath(makePath([[0, 0], [4, 0], [4, 4], [0, 4]]));
        expect(hitTest(scene(path), [2, 2], 0.1)).toBeNull();
    });

    test("hits the visible cubic away from its chord without hitting the chord gap", () => {
        const path = createPath(makePath(
            [[0, 0], [1, 1], [2, 1], [3, 0]],
            { join: ".." },
        ));
        expect(hitTest(scene(path), [1.5, 1.125], 0.03)?.id).toBe(path.id);
        expect(hitTest(scene(path), [1.5, 1], 0.03)).toBeNull();
    });

    test("hits a circle on its ring but not far from it", () => {
        const c = createCircle([0, 0], 3);
        expect(hitTest(scene(c), [3.1, 0], 0.5)?.id).toBe(c.id);
        expect(hitTest(scene(c), [0, 0], 0.5)).toBeNull(); // center is not the ring
    });

    test("hits a rotated affine ellipse on its outline", () => {
        const ellipse = createEllipse([0, 0], [2, 2], [-1, 1]);
        expect(hitTest(scene(ellipse), [2, 2], 0.1)?.id).toBe(ellipse.id);
        expect(hitTest(scene(ellipse), [0, 0], 0.1)).toBeNull();
    });

    test("hits inside a filled region", () => {
        const fill = createFill(makePath([[0, 0], [4, 0], [4, 4], [0, 4]], { cyclic: true }));
        expect(hitTest(scene(fill), [2, 2], 0.5)?.id).toBe(fill.id);
    });

    test("hits interiors painted through fillPen", () => {
        const path = createPath(
            makePath([[0, 0], [2, 0], [2, 2], [0, 2]], { cyclic: true }),
            undefined,
            { namedColor: "red" },
        );
        const circle = createCircle([5, 0], 2, undefined, { namedColor: "blue" });
        const ellipse = createEllipse([10, 0], [2, 0], [0, 1], undefined, { namedColor: "green" });
        expect(hitTest(scene(path), [1, 1], 0.05)?.id).toBe(path.id);
        expect(hitTest(scene(circle), [5, 0], 0.05)?.id).toBe(circle.id);
        expect(hitTest(scene(ellipse), [10, 0], 0.05)?.id).toBe(ellipse.id);
    });

    test("topmost element wins on overlap", () => {
        const under = createDot([0, 0]);
        const over = createDot([0, 0]);
        expect(hitTest(scene(under, over), [0, 0], 0.5)?.id).toBe(over.id);
    });

    test("raw elements are never hit", () => {
        expect(hitTest(scene(createRaw("size(200);")), [0, 0], 100)).toBeNull();
    });
});
