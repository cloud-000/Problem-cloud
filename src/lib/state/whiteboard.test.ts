import { describe, expect, test } from "bun:test";
import * as bunTest from "bun:test";
import type { Scene } from "$lib/asy/scene";
import {
    addRelationConstraint,
    createSmartPath,
    createSmartPointMarker,
    emptyWhiteboardDocument,
    type CurveFeatureRef,
} from "$lib/whiteboard/model";

const runtimeMock = (bunTest as unknown as {
    mock: { module(id: string, factory: () => unknown): void };
}).mock;
runtimeMock.module("$app/environment", () => ({ browser: false }));

const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

const { WhiteboardStore } = await import("./whiteboard.svelte");

function expectPoint(actual: readonly [number, number], expected: readonly [number, number]): void {
    expect(actual[0]).toBeCloseTo(expected[0], 9);
    expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe("WhiteboardStore selection gestures", () => {
    test("switching tools clears the current object selection", () => {
        const store = new WhiteboardStore({
            elements: [{ id: "selected", kind: "dot", at: [0, 0] }],
        });
        store.selection = ["selected"];

        store.setTool("line");

        expect(store.toolKind).toBe("line");
        expect(store.selection).toEqual([]);
    });

    test("the automatic return to select keeps the newly created object selected", () => {
        const store = new WhiteboardStore();
        store.setTool("line");

        store.pointerDown([0, 0]);
        store.pointerMove([4, 0]);
        store.pointerUp([4, 0]);

        expect(store.toolKind).toBe("select");
        expect(store.selection).toHaveLength(1);
        expect(store.scene.elements[0]?.id).toBe(store.selection[0]);
    });

    test("an explicit move gesture drags a selection from empty space inside its box", () => {
        const scene: Scene = {
            elements: [
                { id: "first", kind: "dot", at: [0, 0] },
                { id: "second", kind: "dot", at: [4, 4] },
            ],
        };
        const store = new WhiteboardStore(scene);
        store.selection = scene.elements.map(({ id }) => id);

        store.pointerDown([2, 2], { kind: "move" });
        store.pointerMove([5, 6]);

        expect(store.displayScene.elements).toMatchObject([
            { kind: "dot", at: [3, 4] },
            { kind: "dot", at: [7, 8] },
        ]);

        store.pointerUp([5, 6]);

        expect(store.scene.elements).toMatchObject([
            { kind: "dot", at: [3, 4] },
            { kind: "dot", at: [7, 8] },
        ]);
        expect(store.selection).toEqual(["first", "second"]);
        expect(store.preview).toBeNull();
    });

    test("solver-routes a mixed smart/baked whole-selection move as one history transaction", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0]], false, undefined, undefined, "smart");
        const document = {
            ...created.document,
            items: [...created.document.items, { kind: "baked" as const, element: { id: "baked", kind: "dot" as const, at: [10, 10] as const } }],
        };
        const store = new WhiteboardStore(document);
        store.selection = ["smart", "baked"];
        store.pointerDown([0, 0], { kind: "move" });
        store.pointerMove([2, 3]);
        store.pointerUp([2, 3]);
        expect(store.canUndo).toBe(true);
        expect(store.scene.elements[1]).toMatchObject({ kind: "dot", at: [12, 13] });
        store.undo();
        expect(store.scene.elements[1]).toMatchObject({ kind: "dot", at: [10, 10] });
        expect(store.canUndo).toBe(false);
    });

    test("solver-routes a direct drag of an unselected smart item", () => {
        const created = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0]],
            false,
            undefined,
            undefined,
            "smart",
        );
        const store = new WhiteboardStore(created.document);

        store.pointerDown([2, 0]);
        expect(store.selection).toEqual(["smart"]);
        store.pointerMove([4, 3]);
        const preview = store.displayScene.elements[0];
        if (preview.kind !== "path") throw new Error("missing smart path preview");
        expect(preview.path.nodes[0][0]).toBeCloseTo(2, 9);
        expect(preview.path.nodes[0][1]).toBeCloseTo(3, 9);
        expect(preview.path.nodes[1][0]).toBeCloseTo(6, 9);
        expect(preview.path.nodes[1][1]).toBeCloseTo(3, 9);
        store.pointerUp([4, 3]);

        const committed = store.scene.elements[0];
        if (committed.kind !== "path") throw new Error("missing committed smart path");
        expect(committed.path.nodes[0][0]).toBeCloseTo(2, 9);
        expect(committed.path.nodes[0][1]).toBeCloseTo(3, 9);
        expect(committed.path.nodes[1][0]).toBeCloseTo(6, 9);
        expect(committed.path.nodes[1][1]).toBeCloseTo(3, 9);
        expect(store.preview).toBeNull();
        expect(store.canUndo).toBe(true);
    });

    test("a direct drag on a selected baked item solver-routes the mixed selection", () => {
        const created = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0]],
            false,
            undefined,
            undefined,
            "smart",
        );
        const document = {
            ...created.document,
            items: [
                ...created.document.items,
                { kind: "baked" as const, element: { id: "baked", kind: "dot" as const, at: [10, 10] as const } },
            ],
        };
        const store = new WhiteboardStore(document);
        store.selection = ["smart", "baked"];

        store.pointerDown([10, 10]);
        store.pointerMove([12, 13]);
        store.pointerUp([12, 13]);

        const movedSmart = store.scene.elements[0];
        if (movedSmart.kind !== "path") throw new Error("missing moved smart path");
        expect(movedSmart.path.nodes[0][0]).toBeCloseTo(2, 9);
        expect(movedSmart.path.nodes[0][1]).toBeCloseTo(3, 9);
        expect(movedSmart.path.nodes[1][0]).toBeCloseTo(6, 9);
        expect(movedSmart.path.nodes[1][1]).toBeCloseTo(3, 9);
        expect(store.scene.elements[1]).toMatchObject({ kind: "dot", at: [12, 13] });
    });

    // Replaces the retired model-level `reconcileResolvedScene` test: a Pipeline A
    // (tool) edit of a baked element inside a mixed document must not disturb the
    // smart item. Under the old Scene→Document merge this was enforced by
    // re-deriving the item list from the committed Scene and throwing on drift;
    // now the commit is a `replace` delta lifted to a targeted transaction, so the
    // smart item is never even read.
    test("a baked-only drag in a mixed document leaves the smart item and sketch untouched", () => {
        const created = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0]],
            false,
            undefined,
            undefined,
            "smart",
        );
        const document = {
            ...created.document,
            items: [
                ...created.document.items,
                { kind: "baked" as const, element: { id: "baked", kind: "dot" as const, at: [10, 10] as const } },
            ],
        };
        const store = new WhiteboardStore(document);
        const smartBefore = structuredClone(store.document.items[0]);
        const sketchBefore = structuredClone(store.document.sketch);

        store.pointerDown([10, 10]);
        store.pointerMove([12, 13]);
        store.pointerUp([12, 13]);

        expect(store.scene.elements.find(({ id }) => id === "baked")).toMatchObject({
            kind: "dot",
            at: [12, 13],
        });
        expect(store.document.items[0]).toEqual(smartBefore);
        expect(store.document.sketch).toEqual(sketchBefore);
        expect(store.canUndo).toBe(true);

        store.undo();
        expect(store.scene.elements.find(({ id }) => id === "baked")).toMatchObject({ at: [10, 10] });
        expect(store.canUndo).toBe(false);
    });

    // The eraser's `erase` delta must delete smart items too, not just baked ones
    // (the old reconcile inferred this from a smart item going missing from the
    // committed Scene). Deleting a smart item must also clean up its sketch graph.
    test("erasing a smart item deletes it and its sketch geometry as one undo step", () => {
        const created = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0]],
            false,
            undefined,
            undefined,
            "smart",
        );
        const store = new WhiteboardStore(created.document);
        store.setTool("eraser");

        store.pointerDown([2, 0]);
        store.pointerUp([2, 0]);

        expect(store.scene.elements).toHaveLength(0);
        expect(store.document.items).toHaveLength(0);
        expect(Object.keys(store.document.sketch.curves)).toHaveLength(0);
        expect(Object.keys(store.document.sketch.points)).toHaveLength(0);
        expect(store.canUndo).toBe(true);

        store.undo();
        expect(store.scene.elements).toHaveLength(1);
        expect(store.canUndo).toBe(false);
    });

    test("feature actions, relation creation, and driving dimension edits are each atomic", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [3, 4]], false);
        const item = created.document.items[0];
        if (item.kind !== "sketch-path") throw new Error("missing smart path");
        const curve: CurveFeatureRef = { kind: "curve", curveId: item.uses[0].curveId };
        const store = new WhiteboardStore(created.document);
        store.selectFeature(curve);
        expect(store.applicableRelationActions.map(({ kind }) => kind)).toEqual(["horizontal", "vertical"]);
        expect(store.applyRelation("horizontal")).toBe(true);
        expect(store.canUndo).toBe(true);
        store.undo();
        expect(Object.keys(store.document.sketch.constraints)).toHaveLength(0);
        expect(store.canUndo).toBe(false);

        store.selectFeature(curve);
        expect(store.addLengthDimension("driving")).toBe(true);
        const dimensionId = store.selectedDimensionId!;
        expect(store.dimensionGlyphs[0].value).toBeCloseTo(5);
        store.undo();
        expect(store.document.dimensions).toBeUndefined();
        expect(store.canUndo).toBe(false);

        store.selectFeature(curve);
        store.addLengthDimension("driving");
        const editId = store.selectedDimensionId!;
        expect(store.editDimension(editId, 10)).toBe(true);
        expect(store.dimensionGlyphs[0].value).toBeCloseTo(10);
        store.undo();
        expect(store.dimensionGlyphs[0].value).toBeCloseTo(5);
        store.undo();
        expect(store.document.dimensions).toBeUndefined();
    });

    test("conflicting relation creation leaves the store document and history unchanged", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0]], false);
        const item = created.document.items[0];
        if (item.kind !== "sketch-path") throw new Error("missing smart path");
        const curve: CurveFeatureRef = { kind: "curve", curveId: item.uses[0].curveId };
        const store = new WhiteboardStore(created.document);
        store.selectFeature(curve);
        store.applyRelation("horizontal");
        const before = structuredClone(store.document);
        expect(store.applyRelation("vertical")).toBe(false);
        expect(store.document).toEqual(before);
        expect(store.conflictingConstraintIds.length).toBeGreaterThan(0);
        store.undo();
        expect(store.canUndo).toBe(false);
    });

    test("contextual relation toggles stay selected and each add or remove is one transaction", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 2]], false);
        const item = created.document.items[0];
        if (item.kind !== "sketch-path") throw new Error("missing smart path");
        const curve: CurveFeatureRef = { kind: "curve", curveId: item.uses[0].curveId };
        const store = new WhiteboardStore(created.document);
        store.selectFeature(curve);

        expect(store.toggleRelation("horizontal")).toBe(true);
        expect(store.featureSelection).toEqual([curve]);
        expect(store.contextualRelationActions.find(({ kind }) => kind === "horizontal")?.constraintId).toBeDefined();

        expect(store.toggleRelation("horizontal")).toBe(true);
        expect(store.featureSelection).toEqual([curve]);
        expect(Object.keys(store.document.sketch.constraints)).toHaveLength(0);
        store.undo();
        expect(Object.keys(store.document.sketch.constraints)).toHaveLength(1);
        store.undo();
        expect(Object.keys(store.document.sketch.constraints)).toHaveLength(0);
        expect(store.canUndo).toBe(false);
    });

    test("switching vertical to horizontal replaces the relation atomically without a degenerate solve", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [0, 4]], false);
        const item = created.document.items[0];
        if (item.kind !== "sketch-path") throw new Error("missing smart path");
        const curve: CurveFeatureRef = { kind: "curve", curveId: item.uses[0].curveId };
        const store = new WhiteboardStore(created.document);
        store.selectFeature(curve);

        expect(store.toggleRelation("vertical")).toBe(true);
        const vertical = structuredClone(store.document);
        expect(store.toggleRelation("horizontal")).toBe(true);
        expect(Object.values(store.document.sketch.constraints).map(({ kind }) => kind)).toEqual(["horizontal"]);
        expect(store.solverDiagnostic).not.toContain("degenerate");
        const element = store.scene.elements[0];
        if (element.kind !== "path") throw new Error("missing smart path");
        expect(Math.hypot(
            element.path.nodes[1][0] - element.path.nodes[0][0],
            element.path.nodes[1][1] - element.path.nodes[0][1],
        )).toBeCloseTo(4, 9);

        store.undo();
        expect(store.document).toEqual(vertical);
        store.undo();
        expect(Object.keys(store.document.sketch.constraints)).toHaveLength(0);
        expect(store.canUndo).toBe(false);
    });

    test("contextual dimensions remain discoverable and remove atomically", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [3, 4]], false);
        const item = created.document.items[0];
        if (item.kind !== "sketch-path") throw new Error("missing smart path");
        const curve: CurveFeatureRef = { kind: "curve", curveId: item.uses[0].curveId };
        const store = new WhiteboardStore(created.document);
        store.selectFeature(curve);

        expect(store.addLengthDimension("reference")).toBe(true);
        expect(store.featureSelection).toEqual([curve]);
        const dimensionId = store.selectedFeatureDimensions[0]?.id;
        expect(dimensionId).toBeDefined();
        expect(store.removeDimension(dimensionId!)).toBe(true);
        expect(store.selectedFeatureDimensions).toHaveLength(0);
        store.undo();
        expect(Object.keys(store.document.dimensions ?? {})).toHaveLength(1);
        store.undo();
        expect(Object.keys(store.document.dimensions ?? {})).toHaveLength(0);
        expect(store.canUndo).toBe(false);
    });

    test("short-click feature routing finds smart segments and explicit points", () => {
        const line = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0]], false, undefined, undefined, "line");
        const point = createSmartPointMarker(line.document, [8, 3], undefined, "point");
        const store = new WhiteboardStore(point.document);
        const lineItem = point.document.items.find((item) => item.kind === "sketch-path" && item.id === "line");
        if (!lineItem || lineItem.kind !== "sketch-path") throw new Error("missing smart path");

        store.selectFeatureAtItem("line", [2, 0]);
        expect(store.featureSelection).toEqual([{ kind: "curve", curveId: lineItem.uses[0].curveId }]);
        store.selectFeatureAtItem("point", [8, 3], true);
        expect(store.featureSelection).toHaveLength(2);
        expect(store.featureSelection[1]).toMatchObject({ kind: "point" });
    });

    test("short-click segment routing has a forgiving visual hit target", () => {
        const line = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0]], false, undefined, undefined, "line");
        const store = new WhiteboardStore(line.document);
        const lineItem = line.document.items[0];
        if (lineItem.kind !== "sketch-path") throw new Error("missing smart path");

        store.selectFeatureAtItem("line", [2, 0.275]);

        expect(store.featureSelection).toEqual([{ kind: "curve", curveId: lineItem.uses[0].curveId }]);
    });

    test("shift-click can select two segments from the same smart path", () => {
        const path = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0], [4, 4]],
            false,
            undefined,
            undefined,
            "path",
        );
        const store = new WhiteboardStore(path.document);
        const pathItem = path.document.items[0];
        if (pathItem.kind !== "sketch-path") throw new Error("missing smart path");

        store.selectFeatureAtItem("path", [2, 0]);
        const pointerDownSelection = [...store.featureSelection];
        store.clearFeatureSelection();
        store.selectFeatureAtItem("path", [4, 2], true, pointerDownSelection);

        expect(store.featureSelection).toEqual([
            { kind: "curve", curveId: pathItem.uses[0].curveId },
            { kind: "curve", curveId: pathItem.uses[1].curveId },
        ]);
        expect(store.contextualRelationActions.map(({ kind }) => kind)).toEqual([
            "parallel",
            "perpendicular",
            "equal-length",
        ]);
    });

    test("smart presentation property edits update style without copying resolved geometry", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0]], false, undefined, undefined, "smart");
        const store = new WhiteboardStore(created.document);
        store.selection = ["smart"];
        store.beginPropertyEdit();
        store.setInspectorProperty("lineWidth", 9);
        store.commitPropertyEdit();
        expect(store.document.items[0]).toMatchObject({ kind: "sketch-path", pen: { lineWidth: 9 } });
        expect("path" in store.document.items[0]).toBe(false);
        store.undo();
        expect(store.document.items[0]).not.toHaveProperty("pen");
        expect(store.canUndo).toBe(false);
    });

    test("commits a constrained parallel vertex drag instead of rejecting its residual", () => {
        const first = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0]],
            false,
            undefined,
            undefined,
            "first",
        );
        const second = createSmartPath(
            first.document,
            [[0, 5], [2, 9]],
            false,
            undefined,
            undefined,
            "second",
        );
        const firstItem = second.document.items.find((item) => item.kind === "sketch-path" && item.id === "first");
        const secondItem = second.document.items.find((item) => item.kind === "sketch-path" && item.id === "second");
        if (!firstItem || firstItem.kind !== "sketch-path" || !secondItem || secondItem.kind !== "sketch-path") {
            throw new Error("missing smart lines");
        }
        const related = addRelationConstraint(second.document, "parallel", [
            { kind: "curve", curveId: firstItem.uses[0].curveId },
            { kind: "curve", curveId: secondItem.uses[0].curveId },
        ]).document;
        if (!related) throw new Error("parallel relation was not created");
        const store = new WhiteboardStore(related);
        store.selection = ["first"];
        const firstLine = store.scene.elements.find((element) => element.id === "first");
        if (firstLine?.kind !== "path") throw new Error("missing resolved first line");
        const handle = firstLine.path.nodes[1];
        const target = [handle[0], handle[1] + 3] as const;

        store.pointerDown(handle, { kind: "vertex", elementId: "first", nodeIndex: 1, handle }, true);
        store.pointerMove(target, false, true);
        const previewLine = store.displayScene.elements.find((element) => element.id === "first");
        if (previewLine?.kind !== "path") throw new Error("missing preview first line");
        const previewEndpoint = previewLine.path.nodes[1];
        expect(Math.hypot(previewEndpoint[0] - target[0], previewEndpoint[1] - target[1])).toBeLessThan(0.01);
        store.pointerUp(target, false, [], true);

        const lines = store.scene.elements;
        if (lines[0].kind !== "path" || lines[1].kind !== "path") throw new Error("missing resolved lines");
        const vector = (nodes: readonly (readonly [number, number])[]) => [
            nodes[1][0] - nodes[0][0],
            nodes[1][1] - nodes[0][1],
        ] as const;
        const a = vector(lines[0].path.nodes);
        const b = vector(lines[1].path.nodes);
        const cross = (a[0] * b[1] - a[1] * b[0]) / (Math.hypot(...a) * Math.hypot(...b));
        expect(Math.abs(cross)).toBeLessThanOrEqual(1e-7);
        expect(Math.hypot(
            lines[0].path.nodes[1][0] - previewEndpoint[0],
            lines[0].path.nodes[1][1] - previewEndpoint[1],
        )).toBeLessThan(0.001);
        expect(store.solverDiagnostic).not.toContain("hard constraints exceed");
        expect(store.canUndo).toBe(true);
    });

    test("routes smart and mixed resize and rotation through canonical document transforms", () => {
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
        const resized = new WhiteboardStore(mixed);
        resized.selection = ["smart", "baked"];
        expect(resized.selectionContainsSmartItems).toBe(true);
        resized.pointerDown([4, 2], {
            kind: "resize",
            anchor: [0, 0],
            handle: [4, 2],
            axes: { x: true, y: true },
            minimumScale: [0.1, 0.1],
        });
        resized.pointerMove([8, 4]);
        resized.pointerUp([8, 4]);
        const resizedScene = resized.scene.elements;
        if (resizedScene[0].kind !== "path" || resizedScene[1].kind !== "dot") throw new Error("missing resized selection");
        resizedScene[0].path.nodes.forEach((point, index) =>
            expectPoint(point, [[0, 0], [8, 0], [8, 4]][index] as [number, number])
        );
        expectPoint(resizedScene[1].at, [4, 6]);
        expect(resized.canUndo).toBe(true);

        const rotated = new WhiteboardStore(mixed);
        rotated.selection = ["smart", "baked"];
        rotated.pointerDown([2, 3], { kind: "rotate", pivot: [2, 1] });
        rotated.pointerMove([0, 1]);
        rotated.pointerUp([0, 1]);
        const rotatedScene = rotated.scene.elements;
        if (rotatedScene[0].kind !== "path" || rotatedScene[1].kind !== "dot") throw new Error("missing rotated selection");
        rotatedScene[0].path.nodes.forEach((point, index) =>
            expectPoint(point, [[3, -1], [3, 3], [1, 3]][index] as [number, number])
        );
        expectPoint(rotatedScene[1].at, [0, 1]);
        expect(rotated.canUndo).toBe(true);
    });
});

