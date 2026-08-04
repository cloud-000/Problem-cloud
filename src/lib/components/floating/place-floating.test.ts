import { describe, expect, test } from "bun:test";
import { placeFloating, type FloatingRect } from "./place-floating";

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 100 };
const anchor: FloatingRect = { top: 300, left: 400, width: 80, height: 40 };

describe("placeFloating — anchorless", () => {
    test("centers horizontally and places by topRatio", () => {
        const position = placeFloating(null, size, viewport, { topRatio: 0 });
        expect(position).toEqual({ top: 4, left: 400, side: null });

        const centered = placeFloating(null, size, viewport, { topRatio: 0.5 });
        expect(centered).toEqual({ top: 350, left: 400, side: null });
    });

    test("keeps the top third above the middle", () => {
        // The Coach quick-ask is summoned by a chord with no anchor, and §6.2 wants
        // it in the top third rather than dead center.
        const { top } = placeFloating(null, size, viewport, { topRatio: 0.22 });
        expect(top).toBeLessThan((viewport.height - size.height) / 2);
    });

    test("pins to the near edge when the surface is taller than the viewport", () => {
        const tall = { width: 200, height: 900 };
        expect(placeFloating(null, tall, viewport, { topRatio: 0.5, padding: 8 }).top).toBe(8);
    });
});

describe("placeFloating — anchored", () => {
    test("sits below the anchor, start-aligned, by default", () => {
        const position = placeFloating(anchor, size, viewport, { gap: 4 });
        expect(position).toEqual({ top: 344, left: 400, side: "bottom" });
    });

    test("flips above when the preferred side overflows", () => {
        const low: FloatingRect = { top: 740, left: 400, width: 80, height: 40 };
        const position = placeFloating(low, size, viewport, { gap: 4 });
        expect(position.side).toBe("top");
        expect(position.top).toBe(636);
    });

    test("stays on the preferred side when neither side fits", () => {
        const tall = { width: 200, height: 780 };
        const position = placeFloating(anchor, tall, viewport, { gap: 4 });
        expect(position.side).toBe("bottom");
    });

    test("re-aligns to the anchor's far edge instead of detaching", () => {
        const right: FloatingRect = { top: 300, left: 900, width: 80, height: 40 };
        const position = placeFloating(right, size, viewport, { gap: 4 });
        // end-aligned: 900 + 80 - 200
        expect(position.left).toBe(780);
    });

    test("center alignment is never re-aligned, only clamped", () => {
        const right: FloatingRect = { top: 300, left: 940, width: 80, height: 40 };
        const position = placeFloating(right, size, viewport, { align: "center", padding: 8 });
        expect(position.left).toBe(792);
    });

    test("side: right places a submenu beside its parent and flips when it overflows", () => {
        const item: FloatingRect = { top: 100, left: 100, width: 220, height: 32 };
        expect(placeFloating(item, size, viewport, { side: "right", gap: 4 })).toEqual({
            top: 100,
            left: 324,
            side: "right",
        });

        const nearEdge: FloatingRect = { top: 100, left: 760, width: 220, height: 32 };
        const flipped = placeFloating(nearEdge, size, viewport, { side: "right", gap: 4 });
        expect(flipped.side).toBe("left");
        expect(flipped.left).toBe(556);
    });

    test("shifts a tall submenu up rather than letting it run off the bottom", () => {
        const item: FloatingRect = { top: 760, left: 100, width: 220, height: 32 };
        const position = placeFloating(item, size, viewport, { side: "right", gap: 4 });
        // Bottom-aligned to the item (760 + 32 - 100) rather than clamped adrift.
        expect(position.top).toBe(692);
    });

    test("flip: false keeps the requested side", () => {
        const low: FloatingRect = { top: 740, left: 400, width: 80, height: 40 };
        const position = placeFloating(low, size, viewport, { gap: 4, flip: false });
        expect(position.side).toBe("bottom");
        expect(position.top).toBe(696);
    });

    test("respects padding on every edge", () => {
        const corner: FloatingRect = { top: 0, left: 0, width: 10, height: 10 };
        const position = placeFloating(corner, size, viewport, { side: "left", padding: 12 });
        // No room on the left, so it flips right; the top edge is held off by `padding`.
        expect(position).toEqual({ top: 12, left: 14, side: "right" });
    });
});
