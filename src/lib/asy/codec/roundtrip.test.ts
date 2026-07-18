import { describe, expect, test } from "bun:test";
import { parse } from "./parse";
import { serialize } from "./serialize";
import type { Scene, SceneElement } from "../scene/types";

function bare(scene: Scene): Omit<SceneElement, "id">[] {
    return scene.elements.map(({ id, ...rest }) => rest);
}

/**
 * The headline contract: parsing asy, serializing it, and parsing again yields
 * a structurally identical scene. Serialize normalizes whitespace/formatting but
 * must preserve semantics, and every element (typed or raw) survives.
 */
function assertStableRoundTrip(asy: string) {
    const first = parse(asy).scene;
    const reprinted = serialize(first);
    const second = parse(reprinted).scene;
    expect(bare(second)).toEqual(bare(first));
    return { first, reprinted, second };
}

// A corpus of representative asy snippets like those embedded in problem
// statements via [asy=...]...[/asy].
const CORPUS: string[] = [
    // Triangle with labeled vertices.
    `pair A=(0,0); pair B=(4,0); pair C=(1,3);
     draw(A--B--C--cycle);
     dot(A); dot(B); dot(C);
     label("$A$", A, SW);
     label("$B$", B, SE);
     label("$C$", C, N);`,
    // Circle with a chord and center.
    `size(150);
     draw(circle((0,0), 2));
     draw((-2,0)--(2,0), blue);
     dot((0,0));`,
    // Filled region + stroke.
    `filldraw((0,0)--(2,0)--(2,1)--(0,1)--cycle, lightgray, black);`,
    // Spline curve.
    `draw((0,0)..(1,2)..(3,1)..(4,-1), red+linewidth(1));`,
    // Arc.
    `draw(arc((0,0), 3, 30, 150));`,
    // Mixed with an unknown preamble/command that must survive as raw.
    `import geometry;
     unitsize(1cm);
     draw((0,0)--(1,1));
     draw(shift((1,0))*unitcircle);`,
];

describe("round-trip", () => {
    for (const [i, asy] of CORPUS.entries()) {
        test(`corpus #${i} is stable under parse->serialize->parse`, () => {
            assertStableRoundTrip(asy);
        });
    }

    test("raw passthrough preserves exotic commands verbatim", () => {
        const asy = "draw(shift((1,0))*unitcircle);";
        const { scene, diagnostics } = parse(asy);
        expect(bare(scene)).toEqual([{ kind: "raw", source: "draw(shift((1,0))*unitcircle);" }]);
        expect(diagnostics.length).toBe(1);
        // And it survives serialization unchanged.
        expect(serialize(scene)).toBe(asy);
    });

    test("no data is lost across a full triangle diagram", () => {
        const { first } = assertStableRoundTrip(CORPUS[0]);
        const kinds = first.elements.map((e) => e.kind);
        expect(kinds).toEqual(["path", "dot", "dot", "dot", "label", "label", "label"]);
    });

    test("a Scene built by hand survives serialize->parse", () => {
        const asy = `draw((0,0)--(2,2)--(4,0)--cycle, green+linewidth(2));
dot((2,2), blue);
label("$P$", (2,2), N);
draw(circle((0,0), 1), dashed);`;
        assertStableRoundTrip(asy);
    });

    test("canonical affine ellipse output is stable", () => {
        assertStableRoundTrip(
            "draw(shift((1,2))*transform(0,0,3,-2,4,1)*unitcircle);\n" +
            "draw(shift((0,0))*transform(0,0,2,0,0,1)*arc((0,0), 1, 20, 140));",
        );
    });
});
