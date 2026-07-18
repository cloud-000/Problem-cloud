import { describe, expect, test } from "bun:test";
import { makePath, type Pair, type Scene } from "$lib/asy/scene";
import {
    gridLines,
    isRotationHandleAt,
    dotRadius,
    penStroke,
    projectedArc,
    projectedPath,
    renderWhiteboard,
    resizeHandleAt,
    type WhiteboardPalette,
    type WhiteboardRenderSnapshot,
} from "./render";

const palette: WhiteboardPalette = {
    background: "#fff",
    foreground: "#111",
    inverseInk: "#191c1e",
    border: "#ddd",
    primary: "#36c",
    isDark: false,
};

const project = (point: Pair): Pair => [100 + point[0] * 10, 100 - point[1] * 10];

class RecordingContext {
    calls: string[] = [];
    strokeStyle: string | CanvasGradient | CanvasPattern = "";
    fillStyle: string | CanvasGradient | CanvasPattern = "";
    lineWidth = 1;
    globalAlpha = 1;
    lineJoin: CanvasLineJoin = "miter";
    lineCap: CanvasLineCap = "butt";
    font = "";
    textAlign: CanvasTextAlign = "start";
    textBaseline: CanvasTextBaseline = "alphabetic";

    save() { this.calls.push("save"); }
    restore() { this.calls.push("restore"); }
    beginPath() { this.calls.push("beginPath"); }
    closePath() { this.calls.push("closePath"); }
    moveTo(x: number, y: number) { this.calls.push(`moveTo:${x},${y}`); }
    lineTo(x: number, y: number) { this.calls.push(`lineTo:${x},${y}`); }
    bezierCurveTo() { this.calls.push("bezierCurveTo"); }
    arc(_x: number, _y: number, radius: number) { this.calls.push(`arc:${radius}`); }
    fill() { this.calls.push("fill"); }
    stroke() { this.calls.push("stroke"); }
    fillRect() { this.calls.push("fillRect"); }
    strokeRect() { this.calls.push("strokeRect"); }
    clearRect() { this.calls.push("clearRect"); }
    roundRect() { this.calls.push("roundRect"); }
    fillText(text: string) { this.calls.push(`fillText:${text}`); }
    setLineDash(dash: number[]) { this.calls.push(`dash:${dash.join(",")}`); }
    setTransform(a: number) { this.calls.push(`setTransform:${a}`); }
}

describe("projected geometry", () => {
    test("straight, closed, and spline paths become reusable commands", () => {
        const straight = projectedPath(makePath([[0, 0], [1, 0], [1, 1]]), project);
        expect(straight.map((command) => command.kind)).toEqual(["move", "line", "line"]);
        expect(straight[1]).toEqual({ kind: "line", point: [110, 100] });

        const closed = projectedPath(makePath([[0, 0], [1, 0], [0, 1]], { cyclic: true }), project);
        expect(closed.at(-1)?.kind).toBe("close");

        const spline = projectedPath(makePath([[0, 0], [1, 1], [2, 0]], { join: ".." }), project);
        expect(spline.some((command) => command.kind === "curve")).toBe(true);
    });

    test("a full compass arc covers the full circle", () => {
        const points = projectedArc([0, 0], 1, 0, 360, project, 4);
        expect(points).toHaveLength(5);
        expect(points[0]).toEqual([110, 100]);
        expect(points[2]).toEqual([90, 100]);
    });

    test("grid adapts to the current camera", () => {
        const lines = gridLines({ width: 200, height: 200, scale: 40, origin: [100, 100] });
        expect(lines.vertical).toContain(0);
        expect(lines.horizontal).toContain(0);
    });

    test("selection controls expose their canvas hit regions", () => {
        const handles = [{ screen: [20, 30] as Pair, corner: "nw" }];
        expect(resizeHandleAt([29, 39], handles)?.corner).toBe("nw");
        expect(resizeHandleAt([31, 30], handles)).toBeUndefined();
        expect(isRotationHandleAt([50, 59], { stemStart: [50, 70], screen: [50, 50] })).toBe(true);
        expect(isRotationHandleAt([50, 61], { stemStart: [50, 70], screen: [50, 50] })).toBe(false);
    });
});

