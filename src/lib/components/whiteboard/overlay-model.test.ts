import { describe, expect, test } from "bun:test";
import {
    createArc,
    createCircle,
    createDot,
    createPath,
    makePath,
    type Pair,
    type Scene,
    type SceneElement,
} from "$lib/asy/scene";
import { buildOverlay, type OverlayInput } from "./overlay-model";

/** A viewport with origin (100,100), 10 px per scene unit, y flipped. */
const project = (point: Pair): Pair => [100 + point[0] * 10, 100 - point[1] * 10];
const toScreenLength = (units: number): number => units * 10;

function scene(...elements: SceneElement[]): Scene {
    return { elements };
}

function input(overrides: Partial<OverlayInput> = {}): OverlayInput {
    return {
        displayScene: scene(),
        selection: [],
        selectionPreview: null,
        hasPreview: false,
        toolKind: "select",
        selectionContainsSmartItems: false,
        constructionArcGuide: null,
        marquee: null,
        snapProposal: null,
        constraintGlyphs: [],
        dimensionGlyphs: [],
        selectedFeatureGeometry: { points: [], segments: [], arcs: [] },
        selectedVertex: null,
        hoveredVertex: null,
        selectedArcControl: null,
        hoveredArcControl: null,
        activeArcPointer: null,
        project,
        toScreenLength,
        ...overrides,
    };
}

describe("selection box", () => {
    test("empty selection produces no overlay geometry", () => {
        const overlay = buildOverlay(input());

        expect(overlay.selectionRect).toBeNull();
        expect(overlay.selectionGeometryBounds).toBeNull();
        expect(overlay.rotationControl).toBeNull();
        expect(overlay.resizeHandles).toEqual([]);
        expect(overlay.vertexHandles).toEqual([]);
        expect(overlay.arcGuide).toBeNull();
        expect(overlay.previewElementRects).toEqual([]);
        expect(overlay.straightVertexEditablePath).toBeNull();
        expect(overlay.selectionIsPreview).toBe(false);
    });

    test("single selection pads the projected element bounds by 6px", () => {
        const circle = createCircle([1, 1], 1);
        const overlay = buildOverlay(
            input({ displayScene: scene(circle), selection: [circle.id] }),
        );

        expect(overlay.selectionGeometryBounds).toEqual({ min: [0, 0], max: [2, 2] });
        expect(overlay.selectionRect).toEqual({ x: 94, y: 74, width: 32, height: 32 });
        expect(overlay.rotationControl).toEqual({
            stemStart: [110, 74],
            screen: [110, 50],
            pivot: [1, 1],
        });
    });

    test("a rotated smart rectangle gets an oriented selection box tracking its angle", () => {
        // A unit-square rotated ~26.6°: perpendicular edges, no axis alignment.
        const rectangle = createPath(makePath([[0, 0], [2, 1], [1, 3], [-1, 2]], { cyclic: true }));
        const overlay = buildOverlay(
            input({
                displayScene: scene(rectangle),
                selection: [rectangle.id],
                selectionContainsSmartItems: true,
            }),
        );

        const quad = overlay.selectionQuad;
        expect(quad).not.toBeNull();
        if (!quad) throw new Error("expected an oriented selection quad");
        expect(quad).toHaveLength(4);
        // The outline is a genuine rectangle: adjacent edges are perpendicular.
        const edge = (i: number): Pair => [quad[(i + 1) % 4][0] - quad[i][0], quad[(i + 1) % 4][1] - quad[i][1]];
        for (let i = 0; i < 4; i++) {
            const a = edge(i);
            const b = edge((i + 1) % 4);
            expect(a[0] * b[0] + a[1] * b[1]).toBeCloseTo(0, 6);
        }
        // ...and it is actually rotated (no purely horizontal/vertical edge).
        expect(quad.some((_, i) => Math.abs(edge(i)[0]) > 1e-6 && Math.abs(edge(i)[1]) > 1e-6)).toBe(true);

        // Four corner resize handles anchored to the diagonally-opposite corner.
        expect(overlay.resizeHandles).toHaveLength(4);
        expect(overlay.resizeHandles[0].handle).toEqual([0, 0]);
        expect(overlay.resizeHandles[0].anchor).toEqual([1, 3]);
        expect(overlay.rotationControl).not.toBeNull();
    });

    test("an axis-aligned smart rectangle keeps the axis-aligned selection box", () => {
        const rectangle = createPath(makePath([[0, 0], [4, 0], [4, 2], [0, 2]], { cyclic: true }));
        const overlay = buildOverlay(
            input({
                displayScene: scene(rectangle),
                selection: [rectangle.id],
                selectionContainsSmartItems: true,
            }),
        );

        expect(overlay.selectionQuad).toBeNull();
        expect(overlay.selectionRect).not.toBeNull();
    });

    test("multi selection unions every selected element's bounds", () => {
        const circle = createCircle([1, 1], 1);
        const dot = createDot([3, 0]);
        const ignored = createDot([-9, -9]);
        const overlay = buildOverlay(
            input({
                displayScene: scene(circle, dot, ignored),
                selection: [circle.id, dot.id],
            }),
        );

        expect(overlay.selectionGeometryBounds).toEqual({ min: [0, 0], max: [3, 2] });
        expect(overlay.selectionRect).toEqual({ x: 94, y: 74, width: 42, height: 32 });
    });

    test("mixed selection folds zero-extent elements into the geometry bounds", () => {
        const circle = createCircle([1, 1], 1);
        const label: SceneElement = { id: "label-1", kind: "label", text: "$A$", at: [3, 3] };
        const overlay = buildOverlay(
            input({ displayScene: scene(circle, label), selection: [circle.id, label.id] }),
        );

        expect(overlay.selectionGeometryBounds).toEqual({ min: [0, 0], max: [3, 3] });
        expect(overlay.selectionRect).toEqual({ x: 94, y: 64, width: 42, height: 42 });
    });

    test("a preview selection swaps in the preview ids and marks the rects", () => {
        const circle = createCircle([1, 1], 1);
        const overlay = buildOverlay(
            input({
                displayScene: scene(circle),
                selection: [],
                selectionPreview: [circle.id],
            }),
        );

        expect(overlay.selectionIsPreview).toBe(true);
        expect(overlay.previewElementRects).toEqual([{ x: 96, y: 76, width: 28, height: 28 }]);
        // A preview suppresses every transform affordance.
        expect(overlay.resizeHandles).toEqual([]);
        expect(overlay.rotationControl).toBeNull();
    });
});