// Pipeline ownership is decided once, on pointer-down (ARCHITECTURE.md §3.1);
// these pin that a gesture cannot change pipelines once it has started.
describe("WhiteboardStore pointer routing", () => {
    test("an active creation tool owns a gesture that starts on a smart feature", () => {
        const created = createSmartPointMarker(emptyWhiteboardDocument(), [0, 0]);
        const store = new WhiteboardStore(created.document);
        const pointsBefore = structuredClone(created.document.sketch.points);
        store.setTool("pen");

        store.pointerDown([0, 0]);
        store.pointerMove([2, 2]);
        store.pointerUp([2, 2]);

        // Pipeline A ran: ink was added and the sketch point never moved.
        expect(store.document.sketch.points).toEqual(pointsBefore);
        expect(store.document.items.filter((item) => item.kind === "baked")).toHaveLength(1);
    });

    test("a marquee started in empty space stays a marquee when it crosses a smart feature", () => {
        const created = createSmartPointMarker(emptyWhiteboardDocument(), [0, 0]);
        const store = new WhiteboardStore(created.document);
        const pointsBefore = structuredClone(created.document.sketch.points);

        store.pointerDown([-4, -4]);
        store.pointerMove([0, 0]);

        expect(store.marquee).not.toBeNull();

        store.pointerUp([2, 2]);

        expect(store.document.sketch.points).toEqual(pointsBefore);
        expect(store.selection).toEqual(store.scene.elements.map(({ id }) => id));
    });
});

