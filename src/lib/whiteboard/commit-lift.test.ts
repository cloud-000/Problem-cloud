/**
 * Pipeline A → Document lift (ARCHITECTURE.md §3.2, INVARIANTS.md §4).
 *
 * Every `ToolCommit` kind must produce exactly one correct Document
 * transaction, and the smart/baked partition must follow the tool: line,
 * rectangle, and point lift to smart sketch items; pen, arc, and label stay
 * baked.
 */

import { describe, expect, test } from "bun:test";
import { createArc, createDot, createLabel, createPath, makePath } from "../asy/scene/factory";
import type { SceneElement } from "../asy/scene/types";
import type { ToolCommit } from "../asy/engine";
import {
    appendBaked,
    liftCommit,
    replaceBakedElements,
    snapCreationPreview,
    type LiftContext,
} from "./commit-lift";
import {
    createSmartPath,
    emptyWhiteboardDocument,
    resolveWhiteboardDocument,
    type WhiteboardDocument,
    type WhiteboardItem,
} from "./model";

function ctx(overrides: Partial<LiftContext> = {}): LiftContext {
    return { toolKind: "select", sceneUnitsPerPixel: 1, suppressSnap: true, ...overrides };
}

function pathElement(nodes: readonly (readonly [number, number])[], cyclic = false) {
    return createPath(makePath(nodes.map((node) => [node[0], node[1]] as [number, number]), { cyclic }));
}

function kinds(document: WhiteboardDocument): WhiteboardItem["kind"][] {
    return document.items.map((item) => item.kind);
}

function lift(
    document: WhiteboardDocument,
    commit: ToolCommit,
    overrides: Partial<LiftContext> = {},
): WhiteboardDocument {
    const before = JSON.stringify(document);
    const next = liftCommit(document, commit, ctx(overrides));
    // Every lift is a pure transaction: the input is never mutated.
    expect(JSON.stringify(document)).toBe(before);
    expect(next).not.toBeNull();
    return next!;
}

describe("commit lift: one ToolCommit -> one Document transaction", () => {
    test("add lifts line/rectangle/point to smart items and pen/label to baked", () => {
        const empty = emptyWhiteboardDocument();

        const line = lift(empty, { kind: "add", elements: [pathElement([[0, 0], [4, 0]])] }, {
            toolKind: "line",
        });
        expect(kinds(line)).toEqual(["sketch-path"]);
        expect(Object.keys(line.sketch.points)).toHaveLength(2);
        expect(Object.keys(line.sketch.curves)).toHaveLength(1);

        const rectangle = lift(
            empty,
            { kind: "add", elements: [pathElement([[0, 0], [4, 0], [4, 3], [0, 3]], true)] },
            { toolKind: "rectangle" },
        );
        const rectangleItem = rectangle.items[0];
        expect(rectangleItem.kind).toBe("sketch-path");
        if (rectangleItem.kind !== "sketch-path") throw new Error("expected a smart path");
        expect(rectangleItem.cyclic).toBe(true);
        expect(rectangleItem.uses).toHaveLength(4);
        expect(Object.keys(rectangle.sketch.points)).toHaveLength(4);
        // A rectangle ships with its defining right angles: three perpendicular
        // constraints between consecutive segments (the fourth is implied).
        const perpendiculars = Object.values(rectangle.sketch.constraints).flatMap((constraint) =>
            constraint.kind === "perpendicular" ? [[constraint.a, constraint.b]] : [],
        );
        const segmentIds = rectangleItem.uses.map((use) => use.curveId);
        expect(perpendiculars).toEqual([
            [segmentIds[0], segmentIds[1]],
            [segmentIds[1], segmentIds[2]],
            [segmentIds[2], segmentIds[3]],
        ]);

        const point = lift(empty, { kind: "add", elements: [createDot([2, 2])] }, {
            toolKind: "point",
        });
        expect(kinds(point)).toEqual(["sketch-point-marker"]);

        const baked: [string, SceneElement][] = [
            ["pen", pathElement([[0, 0], [1, 1], [2, 0]])],
            ["label", createLabel("$x$", [1, 1])],
        ];
        for (const [toolKind, element] of baked) {
            const next = lift(empty, { kind: "add", elements: [element] }, {
                toolKind: toolKind as LiftContext["toolKind"],
            });
            expect(kinds(next)).toEqual(["baked"]);
            expect(next.items[0]).toEqual({ kind: "baked", element });
            expect(next.sketch).toEqual(empty.sketch);
        }
    });

    test("partial and full arcs lift to smart three-point curves", () => {
        const empty = emptyWhiteboardDocument();

        // A partial arc (90° here) becomes a smart sketch-curve whose center and
        // two rim endpoints are real, independently draggable sketch points.
        const arc = lift(empty, { kind: "add", elements: [createArc([0, 0], 2, 0, 90)] }, {
            toolKind: "arc",
        });
        expect(kinds(arc)).toEqual(["sketch-curve"]);
        expect(Object.keys(arc.sketch.points)).toHaveLength(3);
        const curves = Object.values(arc.sketch.curves);
        expect(curves).toHaveLength(1);
        if (curves[0].kind !== "arc") throw new Error("expected an arc curve");
        // The projection reproduces the original geometry (radius from `start`,
        // CCW sweep `start`→`end`).
        const resolved = resolveWhiteboardDocument(arc).elements[0];
        if (resolved.kind !== "arc") throw new Error("expected a resolved arc");
        expect(resolved.center).toEqual([0, 0]);
        expect(resolved.radius).toBeCloseTo(2, 9);
        expect(resolved.angle1).toBeCloseTo(0, 9);
        expect(resolved.angle2).toBeCloseTo(90, 9);

        // A full turn keeps distinct endpoint identities joined by one inferred
        // coincidence, so it remains smart and can later be pulled open.
        const full = createArc([0, 0], 2, 0, 360);
        const fullLift = lift(empty, { kind: "add", elements: [full] }, { toolKind: "arc" });
        expect(kinds(fullLift)).toEqual(["sketch-curve"]);
        expect(Object.keys(fullLift.sketch.points)).toHaveLength(3);
        const closures = Object.values(fullLift.sketch.constraints).filter(
            (constraint) => constraint.kind === "coincident" && constraint.origin === "inferred",
        );
        expect(closures).toHaveLength(1);
        expect(resolveWhiteboardDocument(fullLift).elements[0]).toMatchObject({
            kind: "arc",
            angle1: 0,
            angle2: 360,
        });
    });

    test("replace swaps baked elements in place by id and leaves smart items alone", () => {
        const original = pathElement([[0, 0], [1, 0]]);
        const untouched = createDot([9, 9]);
        const smart = createSmartPath(
            appendBaked(emptyWhiteboardDocument(), [original, untouched]),
            [[5, 5], [6, 6]],
            false,
        );
        const moved = { ...original, path: makePath([[2, 2], [3, 2]]) };

        const next = lift(smart.document, { kind: "replace", elements: [moved] });
        expect(kinds(next)).toEqual(["baked", "baked", "sketch-path"]);
        expect(next.items[0]).toEqual({ kind: "baked", element: moved });
        expect(next.items[1]).toEqual({ kind: "baked", element: untouched });
        expect(next.items[2]).toEqual(smart.document.items[2]);
        // An id that matches nothing baked is a no-op, not an append.
        expect(replaceBakedElements(smart.document, [createDot([0, 0])]).items)
            .toEqual(smart.document.items);
    });

    test("erase removes exactly the named items", () => {
        const first = pathElement([[0, 0], [1, 0]]);
        const second = createDot([4, 4]);
        const document = appendBaked(emptyWhiteboardDocument(), [first, second]);

        const next = lift(document, { kind: "erase", elementIds: [first.id] });
        expect(next.items).toEqual([{ kind: "baked", element: second }]);
    });

    test("extend-path appends a node to a smart path and ignores a baked target", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0]], false);
        const next = lift(created.document, {
            kind: "extend-path",
            elementId: created.itemId,
            node: [4, 3],
        });
        const item = next.items[0];
        if (item.kind !== "sketch-path") throw new Error("expected a smart path");
        expect(item.uses).toHaveLength(2);
        expect(Object.keys(next.sketch.points)).toHaveLength(3);

        const bakedOnly = appendBaked(emptyWhiteboardDocument(), [pathElement([[0, 0], [1, 0]])]);
        const bakedId = bakedOnly.items[0].kind === "baked" ? bakedOnly.items[0].element.id : "";
        expect(liftCommit(bakedOnly, { kind: "extend-path", elementId: bakedId, node: [2, 0] }, ctx()))
            .toBeNull();
    });

    test("close-path makes the smart path cyclic", () => {
        const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0], [4, 3]], false);
        const next = lift(created.document, { kind: "close-path", elementId: created.itemId });
        const item = next.items[0];
        if (item.kind !== "sketch-path") throw new Error("expected a smart path");
        expect(item.cyclic).toBe(true);
        expect(item.uses).toHaveLength(3);
    });
});

