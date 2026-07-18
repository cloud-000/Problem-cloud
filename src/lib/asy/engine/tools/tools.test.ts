import { describe, expect, test } from "bun:test";
import { createTool, type ToolContext } from "./index";
import { History } from "../history";
import { DEFAULT_STROKE_PROCESSING_OPTIONS } from "../simplify";
import { emptyScene } from "../../scene/factory";
import { createCircle, createPath, makePath } from "../../scene/factory";
import { elementBounds } from "../../scene/bounds";
import { pathCommands } from "../../scene/path-geometry";
import type { Pair, Scene } from "../../scene/types";

const ctx: ToolContext = {
    pen: { namedColor: "red" },
    tolerance: 0.5,
    penTapTolerance: 0.05,
    strokeProcessing: { ...DEFAULT_STROKE_PROCESSING_OPTIONS },
    selection: [],
    lineContinuation: null,
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
        expect(up.nextTool).toBe("select");
        expect(up.lineContinuation).toEqual({
            elementId: up.commit?.elements[0].id,
            nodeIndex: 1,
        });
    });

    test("a click anchors the first point and previews the first segment before placement", () => {
        const tool = createTool("line");
        const s = emptyScene();
        tool.onPointerDown(s, [0, 0], ctx);
        const up = tool.onPointerUp(s, [0.1, 0], ctx);
        expect(up.commit).toBeUndefined();
        expect(up.preview).toBe(s);

        const preview = tool.onPointerMove(s, [3, 2], ctx);
        expect(preview.preview?.elements).toMatchObject([
            { kind: "path", path: { nodes: [[0, 0], [3, 2]], cyclic: false } },
        ]);

        const placed = tool.onPointerDown(s, [3, 2], ctx);
        expect(placed.commit?.elements).toMatchObject([
            { kind: "path", path: { nodes: [[0, 0], [3, 2]], cyclic: false } },
        ]);
        expect(placed.nextTool).toBe("select");
        expect(placed.lineContinuation).toEqual({
            elementId: placed.commit?.elements[0].id,
            nodeIndex: 1,
        });
    });
});

describe("RectangleTool", () => {
    test("drag creates a closed four-corner path with a live preview", () => {
        const tool = createTool("rectangle");
        const scene = emptyScene();
        tool.onPointerDown(scene, [1, 2], ctx);

        const preview = tool.onPointerMove(scene, [4, 6], ctx);
        expect(preview.preview?.elements).toMatchObject([
            {
                kind: "path",
                path: {
                    nodes: [[1, 2], [4, 2], [4, 6], [1, 6]],
                    cyclic: true,
                },
            },
        ]);

        const up = tool.onPointerUp(scene, [4, 6], ctx);
        expect(up.commit?.elements).toMatchObject([
            {
                kind: "path",
                path: {
                    nodes: [[1, 2], [4, 2], [4, 6], [1, 6]],
                    joins: ["--", "--", "--", "--"],
                    cyclic: true,
                },
                pen: { namedColor: "red" },
            },
        ]);
        expect(up.selection).toEqual([up.commit?.elements[0].id]);
        expect(up.nextTool).toBe("select");
    });

    test("a drag with either dimension shorter than tolerance commits nothing", () => {
        const scene = emptyScene();
        const tool = createTool("rectangle");
        tool.onPointerDown(scene, [0, 0], ctx);
        expect(tool.onPointerUp(scene, [0.1, 4], ctx).commit).toBeUndefined();
    });
});

