import { describe, expect, test } from "bun:test";
import { clampToolbarPosition } from "./constraint-toolbar";

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