describe("commit lift: snap inference inside the lift", () => {
    const existing = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0]], false);

    test("a created endpoint landing near an existing point is conjoined", () => {
        const next = lift(
            existing.document,
            { kind: "add", elements: [pathElement([[4.05, 0], [8, 0]])] },
            { toolKind: "line", suppressSnap: false, sceneUnitsPerPixel: 0.01 },
        );
        const coincident = Object.values(next.sketch.constraints)
            .filter((constraint) => constraint.kind === "coincident");
        expect(coincident).toHaveLength(1);
    });

    test("suppressed snap creates the same geometry with no inferred constraint", () => {
        const next = lift(
            existing.document,
            { kind: "add", elements: [pathElement([[4.05, 0], [8, 0]])] },
            { toolKind: "line", suppressSnap: true, sceneUnitsPerPixel: 0.01 },
        );
        expect(Object.values(next.sketch.constraints)).toHaveLength(0);
    });
});

describe("commit lift: creation preview snapping", () => {
    const existing = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [4, 0]], false);
    const current = resolveWhiteboardDocument(existing.document);

    test("pulls the in-flight endpoint onto a nearby feature and reports the proposal", () => {
        const drawn = pathElement([[8, 8], [4.05, 0.05]]);
        const preview = { ...current, elements: [...current.elements, drawn] };

        const result = snapCreationPreview(existing.document, current, preview, ctx({ toolKind: "line", suppressSnap: false, sceneUnitsPerPixel: 0.01 }));
        const snapped = result.scene!.elements.find((element) => element.id === drawn.id);
        if (snapped?.kind !== "path") throw new Error("expected the drawn path");
        expect(snapped.path.nodes[1]).toEqual([4, 0]);
        expect(result.snapProposal).toEqual({ from: [4.05, 0.05], to: [4, 0] });
    });

    test("a non-creation tool clears the proposal and returns the scene untouched", () => {
        const result = snapCreationPreview(existing.document, current, current, ctx());
        expect(result.scene).toBe(current);
        expect(result.snapProposal).toBeNull();
    });
});
