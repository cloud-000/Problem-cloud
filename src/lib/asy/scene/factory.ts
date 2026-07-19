/**
 * Constructors for Scene elements. Centralizes id generation so every element
 * gets a stable unique id regardless of how it was created (drawn, parsed, or
 * seeded in a test).
 */

import type {
    ArcElement,
    CircleElement,
    DotElement,
    EllipseElement,
    EllipticalArcElement,
    FillElement,
    Join,
    LabelElement,
    Pair,
    Path,
    PathElement,
    Pen,
    RawElement,
    Scene,
    SceneMeta,
} from "./types";

/** Generate a unique element id. */
export function newId(): string {
    // `crypto.randomUUID` is available in browsers, Bun, and modern Node.
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    // Fallback for environments without WebCrypto.
    return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function emptyScene(meta?: SceneMeta): Scene {
    return { elements: [], ...(meta ? { meta } : {}) };
}

/** Build a Path from a node list. Defaults every join to straight (`--`). */
export function makePath(
    nodes: Pair[],
    options: { cyclic?: boolean; joins?: Join[]; join?: Join } = {}
): Path {
    const cyclic = options.cyclic ?? false;
    const expected = cyclic ? nodes.length : Math.max(0, nodes.length - 1);
    let joins = options.joins;
    if (!joins) {
        const fill = options.join ?? "--";
        joins = Array.from({ length: expected }, () => fill);
    }
    return { nodes, joins, cyclic };
}

export function createDot(at: Pair, pen?: Pen): DotElement {
    return { id: newId(), kind: "dot", at, ...(pen ? { pen } : {}) };
}

export function createPath(path: Path, pen?: Pen, fillPen?: Pen): PathElement {
    return { id: newId(), kind: "path", path, ...(pen ? { pen } : {}), ...(fillPen ? { fillPen } : {}) };
}

export function createCircle(center: Pair, radius: number, pen?: Pen, fillPen?: Pen): CircleElement {
    return { id: newId(), kind: "circle", center, radius, ...(pen ? { pen } : {}), ...(fillPen ? { fillPen } : {}) };
}

export function createArc(
    center: Pair,
    radius: number,
    angle1: number,
    angle2: number,
    pen?: Pen
): ArcElement {
    return { id: newId(), kind: "arc", center, radius, angle1, angle2, ...(pen ? { pen } : {}) };
}

export function createEllipse(
    center: Pair,
    axisX: Pair,
    axisY: Pair,
    pen?: Pen,
    fillPen?: Pen,
): EllipseElement {
    return { id: newId(), kind: "ellipse", center, axisX, axisY, ...(pen ? { pen } : {}), ...(fillPen ? { fillPen } : {}) };
}

export function createEllipticalArc(
    center: Pair,
    axisX: Pair,
    axisY: Pair,
    angle1: number,
    angle2: number,
    pen?: Pen,
): EllipticalArcElement {
    return {
        id: newId(),
        kind: "elliptical-arc",
        center,
        axisX,
        axisY,
        angle1,
        angle2,
        ...(pen ? { pen } : {}),
    };
}

export function createLabel(text: string, at: Pair, align?: Pair, pen?: Pen): LabelElement {
    return {
        id: newId(),
        kind: "label",
        text,
        at,
        ...(align ? { align } : {}),
        ...(pen ? { pen } : {}),
    };
}

export function createFill(path: Path, pen?: Pen, drawPen?: Pen): FillElement {
    return {
        id: newId(),
        kind: "fill",
        path,
        ...(pen ? { pen } : {}),
        ...(drawPen ? { drawPen } : {}),
    };
}

export function createRaw(source: string): RawElement {
    return { id: newId(), kind: "raw", source };
}
