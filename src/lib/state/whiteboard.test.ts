import { describe, expect, test } from "bun:test";
import * as bunTest from "bun:test";
import type { Scene } from "$lib/asy/scene";
import { createSmartPath, createSmartPointMarker, emptyWhiteboardDocument, type CurveFeatureRef } from "$lib/whiteboard/model";

const runtimeMock = (bunTest as unknown as {
    mock: { module(id: string, factory: () => unknown): void };
}).mock;
runtimeMock.module("$app/environment", () => ({ browser: false }));

const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

const { WhiteboardStore } = await import("./whiteboard.svelte");

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
});
