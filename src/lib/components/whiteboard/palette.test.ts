import { describe, expect, test } from "bun:test";
import { hexToRGB } from "$lib/asy/editor-properties";
import { penStroke } from "./render";
import {
    previewSwatchColor,
    resolveInkColor,
    themeInk,
    themePalette,
    type WhiteboardPalette,
} from "./palette";

const LIGHT: WhiteboardPalette = {
    background: "#ffffff",
    foreground: "#191c1e",
    inverseInk: "#191c1e",
    border: "#e2e8f0",
    primary: "#326cec",
    isDark: false,
};
const DARK: WhiteboardPalette = { ...LIGHT, background: "#121414", foreground: "#e8eaed", isDark: true };

describe("resolveInkColor", () => {
    test("absent ink and black follow the theme foreground", () => {
        expect(resolveInkColor(undefined, LIGHT)).toBe("#191c1e");
        expect(resolveInkColor({ r: 0, g: 0, b: 0 }, LIGHT)).toBe("#191c1e");
        expect(resolveInkColor({ r: 0, g: 0, b: 0 }, DARK)).toBe("#e8eaed");
    });

    test("white paints authored in light mode and inverse ink in dark mode", () => {
        expect(resolveInkColor({ r: 1, g: 1, b: 1 }, LIGHT)).toBe("rgb(255,255,255)");
        expect(resolveInkColor({ r: 1, g: 1, b: 1 }, DARK)).toBe("#191c1e");
    });

    test("authored colors pass through in both themes", () => {
        for (const palette of [LIGHT, DARK]) {
            expect(resolveInkColor({ r: 1, g: 0, b: 0 }, palette)).toBe("rgb(255,0,0)");
        }
    });
});

describe("swatch previews match the canvas", () => {
    const swatches = ["#000000", "#808080", "#ffffff", "#ff0000", "#ff8000", "#00ff00", "#0000ff", "#800080"];
    for (const palette of [LIGHT, DARK]) {
        for (const hex of swatches) {
            test(`${hex} in ${palette.isDark ? "dark" : "light"} mode`, () => {
                const pen = { color: hexToRGB(hex) };
                expect(previewSwatchColor(hex, palette)).toBe(
                    penStroke(pen, palette, 40).color,
                );
            });
        }
    }
});

describe("theme mapping", () => {
    test("themePalette and themeInk agree on the shared slice", () => {
        const current = {
            "surface-container-lowest": "#121414",
            foreground: "#e8eaed",
            border: "#333",
            "primary-foreground": "#326cec",
        };
        const light = { foreground: "#191c1e" };
        const palette = themePalette(current, light, true);
        expect(palette).toMatchObject({ ...themeInk(current, light, true), background: "#121414" });
        expect(palette.isDark).toBe(true);
    });

    test("missing theme records fall back to the light defaults", () => {
        expect(themePalette(undefined, undefined, false)).toMatchObject({
            background: "#ffffff",
            foreground: "#191c1e",
            inverseInk: "#191c1e",
            isDark: false,
        });
    });
});
