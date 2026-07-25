import { describe, expect, test } from "bun:test";
import type { Pair, Scene } from "../../asy/scene/types";
import {
    addLengthDimension,
    addRelationConstraint,
    applicableRelationActions,
    contextualRelationActions,
    createSmartArc,
    createSmartPath,
    createSmartPointMarker,
    editDrivingLengthDimension,
    emptyWhiteboardDocument,
    lengthDimensionValue,
    lengthDimensionsForSelection,
    resolveWhiteboardDocument,
    resizeWhiteboardItems,
    rotateWhiteboardItems,
    scaleWhiteboardItems,
    switchDirectionalRelationConstraint,
    translateWhiteboardItems,
    updateSmartPresentationStyle,
    validateWhiteboardDocument,
    type CurveFeatureRef,
    type FeatureRef,
    type PointFeatureRef,
} from ".";

function line(document = emptyWhiteboardDocument(), a: readonly [number, number] = [0, 0], b: readonly [number, number] = [4, 2]) {
    return createSmartPath(document, [a, b], false, undefined, undefined);
}

function curveFeature(document: ReturnType<typeof emptyWhiteboardDocument>, itemId: string): CurveFeatureRef {
    const item = document.items.find((candidate) => candidate.kind === "sketch-path" && candidate.id === itemId);
    if (!item || item.kind !== "sketch-path") throw new Error("missing path");
    return { kind: "curve", curveId: item.uses[0].curveId };
}

function endpoints(feature: CurveFeatureRef): [PointFeatureRef, PointFeatureRef] {
    return [
        { kind: "curve-point", curveId: feature.curveId, feature: "start" },
        { kind: "curve-point", curveId: feature.curveId, feature: "end" },
    ];
}

function expectPoint(actual: readonly [number, number], expected: readonly [number, number]): void {
    expect(actual[0]).toBeCloseTo(expected[0], 9);
    expect(actual[1]).toBeCloseTo(expected[1], 9);
}

function arcCurveId(document: ReturnType<typeof emptyWhiteboardDocument>, itemId: string): string {
    const item = document.items.find((candidate) => candidate.kind === "sketch-curve" && candidate.id === itemId);
    if (!item || item.kind !== "sketch-curve") throw new Error("missing arc item");
    return item.curveId;
}

