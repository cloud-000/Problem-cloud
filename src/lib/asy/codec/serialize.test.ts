import { describe, expect, test } from "bun:test";
import { serialize } from "./serialize";
import {
    createArc,
    createCircle,
    createDot,
    createFill,
    createLabel,
    createPath,
    createRaw,
    makePath,
} from "../scene/factory";
import type { Scene } from "../scene/types";

function scene(...elements: Scene["elements"]): Scene {
    return { elements };
}

describe("serialize", () => {
    test("dot", () => {
        expect(serialize(scene(createDot([1, 2])))).toBe("dot((1,2));");
    });

    test("straight path", () => {
        expect(serialize(scene(createPath(makePath([[0, 0], [1, 1], [2, 0]]))))).toBe(
            "draw((0,0)--(1,1)--(2,0));"
        );
    });

    test("cyclic path", () => {
        expect(
            serialize(scene(createPath(makePath([[0, 0], [1, 0], [0, 1]], { cyclic: true }))))
        ).toBe("draw((0,0)--(1,0)--(0,1)--cycle);");
    });

    test("spline path uses .. joins", () => {
        expect(
            serialize(scene(createPath(makePath([[0, 0], [1, 2], [3, 1]], { join: ".." }))))
        ).toBe("draw((0,0)..(1,2)..(3,1));");
    });

    test("circle and arc stay first-class", () => {
        expect(serialize(scene(createCircle([0, 0], 5)))).toBe("draw(circle((0,0), 5));");
        expect(serialize(scene(createArc([0, 0], 2, 0, 90)))).toBe("draw(arc((0,0), 2, 0, 90));");
    });

    test("label with and without align", () => {
        expect(serialize(scene(createLabel("$A$", [0, 0])))).toBe('label("$A$", (0,0));');
        expect(serialize(scene(createLabel("$B$", [1, 1], [1, 0])))).toBe(
            'label("$B$", (1,1), (1,0));'
        );
    });

    test("pen: named color + linewidth + dashed", () => {
        expect(
            serialize(
                scene(
                    createPath(makePath([[0, 0], [1, 1]]), {
                        namedColor: "red",
                        lineWidth: 1.5,
                        dash: "dashed",
                    })
                )
            )
        ).toBe("draw((0,0)--(1,1), red+linewidth(1.5)+dashed);");
    });

    test("pen: rgb color that matches a name serializes as the name", () => {
        expect(
            serialize(scene(createDot([0, 0], { color: { r: 0, g: 0, b: 1 } })))
        ).toBe("dot((0,0), blue);");
    });

    test("pen: rgb color with no name serializes as rgb()", () => {
        expect(
            serialize(scene(createDot([0, 0], { color: { r: 0.1, g: 0.2, b: 0.3 } })))
        ).toBe("dot((0,0), rgb(0.1,0.2,0.3));");
    });

    test("fill vs filldraw", () => {
        const path = makePath([[0, 0], [1, 0], [0, 1]], { cyclic: true });
        expect(serialize(scene(createFill(path, { namedColor: "gray" })))).toBe(
            "fill((0,0)--(1,0)--(0,1)--cycle, gray);"
        );
        expect(
            serialize(scene(createFill(path, { namedColor: "yellow" }, { namedColor: "black" })))
        ).toBe("filldraw((0,0)--(1,0)--(0,1)--cycle, yellow, black);");
    });

    test("raw passes through verbatim", () => {
        expect(serialize(scene(createRaw("size(200);")))).toBe("size(200);");
    });

    test("multiple elements: one statement per line", () => {
        expect(serialize(scene(createRaw("size(100);"), createDot([0, 0]), createCircle([0, 0], 1)))).toBe(
            "size(100);\ndot((0,0));\ndraw(circle((0,0), 1));"
        );
    });

    test("label text is escaped", () => {
        expect(serialize(scene(createLabel('a "b"', [0, 0])))).toBe('label("a \\"b\\"", (0,0));');
    });
});
