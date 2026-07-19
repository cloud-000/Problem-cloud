import { describe, expect, test } from "bun:test";
import {
    distance,
    pointInPolygon,
    pointToArc,
    pointToPolyline,
    pointToRing,
    pointToSegment,
    rotateElement,
    scaleElement,
    scaleElementBy,
    snapConstructionScalar,
    translateElement,
} from "./geometry";
import {
    createArc,
    createCircle,
    createDot,
    createFill,
    createLabel,
    createPath,
    makePath,
    createRaw,
} from "../scene/factory";

describe("geometry", () => {
    test("distance", () => {
        expect(distance([0, 0], [3, 4])).toBe(5);
    });

    test("construction scalar snapping engages only while approaching a target", () => {
        const entered = snapConstructionScalar(0.92, 0.8);
        expect(entered).toEqual({ value: 1, target: 1 });

        expect(snapConstructionScalar(0.92, 0.95)).toEqual({
            value: 0.92,
            target: null,
        });
    });

    test("construction scalar snapping releases as soon as movement reverses", () => {
        expect(snapConstructionScalar(0.94, 0.92, 1)).toEqual({ value: 1, target: 1 });
        expect(snapConstructionScalar(0.92, 0.94, 1)).toEqual({ value: 0.92, target: null });
    });

    test("construction scalar snapping uses half-unit targets only", () => {
        expect(snapConstructionScalar(2.58, 2.7)).toEqual({ value: 2.5, target: 2.5 });
        expect(snapConstructionScalar(3.27, 3.4)).toEqual({ value: 3.27, target: null });
    });

    test("construction scalar snapping accepts a custom increment", () => {
        expect(snapConstructionScalar(2.08, 2.2, null, 0.1, 1)).toEqual({
            value: 2,
            target: 2,
        });
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

    test("scaleElement uniformly transforms every editable geometry kind", () => {
        const origin: [number, number] = [1, 1];
        expect(scaleElement(createDot([2, 1]), origin, 2)).toMatchObject({ at: [3, 1] });
        expect(scaleElement(createPath(makePath([[1, 1], [2, 2]])), origin, 2)).toMatchObject({
            path: { nodes: [[1, 1], [3, 3]] },
        });
        expect(scaleElement(createFill(makePath([[0, 0], [1, 0], [1, 1]])), origin, 2)).toMatchObject({
            path: { nodes: [[-1, -1], [1, -1], [1, 1]] },
        });
        expect(scaleElement(createCircle([2, 1], 3), origin, 2)).toMatchObject({
            kind: "circle",
            center: [3, 1],
            radius: 6,
        });
        expect(scaleElement(createArc([1, 2], 2, 10, 80), origin, 2)).toMatchObject({
            kind: "arc",
            center: [1, 3],
            radius: 4,
            angle1: 10,
            angle2: 80,
        });
        expect(scaleElement(createLabel("$A$", [2, 2], [0, 1]), origin, 2)).toMatchObject({
            at: [3, 3],
            align: [0, 1],
        });
        const raw = createRaw("size(200);");
        expect(scaleElement(raw, origin, 2)).toBe(raw);
    });

    test("scaleElementBy preserves affine ellipse geometry across resize and rotation", () => {
        const ellipse = scaleElementBy(createCircle([1, 1], 2), [0, 0], [2, 3]);
        expect(ellipse).toMatchObject({
            kind: "ellipse",
            center: [2, 3],
            axisX: [4, 0],
            axisY: [0, 6],
        });
        expect("radius" in ellipse).toBe(false);
        const rotated = rotateElement(ellipse, [0, 0], 90);
        expect(rotated.kind).toBe("ellipse");
        if (rotated.kind === "ellipse") {
            expect(rotated.center[0]).toBeCloseTo(-3);
            expect(rotated.center[1]).toBeCloseTo(2);
            expect(rotated.axisX[0]).toBeCloseTo(0);
            expect(rotated.axisX[1]).toBeCloseTo(4);
            expect(rotated.axisY[0]).toBeCloseTo(-6);
            expect(rotated.axisY[1]).toBeCloseTo(0);
        }
    });

    test("rotateElement rotates geometry and label alignment while preserving primitive types", () => {
        const origin: [number, number] = [1, 1];
        const dot = rotateElement(createDot([2, 1]), origin, 90);
        expect(dot.kind === "dot" && dot.at[0]).toBeCloseTo(1);
        expect(dot.kind === "dot" && dot.at[1]).toBeCloseTo(2);

        const path = rotateElement(createPath(makePath([[1, 1], [3, 1]])), origin, 90);
        expect(path.kind === "path" && path.path.nodes[1][0]).toBeCloseTo(1);
        expect(path.kind === "path" && path.path.nodes[1][1]).toBeCloseTo(3);

        const fill = rotateElement(createFill(makePath([[2, 1], [1, 2], [0, 1]])), origin, 90);
        expect(fill.kind === "fill" && fill.path.nodes[0][0]).toBeCloseTo(1);
        expect(fill.kind === "fill" && fill.path.nodes[0][1]).toBeCloseTo(2);

        const circle = rotateElement(createCircle([2, 1], 3), origin, 90);
        expect(circle.kind).toBe("circle");
        expect(circle.kind === "circle" && circle.center[0]).toBeCloseTo(1);
        expect(circle.kind === "circle" && circle.center[1]).toBeCloseTo(2);
        expect(circle.kind === "circle" && circle.radius).toBe(3);

        const arc = rotateElement(createArc([2, 1], 2, 10, 80), origin, 90);
        expect(arc.kind).toBe("arc");
        expect(arc.kind === "arc" && arc.angle1).toBeCloseTo(100);
        expect(arc.kind === "arc" && arc.angle2).toBeCloseTo(170);

        const label = rotateElement(createLabel("$A$", [2, 1], [0, 1]), origin, 90);
        expect(label.kind === "label" && label.at[0]).toBeCloseTo(1);
        expect(label.kind === "label" && label.at[1]).toBeCloseTo(2);
        expect(label.kind === "label" && label.align?.[0]).toBeCloseTo(-1);
        expect(label.kind === "label" && label.align?.[1]).toBeCloseTo(0);

        const raw = createRaw("size(200);");
        expect(rotateElement(raw, origin, 90)).toBe(raw);
    });
});
