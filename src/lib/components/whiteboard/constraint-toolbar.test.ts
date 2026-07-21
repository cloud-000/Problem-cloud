import { describe, expect, test } from "bun:test";
import type { Pair } from "$lib/asy/scene";
import {
    autoToolbarPosition,
    clampToolbarPosition,
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
    test("centers over the anchors and sits above them when there is headroom", () => {
        expect(autoToolbarPosition([[100, 200], [300, 260]])).toEqual({
            left: 200,
            top: 156,
        });
    });

    test("drops below the anchors when the toolbar would leave the top edge", () => {
        // minY 40 is under the 56px headroom, so the toolbar goes under maxY.
        expect(autoToolbarPosition([[100, 40], [300, 90]])).toEqual({
            left: 200,
            top: 102,
        });
        // Exactly at the headroom threshold it still sits above.
        expect(autoToolbarPosition([[0, 56], [0, 90]])?.top).toBe(12);
    });

    test("has no placement without anchors", () => {
        expect(autoToolbarPosition([])).toBeNull();
    });

    /**
     * The contract `constraint-toolbar.svelte` composes: a drag stores the
     * offset from the *auto* placement, so when the selection later moves the
     * toolbar travels with it instead of snapping back or drifting. Pins both
     * halves together, since the component's own wiring has no test harness.
     */
    test("a dragged offset rides along when the selection moves", () => {
        const board = { width: 800, height: 600 };
        const toolbar = { width: 320, height: 40 };
        const before = autoToolbarPosition([[400, 300], [400, 300]])!;

        // The user drags the toolbar 60px left and 30px down of its auto spot.
        const dropped = clampToolbarPosition(
            { left: before.left - 60, top: before.top + 30 },
            board,
            toolbar,
        );
        const offset: Pair = [dropped.left - before.left, dropped.top - before.top];
        expect(offset).toEqual([-60, 30]);

        // The selection moves; the toolbar keeps the same relative placement.
        const after = autoToolbarPosition([[500, 400], [500, 400]])!;
        expect(clampToolbarPosition(
            { left: after.left + offset[0], top: after.top + offset[1] },
            board,
            toolbar,
        )).toEqual({ left: 440, top: 386 });
    });
});

describe("constraint toolbar visibility", () => {
    const geometry = { points: [[0, 0]], segments: [] };

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
            selectedFeatureGeometry: { points: [], segments: [] },
        })).toBe(false);
    });
});
