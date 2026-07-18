import { describe, expect, test } from "bun:test";
import { isDefaultPen, mergePen, namedColorToRGB, resolvePenColor, rgbToNamedColor } from "./pen";

describe("named-color table", () => {
    test("maps names to rgb", () => {
        expect(namedColorToRGB("red")).toEqual({ r: 1, g: 0, b: 0 });
        expect(namedColorToRGB("BLUE")).toEqual({ r: 0, g: 0, b: 1 });
    });

    test("returns undefined for unknown names", () => {
        expect(namedColorToRGB("chartreuse")).toBeUndefined();
    });

    test("reverse-maps exact rgb to a canonical name", () => {
        expect(rgbToNamedColor({ r: 1, g: 0, b: 0 })).toBe("red");
        expect(rgbToNamedColor({ r: 0, g: 0, b: 0 })).toBe("black");
    });

    test("reverse lookup prefers american spelling over british", () => {
        expect(rgbToNamedColor({ r: 0.5, g: 0.5, b: 0.5 })).toBe("gray");
    });

    test("returns undefined for a color with no exact name", () => {
        expect(rgbToNamedColor({ r: 0.1, g: 0.2, b: 0.3 })).toBeUndefined();
    });

    test("name round-trips: name -> rgb -> name", () => {
        for (const name of ["red", "green", "blue", "orange", "black", "white"]) {
            const rgb = namedColorToRGB(name)!;
            expect(rgbToNamedColor(rgb)).toBe(name);
        }
    });
});

describe("pen helpers", () => {
    test("isDefaultPen", () => {
        expect(isDefaultPen(undefined)).toBe(true);
        expect(isDefaultPen({})).toBe(true);
        expect(isDefaultPen({ lineWidth: 1 })).toBe(false);
        expect(isDefaultPen({ namedColor: "red" })).toBe(false);
    });

    test("mergePen overrides base fields", () => {
        expect(mergePen({ lineWidth: 1, namedColor: "red" }, { namedColor: "blue" })).toEqual({
            lineWidth: 1,
            namedColor: "blue",
        });
    });

    test("resolvePenColor prefers named color", () => {
        expect(resolvePenColor({ namedColor: "green", color: { r: 1, g: 1, b: 1 } })).toEqual({
            r: 0,
            g: 1,
            b: 0,
        });
        expect(resolvePenColor({ color: { r: 0.2, g: 0.2, b: 0.2 } })).toEqual({
            r: 0.2,
            g: 0.2,
            b: 0.2,
        });
    });
});