describe("resize handles", () => {
    const circle = createCircle([1, 1], 1);
    const baseline = input({ displayScene: scene(circle), selection: [circle.id] });

    test("a two-dimensional selection gets four corners plus four edges", () => {
        const overlay = buildOverlay(baseline);
        const byPosition = new Map(overlay.resizeHandles.map((h) => [h.position, h]));

        expect([...byPosition.keys()].sort()).toEqual(
            ["e", "n", "ne", "nw", "s", "se", "sw", "w"],
        );
        expect(byPosition.get("nw")).toEqual({
            position: "nw",
            screen: [94, 74],
            handle: [0, 2],
            anchor: [2, 0],
            axes: { x: true, y: true },
            cursor: "nwse-resize",
        });
        expect(byPosition.get("se")).toMatchObject({
            screen: [126, 106],
            handle: [2, 0],
            anchor: [0, 2],
            cursor: "nwse-resize",
        });
        expect(byPosition.get("ne")).toMatchObject({ screen: [126, 74], cursor: "nesw-resize" });
        expect(byPosition.get("sw")).toMatchObject({ screen: [94, 106], cursor: "nesw-resize" });
        expect(byPosition.get("n")).toEqual({
            position: "n",
            screen: [110, 74],
            handle: [1, 2],
            anchor: [1, 0],
            axes: { x: false, y: true },
            cursor: "ns-resize",
        });
        expect(byPosition.get("e")).toEqual({
            position: "e",
            screen: [126, 90],
            handle: [2, 1],
            anchor: [0, 1],
            axes: { x: true, y: false },
            cursor: "ew-resize",
        });
    });

    test("a smart selection keeps only the four corner handles", () => {
        const overlay = buildOverlay({ ...baseline, selectionContainsSmartItems: true });

        expect(overlay.resizeHandles.map((h) => h.position)).toEqual(["nw", "ne", "se", "sw"]);
    });

    test("a flat selection clears the y axis flag and drops the n/s handles", () => {
        const flat = createPath(makePath([[0, 0], [1, 0], [2, 0]]));
        const overlay = buildOverlay(
            input({ displayScene: scene(flat), selection: [flat.id] }),
        );

        expect(overlay.selectionRect).toEqual({ x: 94, y: 94, width: 32, height: 12 });
        expect(overlay.resizeHandles.map((h) => h.position)).toEqual(
            ["nw", "ne", "se", "sw", "e", "w"],
        );
        expect(overlay.resizeHandles[0].axes).toEqual({ x: true, y: false });
    });

    test("handles vanish outside the select tool", () => {
        const overlay = buildOverlay({ ...baseline, toolKind: "pen" });

        expect(overlay.resizeHandles).toEqual([]);
        expect(overlay.rotationControl).toBeNull();
        // The box itself still draws, so the user sees what is selected.
        expect(overlay.selectionRect).not.toBeNull();
    });
});