function distance(a: readonly [number, number], b: readonly [number, number]): number {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Perpendicular distance from `p` to the infinite line through `a`→`b`. */
function lineDistance(
    p: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
): number {
    const length = distance(a, b);
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / length;
}

describe("whiteboard arc constraints (point-on-curve, tangent)", () => {
    test("point-on-curve drops an external point onto an arc's circle", () => {
        // Arc: center (0,0), start (4,0) → radius 4; plus a stray point at (5,5).
        const arc = createSmartArc(emptyWhiteboardDocument(), [0, 0], [4, 0], [0, 4], undefined, undefined, "arc");
        const withPoint = createSmartPointMarker(arc.document, [5, 5], undefined, "p");
        const curveId = arcCurveId(withPoint.document, "arc");
        const selection: FeatureRef[] = [
            withPoint.endpointFeatures[0],
            { kind: "curve", curveId },
        ];

        expect(applicableRelationActions(withPoint.document, selection).map(({ kind }) => kind))
            .toEqual(["point-on-curve"]);

        const result = addRelationConstraint(withPoint.document, "point-on-curve", selection);
        expect(result.document).toBeDefined();
        const scene = resolveWhiteboardDocument(result.document!);
        const arcElement = scene.elements.find((element) => element.kind === "arc");
        if (arcElement?.kind !== "arc") throw new Error("missing resolved arc");
        const dot = scene.elements.find((element) => element.kind === "dot");
        if (dot?.kind !== "dot") throw new Error("missing resolved point");
        // The point now sits on the arc's circle: its distance to the center is the radius.
        expect(distance(dot.at, arcElement.center)).toBeCloseTo(arcElement.radius, 5);
    });

    test("tangent makes a segment's line tangent to an arc's circle", () => {
        // Arc radius 4 at the origin; a horizontal segment sitting at y = 7.
        const arc = createSmartArc(emptyWhiteboardDocument(), [0, 0], [4, 0], [0, 4], undefined, undefined, "arc");
        const segment = createSmartPath(arc.document, [[-10, 7], [10, 7]], false, undefined, undefined, "seg");
        const arcId = arcCurveId(segment.document, "arc");
        const segItem = segment.document.items.find((item) => item.kind === "sketch-path" && item.id === "seg");
        if (!segItem || segItem.kind !== "sketch-path") throw new Error("missing segment");
        const segId = segItem.uses[0].curveId;
        const selection: CurveFeatureRef[] = [
            { kind: "curve", curveId: arcId },
            { kind: "curve", curveId: segId },
        ];

        expect(applicableRelationActions(segment.document, selection).map(({ kind }) => kind))
            .toEqual(["tangent"]);

        const result = addRelationConstraint(segment.document, "tangent", selection);
        expect(result.document).toBeDefined();
        const scene = resolveWhiteboardDocument(result.document!);
        const arcElement = scene.elements.find((element) => element.kind === "arc");
        const line = scene.elements.find((element) => element.kind === "path");
        if (arcElement?.kind !== "arc" || line?.kind !== "path") throw new Error("missing resolved geometry");
        expect(lineDistance(arcElement.center, line.path.nodes[0], line.path.nodes[1]))
            .toBeCloseTo(arcElement.radius, 5);
    });

    test("point-on-curve and tangent generalize after an arc becomes affine", () => {
        const source = createSmartArc(
            emptyWhiteboardDocument(),
            [0, 0],
            [4, 0],
            [0, 4],
            undefined,
            undefined,
            "arc",
        );
        const stretched = resizeWhiteboardItems(source.document, ["arc"], [0, 0], [2, 0.5]);
        if (!stretched.document) throw new Error("missing stretched arc");
        const withPoint = createSmartPointMarker(stretched.document, [10, 10], undefined, "p");
        const curveId = arcCurveId(withPoint.document, "arc");
        const attached = addRelationConstraint(withPoint.document, "point-on-curve", [
            withPoint.endpointFeatures[0],
            { kind: "curve", curveId },
        ]);
        expect(attached.document).toBeDefined();
        const ellipse = resolveWhiteboardDocument(attached.document!).elements
            .find((element) => element.id === "arc");
        const dot = resolveWhiteboardDocument(attached.document!).elements
            .find((element) => element.id === "p");
        if (ellipse?.kind !== "elliptical-arc" || dot?.kind !== "dot") {
            throw new Error("missing affine relation geometry");
        }
        const localX = (dot.at[0] - ellipse.center[0]) / 8;
        const localY = (dot.at[1] - ellipse.center[1]) / 2;
        expect(Math.hypot(localX, localY)).toBeCloseTo(1, 5);

        const segment = createSmartPath(
            attached.document!,
            [[-10, 7], [10, 7]],
            false,
            undefined,
            undefined,
            "seg",
        );
        const segmentItem = segment.document.items.find(
            (item) => item.kind === "sketch-path" && item.id === "seg",
        );
        if (!segmentItem || segmentItem.kind !== "sketch-path") throw new Error("missing segment");
        const tangent = addRelationConstraint(segment.document, "tangent", [
            { kind: "curve", curveId },
            { kind: "curve", curveId: segmentItem.uses[0].curveId },
        ]);
        expect(tangent.document).toBeDefined();
        const tangentScene = resolveWhiteboardDocument(tangent.document!);
        const tangentEllipse = tangentScene.elements.find((element) => element.id === "arc");
        const tangentLine = tangentScene.elements.find((element) => element.id === "seg");
        if (tangentEllipse?.kind !== "elliptical-arc" || tangentLine?.kind !== "path") {
            throw new Error("missing affine tangent geometry");
        }
        const lineDx = tangentLine.path.nodes[1][0] - tangentLine.path.nodes[0][0];
        const lineDy = tangentLine.path.nodes[1][1] - tangentLine.path.nodes[0][1];
        const lineLength = Math.hypot(lineDx, lineDy);
        const normal: Pair = [lineDy / lineLength, -lineDx / lineLength];
        const support = Math.hypot(
            normal[0] * tangentEllipse.axisX[0] + normal[1] * tangentEllipse.axisX[1],
            normal[0] * tangentEllipse.axisY[0] + normal[1] * tangentEllipse.axisY[1],
        );
        expect(lineDistance(
            tangentEllipse.center,
            tangentLine.path.nodes[0],
            tangentLine.path.nodes[1],
        )).toBeCloseTo(support, 5);
    });

    test("tangent is not applicable to two arcs and rejects atomically", () => {
        const first = createSmartArc(emptyWhiteboardDocument(), [0, 0], [4, 0], [0, 4], undefined, undefined, "a1");
        const second = createSmartArc(first.document, [20, 0], [24, 0], [20, 4], undefined, undefined, "a2");
        const selection: CurveFeatureRef[] = [
            { kind: "curve", curveId: arcCurveId(second.document, "a1") },
            { kind: "curve", curveId: arcCurveId(second.document, "a2") },
        ];
        expect(applicableRelationActions(second.document, selection)).toEqual([]);
        const result = addRelationConstraint(second.document, "tangent", selection);
        expect(result.status).toBe("failed");
        expect(result.document).toBeUndefined();
    });

    test("point-on-curve rejects a curve's own defining point", () => {
        const arc = createSmartArc(emptyWhiteboardDocument(), [0, 0], [4, 0], [0, 4], undefined, undefined, "arc");
        const curveId = arcCurveId(arc.document, "arc");
        // The arc's own `end` point lies on it trivially, so it is not offered.
        const selection = [
            { kind: "curve-point", curveId, feature: "end" } as PointFeatureRef,
            { kind: "curve", curveId } as CurveFeatureRef,
        ];
        expect(applicableRelationActions(arc.document, selection)).toEqual([]);
    });
});

describe("whiteboard smart geometry phase 3 model", () => {
    test("discovers contextual actions and authors all core line relations", () => {
        const first = line();
        const second = line(first.document, [0, 5], [2, 9]);
        const a = curveFeature(second.document, first.itemId);
        const b = curveFeature(second.document, second.itemId);
        expect(applicableRelationActions(second.document, [a]).map(({ kind }) => kind)).toEqual(["horizontal", "vertical"]);
        expect(applicableRelationActions(second.document, [a, b]).map(({ kind }) => kind)).toEqual([
            "parallel", "perpendicular", "equal-length",
        ]);
        expect(applicableRelationActions(second.document, endpoints(a)).map(({ kind }) => kind)).toEqual(["distance"]);

        for (const kind of ["horizontal", "vertical"] as const) {
            const result = addRelationConstraint(second.document, kind, [a]);
            expect(result.document).toBeDefined();
            expect(Object.values(result.document!.sketch.constraints).some((constraint) => constraint.kind === kind)).toBe(true);
        }
        for (const kind of ["parallel", "perpendicular", "equal-length"] as const) {
            const result = addRelationConstraint(second.document, kind, [a, b]);
            expect(result.document).toBeDefined();
            expect(Object.values(result.document!.sketch.constraints).some((constraint) => constraint.kind === kind)).toBe(true);
        }
        const fixed = addRelationConstraint(second.document, "fixed-point", [endpoints(a)[0]]);
        expect(fixed.document).toBeDefined();
        const distance = addRelationConstraint(second.document, "distance", endpoints(a));
        expect(distance.document).toBeDefined();
        expect(Object.values(distance.document!.sketch.parameters)[0]?.value).toBeCloseTo(Math.hypot(4, 2));
    });

    test("annotates active contextual relations independent of selection order", () => {
        const first = line();
        const second = line(first.document, [0, 5], [2, 9]);
        const a = curveFeature(second.document, first.itemId);
        const b = curveFeature(second.document, second.itemId);
        const related = addRelationConstraint(second.document, "parallel", [a, b]).document!;
        const actions = contextualRelationActions(related, [b, a]);
        expect(actions.find(({ kind }) => kind === "parallel")?.constraintId).toBeDefined();
        expect(actions.find(({ kind }) => kind === "perpendicular")?.constraintId).toBeUndefined();
    });

    test("rejects a conflicting direction relation atomically with diagnostics", () => {
        const created = line(emptyWhiteboardDocument(), [0, 0], [4, 0]);
        const feature = curveFeature(created.document, created.itemId);
        const horizontal = addRelationConstraint(created.document, "horizontal", [feature]).document!;
        const before = structuredClone(horizontal);
        const vertical = addRelationConstraint(horizontal, "vertical", [feature]);
        expect(vertical.document).toBeUndefined();
        expect(vertical.conflictingConstraintIds.length).toBeGreaterThan(0);
        expect(vertical.diagnostic).toContain("degenerate");
        expect(horizontal).toEqual(before);
    });

    test("switches mutually exclusive segment directions without collapsing length", () => {
        const created = line(emptyWhiteboardDocument(), [0, 0], [0, 4]);
        const feature = curveFeature(created.document, created.itemId);
        const vertical = addRelationConstraint(created.document, "vertical", [feature]).document!;
        const verticalId = Object.values(vertical.sketch.constraints).find(({ kind }) => kind === "vertical")!.id;
        const switched = switchDirectionalRelationConstraint(vertical, "horizontal", [feature], verticalId);
        expect(switched.document).toBeDefined();
        expect(Object.values(switched.document!.sketch.constraints).map(({ kind }) => kind)).toEqual(["horizontal"]);
        const scene = resolveWhiteboardDocument(switched.document!);
        if (scene.elements[0].kind !== "path") throw new Error("missing path");
        const [start, end] = scene.elements[0].path.nodes;
        expect(start[1]).toBeCloseTo(end[1], 9);
        expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeCloseTo(4, 9);
        expect((start[0] + end[0]) / 2).toBeCloseTo(0, 9);
        expect((start[1] + end[1]) / 2).toBeCloseTo(2, 9);
    });

    test("creates reference and driving dimensions and edits driving values atomically", () => {
        const created = line(emptyWhiteboardDocument(), [0, 0], [3, 4]);
        const feature = curveFeature(created.document, created.itemId);
        const reference = addLengthDimension(created.document, [feature], "reference").document!;
        const referenceId = Object.keys(reference.dimensions!)[0];
        expect(lengthDimensionValue(reference, referenceId)).toBe(5);
        expect(Object.keys(reference.sketch.constraints)).toHaveLength(0);

        const driving = addLengthDimension(reference, [feature], "driving").document!;
        const drivingId = Object.keys(driving.dimensions!).find((id) => id !== referenceId)!;
        expect(lengthDimensionValue(driving, drivingId)).toBe(5);
        const edited = editDrivingLengthDimension(driving, drivingId, 10);
        expect(edited.document).toBeDefined();
        expect(lengthDimensionValue(edited.document!, drivingId)).toBe(10);

        const selectedDimensions = lengthDimensionsForSelection(edited.document!, endpoints(feature));
        expect(selectedDimensions.map(({ mode }) => mode).sort()).toEqual(["driving", "reference"]);
        expect(lengthDimensionsForSelection(edited.document!, [feature])).toHaveLength(2);
        const invalid = editDrivingLengthDimension(edited.document!, drivingId, -1);
        expect(invalid.document).toBeUndefined();
        expect(lengthDimensionValue(edited.document!, drivingId)).toBe(10);
    });

    test("solver-translates smart and baked selections together and styles presentations canonically", () => {
        const created = line();
        const baked: Scene["elements"][number] = { id: "legacy", kind: "dot", at: [10, 10] };
        const mixed = { ...created.document, items: [...created.document.items, { kind: "baked" as const, element: baked }] };
        const moved = translateWhiteboardItems(mixed, [created.itemId, "legacy"], [2, 3]);
        expect(moved.document).toBeDefined();
        const scene = resolveWhiteboardDocument(moved.document!);
        expect(scene.elements[0]).toMatchObject({ kind: "path" });
        if (scene.elements[0].kind !== "path") throw new Error("missing path");
        expect(scene.elements[0].path.nodes[0][0]).toBeCloseTo(2, 9);
        expect(scene.elements[0].path.nodes[0][1]).toBeCloseTo(3, 9);
        expect(scene.elements[0].path.nodes[1][0]).toBeCloseTo(6, 9);
        expect(scene.elements[0].path.nodes[1][1]).toBeCloseTo(5, 9);
        expect(scene.elements[1]).toMatchObject({ kind: "dot", at: [12, 13] });
        const resolved = resolveWhiteboardDocument(moved.document!).elements[0];
        const styled = updateSmartPresentationStyle(moved.document!, created.itemId, {
            ...resolved,
            pen: { namedColor: "red", lineWidth: 7 },
        });
        expect(styled.items[0]).toMatchObject({ kind: "sketch-path", pen: { namedColor: "red", lineWidth: 7 } });
        expect("path" in styled.items[0]).toBe(false);
    });

    test("uniformly scales and rotates smart and baked selections canonically", () => {
        const created = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0], [4, 2]],
            false,
            undefined,
            undefined,
            "smart",
        );
        const mixed = {
            ...created.document,
            items: [
                ...created.document.items,
                { kind: "baked" as const, element: { id: "baked", kind: "dot" as const, at: [2, 3] as const } },
            ],
        };
        const scaled = scaleWhiteboardItems(mixed, ["smart", "baked"], [0, 0], 2);
        expect(scaled.document).toBeDefined();
        const scaledScene = resolveWhiteboardDocument(scaled.document!).elements;
        if (scaledScene[0].kind !== "path" || scaledScene[1].kind !== "dot") throw new Error("missing scaled selection");
        scaledScene[0].path.nodes.forEach((point, index) =>
            expectPoint(point, [[0, 0], [8, 0], [8, 4]][index] as [number, number])
        );
        expectPoint(scaledScene[1].at, [4, 6]);

        const rotated = rotateWhiteboardItems(mixed, ["smart", "baked"], [2, 1], 90);
        expect(rotated.document).toBeDefined();
        const rotatedScene = resolveWhiteboardDocument(rotated.document!).elements;
        if (rotatedScene[0].kind !== "path" || rotatedScene[1].kind !== "dot") throw new Error("missing rotated selection");
        rotatedScene[0].path.nodes.forEach((point, index) =>
            expectPoint(point, [[3, -1], [3, 3], [1, 3]][index] as [number, number])
        );
        expectPoint(rotatedScene[1].at, [0, 1]);
    });

    test("non-uniform resize promotes a smart arc to an affine smart arc", () => {
        const created = createSmartArc(
            emptyWhiteboardDocument(),
            [0, 0],
            [4, 0],
            [0, 4],
            undefined,
            undefined,
            "arc",
        );
        const resized = resizeWhiteboardItems(
            created.document,
            ["arc"],
            [0, 0],
            [2, 0.5],
        );
        expect(resized.document).toBeDefined();
        expect(validateWhiteboardDocument(resized.document!)).toEqual({ valid: true, errors: [] });
        const curve = resized.document!.sketch.curves[arcCurveId(resized.document!, "arc")];
        expect(curve).toMatchObject({
            kind: "elliptical-arc",
            axisX: [8, 0],
            axisY: [0, 2],
        });
        const resolved = resolveWhiteboardDocument(resized.document!).elements[0];
        expect(resolved).toMatchObject({
            kind: "elliptical-arc",
            center: [0, 0],
            axisX: [8, 0],
            axisY: [0, 2],
        });
        if (curve.kind !== "elliptical-arc") throw new Error("missing affine arc curve");
        expect(resized.document!.sketch.points[curve.center].at).toEqual([0, 0]);
        const invalid = structuredClone(resized.document!);
        const invalidCurve = invalid.sketch.curves[curve.id];
        if (invalidCurve.kind !== "elliptical-arc") throw new Error("missing cloned affine arc");
        invalidCurve.axisY = [...invalidCurve.axisX];
        expect(validateWhiteboardDocument(invalid).valid).toBe(false);
    });

    test("a radial constraint blocks circle-to-ellipse promotion without mutation", () => {
        const created = createSmartArc(
            emptyWhiteboardDocument(),
            [0, 0],
            [4, 0],
            [0, 4],
            undefined,
            undefined,
            "arc",
        );
        const curveId = arcCurveId(created.document, "arc");
        const constrained = {
            ...created.document,
            sketch: {
                ...created.document.sketch,
                parameters: {
                    ...created.document.sketch.parameters,
                    radius: { id: "radius", value: 4, unit: "length" as const },
                },
                constraints: {
                    ...created.document.sketch.constraints,
                    radial: {
                        id: "radial",
                        kind: "radial-distance" as const,
                        enabled: true,
                        origin: "explicit" as const,
                        curveId,
                        value: "radius",
                        display: "radius" as const,
                    },
                },
            },
        };
        const result = resizeWhiteboardItems(constrained, ["arc"], [0, 0], [2, 1]);
        expect(result.status).toBe("conflicting");
        expect(result.conflictingConstraintIds).toEqual(["radial"]);
        expect(result.document).toBeUndefined();
    });

    test("a rotated local resize changes a smart rectangle's width without losing right angles", () => {
        const root = Math.SQRT1_2;
        const created = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [2 * root, 2 * root], [root, 3 * root], [-root, root]],
            true,
            undefined,
            undefined,
            "rect",
        );
        const resized = resizeWhiteboardItems(
            created.document,
            ["rect"],
            [-root, root],
            [2, 1],
            { x: [root, root], y: [-root, root] },
        );
        expect(resized.document).toBeDefined();
        const element = resolveWhiteboardDocument(resized.document!).elements[0];
        if (element.kind !== "path") throw new Error("missing resized rectangle");
        const a = element.path.nodes[0];
        const b = element.path.nodes[1];
        const c = element.path.nodes[2];
        const ab: [number, number] = [b[0] - a[0], b[1] - a[1]];
        const bc: [number, number] = [c[0] - b[0], c[1] - b[1]];
        expect(Math.hypot(...ab)).toBeCloseTo(4, 7);
        expect(Math.hypot(...bc)).toBeCloseTo(1, 7);
        expect(ab[0] * bc[0] + ab[1] * bc[1]).toBeCloseTo(0, 7);
    });
});
