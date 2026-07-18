import { describe, expect, test } from "bun:test";
import { parse } from "./parse";
import type { Scene, SceneElement } from "../scene/types";

/** Strip volatile `id`s so scenes compare structurally. */
function bare(scene: Scene): Omit<SceneElement, "id">[] {
    return scene.elements.map(({ id, ...rest }) => rest);
}

describe("parse", () => {
    test("dot", () => {
        expect(bare(parse("dot((1,2));").scene)).toEqual([{ kind: "dot", at: [1, 2] }]);
    });

    test("straight and cyclic paths", () => {
        expect(bare(parse("draw((0,0)--(1,1)--(2,0));").scene)).toEqual([
            { kind: "path", path: { nodes: [[0, 0], [1, 1], [2, 0]], joins: ["--", "--"], cyclic: false } },
        ]);
        expect(bare(parse("draw((0,0)--(1,0)--(0,1)--cycle);").scene)).toEqual([
            {
                kind: "path",
                path: { nodes: [[0, 0], [1, 0], [0, 1]], joins: ["--", "--", "--"], cyclic: true },
            },
        ]);
    });

    test("spline joins", () => {
        expect(bare(parse("draw((0,0)..(1,2)..(3,1));").scene)).toEqual([
            { kind: "path", path: { nodes: [[0, 0], [1, 2], [3, 1]], joins: ["..", ".."], cyclic: false } },
        ]);
    });

    test("negative coordinates", () => {
        expect(bare(parse("draw((-1,-2)--(3,-4));").scene)).toEqual([
            { kind: "path", path: { nodes: [[-1, -2], [3, -4]], joins: ["--"], cyclic: false } },
        ]);
    });

    test("circle and arc stay first-class", () => {
        expect(bare(parse("draw(circle((0,0), 5));").scene)).toEqual([
            { kind: "circle", center: [0, 0], radius: 5 },
        ]);
        expect(bare(parse("draw(arc((1,1), 2, 0, 90));").scene)).toEqual([
            { kind: "arc", center: [1, 1], radius: 2, angle1: 0, angle2: 90 },
        ]);
    });

    test("pens: named color, linewidth, dashed", () => {
        expect(bare(parse("draw((0,0)--(1,1), red+linewidth(1.5)+dashed);").scene)).toEqual([
            {
                kind: "path",
                path: { nodes: [[0, 0], [1, 1]], joins: ["--"], cyclic: false },
                pen: { namedColor: "red", lineWidth: 1.5, dash: "dashed" },
            },
        ]);
    });

    test("pen: rgb", () => {
        expect(bare(parse("dot((0,0), rgb(0.1,0.2,0.3));").scene)).toEqual([
            { kind: "dot", at: [0, 0], pen: { color: { r: 0.1, g: 0.2, b: 0.3 } } },
        ]);
    });

    test("label with position and compass align", () => {
        expect(bare(parse('label("$A$", (0,0), N);').scene)).toEqual([
            { kind: "label", text: "$A$", at: [0, 0], align: [0, 1] },
        ]);
    });

    test("fill and filldraw", () => {
        expect(bare(parse("fill((0,0)--(1,0)--(0,1)--cycle, gray);").scene)).toEqual([
            {
                kind: "fill",
                path: { nodes: [[0, 0], [1, 0], [0, 1]], joins: ["--", "--", "--"], cyclic: true },
                pen: { namedColor: "gray" },
            },
        ]);
        const fd = bare(parse("filldraw((0,0)--(1,0)--(0,1)--cycle, yellow, black);").scene);
        expect(fd).toEqual([
            {
                kind: "fill",
                path: { nodes: [[0, 0], [1, 0], [0, 1]], joins: ["--", "--", "--"], cyclic: true },
                pen: { namedColor: "yellow" },
                drawPen: { namedColor: "black" },
            },
        ]);
    });

    test("symbol table: pair and path declarations resolve", () => {
        const asy = "pair A=(0,0); pair B=(4,0); draw(A--B);";
        expect(bare(parse(asy).scene)).toEqual([
            { kind: "path", path: { nodes: [[0, 0], [4, 0]], joins: ["--"], cyclic: false } },
        ]);
    });

    test("unknown statement becomes raw and is preserved verbatim", () => {
        const { scene, diagnostics } = parse("size(200);\ndraw((0,0)--(1,1));");
        expect(bare(scene)).toEqual([
            { kind: "raw", source: "size(200);" },
            { kind: "path", path: { nodes: [[0, 0], [1, 1]], joins: ["--"], cyclic: false } },
        ]);
        expect(diagnostics.length).toBe(1);
    });

    test("recovery: a broken statement doesn't swallow the next one", () => {
        const { scene } = parse("draw((0,0)-- ; dot((1,1));");
        const kinds = scene.elements.map((e) => e.kind);
        expect(kinds).toEqual(["raw", "dot"]);
    });

    test("unresolved reference falls back to raw (no silent loss)", () => {
        const { scene } = parse("draw(A--B);");
        expect(bare(scene)).toEqual([{ kind: "raw", source: "draw(A--B);" }]);
    });

    test("unknown named color is preserved", () => {
        expect(bare(parse("draw((0,0)--(1,1), chartreuse);").scene)).toEqual([
            {
                kind: "path",
                path: { nodes: [[0, 0], [1, 1]], joins: ["--"], cyclic: false },
                pen: { namedColor: "chartreuse" },
            },
        ]);
    });
});