// Characterization tests: these pin the store's *current* end-to-end behavior
// (creation per tool, selection/deletion, smart-gesture undo, and asy
// round-trip) so a behavior-preserving refactor of WhiteboardStore has a net.
// They document what the code does today, not an ideal.
describe("WhiteboardStore characterization — creation per tool", () => {
    /** Perform the minimal committing gesture for `tool`, returning the store. */
    const creations: Array<{
        tool: "pen" | "line" | "rectangle" | "arc" | "point" | "label";
        expectedKind: string;
        /** True where the store lifts the committed geometry into a smart item. */
        smart: boolean;
        draw: (store: InstanceType<typeof WhiteboardStore>) => void;
    }> = [
        {
            tool: "pen",
            expectedKind: "dot",
            smart: false,
            draw: (store) => {
                store.pointerDown([1, 2]);
                store.pointerUp([1, 2]);
            },
        },
        {
            tool: "line",
            expectedKind: "path",
            smart: true,
            draw: (store) => {
                store.pointerDown([0, 0]);
                store.pointerMove([4, 0]);
                store.pointerUp([4, 0]);
            },
        },
        {
            tool: "rectangle",
            expectedKind: "path",
            smart: true,
            draw: (store) => {
                store.pointerDown([0, 0]);
                store.pointerMove([4, 3]);
                store.pointerUp([4, 3]);
            },
        },
        {
            tool: "arc",
            expectedKind: "arc",
            smart: false,
            draw: (store) => {
                store.pointerDown([0, 0]); // center
                store.pointerDown([2, 0]); // radius
                store.pointerDown([0, 3]); // start angle
                store.pointerDown([-4, 0]); // end angle -> commit
            },
        },
        {
            tool: "point",
            expectedKind: "dot",
            smart: true,
            draw: (store) => {
                store.pointerDown([1, 2]); // point tool commits on down
            },
        },
        {
            tool: "label",
            expectedKind: "label",
            smart: false,
            draw: (store) => {
                store.promptLabel = () => "$P$";
                store.pointerDown([1, 1]);
            },
        },
    ];

    for (const { tool, expectedKind, smart, draw } of creations) {
        test(`${tool} creates one element as a single undoable history entry`, () => {
            const store = new WhiteboardStore();
            store.setTool(tool);

            draw(store);

            // The gesture committed exactly one element into the document.
            expect(store.scene.elements).toHaveLength(1);
            expect(store.scene.elements[0].kind).toBe(expectedKind);
            // Current behavior: line/rectangle/point are lifted to smart items,
            // while pen/arc/label stay baked.
            const item = store.document.items[0];
            expect(item.kind === "baked").toBe(!smart);
            expect(store.canUndo).toBe(true);
            expect(store.canRedo).toBe(false);

            // Exactly one undo returns to the empty document.
            store.undo();
            expect(store.scene.elements).toHaveLength(0);
            expect(store.canUndo).toBe(false);
            expect(store.canRedo).toBe(true);

            // Redo restores the created element.
            store.redo();
            expect(store.scene.elements).toHaveLength(1);
            expect(store.scene.elements[0].kind).toBe(expectedKind);
            expect(store.canUndo).toBe(true);
        });
    }
});