describe("vertex handles", () => {
    const path = createPath(makePath([[0, 0], [1, 0], [1, 1]]));
    const baseline = input({ displayScene: scene(path), selection: [path.id] });

    test("an all-straight path exposes one handle per node", () => {
        const overlay = buildOverlay(baseline);

        expect(overlay.straightVertexEditablePath?.id).toBe(path.id);
        expect(overlay.vertexHandles.map((h) => h.screen)).toEqual([
            [100, 100],
            [110, 100],
            [110, 90],
        ]);
        expect(overlay.vertexHandles.map((h) => h.handle)).toEqual([[0, 0], [1, 0], [1, 1]]);
        expect(overlay.vertexHandles.every((h) => h.cursor === "move")).toBe(true);
        expect(overlay.vertexHandles.map((h) => h.state)).toEqual([
            "default",
            "default",
            "default",
        ]);
        // Two segments, so the whole-object box and its handles stay available.
        expect(overlay.selectionRect).toEqual({ x: 94, y: 84, width: 22, height: 22 });
        expect(overlay.resizeHandles.length).toBe(8);
    });

    test("hover and selection states are per node, and stale refs are ignored", () => {
        const overlay = buildOverlay({
            ...baseline,
            hoveredVertex: { elementId: path.id, nodeIndex: 1 },
            selectedVertex: { elementId: path.id, nodeIndex: 2 },
        });
        expect(overlay.vertexHandles.map((h) => h.state)).toEqual([
            "default",
            "hovered",
            "selected",
        ]);

        const stale = buildOverlay({
            ...baseline,
            selectedVertex: { elementId: path.id, nodeIndex: 7 },
        });
        expect(stale.vertexHandles.map((h) => h.state)).toEqual([
            "default",
            "default",
            "default",
        ]);
    });

    test("a single-segment path hides the box and its transform handles", () => {
        const segment = createPath(makePath([[0, 0], [2, 1]]));
        const overlay = buildOverlay(
            input({ displayScene: scene(segment), selection: [segment.id] }),
        );

        expect(overlay.selectionRect).toBeNull();
        expect(overlay.resizeHandles).toEqual([]);
        expect(overlay.rotationControl).toBeNull();
        expect(overlay.vertexHandles.length).toBe(2);
    });

    test("a curved path is not vertex editable", () => {
        const curve = createPath(makePath([[0, 0], [1, 1], [2, 0]], { join: ".." }));
        const overlay = buildOverlay(
            input({ displayScene: scene(curve), selection: [curve.id] }),
        );

        expect(overlay.straightVertexEditablePath).toBeNull();
        expect(overlay.vertexHandles).toEqual([]);
    });
});