describe("adaptive pen styles", () => {
    test("default and black ink use the theme foreground", () => {
        expect(penStroke(undefined, palette).color).toBe("#111");
        expect(penStroke({ namedColor: "black" }, palette).color).toBe("#111");
    });

    test("white ink becomes dark ink only in dark mode and colors remain authored", () => {
        const dark = { ...palette, isDark: true, foreground: "#eee" };
        expect(penStroke({ namedColor: "white" }, dark).color).toBe("#191c1e");
        expect(penStroke({ namedColor: "red" }, dark).color).toBe("rgb(255,0,0)");
        expect(penStroke({ dash: "dashed", opacity: 0.5, lineWidth: 3 }, dark)).toMatchObject({
            dash: [6, 4],
            opacity: 0.5,
            width: 3,
        });
    });

    test("dots scale linearly from the size-1 pen baseline", () => {
        expect(dotRadius(penStroke({ lineWidth: 1 }, palette))).toBe(3.5);
        expect(dotRadius(penStroke({ lineWidth: 2 }, palette))).toBe(7);
        expect(dotRadius(penStroke({ lineWidth: 4 }, palette))).toBe(14);
    });
});

describe("Canvas 2D rendering", () => {
    test("renders every editable element and high-DPI overlay in order", () => {
        const path = makePath([[0, 0], [1, 1], [2, 0]], { join: ".." });
        const scene: Scene = {
            elements: [
                { id: "path", kind: "path", path, pen: { dash: "dashed" } },
                { id: "fill", kind: "fill", path: makePath([[0, 0], [1, 0], [0, 1]], { cyclic: true }) },
                { id: "circle", kind: "circle", center: [0, 0], radius: 1 },
                { id: "arc", kind: "arc", center: [0, 0], radius: 1, angle1: 0, angle2: 90 },
                { id: "dot", kind: "dot", at: [0, 0] },
                { id: "label", kind: "label", at: [0, 0], text: "$A$" },
            ],
        };
        const snapshot: WhiteboardRenderSnapshot = {
            scene,
            viewport: { width: 200, height: 200, scale: 40, origin: [100, 100] },
            showGrid: true,
            transparent: false,
            palette,
        };
        const context = new RecordingContext();
        renderWhiteboard(context as unknown as CanvasRenderingContext2D, snapshot, {
            selectedIds: new Set(["path"]),
            selectionIsPreview: false,
            previewElementRects: [{ x: 1, y: 1, width: 5, height: 5 }],
            marqueeRect: { x: 2, y: 2, width: 8, height: 8 },
            selectionRect: { x: 3, y: 3, width: 10, height: 10 },
            rotationControl: { stemStart: [8, 3], screen: [8, 0] },
            resizeHandles: [{ screen: [3, 3] }],
            vertexHandles: [{ screen: [13, 13], state: "selected" }],
        }, 2);

        expect(context.calls[0]).toBe("setTransform:2");
        expect(context.calls.indexOf("fillRect")).toBeLessThan(context.calls.indexOf("bezierCurveTo"));
        expect(context.calls).toContain("closePath");
        expect(context.calls.filter((call) => call.startsWith("arc:")).length).toBeGreaterThanOrEqual(4);
        expect(context.calls).toContain("fillText:A");
        expect(context.calls).toContain("roundRect");
        expect(context.calls.at(-1)).toBe("setTransform:1");
    });

    test("sizes an unselected dot from its pen width", () => {
        const context = new RecordingContext();
        const snapshot: WhiteboardRenderSnapshot = {
            scene: {
                elements: [{
                    id: "tap",
                    kind: "dot",
                    at: [0, 0],
                    pen: { namedColor: "blue", lineWidth: 6, opacity: 0.4 },
                }],
            },
            viewport: { width: 200, height: 200, scale: 40, origin: [100, 100] },
            showGrid: false,
            transparent: false,
            palette,
        };

        renderWhiteboard(context as unknown as CanvasRenderingContext2D, snapshot);

        expect(context.calls).toContain("arc:21");
        expect(context.fillStyle).toBe("rgb(0,0,255)");
        expect(context.globalAlpha).toBe(0.4);
    });
});
