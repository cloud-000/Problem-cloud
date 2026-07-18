import { describe, expect, test } from "bun:test";
import { arcD, pathD, penStroke, type Project } from "./svg";
import { makePath } from "$lib/asy/scene";
import type { Pair } from "$lib/asy/scene";

// Identity-ish projection with a y-flip and 10x scale, origin at (100,100).
const project: Project = (p: Pair) => [100 + p[0] * 10, 100 - p[1] * 10];

describe("pathD", () => {
    test("straight joins become L segments", () => {
        expect(pathD(makePath([[0, 0], [1, 0], [1, 1]]), project)).toBe("M 100,100 L 110,100 L 110,90");
    });

    test("cyclic path closes with Z", () => {
        const d = pathD(makePath([[0, 0], [1, 0], [0, 1]], { cyclic: true }), project);
        expect(d.endsWith(" Z")).toBe(true);
    });

    test("spline joins emit cubic curves", () => {
        const d = pathD(makePath([[0, 0], [1, 1], [2, 0]], { join: ".." }), project);
        expect(d).toContain(" C ");
    });

    test("empty and single-node paths", () => {
        expect(pathD(makePath([]), project)).toBe("");
        expect(pathD(makePath([[2, 3]]), project)).toBe("M 120,70");
    });
});

describe("arcD", () => {
    test("samples from angle1 to angle2", () => {
        const d = arcD([0, 0], 1, 0, 90, project, 4);
        expect(d.startsWith("M ")).toBe(true);
        // start at angle 0 -> (1,0) -> screen (110,100)
        expect(d).toContain("110,100");
    });
});

describe("penStroke", () => {
    test("named color resolves to rgb()", () => {
        expect(penStroke({ namedColor: "red" }).stroke).toBe("rgb(255,0,0)");
    });
    test("default falls back", () => {
        expect(penStroke(undefined).stroke).toBe("var(--color-foreground)");
    });
    test("dash maps to a dasharray", () => {
        expect(penStroke({ dash: "dashed" }).dasharray).toBe("6 4");
    });
});