describe("PenTool", () => {
    test("a tap commits exactly one pen-aware dot", () => {
        const tool = createTool("pen");
        const scene = emptyScene();
        const styled = {
            ...ctx,
            pen: { namedColor: "blue", lineWidth: 6, opacity: 0.4 },
        };
        tool.onPointerDown(scene, [1, 2], styled);

        const up = tool.onPointerUp(scene, [1, 2], styled);

        expect(up.commit?.elements).toHaveLength(1);
        expect(up.commit?.elements).toMatchObject([
            {
                kind: "dot",
                at: [1, 2],
                pen: styled.pen,
            },
        ]);
        expect(up.selection).toEqual([]);
    });

    test("small drags resolve to either one tap or one stroke, never both", () => {
        const scene = emptyScene();
        const tap = createTool("pen");
        tap.onPointerDown(scene, [0, 0], ctx);
        const tapCommit = tap.onPointerUp(scene, [0.04, 0], ctx, [[0.02, 0.01]]).commit;

        const stroke = createTool("pen");
        stroke.onPointerDown(scene, [0, 0], ctx);
        const strokeCommit = stroke.onPointerUp(scene, [0.06, 0], ctx, [[0.03, 0]]).commit;

        expect(tapCommit?.elements).toHaveLength(1);
        expect(tapCommit?.elements[0].kind).toBe("dot");
        expect(strokeCommit?.elements).toHaveLength(1);
        expect(strokeCommit?.elements[0].kind).toBe("path");
    });

    test("a tap commit is one undoable history step", () => {
        const before = emptyScene();
        const tool = createTool("pen");
        tool.onPointerDown(before, [0, 0], ctx);
        const after = tool.onPointerUp(before, [0, 0], ctx).commit!;
        const history = new History<Scene>();
        history.push(before);

        expect(history.undo(after)).toEqual(before);
        expect(history.redo(before)?.elements).toHaveLength(1);
    });

    test("live preview uses the current pen style", () => {
        const tool = createTool("pen");
        const scene = emptyScene();
        const styled = {
            ...ctx,
            pen: { namedColor: "blue", lineWidth: 4, dash: "dashed" as const },
        };
        tool.onPointerDown(scene, [0, 0], styled);

        const preview = tool.onPointerMove(scene, [1, 1], styled);

        expect(preview.preview?.elements).toMatchObject([
            { kind: "path", pen: styled.pen },
        ]);
    });

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

    test("processes a sample batch into one preview with the same raw geometry", () => {
        const scene = emptyScene();
        const samples: Pair[] = [[1, 0.2], [2, 0.1], [3, 1]];
        const batched = createTool("pen");
        batched.onPointerDown(scene, [0, 0], ctx);
        const preview = batched.onPointerMoves?.(scene, samples, ctx);

        const individual = createTool("pen");
        individual.onPointerDown(scene, [0, 0], ctx);
        let last;
        for (const sample of samples) last = individual.onPointerMove(scene, sample, ctx);

        const batchedElement = preview?.preview?.elements[0];
        const individualElement = last?.preview?.elements[0];
        expect(batchedElement).toMatchObject({ kind: "path" });
        expect(batchedElement?.kind === "path" ? batchedElement.path : null).toEqual(
            individualElement?.kind === "path" ? individualElement.path : null,
        );
    });

    test("pointer-up incorporates a pending frame batch before committing", () => {
        const tool = createTool("pen");
        const scene = emptyScene();
        tool.onPointerDown(scene, [0, 0], ctx);
        const commit = tool.onPointerUp(scene, [3, 1], ctx, [[1, 0.2], [2, 0.1]]);
        const committed = commit.commit?.elements[0];

        const reference = createTool("pen");
        reference.onPointerDown(scene, [0, 0], ctx);
        reference.onPointerMoves?.(scene, [[1, 0.2], [2, 0.1]], ctx);
        const expected = reference.onPointerUp(scene, [3, 1], ctx).commit?.elements[0];
        expect(committed?.kind === "path" ? committed.path : null).toEqual(
            expected?.kind === "path" ? expected.path : null,
        );
    });

    test("cancel clears the active draft and ignores later buffered release", () => {
        const tool = createTool("pen");
        const scene = emptyScene();
        tool.onPointerDown(scene, [0, 0], ctx);
        tool.onPointerMoves?.(scene, [[1, 1], [2, 1]], ctx);
        expect(tool.onCancel().preview).toBeNull();
        expect(tool.onPointerUp(scene, [3, 1], ctx, [[2.5, 1]])).toEqual({});
    });

    test("live and committed strokes use the same processed mixed-join geometry", () => {
        const tool = createTool("pen");
        const scene = emptyScene();
        tool.onPointerDown(scene, [0, 0], ctx);
        tool.onPointerMove(scene, [1, 0.25], ctx);
        tool.onPointerMove(scene, [2, 0], ctx);
        const preview = tool.onPointerMove(scene, [3, 1], ctx);
        const commit = tool.onPointerUp(scene, [3, 1], ctx);
        const previewElement = preview.preview?.elements[0];
        const commitElement = commit.commit?.elements[0];

        expect(previewElement?.kind).toBe("path");
        expect(commitElement?.kind).toBe("path");
        if (previewElement?.kind !== "path" || commitElement?.kind !== "path") return;
        expect(commitElement.id).toBe(previewElement.id);
        expect(commitElement.path).toEqual(previewElement.path);
    });

    test("custom processing options remain identical across batched preview and commit", () => {
        const tool = createTool("pen");
        const scene = emptyScene();
        const custom: ToolContext = {
            ...ctx,
            strokeProcessing: {
                sampleSpacing: 0.3,
                simplifyTolerance: 0.05,
                smoothing: 0.8,
                cornerThresholdDegrees: 75,
            },
        };
        tool.onPointerDown(scene, [0, 0], custom);
        const preview = tool.onPointerMoves?.(
            scene,
            [[0.4, 0.2], [1, -0.1], [1.6, 0.8], [2, 1]],
            custom,
        );
        const commit = tool.onPointerUp(scene, [2, 1], custom);
        const previewElement = preview?.preview?.elements[0];
        const commitElement = commit.commit?.elements[0];

        expect(previewElement?.kind).toBe("path");
        expect(commitElement?.kind).toBe("path");
        if (previewElement?.kind !== "path" || commitElement?.kind !== "path") return;
        expect(commitElement.path).toEqual(previewElement.path);
    });

    test("passes the explicit corner threshold into join classification", () => {
        const scene = emptyScene();
        const draw = (cornerThresholdDegrees: number) => {
            const tool = createTool("pen");
            const options: ToolContext = {
                ...ctx,
                strokeProcessing: {
                    sampleSpacing: 0,
                    simplifyTolerance: 0,
                    smoothing: 0,
                    cornerThresholdDegrees,
                },
            };
            tool.onPointerDown(scene, [0, 0], options);
            tool.onPointerMoves?.(scene, [[1, 0], [1, 1]], options);
            return tool.onPointerUp(scene, [1, 1], options).commit?.elements[0];
        };

        const smooth = draw(91);
        const cusp = draw(90);
        expect(smooth?.kind === "path" ? smooth.path.joins : null).toEqual(["..", ".."]);
        expect(cusp?.kind === "path" ? cusp.path.joins : null).toEqual(["--", "--"]);
    });

    test("a deliberate corner becomes a cusp while gentle segments remain curved", () => {
        const tool = createTool("pen");
        const scene = emptyScene();
        const exact = {
            ...ctx,
            strokeProcessing: {
                ...ctx.strokeProcessing,
                sampleSpacing: 0,
                simplifyTolerance: 0,
            },
        };
        tool.onPointerDown(scene, [0, 0], exact);
        tool.onPointerMoves?.(scene, [[1, 0], [2, 0], [2, 1], [2, 2], [3, 2.5]], exact);
        const preview = tool.onPointerMove(scene, [4, 2.7], exact);
        const commit = tool.onPointerUp(scene, [4, 2.7], exact);
        const previewElement = preview.preview?.elements[0];
        const commitElement = commit.commit?.elements[0];

        expect(previewElement?.kind).toBe("path");
        expect(commitElement?.kind).toBe("path");
        if (previewElement?.kind !== "path" || commitElement?.kind !== "path") return;
        expect(commitElement.path).toEqual(previewElement.path);
        expect(commitElement.path.joins).toContain("--");
        expect(commitElement.path.joins).toContain("..");
        const commands = pathCommands(commitElement.path);
        expect(commands.some(({ kind }) => kind === "line")).toBe(true);
        expect(commands.some(({ kind }) => kind === "curve")).toBe(true);
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

    function sceneWithMixedPath() {
        const path = createPath(makePath(
            [[0, 0], [1, 1], [2, 1], [3, 0]],
            { joins: ["..", "--", ".."] },
        ));
        return { scene: { elements: [path] } as Scene, path };
    }

    test("click selects the element under the pointer", () => {
        const scene = sceneWithDot([1, 1]);
        const tool = createTool("select");
        const down = tool.onPointerDown(scene, [1, 1], ctx);
        expect(down.selection).toEqual([scene.elements[0].id]);
        // A pure click (no move) commits nothing.
        expect(tool.onPointerUp(scene, [1, 1], ctx).commit).toBeUndefined();
    });

    test("previews and appends repeated line continuations to the same path", () => {
        const scene = { elements: [createPath(makePath([[0, 0], [2, 1]]), ctx.pen)] };
        const line = scene.elements[0];
        const continuationCtx: ToolContext = {
            ...ctx,
            selection: [line.id],
            lineContinuation: { elementId: line.id, nodeIndex: 1 },
        };
        const tool = createTool("select");
        const preview = tool.onPointerMove(scene, [4, 3], continuationCtx);
        expect(preview.preview?.elements).toHaveLength(1);
        expect(preview.preview?.elements).toMatchObject([
            { id: line.id, kind: "path", path: { nodes: [[0, 0], [2, 1], [4, 3]] } },
        ]);

        const result = tool.onPointerDown(scene, [4, 3], continuationCtx);
        expect(result.commit?.elements).toHaveLength(1);
        expect(result.commit?.elements).toMatchObject([
            { id: line.id, kind: "path", path: { nodes: [[0, 0], [2, 1], [4, 3]] } },
        ]);
        expect(result.selection).toEqual([line.id]);
        expect(result.lineContinuation).toEqual({ elementId: line.id, nodeIndex: 2 });

        const extended = tool.onPointerDown(result.commit!, [5, 4], {
            ...continuationCtx,
            lineContinuation: result.lineContinuation!,
        });
        expect(extended.commit?.elements).toHaveLength(1);
        expect(extended.commit?.elements).toMatchObject([
            { id: line.id, kind: "path", path: { nodes: [[0, 0], [2, 1], [4, 3], [5, 4]] } },
        ]);
        expect(extended.lineContinuation).toEqual({ elementId: line.id, nodeIndex: 3 });
    });

    test("clicking the start of a multi-segment path closes it without repeating the node", () => {
        const scene = { elements: [createPath(makePath([[0, 0], [2, 1], [4, 3]]))] };
        const path = scene.elements[0];
        const tool = createTool("select");
        const continuationCtx: ToolContext = {
            ...ctx,
            selection: [path.id],
            lineContinuation: { elementId: path.id, nodeIndex: 2 },
        };
        const preview = tool.onPointerMove(scene, [0.2, 0.1], continuationCtx);
        expect(preview.preview?.elements).toMatchObject([
            {
                id: path.id,
                kind: "path",
                path: { nodes: [[0, 0], [2, 1], [4, 3], [0, 0]], cyclic: false },
            },
        ]);

        const result = tool.onPointerDown(scene, [0.2, 0.1], continuationCtx);
        expect(result.commit?.elements).toHaveLength(1);
        expect(result.commit?.elements).toMatchObject([
            {
                id: path.id,
                kind: "path",
                path: {
                    nodes: [[0, 0], [2, 1], [4, 3]],
                    joins: ["--", "--", "--"],
                    cyclic: true,
                },
            },
        ]);
        expect(result.lineContinuation).toBeNull();
        expect(result.consoleMessage).toBe("[Whiteboard] Closed path at its starting vertex.");
    });

    test("clicking near an endpoint of a single segment only cancels continuation", () => {
        const scene = { elements: [createPath(makePath([[0, 0], [2, 1]]))] };
        const line = scene.elements[0];
        const tool = createTool("select");
        const continuationCtx: ToolContext = {
            ...ctx,
            selection: [line.id],
            lineContinuation: { elementId: line.id, nodeIndex: 1 },
        };
        const preview = tool.onPointerMove(scene, [0.2, 0.1], continuationCtx);
        expect(preview.preview?.elements).toMatchObject([
            {
                id: line.id,
                kind: "path",
                path: { nodes: [[0, 0], [2, 1], [0, 0]], cyclic: false },
            },
        ]);

        const result = tool.onPointerDown(scene, [0.2, 0.1], continuationCtx);
        expect(result.commit).toBeUndefined();
        expect(result.lineContinuation).toBeNull();
        expect(result.preview).toBeNull();
    });

    test("previewing cancellation at the current endpoint draws no zero-length segment", () => {
        const scene = { elements: [createPath(makePath([[0, 0], [2, 1], [4, 3]]))] };
        const path = scene.elements[0];
        const preview = createTool("select").onPointerMove(scene, [4.2, 3.1], {
            ...ctx,
            selection: [path.id],
            lineContinuation: { elementId: path.id, nodeIndex: 2 },
        });

        expect(preview.preview).toBe(scene);
        expect(preview.preview?.elements[0]).toBe(path);
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

    test("whole-object move, resize, and rotation preserve mixed joins", () => {
        const originalJoins = ["..", "--", ".."];

        const movedSource = sceneWithMixedPath();
        const move = createTool("select");
        move.onPointerDown(movedSource.scene, [0, 0], {
            ...ctx,
            selection: [movedSource.path.id],
        });
        move.onPointerMove(movedSource.scene, [2, 3], ctx);
        const moved = move.onPointerUp(movedSource.scene, [2, 3], ctx).commit?.elements[0];
        expect(moved?.kind === "path" ? moved.path.joins : []).toEqual(originalJoins);
        expect(moved?.kind === "path" ? moved.path.nodes[0] : null).toEqual([2, 3]);

        const resizedSource = sceneWithMixedPath();
        const resize = createTool("select");
        const resizeCtx: ToolContext = {
            ...ctx,
            selection: [resizedSource.path.id],
            selectionTransform: {
                kind: "resize",
                anchor: [0, 0],
                handle: [3, 1],
                axes: { x: true, y: true },
                minimumScale: [0.1, 0.1],
            },
        };
        resize.onPointerDown(resizedSource.scene, [3, 1], resizeCtx);
        const resized = resize.onPointerUp(resizedSource.scene, [6, 2], resizeCtx)
            .commit?.elements[0];
        expect(resized?.kind === "path" ? resized.path.joins : []).toEqual(originalJoins);
        expect(resized?.kind === "path" ? resized.path.nodes.at(-1) : null).toEqual([6, 0]);

        const rotatedSource = sceneWithMixedPath();
        const rotate = createTool("select");
        const rotateCtx: ToolContext = {
            ...ctx,
            selection: [rotatedSource.path.id],
            selectionTransform: { kind: "rotate", pivot: [0, 0] },
        };
        rotate.onPointerDown(rotatedSource.scene, [1, 0], rotateCtx);
        const rotated = rotate.onPointerUp(rotatedSource.scene, [0, 1], rotateCtx)
            .commit?.elements[0];
        expect(rotated?.kind === "path" ? rotated.path.joins : []).toEqual(originalJoins);
        if (rotated?.kind !== "path") return;
        expect(rotated.path.nodes[1][0]).toBeCloseTo(-1);
        expect(rotated.path.nodes[1][1]).toBeCloseTo(1);
    });

    test("dragging empty space marquee-selects fully enclosed elements", () => {
        const point = createTool("point");
        let scene = point.onPointerDown(emptyScene(), [1, 1], ctx).commit!;
        scene = createTool("point").onPointerDown(scene, [6, 6], ctx).commit!;
        const tool = createTool("select");
        tool.onPointerDown(scene, [0, 0], ctx);
        const preview = tool.onPointerMove(scene, [3, 3], ctx);
        expect(preview.marquee).toEqual({ start: [0, 0], end: [3, 3] });
        expect(preview.selectionPreview).toEqual([scene.elements[0].id]);
        const result = tool.onPointerUp(scene, [3, 3], ctx);
        expect(result.selection).toEqual([scene.elements[0].id]);
        expect(result.selectionPreview).toBeNull();
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

    const resizeCornerCases: Array<{
        handle: Pair;
        anchor: Pair;
        target: Pair;
        expected: { min: Pair; max: Pair };
    }> = [
        {
            handle: [0, 0] as Pair,
            anchor: [2, 2] as Pair,
            target: [-2, -2] as Pair,
            expected: { min: [-2, -2], max: [2, 2] },
        },
        {
            handle: [2, 0] as Pair,
            anchor: [0, 2] as Pair,
            target: [4, -2] as Pair,
            expected: { min: [0, -2], max: [4, 2] },
        },
        {
            handle: [2, 2] as Pair,
            anchor: [0, 0] as Pair,
            target: [4, 4] as Pair,
            expected: { min: [0, 0], max: [4, 4] },
        },
        {
            handle: [0, 2] as Pair,
            anchor: [2, 0] as Pair,
            target: [-2, 4] as Pair,
            expected: { min: [-2, 0], max: [2, 4] },
        },
    ];

    for (const [index, { handle, anchor, target, expected }] of resizeCornerCases.entries()) {
        test(`proportionally resizes from corner ${index + 1} while fixing its opposite corner`, () => {
            const scene = {
                elements: [createPath(makePath([[0, 0], [2, 0], [2, 2], [0, 2]], { cyclic: true }))],
            };
            const selection = [scene.elements[0].id];
            const tool = createTool("select");
            const transformCtx: ToolContext = {
                ...ctx,
                selection,
                lockAspectRatio: true,
                selectionTransform: {
                    kind: "resize",
                    anchor,
                    handle,
                    axes: { x: true, y: true },
                    minimumScale: [0.1, 0.1],
                },
            };
            tool.onPointerDown(scene, handle, transformCtx);
            expect(tool.onPointerMove(scene, target, transformCtx).commit).toBeUndefined();
            const result = tool.onPointerUp(scene, target, transformCtx);
            expect(elementBounds(result.commit!.elements[0])).toEqual(expected);
        });
    }

    test("corner resize changes width and height independently", () => {
        const shape = createPath(makePath([[0, 0], [2, 0], [2, 2], [0, 2]], { cyclic: true }));
        const scene = { elements: [shape] };
        const tool = createTool("select");
        const transformCtx: ToolContext = {
            ...ctx,
            selection: [shape.id],
            selectionTransform: {
                kind: "resize",
                anchor: [0, 0],
                handle: [2, 2],
                axes: { x: true, y: true },
                minimumScale: [0.1, 0.1],
            },
        };
        tool.onPointerDown(scene, [2, 2], transformCtx);
        const result = tool.onPointerUp(scene, [4, 6], transformCtx);
        expect(elementBounds(result.commit!.elements[0])).toEqual({ min: [0, 0], max: [4, 6] });
    });

    test("edge resize changes one dimension and Shift preserves the original ratio", () => {
        const shape = createPath(makePath([[0, 0], [2, 0], [2, 2], [0, 2]], { cyclic: true }));
        const scene = { elements: [shape] };
        const gesture = {
            kind: "resize" as const,
            anchor: [0, 1] as Pair,
            handle: [2, 1] as Pair,
            axes: { x: true, y: false },
            minimumScale: [0.1, 0.1] as Pair,
        };

        const free = createTool("select");
        const freeCtx: ToolContext = { ...ctx, selection: [shape.id], selectionTransform: gesture };
        free.onPointerDown(scene, [2, 1], freeCtx);
        const freeResult = free.onPointerUp(scene, [4, 3], freeCtx);
        expect(elementBounds(freeResult.commit!.elements[0])).toEqual({ min: [0, 0], max: [4, 2] });

        const locked = createTool("select");
        const lockedCtx: ToolContext = { ...freeCtx, lockAspectRatio: true };
        locked.onPointerDown(scene, [2, 1], lockedCtx);
        const lockedResult = locked.onPointerUp(scene, [4, 1], lockedCtx);
        expect(elementBounds(lockedResult.commit!.elements[0])).toEqual({ min: [0, -1], max: [4, 3] });
    });

    test("aspect locking can be toggled during an active corner drag", () => {
        const shape = createPath(makePath([[0, 0], [2, 0], [2, 2], [0, 2]], { cyclic: true }));
        const scene = { elements: [shape] };
        const freeCtx: ToolContext = {
            ...ctx,
            selection: [shape.id],
            selectionTransform: {
                kind: "resize",
                anchor: [0, 0],
                handle: [2, 2],
                axes: { x: true, y: true },
                minimumScale: [0.1, 0.1],
            },
        };
        const tool = createTool("select");
        tool.onPointerDown(scene, [2, 2], freeCtx);
        const freePreview = tool.onPointerMove(scene, [4, 6], freeCtx).preview!;
        expect(elementBounds(freePreview.elements[0])).toEqual({ min: [0, 0], max: [4, 6] });
        const lockedPreview = tool.onPointerMove(scene, [4, 6], {
            ...freeCtx,
            lockAspectRatio: true,
        }).preview!;
        expect(elementBounds(lockedPreview.elements[0])).toEqual({ min: [0, 0], max: [5, 5] });
        const result = tool.onPointerUp(scene, [4, 6], freeCtx);
        expect(elementBounds(result.commit!.elements[0])).toEqual({ min: [0, 0], max: [4, 6] });
    });

    test("anisotropic resize converts circles to editable ellipses", () => {
        const circle = createCircle([1, 1], 1);
        const scene = { elements: [circle] };
        const transformCtx: ToolContext = {
            ...ctx,
            selection: [circle.id],
            selectionTransform: {
                kind: "resize",
                anchor: [0, 0],
                handle: [2, 2],
                axes: { x: true, y: true },
                minimumScale: [0.1, 0.1],
            },
        };
        const tool = createTool("select");
        tool.onPointerDown(scene, [2, 2], transformCtx);
        expect(tool.onPointerUp(scene, [4, 6], transformCtx).commit?.elements[0]).toMatchObject({
            kind: "ellipse",
            center: [2, 3],
            axisX: [2, 0],
            axisY: [0, 3],
        });
    });

    test("resize keeps the UI handle offset and clamps before mirroring", () => {
        const scene = {
            elements: [createPath(makePath([[0, 0], [2, 0]]))],
        };
        const selection = [scene.elements[0].id];
        const tool = createTool("select");
        const transformCtx: ToolContext = {
            ...ctx,
            selection,
            selectionTransform: {
                kind: "resize",
                anchor: [0, 0],
                handle: [2, 0],
                axes: { x: true, y: false },
                minimumScale: [0.25, 0],
            },
        };
        tool.onPointerDown(scene, [2.2, 0.1], transformCtx);
        const result = tool.onPointerUp(scene, [-2 + 0.2, 0.1], transformCtx);
        expect(result.commit?.elements).toMatchObject([{ kind: "path", path: { nodes: [[0, 0], [0.5, 0]] } }]);
    });

    test("dragging a line vertex moves only that endpoint and keeps the pointer offset", () => {
        const scene = { elements: [createPath(makePath([[0, 0], [2, 1]]))] };
        const line = scene.elements[0];
        const selection = [line.id];
        const transformCtx: ToolContext = {
            ...ctx,
            selection,
            selectionTransform: {
                kind: "vertex",
                elementId: line.id,
                nodeIndex: 1,
                handle: [2, 1],
            },
        };
        const tool = createTool("select");
        tool.onPointerDown(scene, [2.1, 1.2], transformCtx);
        const result = tool.onPointerUp(scene, [4.1, 3.2], transformCtx);
        const nodes = result.commit?.elements[0].kind === "path"
            ? result.commit.elements[0].path.nodes
            : [];
        expect(nodes[0]).toEqual([0, 0]);
        expect(nodes[1][0]).toBeCloseTo(4);
        expect(nodes[1][1]).toBeCloseTo(3);
    });

    test("a forged vertex transform cannot edit a mixed-join path", () => {
        const { scene, path } = sceneWithMixedPath();
        const transformCtx: ToolContext = {
            ...ctx,
            selection: [path.id],
            selectionTransform: {
                kind: "vertex",
                elementId: path.id,
                nodeIndex: 1,
                handle: path.path.nodes[1],
            },
        };
        const tool = createTool("select");
        tool.onPointerDown(scene, path.path.nodes[1], transformCtx);
        const result = tool.onPointerUp(scene, [5, 5], transformCtx);
        expect(result.commit).toBeUndefined();
        expect(result.preview).toBeNull();
        expect(scene.elements[0]).toEqual(path);
    });

    test("a transform handle wins over move hit-testing and transforms the whole selection", () => {
        let scene = createTool("point").onPointerDown(emptyScene(), [0, 0], ctx).commit!;
        scene = createTool("point").onPointerDown(scene, [2, 2], ctx).commit!;
        scene = createTool("point").onPointerDown(scene, [8, 8], ctx).commit!;
        const selection = scene.elements.slice(0, 2).map((element) => element.id);
        const transformCtx: ToolContext = {
            ...ctx,
            selection,
            selectionTransform: {
                kind: "resize",
                anchor: [0, 0],
                handle: [2, 2],
                axes: { x: true, y: true },
                minimumScale: [0.1, 0.1],
            },
        };
        const tool = createTool("select");
        // The handle lies directly on a selected dot; transform routing must win.
        tool.onPointerDown(scene, [2, 2], transformCtx);
        const result = tool.onPointerUp(scene, [4, 4], transformCtx);
        expect(result.commit?.elements).toMatchObject([
            { kind: "dot", at: [0, 0] },
            { kind: "dot", at: [4, 4] },
            { kind: "dot", at: [8, 8] },
        ]);
    });

    test("rotation previews continuously and commits once around the selection center", () => {
        const scene = { elements: [createPath(makePath([[0, 0], [2, 0]]))] };
        const selection = [scene.elements[0].id];
        const tool = createTool("select");
        const transformCtx: ToolContext = {
            ...ctx,
            selection,
            selectionTransform: { kind: "rotate", pivot: [1, 0] },
        };
        tool.onPointerDown(scene, [1, 2], transformCtx);
        const preview = tool.onPointerMove(scene, [-1, 0], transformCtx);
        expect(preview.preview?.elements[0].kind).toBe("path");
        expect(preview.commit).toBeUndefined();
        const result = tool.onPointerUp(scene, [-1, 0], transformCtx);
        const nodes = result.commit?.elements[0].kind === "path"
            ? result.commit.elements[0].path.nodes
            : [];
        expect(nodes[0][0]).toBeCloseTo(1);
        expect(nodes[0][1]).toBeCloseTo(-1);
        expect(nodes[1][0]).toBeCloseTo(1);
        expect(nodes[1][1]).toBeCloseTo(1);
    });

    test("Shift snaps rotation to 15-degree increments", () => {
        const scene = { elements: [createPath(makePath([[1, 0], [2, 0]]))] };
        const selection = [scene.elements[0].id];
        const tool = createTool("select");
        const transformCtx: ToolContext = {
            ...ctx,
            selection,
            selectionTransform: { kind: "rotate", pivot: [0, 0] },
            snapRotation: true,
        };
        tool.onPointerDown(scene, [2, 0], transformCtx);
        const angle = (20 * Math.PI) / 180;
        const result = tool.onPointerUp(scene, [2 * Math.cos(angle), 2 * Math.sin(angle)], transformCtx);
        const first = result.commit?.elements[0].kind === "path"
            ? result.commit.elements[0].path.nodes[0]
            : [0, 0];
        expect(first[0]).toBeCloseTo(Math.cos(Math.PI / 12));
        expect(first[1]).toBeCloseTo(Math.sin(Math.PI / 12));
    });

    test("no-op and cancelled transforms do not commit", () => {
        const scene = { elements: [createPath(makePath([[0, 0], [2, 0]]))] };
        const selection = [scene.elements[0].id];
        const transformCtx: ToolContext = {
            ...ctx,
            selection,
            selectionTransform: {
                kind: "resize",
                anchor: [0, 0],
                handle: [2, 0],
                axes: { x: true, y: false },
                minimumScale: [0.1, 0],
            },
        };
        const noOp = createTool("select");
        noOp.onPointerDown(scene, [2, 0], transformCtx);
        expect(noOp.onPointerUp(scene, [2, 0], transformCtx).commit).toBeUndefined();

        const cancelled = createTool("select");
        cancelled.onPointerDown(scene, [2, 0], transformCtx);
        cancelled.onPointerMove(scene, [4, 0], transformCtx);
        expect(cancelled.onCancel()).toMatchObject({ preview: null });
        expect(cancelled.onPointerUp(scene, [4, 0], transformCtx).commit).toBeUndefined();
    });
});
