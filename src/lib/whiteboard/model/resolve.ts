import type { Pair, PathElement, Scene, SceneElement } from "../../asy/scene/types";
import type { SketchCurve, SketchPathItem, WhiteboardDocument } from "./types";

function orientedSegment(
    document: WhiteboardDocument,
    curve: Extract<SketchCurve, { kind: "segment" }>,
    reversed: boolean,
): readonly [Pair, Pair] {
    const start = document.sketch.points[reversed ? curve.end : curve.start]?.at;
    const end = document.sketch.points[reversed ? curve.start : curve.end]?.at;
    if (!start || !end) throw new Error(`segment ${curve.id} has an unresolved endpoint`);
    return [start, end];
}

function resolvePath(document: WhiteboardDocument, item: SketchPathItem): PathElement {
    const segments = item.uses.map((use) => {
        const curve = document.sketch.curves[use.curveId];
        if (!curve || curve.kind !== "segment") {
            throw new Error(`sketch path ${item.id} references a non-segment curve`);
        }
        return orientedSegment(document, curve, use.reversed);
    });
    const nodes = segments.length === 0
        ? []
        : [segments[0][0], ...segments.map((segment) => segment[1])];
    if (item.cyclic && nodes.length > 0) nodes.pop();
    return {
        id: item.id,
        kind: "path",
        path: {
            nodes,
            joins: Array.from(
                { length: item.cyclic ? nodes.length : Math.max(0, nodes.length - 1) },
                () => "--" as const,
            ),
            cyclic: item.cyclic,
        },
        ...(item.pen ? { pen: item.pen } : {}),
        ...(item.fillPen ? { fillPen: item.fillPen } : {}),
        ...(item.strokeEnabled !== undefined ? { strokeEnabled: item.strokeEnabled } : {}),
    };
}

function resolveItem(document: WhiteboardDocument, index: number): SceneElement {
    const item = document.items[index];
    if (!item) throw new Error(`missing whiteboard item at index ${index}`);
    if (item.kind === "baked") return item.element;
    if (item.kind === "sketch-path") return resolvePath(document, item);
    if (item.kind === "sketch-point-marker") {
        const at = document.sketch.points[item.pointId]?.at;
        if (!at) throw new Error(`point marker ${item.id} has an unresolved point`);
        return {
            id: item.id,
            kind: "dot",
            at,
            ...(item.pen ? { pen: item.pen } : {}),
            ...(item.strokeEnabled !== undefined ? { strokeEnabled: item.strokeEnabled } : {}),
        };
    }

    const curve = document.sketch.curves[item.curveId];
    if (!curve) throw new Error(`curve item ${item.id} has an unresolved curve`);
    const center = curve.kind === "segment" ? undefined : document.sketch.points[curve.center]?.at;
    const style = {
        ...(item.pen ? { pen: item.pen } : {}),
        ...(item.strokeEnabled !== undefined ? { strokeEnabled: item.strokeEnabled } : {}),
    };
    if (curve.kind === "segment") {
        const [start, end] = orientedSegment(document, curve, false);
        return {
            id: item.id,
            kind: "path",
            path: { nodes: [start, end], joins: ["--"], cyclic: false },
            ...(item.fillPen ? { fillPen: item.fillPen } : {}),
            ...style,
        };
    }
    if (!center) throw new Error(`curve ${curve.id} has an unresolved center`);
    if (curve.kind === "circle") {
        return {
            id: item.id,
            kind: "circle",
            center,
            radius: curve.radius,
            ...(item.fillPen ? { fillPen: item.fillPen } : {}),
            ...style,
        };
    }
    if (item.fillPen) throw new Error(`arc presentation ${item.id} cannot have a fill pen`);
    return {
        id: item.id,
        kind: "arc",
        center,
        radius: curve.radius,
        angle1: curve.startAngle * 180 / Math.PI,
        angle2: (curve.startAngle + curve.sweepAngle) * 180 / Math.PI,
        ...style,
    };
}

export function resolveWhiteboardDocument(document: WhiteboardDocument): Scene {
    return {
        elements: document.items.map((_, index) => resolveItem(document, index)),
        ...(document.meta ? { meta: document.meta } : {}),
    };
}