describe("arc guide", () => {
    const arc = createArc([1, 1], 1, 0, 90);
    const baseline = input({ displayScene: scene(arc), selection: [arc.id] });

    test("a selected arc exposes centre/start/end controls and its measurements", () => {
        const guide = buildOverlay(baseline).arcGuide;

        expect(guide).not.toBeNull();
        expect(guide?.elementId).toBe(arc.id);
        expect(guide?.radiusEditable).toBe(true);
        expect(guide?.center).toEqual([110, 90]);
        expect(guide?.radius).toBe(10);
        expect(guide?.points).toBeUndefined();
        expect(guide?.editHandles.map((h) => h.control)).toEqual(["center", "start", "end"]);
        expect(guide?.editHandles.map((h) => h.screen)).toEqual([
            [110, 90],
            [120, 90],
            [110, 80],
        ]);
        expect(guide?.editHandles.map((h) => h.handle)).toEqual([[1, 1], [2, 1], [1, 2]]);
        expect(guide?.editHandles.every((h) => h.elementId === arc.id)).toBe(true);
        // `handles` (what the renderer draws) is the same list as `editHandles`.
        expect(guide?.handles).toBe(guide!.editHandles);

        expect(guide?.measurements?.axes).toEqual([
            { start: [110, 90], end: [120, 90], label: "r 1", labelAt: [115.5, 90] },
        ]);
        expect(guide?.measurements?.angleRays).toEqual([[120, 90], [110, 80]]);
        expect(guide?.measurements?.angleLabel).toBe("θ 90°");
        expect(guide?.measurements?.angleLabelAt?.[0]).toBeCloseTo(112.687, 3);
        expect(guide?.measurements?.angleLabelAt?.[1]).toBeCloseTo(87.313, 3);
    });

    test("hover and selection mark the matching arc control", () => {
        const guide = buildOverlay({
            ...baseline,
            hoveredArcControl: { elementId: arc.id, control: "start" },
            selectedArcControl: { elementId: arc.id, control: "end" },
        }).arcGuide;

        expect(guide?.editHandles.map((h) => h.state)).toEqual([
            "default",
            "hovered",
            "selected",
        ]);
    });

    test("coincident handles separate only at rest and the active handle follows the pointer", () => {
        const closed = createArc([1, 1], 1, 0, 360);
        const closedInput = input({
            displayScene: scene(closed),
            selection: [closed.id],
        });
        const idle = buildOverlay(closedInput).arcGuide;
        expect(idle?.editHandles.find(({ control }) => control === "start")?.screen)
            .toEqual([120, 97]);
        expect(idle?.editHandles.find(({ control }) => control === "end")?.screen)
            .toEqual([120, 83]);

        const active = buildOverlay({
            ...closedInput,
            selectedArcControl: { elementId: closed.id, control: "end" },
            activeArcPointer: [133, 77],
        }).arcGuide;
        expect(active?.editHandles.find(({ control }) => control === "start")?.screen)
            .toEqual([120, 90]);
        expect(active?.editHandles.find(({ control }) => control === "end")?.screen)
            .toEqual([133, 77]);
    });

    test("a construction guide wins over the selection and is not editable", () => {
        const guide = buildOverlay({
            ...baseline,
            constructionArcGuide: { center: [0, 0], radius: 2, angle1: 0 },
        }).arcGuide;

        expect(guide?.elementId).toBeNull();
        expect(guide?.editHandles).toEqual([]);
        expect(guide?.radiusEditable).toBe(false);
        expect(guide?.center).toEqual([100, 100]);
        expect(guide?.radius).toBe(20);
        expect(guide?.handles.map((h) => h.control)).toEqual(["center", "start"]);
        expect(guide?.handles.map((h) => h.screen)).toEqual([[100, 100], [120, 100]]);
        expect(guide?.measurements?.axes).toEqual([
            { start: [100, 100], end: [120, 100], label: "r 2", labelAt: [111, 100] },
        ]);
    });

    test("a zero-radius construction guide carries no measurements", () => {
        const guide = buildOverlay({
            ...baseline,
            constructionArcGuide: { center: [0, 0], radius: 0 },
        }).arcGuide;

        expect(guide?.measurements).toBeUndefined();
        expect(guide?.handles.map((h) => h.control)).toEqual(["center"]);
    });

    test("the selected-arc guide is gated on the select tool and a settled selection", () => {
        expect(buildOverlay({ ...baseline, toolKind: "arc" }).arcGuide).toBeNull();
        expect(buildOverlay({ ...baseline, selectionPreview: [arc.id] }).arcGuide).toBeNull();
    });
});

describe("elements with no extent", () => {
    const label: SceneElement = { id: "label-1", kind: "label", text: "$AB$", at: [1, 1] };
    const dot = createDot([1, 1]);

    test("a label falls back to its text-box rect and offers no transform", () => {
        const overlay = buildOverlay(
            input({ displayScene: scene(label), selection: [label.id] }),
        );

        // No measurer injected → estimateLabelWidth: "AB" is 2 * 7.5 = 15px.
        expect(overlay.selectionRect).toEqual({ x: 96.5, y: 75, width: 27, height: 30 });
        expect(overlay.selectionGeometryBounds).toEqual({ min: [1, 1], max: [1, 1] });
        expect(overlay.resizeHandles).toEqual([]);
        expect(overlay.rotationControl).toBeNull();
    });

    test("an injected measurer sizes the box to the ink, stripped of `$`", () => {
        const seen: Array<[string, number]> = [];
        const overlay = buildOverlay(
            input({
                displayScene: scene(label),
                selection: [label.id],
                measureLabelWidth: (text, fontSize) => {
                    seen.push([text, fontSize]);
                    return 40;
                },
            }),
        );

        // The `$`s never reach the measurer, and the default font size is 14.
        expect(seen).toEqual([["AB", 14]]);
        expect(overlay.selectionRect).toEqual({ x: 84, y: 75, width: 52, height: 30 });
    });

    test("a LaTeX-heavy label is no longer over-boxed by the per-character guess", () => {
        const alpha: SceneElement = { id: "l", kind: "label", text: "$\\alpha$", at: [1, 1] };
        const estimated = buildOverlay(
            input({ displayScene: scene(alpha), selection: [alpha.id] }),
        ).selectionRect;
        const measured = buildOverlay(
            input({
                displayScene: scene(alpha),
                selection: [alpha.id],
                measureLabelWidth: () => 30,
            }),
        ).selectionRect;

        // "\alpha" is 6 chars → the estimate claims 45px for 30px of ink.
        expect(estimated?.width).toBe(45 + 12);
        expect(measured?.width).toBe(30 + 12);
    });

    test("the box scales with a label's font size", () => {
        const big: SceneElement = {
            id: "l",
            kind: "label",
            text: "$A$",
            at: [1, 1],
            pen: { fontSize: 28 },
        };
        const overlay = buildOverlay(
            input({
                displayScene: scene(big),
                selection: [big.id],
                measureLabelWidth: (_text, fontSize) => fontSize,
            }),
        );

        // Double the font → double the 9px half-height, so 36px + padding.
        expect(overlay.selectionRect).toEqual({ x: 90, y: 66, width: 40, height: 48 });
    });

    test("the minimum width keeps a narrow label grabbable", () => {
        const overlay = buildOverlay(
            input({
                displayScene: scene(label),
                selection: [label.id],
                measureLabelWidth: () => 2,
            }),
        );

        expect(overlay.selectionRect?.width).toBe(14 + 12);
    });

    test("a point collapses to a zero-size box and offers no transform", () => {
        const overlay = buildOverlay(input({ displayScene: scene(dot), selection: [dot.id] }));

        expect(overlay.selectionRect).toEqual({ x: 104, y: 84, width: 12, height: 12 });
        expect(overlay.resizeHandles).toEqual([]);
        expect(overlay.rotationControl).toBeNull();
    });
});