describe("WhiteboardStore characterization — selection and deletion", () => {
    test("clicking a baked element selects it and deleteSelected removes it as one undo step", () => {
        const store = new WhiteboardStore({
            elements: [
                { id: "a", kind: "dot", at: [0, 0] },
                { id: "b", kind: "dot", at: [5, 5] },
            ],
        });

        // Pointer-driven click selection (select is the default tool).
        store.pointerDown([0, 0]);
        store.pointerUp([0, 0]);
        expect(store.selection).toEqual(["a"]);

        store.deleteSelected();
        expect(store.scene.elements.map(({ id }) => id)).toEqual(["b"]);
        expect(store.selection).toEqual([]);
        expect(store.canUndo).toBe(true);

        store.undo();
        expect(store.scene.elements.map(({ id }) => id)).toEqual(["a", "b"]);
        expect(store.canUndo).toBe(false);
    });

    test("selectAll then deleteSelected clears the board in a single undoable step", () => {
        const store = new WhiteboardStore({
            elements: [
                { id: "a", kind: "dot", at: [0, 0] },
                { id: "b", kind: "dot", at: [5, 5] },
            ],
        });

        store.selectAll();
        expect(store.selection).toEqual(["a", "b"]);

        store.deleteSelected();
        expect(store.scene.elements).toHaveLength(0);
        expect(store.canUndo).toBe(true);

        store.undo();
        expect(store.scene.elements).toHaveLength(2);
        expect(store.canUndo).toBe(false);
    });
});

