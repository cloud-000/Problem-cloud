import { describe, expect, test } from "bun:test";
import {
    clampPanelSize,
    mergePanelSize,
    parsePersistedPanelSize,
    resizePanel,
    serializePanelSize,
} from "./resize";

const constraints = {
    minWidth: 280,
    maxWidth: 640,
    minHeight: 240,
    maxHeight: 720,
};

describe("resizable panel sizing", () => {
    test("applies the correct delta for every edge", () => {
        const start = { width: 400, height: 500 };
        expect(resizePanel(start, 40, 0, ["left"], constraints).width).toBe(360);
        expect(resizePanel(start, 40, 0, ["right"], constraints).width).toBe(440);
        expect(resizePanel(start, 0, 40, ["top"], constraints).height).toBe(460);
        expect(resizePanel(start, 0, 40, ["bottom"], constraints).height).toBe(540);
    });

    test("resizes both dimensions from a corner", () => {
        expect(resizePanel({ width: 400, height: 500 }, -30, -20, ["left", "top"], constraints)).toEqual({
            width: 430,
            height: 520,
        });
    });

    test("snaps a collapsible dimension to zero below its minimum", () => {
        expect(
            resizePanel(
                { width: 300, height: 500 },
                170,
                0,
                ["left"],
                constraints,
                { width: true },
            ),
        ).toEqual({ width: 0, height: 500 });
        expect(
            resizePanel(
                { width: 300, height: 500 },
                40,
                0,
                ["left"],
                constraints,
                { width: true },
            ).width,
        ).toBe(280);
        expect(
            resizePanel(
                { width: 300, height: 500 },
                40,
                0,
                ["left"],
                constraints,
            ).width,
        ).toBe(280);
    });

    test("clamps dragged and restored dimensions", () => {
        expect(resizePanel({ width: 400, height: 500 }, -1000, -1000, ["left", "top"], constraints)).toEqual({
            width: 640,
            height: 720,
        });
        expect(clampPanelSize({ width: 100, height: 900 }, constraints)).toEqual({
            width: 280,
            height: 720,
        });
    });

    test("falls back for invalid persisted data and reclamps stale sizes", () => {
        const fallback = { width: 400, height: 400 };
        expect(parsePersistedPanelSize("not-json", fallback, constraints)).toEqual(fallback);
        expect(parsePersistedPanelSize('{"width":900,"height":100}', fallback, constraints)).toEqual({
            width: 640,
            height: 240,
        });
        expect(parsePersistedPanelSize('{"width":"wide","height":500}', fallback, constraints)).toEqual({
            width: 400,
            height: 500,
        });
    });

    test("serializes only finite dimensions", () => {
        expect(serializePanelSize({ width: 420, height: Number.NaN })).toBe('{"width":420}');
        expect(serializePanelSize({ width: Number.POSITIVE_INFINITY })).toBeNull();
    });

    test("preserves the inactive axis when responsive modes save separately", () => {
        const restoredMobile = parsePersistedPanelSize(
            '{"width":500,"height":900}',
            { height: 400 },
            { minHeight: 240, maxHeight: 720 },
        );
        expect(restoredMobile).toEqual({ width: 500, height: 720 });
        const mobile = mergePanelSize({ width: 420 }, { height: 560 });
        expect(mobile).toEqual({ width: 420, height: 560 });
        expect(mergePanelSize(mobile, { width: 500 })).toEqual({
            width: 500,
            height: 560,
        });
    });
});
