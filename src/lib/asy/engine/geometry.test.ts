import { describe, expect, test } from "bun:test";
import {
    distance,
    pointInPolygon,
    pointToArc,
    pointToPolyline,
    pointToRing,
    pointToSegment,
    translateElement,
} from "./geometry";
import { createCircle, createDot, createPath, makePath, createRaw } from "../scene/factory";

describe("geometry", () => {
    test("distance", () => {
        expect(distance([0, 0], [3, 4])).toBe(5);
    });

    test("pointToSegment: perpendicular and endpoint clamping", () => {
        expect(pointToSegment([1, 1], [0, 0], [2, 0])).toBe(1);
        expect(pointToSegment([-2, 0], [0, 0], [2, 0])).toBe(2); // clamps to start
        expect(pointToSegment([5, 0], [0, 0], [2, 0])).toBe(3); // clamps to end
    });

    test("pointToPolyline follows the nodes", () => {
        const path = makePath([[0, 0], [2, 0], [2, 2]]);
        expect(pointToPolyline([1, 0.5], path)).toBeCloseTo(0.5);
    });

    test("pointToRing is 0 on the ring", () => {
        expect(pointToRing([2, 0], [0, 0], 2)).toBeCloseTo(0);
        expect(pointToRing([0, 0], [0, 0], 2)).toBeCloseTo(2);
    });

    test("pointToArc: inside sweep uses ring, outside uses endpoints", () => {
        // Quarter arc from 0 to 90 degrees, radius 2, centered at origin.
        expect(pointToArc([2, 0.01], [0, 0], 2, 0, 90)).toBeCloseTo(0, 1);
        // A point at angle 180 is outside [0,90]; nearest endpoint is (−?) → (0,2) or (2,0).
        const d = pointToArc([-2, 0], [0, 0], 2, 0, 90);
        expect(d).toBeGreaterThan(1);
    });

    test("pointToArc treats a 360-degree arc as a full ring", () => {
        expect(pointToArc([-2, 0], [0, 0], 2, 0, 360)).toBeCloseTo(0);
    });

    test("pointInPolygon (even-odd)", () => {
        const square = makePath([[0, 0], [4, 0], [4, 4], [0, 4]], { cyclic: true });
        expect(pointInPolygon([2, 2], square)).toBe(true);
        expect(pointInPolygon([5, 2], square)).toBe(false);
    });

    test("translateElement moves geometry, leaves raw untouched", () => {
        expect(translateElement(createDot([1, 1]), 2, 3)).toMatchObject({ at: [3, 4] });
        expect(translateElement(createCircle([0, 0], 2), 1, 1)).toMatchObject({ center: [1, 1] });
        const path = translateElement(createPath(makePath([[0, 0], [1, 1]])), 1, 0);
        expect(path.kind === "path" && path.path.nodes).toEqual([[1, 0], [2, 1]]);
        const raw = createRaw("size(200);");
        expect(translateElement(raw, 5, 5)).toBe(raw);
    });
});