describe("WhiteboardStore characterization — smart gesture undo", () => {
    test("a solver-resolved smart vertex drag commits once and undoes to the original geometry", () => {
        const created = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0]],
            false,
            undefined,
            undefined,
            "seg",
        );
        const store = new WhiteboardStore(created.document);
        store.selection = ["seg"];
        const line = store.scene.elements.find(({ id }) => id === "seg");
        if (line?.kind !== "path") throw new Error("missing resolved smart segment");
        const handle = line.path.nodes[1];
        const target = [handle[0], handle[1] + 3] as const;

        store.pointerDown(handle, { kind: "vertex", elementId: "seg", nodeIndex: 1, handle }, true);
        store.pointerMove(target, false, true);
        store.pointerUp(target, false, [], true);

        const dragged = store.scene.elements[0];
        if (dragged.kind !== "path") throw new Error("missing dragged smart segment");
        expect(dragged.path.nodes[1][0]).toBeCloseTo(4, 6);
        expect(dragged.path.nodes[1][1]).toBeCloseTo(3, 6);
        expect(store.preview).toBeNull();
        expect(store.canUndo).toBe(true);

        store.undo();
        const restored = store.scene.elements[0];
        if (restored.kind !== "path") throw new Error("missing restored smart segment");
        expect(restored.path.nodes[1][0]).toBeCloseTo(4, 9);
        expect(restored.path.nodes[1][1]).toBeCloseTo(0, 9);
        expect(store.canUndo).toBe(false);
    });

    test("a smart whole-item translation commits once and undoes to the original geometry", () => {
        const created = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0]],
            false,
            undefined,
            undefined,
            "seg",
        );
        const store = new WhiteboardStore(created.document);
        store.selection = ["seg"];

        store.pointerDown([0, 0], { kind: "move" });
        store.pointerMove([2, 3]);
        store.pointerUp([2, 3]);

        const moved = store.scene.elements[0];
        if (moved.kind !== "path") throw new Error("missing moved smart segment");
        expectPoint(moved.path.nodes[0], [2, 3]);
        expectPoint(moved.path.nodes[1], [6, 3]);
        expect(store.preview).toBeNull();
        expect(store.canUndo).toBe(true);

        store.undo();
        const restored = store.scene.elements[0];
        if (restored.kind !== "path") throw new Error("missing restored smart segment");
        expectPoint(restored.path.nodes[0], [0, 0]);
        expectPoint(restored.path.nodes[1], [4, 0]);
        expect(store.canUndo).toBe(false);
    });

    test("a smart resize and a smart rotation each commit once and undo to the original geometry", () => {
        const source = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [4, 0], [4, 2]],
            false,
            undefined,
            undefined,
            "smart",
        );

        const resized = new WhiteboardStore(source.document);
        resized.selection = ["smart"];
        resized.pointerDown([4, 2], {
            kind: "resize",
            anchor: [0, 0],
            handle: [4, 2],
            axes: { x: true, y: true },
            minimumScale: [0.1, 0.1],
        });
        resized.pointerMove([8, 4]);
        resized.pointerUp([8, 4]);
        const resizedPath = resized.scene.elements[0];
        if (resizedPath.kind !== "path") throw new Error("missing resized smart path");
        resizedPath.path.nodes.forEach((point, index) =>
            expectPoint(point, [[0, 0], [8, 0], [8, 4]][index] as [number, number])
        );
        expect(resized.canUndo).toBe(true);
        resized.undo();
        const resizeRestored = resized.scene.elements[0];
        if (resizeRestored.kind !== "path") throw new Error("missing restored resized path");
        resizeRestored.path.nodes.forEach((point, index) =>
            expectPoint(point, [[0, 0], [4, 0], [4, 2]][index] as [number, number])
        );
        expect(resized.canUndo).toBe(false);

        const rotated = new WhiteboardStore(source.document);
        rotated.selection = ["smart"];
        rotated.pointerDown([4, 0], { kind: "rotate", pivot: [0, 0] });
        rotated.pointerMove([0, 4]);
        rotated.pointerUp([0, 4]);
        const rotatedPath = rotated.scene.elements[0];
        if (rotatedPath.kind !== "path") throw new Error("missing rotated smart path");
        // A +90° rotation about the origin maps (x, y) -> (-y, x).
        rotatedPath.path.nodes.forEach((point, index) =>
            expectPoint(point, [[0, 0], [0, 4], [-2, 4]][index] as [number, number])
        );
        expect(rotated.canUndo).toBe(true);
        rotated.undo();
        const rotateRestored = rotated.scene.elements[0];
        if (rotateRestored.kind !== "path") throw new Error("missing restored rotated path");
        rotateRestored.path.nodes.forEach((point, index) =>
            expectPoint(point, [[0, 0], [4, 0], [4, 2]][index] as [number, number])
        );
        expect(rotated.canUndo).toBe(false);
    });
});

