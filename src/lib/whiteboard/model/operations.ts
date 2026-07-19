import { newId } from "../../asy/scene/factory";
import type { Pair, Pen, Scene } from "../../asy/scene/types";
import { pointFeaturePosition } from "./features";
import { resolveWhiteboardDocument } from "./resolve";
import { solveWhiteboardDocument } from "./solver-adapter";
import type {
    Constraint,
    PointFeatureRef,
    SketchPathItem,
    WhiteboardDocument,
    WhiteboardItem,
} from "./types";

export interface SnapRelationProposal {
    source: PointFeatureRef;
    target: PointFeatureRef;
    from: Pair;
    to: Pair;
}

interface CreationResult {
    document: WhiteboardDocument;
    itemId: string;
    endpointFeatures: PointFeatureRef[];
}

function withPoints(document: WhiteboardDocument, points: Pair[]): {
    document: WhiteboardDocument;
    pointIds: string[];
} {
    const pointIds = points.map(() => newId());
    const nextPoints = { ...document.sketch.points };
    pointIds.forEach((id, index) => {
        nextPoints[id] = { id, at: points[index] };
    });
    return {
        document: { ...document, sketch: { ...document.sketch, points: nextPoints } },
        pointIds,
    };
}

export function createSmartPath(
    document: WhiteboardDocument,
    nodes: Pair[],
    cyclic: boolean,
    pen?: Pen,
    fillPen?: Pen,
    itemId = newId(),
): CreationResult {
    if (nodes.length < 2) throw new Error("a smart path needs at least two points");
    const created = withPoints(document, nodes);
    const curveIds = Array.from(
        { length: cyclic ? nodes.length : nodes.length - 1 },
        () => newId(),
    );
    const curves = { ...created.document.sketch.curves };
    curveIds.forEach((id, index) => {
        curves[id] = {
            id,
            kind: "segment",
            start: created.pointIds[index],
            end: created.pointIds[(index + 1) % created.pointIds.length],
        };
    });
    const item: SketchPathItem = {
        id: itemId,
        kind: "sketch-path",
        uses: curveIds.map((curveId) => ({ curveId, reversed: false })),
        cyclic,
        ...(pen ? { pen } : {}),
        ...(fillPen ? { fillPen } : {}),
    };
    const next = {
        ...created.document,
        items: [...created.document.items, item],
        sketch: { ...created.document.sketch, curves },
    };
    const endpointFeatures: PointFeatureRef[] = curveIds.flatMap((curveId, index) =>
        index === 0
            ? [
                  { kind: "curve-point" as const, curveId, feature: "start" as const },
                  { kind: "curve-point" as const, curveId, feature: "end" as const },
              ]
            : [{ kind: "curve-point" as const, curveId, feature: "end" as const }]
    );
    if (cyclic) endpointFeatures.pop();
    return { document: next, itemId, endpointFeatures };
}

export function createSmartPointMarker(
    document: WhiteboardDocument,
    at: Pair,
    pen?: Pen,
    itemId = newId(),
): CreationResult {
    const created = withPoints(document, [at]);
    const pointId = created.pointIds[0];
    return {
        document: {
            ...created.document,
            items: [
                ...created.document.items,
                { id: itemId, kind: "sketch-point-marker", pointId, ...(pen ? { pen } : {}) },
            ],
        },
        itemId,
        endpointFeatures: [{ kind: "point", pointId }],
    };
}

export function appendSmartPathNode(
    document: WhiteboardDocument,
    itemId: string,
    at: Pair,
): { document: WhiteboardDocument; feature: PointFeatureRef } {
    const itemIndex = document.items.findIndex((item) =>
        item.kind === "sketch-path" && item.id === itemId
    );
    const item = document.items[itemIndex];
    if (!item || item.kind !== "sketch-path" || item.cyclic || item.uses.length === 0) {
        throw new Error("only a non-empty open smart path can be continued");
    }
    const lastUse = item.uses.at(-1)!;
    const lastCurve = document.sketch.curves[lastUse.curveId];
    if (!lastCurve || lastCurve.kind !== "segment") throw new Error("smart path is not segment-backed");
    const start = lastUse.reversed ? lastCurve.start : lastCurve.end;
    const pointId = newId();
    const curveId = newId();
    const nextItem: SketchPathItem = {
        ...item,
        uses: [...item.uses, { curveId, reversed: false }],
    };
    const items = [...document.items];
    items[itemIndex] = nextItem;
    return {
        document: {
            ...document,
            items,
            sketch: {
                ...document.sketch,
                points: { ...document.sketch.points, [pointId]: { id: pointId, at } },
                curves: {
                    ...document.sketch.curves,
                    [curveId]: { id: curveId, kind: "segment", start, end: pointId },
                },
            },
        },
        feature: { kind: "curve-point", curveId, feature: "end" },
    };
}

