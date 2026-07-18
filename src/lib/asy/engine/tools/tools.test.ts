import { describe, expect, test } from "bun:test";
import { createTool, type ToolContext } from "./index";
import { emptyScene } from "../../scene/factory";
import type { Pair, Scene } from "../../scene/types";

const ctx: ToolContext = {
    pen: { namedColor: "red" },
    tolerance: 0.5,
    simplifyEpsilon: 0.1,
    selection: [],
    promptLabel: () => "$P$",
};

describe("PointTool", () => {
    test("commits a dot on click", () => {
        const tool = createTool("point");
        const r = tool.onPointerDown(emptyScene(), [1, 2], ctx);
        expect(r.commit?.elements).toMatchObject([{ kind: "dot", at: [1, 2], pen: { namedColor: "red" } }]);
        expect(r.selection).toHaveLength(1);
    });
});

describe("LineTool", () => {
    test("drag creates a two-node path; preview during drag is not committed", () => {
        const tool = createTool("line");
        const s = emptyScene();
        expect(tool.onPointerDown(s, [0, 0], ctx).commit).toBeUndefined();
        const mv = tool.onPointerMove(s, [3, 3], ctx);
        expect(mv.preview?.elements).toHaveLength(1);
        expect(mv.commit).toBeUndefined();
        const up = tool.onPointerUp(s, [3, 3], ctx);
        expect(up.commit?.elements).toMatchObject([
            { kind: "path", path: { nodes: [[0, 0], [3, 3]], cyclic: false } },
        ]);
    });

    test("a click shorter than tolerance commits nothing", () => {
        const tool = createTool("line");
        const s = emptyScene();
        tool.onPointerDown(s, [0, 0], ctx);
        const up = tool.onPointerUp(s, [0.1, 0], ctx);
        expect(up.commit).toBeUndefined();
    });
});

describe("PenTool", () => {
    test("freehand simplifies a straight drag to endpoints", () => {
        const tool = createTool("pen");
        let s: Scene = emptyScene();
        tool.onPointerDown(s, [0, 0], ctx);
        for (const x of [1, 2, 3, 4]) tool.onPointerMove(s, [x, 0.01], ctx);
        const up = tool.onPointerUp(s, [5, 0], ctx);
        const el = up.commit!.elements[0];
        expect(el.kind).toBe("path");
        // A near-straight stroke collapses to 2 nodes.
        expect(el.kind === "path" && el.path.nodes.length).toBe(2);
    });
});

describe("ArcTool", () => {
    test("three clicks produce an arc", () => {
        const tool = createTool("arc");
        const s = emptyScene();
        tool.onPointerDown(s, [0, 0], ctx); // center
        tool.onPointerDown(s, [2, 0], ctx); // radius 2, angle1 = 0
        const commit = tool.onPointerDown(s, [0, 2], ctx); // angle2 = 90
        expect(commit.commit?.elements).toMatchObject([
            { kind: "arc", center: [0, 0], radius: 2, angle1: 0, angle2: 90 },
        ]);
    });

    test("clicking the start point again produces a full compass circle", () => {
        const tool = createTool("arc");
        const s = emptyScene();
        tool.onPointerDown(s, [0, 0], ctx);
        tool.onPointerDown(s, [2, 0], ctx);
        const commit = tool.onPointerDown(s, [2, 0], ctx);
        expect(commit.commit?.elements).toMatchObject([
            { kind: "arc", center: [0, 0], radius: 2, angle1: 0, angle2: 360 },
        ]);
    });
});

describe("LabelTool", () => {
    test("uses promptLabel text", () => {
        const tool = createTool("label");
        const r = tool.onPointerDown(emptyScene(), [1, 1], ctx);
        expect(r.commit?.elements).toMatchObject([{ kind: "label", text: "$P$", at: [1, 1] }]);
    });

    test("no text -> no element", () => {
        const tool = createTool("label");
        const r = tool.onPointerDown(emptyScene(), [1, 1], { ...ctx, promptLabel: () => null });
        expect(r.commit).toBeUndefined();
    });
});

describe("EraserTool", () => {
    test("drag erases hit elements, committed as one edit", () => {
        const point = createTool("point");
        let scene = point.onPointerDown(emptyScene(), [0, 0], ctx).commit!;
        scene = createTool("point").onPointerDown(scene, [5, 5], ctx).commit!;
        expect(scene.elements).toHaveLength(2);

        const eraser = createTool("eraser");
        eraser.onPointerDown(scene, [0, 0], ctx); // erase first dot
        eraser.onPointerMove(scene, [5, 5], ctx); // erase second dot
        const up = eraser.onPointerUp(scene, [5, 5], ctx);
        expect(up.commit?.elements).toHaveLength(0);
    });

    test("erasing empty space commits nothing", () => {
        const eraser = createTool("eraser");
        const s = emptyScene();
        eraser.onPointerDown(s, [0, 0], ctx);
        expect(eraser.onPointerUp(s, [0, 0], ctx).commit).toBeUndefined();
    });
});

describe("SelectTool", () => {
    function sceneWithDot(at: Pair) {
        return createTool("point").onPointerDown(emptyScene(), at, ctx).commit!;
    }

    test("click selects the element under the pointer", () => {
        const scene = sceneWithDot([1, 1]);
        const tool = createTool("select");
        const down = tool.onPointerDown(scene, [1, 1], ctx);
        expect(down.selection).toEqual([scene.elements[0].id]);
        // A pure click (no move) commits nothing.
        expect(tool.onPointerUp(scene, [1, 1], ctx).commit).toBeUndefined();
    });

    test("clicking empty space clears the selection", () => {
        const scene = sceneWithDot([1, 1]);
        const tool = createTool("select");
        expect(tool.onPointerDown(scene, [8, 8], ctx).selection).toEqual([]);
    });

    test("drag moves the selected element, committed once", () => {
        const scene = sceneWithDot([1, 1]);
        const tool = createTool("select");
        tool.onPointerDown(scene, [1, 1], ctx);
        tool.onPointerMove(scene, [4, 5], ctx);
        const up = tool.onPointerUp(scene, [4, 5], ctx);
        expect(up.commit?.elements).toMatchObject([{ kind: "dot", at: [4, 5] }]);
    });

    test("dragging empty space marquee-selects fully enclosed elements", () => {
        const point = createTool("point");
        let scene = point.onPointerDown(emptyScene(), [1, 1], ctx).commit!;
        scene = createTool("point").onPointerDown(scene, [6, 6], ctx).commit!;
        const tool = createTool("select");
        tool.onPointerDown(scene, [0, 0], ctx);
        expect(tool.onPointerMove(scene, [3, 3], ctx).marquee).toEqual({ start: [0, 0], end: [3, 3] });
        expect(tool.onPointerUp(scene, [3, 3], ctx).selection).toEqual([scene.elements[0].id]);
    });

    test("dragging one member of a selection moves the whole group", () => {
        let scene = createTool("point").onPointerDown(emptyScene(), [1, 1], ctx).commit!;
        scene = createTool("point").onPointerDown(scene, [2, 2], ctx).commit!;
        const selection = scene.elements.map((element) => element.id);
        const tool = createTool("select");
        tool.onPointerDown(scene, [1, 1], { ...ctx, selection });
        tool.onPointerMove(scene, [4, 5], { ...ctx, selection });
        const up = tool.onPointerUp(scene, [4, 5], { ...ctx, selection });
        expect(up.commit?.elements).toMatchObject([
            { kind: "dot", at: [4, 5] },
            { kind: "dot", at: [5, 6] },
        ]);
    });
});