describe("WhiteboardStore characterization — relation and dimension as single undo steps", () => {
    test("applyRelation and editDimension each push exactly one history entry", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [3, 4]], false);
        const item = created.document.items[0];
        if (item.kind !== "sketch-path") throw new Error("missing smart path");
        const curve: CurveFeatureRef = { kind: "curve", curveId: item.uses[0].curveId };
        const store = new WhiteboardStore(created.document);

        // applyRelation is one undo step.
        store.selectFeature(curve);
        expect(store.applyRelation("horizontal")).toBe(true);
        expect(store.canUndo).toBe(true);

        // addLengthDimension is a second, independent undo step. The horizontal
        // relation above already snapped the segment flat, so its current length
        // is the x-projection (3), not the original 3-4-5 hypotenuse (5).
        store.selectFeature(curve);
        expect(store.addLengthDimension("driving")).toBe(true);
        const dimensionId = store.selectedDimensionId!;
        expect(store.dimensionGlyphs[0].value).toBeCloseTo(3);

        // editDimension is a third undo step; one undo reverts only the edit.
        expect(store.editDimension(dimensionId, 10)).toBe(true);
        expect(store.dimensionGlyphs[0].value).toBeCloseTo(10);
        store.undo();
        expect(store.dimensionGlyphs[0].value).toBeCloseTo(3);

        // Peeling back the remaining two steps returns to a constraint-free doc.
        store.undo();
        expect(store.document.dimensions).toBeUndefined();
        store.undo();
        expect(Object.keys(store.document.sketch.constraints)).toHaveLength(0);
        expect(store.canUndo).toBe(false);
    });
});

describe("WhiteboardStore characterization — asy round-trip", () => {
    test("toAsy output reloads via loadAsy and re-serializes identically", () => {
        const source = new WhiteboardStore();
        source.setTool("line");
        source.pointerDown([0, 0]);
        source.pointerMove([4, 2]);
        source.pointerUp([4, 2]);
        source.setTool("point");
        source.pointerDown([6, 1]);

        const asy = source.toAsy();
        expect(asy.length).toBeGreaterThan(0);

        const reloaded = new WhiteboardStore();
        reloaded.loadAsy(asy);

        // The round trip is idempotent at the asy layer.
        expect(reloaded.toAsy()).toBe(asy);
        // The projected scene carries the same number of elements.
        expect(reloaded.scene.elements).toHaveLength(source.scene.elements.length);
        // loadAsy is a single undoable step back to the empty board.
        expect(reloaded.canUndo).toBe(true);
        reloaded.undo();
        expect(reloaded.scene.elements).toHaveLength(0);
        expect(reloaded.canUndo).toBe(false);
    });
});