export function closeSmartPath(document: WhiteboardDocument, itemId: string): WhiteboardDocument {
    const itemIndex = document.items.findIndex((item) =>
        item.kind === "sketch-path" && item.id === itemId
    );
    const item = document.items[itemIndex];
    if (!item || item.kind !== "sketch-path" || item.cyclic || item.uses.length < 2) return document;
    const firstUse = item.uses[0];
    const lastUse = item.uses.at(-1)!;
    const firstCurve = document.sketch.curves[firstUse.curveId];
    const lastCurve = document.sketch.curves[lastUse.curveId];
    if (firstCurve?.kind !== "segment" || lastCurve?.kind !== "segment") return document;
    const start = lastUse.reversed ? lastCurve.start : lastCurve.end;
    const end = firstUse.reversed ? firstCurve.end : firstCurve.start;
    const curveId = newId();
    const items = [...document.items];
    items[itemIndex] = {
        ...item,
        cyclic: true,
        uses: [...item.uses, { curveId, reversed: false }],
    };
    return {
        ...document,
        items,
        sketch: {
            ...document.sketch,
            curves: {
                ...document.sketch.curves,
                [curveId]: { id: curveId, kind: "segment", start, end },
            },
        },
    };
}

export function addCoincidentConstraint(
    document: WhiteboardDocument,
    a: PointFeatureRef,
    b: PointFeatureRef,
    origin: Constraint["origin"] = "inferred",
): WhiteboardDocument | null {
    const duplicate = Object.values(document.sketch.constraints).some((constraint) =>
        constraint.kind === "coincident" && (
            JSON.stringify([constraint.a, constraint.b]) === JSON.stringify([a, b]) ||
            JSON.stringify([constraint.a, constraint.b]) === JSON.stringify([b, a])
        )
    );
    if (duplicate) return document;
    const id = newId();
    const candidate: WhiteboardDocument = {
        ...document,
        sketch: {
            ...document.sketch,
            constraints: {
                ...document.sketch.constraints,
                [id]: { id, kind: "coincident", enabled: true, origin, a, b },
            },
        },
    };
    const solved = solveWhiteboardDocument(candidate, {
        affected: [a, b],
        drivers: [],
        mode: "commit",
    });
    return solved.document ?? null;
}

export function removeConstraint(
    document: WhiteboardDocument,
    constraintId: string,
): WhiteboardDocument {
    if (!document.sketch.constraints[constraintId]) return document;
    const constraints = { ...document.sketch.constraints };
    delete constraints[constraintId];
    return { ...document, sketch: { ...document.sketch, constraints } };
}

function referencedPointIds(document: WhiteboardDocument): Set<string> {
    const ids = new Set<string>();
    for (const curve of Object.values(document.sketch.curves)) {
        if (curve.kind === "segment") {
            ids.add(curve.start);
            ids.add(curve.end);
        } else ids.add(curve.center);
    }
    for (const item of document.items) {
        if (item.kind === "sketch-point-marker") ids.add(item.pointId);
    }
    return ids;
}

export function deleteWhiteboardItems(
    document: WhiteboardDocument,
    itemIds: readonly string[],
): WhiteboardDocument {
    const removed = new Set(itemIds);
    const items = document.items.filter((item) => {
        const id = item.kind === "baked" ? item.element.id : item.id;
        return !removed.has(id);
    });
    const usedCurves = new Set<string>();
    for (const item of items) {
        if (item.kind === "sketch-curve") usedCurves.add(item.curveId);
        if (item.kind === "sketch-path") item.uses.forEach((use) => usedCurves.add(use.curveId));
    }
    const curves = Object.fromEntries(Object.entries(document.sketch.curves).filter(([id]) =>
        usedCurves.has(id)
    ));
    let next: WhiteboardDocument = { ...document, items, sketch: { ...document.sketch, curves } };
    const retainedPointIds = referencedPointIds(next);
    const points = Object.fromEntries(Object.entries(next.sketch.points).filter(([id]) => retainedPointIds.has(id)));
    const constraints = Object.fromEntries(Object.entries(next.sketch.constraints).filter(([, constraint]) => {
        const refs = constraint.kind === "coincident" ? [constraint.a, constraint.b] : [];
        return refs.every((ref) => {
            const at = pointFeaturePosition({ ...next, sketch: { ...next.sketch, points } }, ref);
            return at !== null;
        });
    }));
    next = { ...next, sketch: { ...next.sketch, points, constraints } };
    return next;
}

/** Reconcile Scene-based baked tools without flattening any surviving smart item. */
export function reconcileResolvedScene(
    document: WhiteboardDocument,
    scene: Scene,
): WhiteboardDocument {
    const resolved = resolveWhiteboardDocument(document);
    const smartById = new Map<string, WhiteboardItem>();
    document.items.forEach((item) => {
        if (item.kind !== "baked") smartById.set(item.id, item);
    });
    const resolvedById = new Map(resolved.elements.map((element) => [element.id, element]));
    const items: WhiteboardItem[] = [];
    for (const element of scene.elements) {
        const smart = smartById.get(element.id);
        if (smart) {
            if (JSON.stringify(element) !== JSON.stringify(resolvedById.get(element.id))) {
                throw new Error(`Scene operation attempted to mutate smart item ${element.id}`);
            }
            items.push(smart);
        } else {
            items.push({ kind: "baked", element });
        }
    }
    const survivingIds = new Set(items.map((item) => item.kind === "baked" ? item.element.id : item.id));
    const removedSmart = [...smartById.keys()].filter((id) => !survivingIds.has(id));
    return deleteWhiteboardItems({ ...document, items }, removedSmart);
}
