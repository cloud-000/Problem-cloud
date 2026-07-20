import { describe, expect, test } from "bun:test";
import type { Scene } from "../../asy/scene/types";
import {
    addLengthDimension,
    addRelationConstraint,
    applicableRelationActions,
    contextualRelationActions,
    createSmartPath,
    editDrivingLengthDimension,
    emptyWhiteboardDocument,
    lengthDimensionValue,
    lengthDimensionsForSelection,
    resolveWhiteboardDocument,
    rotateWhiteboardItems,
    scaleWhiteboardItems,
    switchDirectionalRelationConstraint,
    translateWhiteboardItems,
    updateSmartPresentationStyle,
    type CurveFeatureRef,
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
});
