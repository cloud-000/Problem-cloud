import { describe, expect, test } from "bun:test";
import type { Pair } from "$lib/asy/scene";
import {
    createSmartArc,
    createSmartPath,
    emptyWhiteboardDocument,
} from "$lib/whiteboard/model";
import {
    autoToolbarPlacement,
    clampToolbarPosition,
    constraintToolbarGuidance,
    hasConstraintToolbarTarget,
} from "./constraint-toolbar";

describe("constraint toolbar placement", () => {
    test("keeps a dragged toolbar inside the whiteboard", () => {
        const board = { width: 600, height: 400 };
        const toolbar = { width: 240, height: 40 };

        expect(clampToolbarPosition({ left: -100, top: -100 }, board, toolbar)).toEqual({
            left: 128,
            top: 8,
        });
        expect(clampToolbarPosition({ left: 900, top: 900 }, board, toolbar)).toEqual({
            left: 472,
            top: 352,
        });
    });

    test("centers an oversized toolbar while retaining vertical bounds", () => {
        expect(clampToolbarPosition(
            { left: 0, top: 120 },
            { width: 180, height: 160 },
            { width: 300, height: 40 },
        )).toEqual({ left: 90, top: 112 });
    });
});

describe("constraint toolbar auto placement", () => {
    const board = { width: 800, height: 600 };
    const toolbar = { width: 320, height: 40 };
    const geometry = (
        segments: Array<{ a: Pair; b: Pair }> = [],
        points: Pair[] = [],
    ) => ({ points, segments, arcs: [] });

    test("places a vertical line's toolbar beside its midpoint, away from its endpoints", () => {
        const placement = autoToolbarPlacement(
            geometry([{ a: [400, 160], b: [400, 440] }]),
            board,
            toolbar,
        );
        expect(placement).toEqual({
            position: { left: 576, top: 280 },
            side: "right",
        });
    });

    test("places a horizontal line above its midpoint when both normal sides fit", () => {
        expect(autoToolbarPlacement(
            geometry([{ a: [200, 300], b: [600, 300] }]),
            board,
            toolbar,
        )).toEqual({
            position: { left: 400, top: 244 },
            side: "top",
        });
    });

    test("chooses the normal side with room instead of clamping at the board edge", () => {
        expect(autoToolbarPlacement(
            geometry([{ a: [80, 160], b: [80, 440] }]),
            board,
            toolbar,
        )).toEqual({
            position: { left: 256, top: 280 },
            side: "right",
        });
    });

    test("retains a preferred side while additive selection changes its bounds", () => {
        const before = autoToolbarPlacement(
            geometry([{ a: [300, 160], b: [300, 440] }]),
            board,
            toolbar,
        )!;
        const after = autoToolbarPlacement(
            geometry([
                { a: [300, 160], b: [300, 440] },
                { a: [400, 180], b: [400, 420] },
            ]),
            board,
            toolbar,
            before.side,
        )!;
        expect(after.side).toBe("right");
    });

    test("abandons a preferred side when it no longer fits", () => {
        const placement = autoToolbarPlacement(
            geometry([
                { a: [560, 160], b: [560, 440] },
                { a: [680, 180], b: [680, 420] },
            ]),
            board,
            toolbar,
            "right",
        )!;
        expect(placement.side).toBe("left");
    });

    test("docks at the bottom on a mobile-width board", () => {
        expect(autoToolbarPlacement(
            geometry([{ a: [200, 100], b: [200, 300] }]),
            { width: 400, height: 600 },
            toolbar,
        )).toEqual({
            position: { left: 200, top: 552 },
            side: "bottom",
        });
    });

    test("a dragged offset rides along when the selection moves", () => {
        const before = autoToolbarPlacement(
            geometry([{ a: [200, 300], b: [600, 300] }]),
            board,
            toolbar,
        )!;
        const dropped = clampToolbarPosition(
            { left: before.position.left - 60, top: before.position.top + 30 },
            board,
            toolbar,
        );
        const offset: Pair = [
            dropped.left - before.position.left,
            dropped.top - before.position.top,
        ];
        expect(offset).toEqual([-60, 30]);

        const after = autoToolbarPlacement(
            geometry([{ a: [300, 400], b: [700, 400] }]),
            board,
            toolbar,
            before.side,
        )!;
        expect(clampToolbarPosition(
            {
                left: after.position.left + offset[0],
                top: after.position.top + offset[1],
            },
            board,
            toolbar,
        )).toEqual({ left: 440, top: 374 });
    });

    test("has no placement without geometry", () => {
        expect(autoToolbarPlacement(geometry(), board, toolbar)).toBeNull();
    });
});

describe("constraint toolbar visibility", () => {
    const geometry = { points: [[0, 0]], segments: [], arcs: [] };

    test("needs the select tool, a feature selection, and an anchor", () => {
        expect(hasConstraintToolbarTarget({
            toolKind: "select",
            featureSelection: [{}],
            selectedFeatureGeometry: geometry,
        })).toBe(true);
        expect(hasConstraintToolbarTarget({
            toolKind: "pen",
            featureSelection: [{}],
            selectedFeatureGeometry: geometry,
        })).toBe(false);
        expect(hasConstraintToolbarTarget({
            toolKind: "select",
            featureSelection: [],
            selectedFeatureGeometry: geometry,
        })).toBe(false);
        expect(hasConstraintToolbarTarget({
            toolKind: "select",
            featureSelection: [{}],
            selectedFeatureGeometry: { points: [], segments: [], arcs: [] },
        })).toBe(false);
        expect(hasConstraintToolbarTarget({
            toolKind: "select",
            featureSelection: [{}],
            selectedFeatureGeometry: { points: [], segments: [], arcs: [{}] },
        })).toBe(true);
    });
});

describe("constraint toolbar guidance", () => {
    test("explains how to extend a single arc or line selection", () => {
        const arc = createSmartArc(
            emptyWhiteboardDocument(),
            [0, 0],
            [2, 0],
            [0, 2],
        );
        const arcItem = arc.document.items[0];
        if (arcItem.kind !== "sketch-curve") throw new Error("missing smart arc");
        expect(constraintToolbarGuidance(
            arc.document,
            [{ kind: "curve", curveId: arcItem.curveId }],
        )).toBe("Shift-click a smart line to make it tangent");

        const line = createSmartPath(arc.document, [[-2, 3], [2, 3]], false);
        const lineItem = line.document.items.at(-1);
        if (lineItem?.kind !== "sketch-path") throw new Error("missing smart line");
        expect(constraintToolbarGuidance(
            line.document,
            [{ kind: "curve", curveId: lineItem.uses[0].curveId }],
        )).toBe("Shift-click another smart line to compare segments");
        expect(constraintToolbarGuidance(line.document, [])).toBeNull();
    });
});