describe("glyphs, markers, and rubber bands", () => {
    test("constraint glyphs are nudged up-right of their anchor", () => {
        const overlay = buildOverlay(
            input({ constraintGlyphs: [{ id: "c1", at: [1, 1], selected: true }] }),
        );

        expect(overlay.constraintGlyphs).toEqual([
            { id: "c1", screen: [122, 78], selected: true },
        ]);
    });

    test("dimension glyphs project their endpoints and format their text", () => {
        const overlay = buildOverlay(
            input({
                dimensionGlyphs: [
                    { id: "d1", a: [0, 0], b: [2, 0], at: [1, 0], value: 2.5, mode: "driving", selected: false },
                    { id: "d2", a: [0, 1], b: [2, 1], at: [1, 1], value: 2.5, mode: "reference", selected: true },
                ],
            }),
        );

        expect(overlay.dimensions[0]).toEqual({
            id: "d1",
            a: [100, 100],
            b: [120, 100],
            label: [110, 100],
            text: "2.50",
            mode: "driving",
            selected: false,
            value: 2.5,
        });
        expect(overlay.dimensions[1].text).toBe("2.50 ref");
    });

    test("selected segments get numbered midpoint markers", () => {
        const overlay = buildOverlay(
            input({
                selectedFeatureGeometry: {
                    points: [[0, 1]],
                    segments: [{ a: [0, 0], b: [2, 0] }, { a: [0, 0], b: [0, 2] }],
                    arcs: [],
                },
            }),
        );

        expect(overlay.selectedSegmentMarkers).toEqual([
            { label: 1, screen: [110, 100] },
            { label: 2, screen: [100, 90] },
        ]);
        expect(overlay.featurePoints).toEqual([[100, 90]]);
        expect(overlay.featureSegments).toEqual([
            { a: [100, 100], b: [120, 100] },
            { a: [100, 100], b: [100, 80] },
        ]);
    });

    test("selected arc curves highlight their stroke instead of defining points", () => {
        const arc = createArc([0, 0], 2, 0, 90);
        const overlay = buildOverlay(
            input({
                displayScene: scene(arc),
                selectedFeatureGeometry: {
                    points: [],
                    segments: [],
                    arcs: [{
                        elementId: arc.id,
                        anchors: [[0, 0], [2, 0], [0, 2]],
                    }],
                },
            }),
        );

        expect(overlay.featurePoints).toEqual([]);
        expect(overlay.featureArcs).toHaveLength(1);
        expect(overlay.featureArcs?.[0][0]).toEqual([120, 100]);
        expect(overlay.featureArcs?.[0].at(-1)).toEqual([100, 80]);
    });

    test("marquee and snap proposal are projected screen-space", () => {
        const overlay = buildOverlay(
            input({
                marquee: { start: [2, 2], end: [0, 0] },
                snapProposal: { from: [0, 0], to: [1, 1] },
            }),
        );

        expect(overlay.marqueeRect).toEqual({ x: 100, y: 80, width: 20, height: 20 });
        expect(overlay.snapProposal).toEqual({ from: [100, 100], to: [110, 90] });
    });
});
