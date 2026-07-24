import { newId } from "../../asy/scene/factory";
import { rotateElement, scaleElementBy, translateElement } from "../../asy/engine/geometry";
import type { Pair, Pen, Scene, SceneElement } from "../../asy/scene/types";
import { pointFeaturePointId, pointFeaturePosition } from "./features";
import { isPointFeature, pointOnCurvePair, tangentPair, type RelationKind } from "./relations";
import { resolveWhiteboardDocument } from "./resolve";
import { solveWhiteboardDocument } from "./solver-adapter";
import type {
    Constraint,
    FeatureRef,
    LengthDimension,
    PointFeatureRef,
    SketchCurve,
    SketchCurveItem,
    SketchPathItem,
    WhiteboardDocument,
    WhiteboardItem,
} from "./types";

export interface GeometryOperationResult {
    document?: WhiteboardDocument;
    status: "solved" | "under-constrained" | "conflicting" | "failed";
    conflictingConstraintIds: string[];
    diagnostic?: string;
    degreesOfFreedom?: number;
}

function successful(document: WhiteboardDocument): GeometryOperationResult {
    return { document, status: "under-constrained", conflictingConstraintIds: [] };
}

function pointRefsForCurve(document: WhiteboardDocument, curveId: string): PointFeatureRef[] {
    const curve = document.sketch.curves[curveId];
    if (curve?.kind === "segment") return [
        { kind: "curve-point", curveId, feature: "start" },
        { kind: "curve-point", curveId, feature: "end" },
    ];
    if (curve?.kind === "arc") return [
        { kind: "curve-point", curveId, feature: "center" },
        { kind: "curve-point", curveId, feature: "start" },
        { kind: "curve-point", curveId, feature: "end" },
    ];
    return [];
}

function pointRefsForFeatures(document: WhiteboardDocument, features: readonly FeatureRef[]): PointFeatureRef[] {
    return features.flatMap((feature) => feature.kind === "curve"
        ? pointRefsForCurve(document, feature.curveId)
        : [feature]);
}

function operationFromSolve(result: ReturnType<typeof solveWhiteboardDocument>): GeometryOperationResult {
    return {
        ...(result.document ? { document: result.document } : {}),
        status: result.status,
        conflictingConstraintIds: result.conflictingConstraintIds,
        ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
        ...(result.degreesOfFreedom === undefined ? {} : { degreesOfFreedom: result.degreesOfFreedom }),
    };
}

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

/**
 * Author a rectangle's defining right angles: three `perpendicular` constraints
 * between the four consecutive segments of a cyclic 4-segment smart path. Three
 * (not four) exactly removes the 3 rotational/shear degrees of freedom that make
 * a quad a rectangle — the fourth right angle is implied, so adding it would
 * over-constrain. The rectangle is already square at creation, so the
 * constraints are satisfied as authored (no solve needed); they bind on the next
 * rotate/resize, keeping the shape rectangular. A no-op for any other path.
 */
export function addDefaultRectangleConstraints(
    document: WhiteboardDocument,
    itemId: string,
): WhiteboardDocument {
    const item = document.items.find(
        (candidate): candidate is SketchPathItem =>
            candidate.kind === "sketch-path" && candidate.id === itemId,
    );
    if (!item || !item.cyclic || item.uses.length !== 4) return document;
    const curveIds = item.uses.map((use) => use.curveId);
    const constraints = { ...document.sketch.constraints };
    for (let index = 0; index < 3; index++) {
        const id = newId();
        constraints[id] = {
            id,
            kind: "perpendicular",
            enabled: true,
            origin: "inferred",
            a: curveIds[index],
            b: curveIds[index + 1],
        };
    }
    return { ...document, sketch: { ...document.sketch, constraints } };
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

/**
 * Author a smart arc from its three defining points (center + two rim
 * endpoints). The drawn radius is `|center − start|` and the sweep runs CCW from
 * `start`'s angle to `end`'s angle (`resolve.ts`); `end` may sit off that circle
 * until a future point-on-circle constraint pins it. All three points are real
 * sketch points, so they are independently draggable and snap-attachable, and
 * the returned `endpointFeatures` let the lift infer coincidence on each.
 */
export function createSmartArc(
    document: WhiteboardDocument,
    center: Pair,
    start: Pair,
    end: Pair,
    pen?: Pen,
    strokeEnabled?: boolean,
    itemId = newId(),
): CreationResult {
    const created = withPoints(document, [center, start, end]);
    const [centerId, startId, endId] = created.pointIds;
    const curveId = newId();
    const curve: SketchCurve = {
        id: curveId,
        kind: "arc",
        center: centerId,
        start: startId,
        end: endId,
    };
    const item: SketchCurveItem = {
        id: itemId,
        kind: "sketch-curve",
        curveId,
        ...(pen ? { pen } : {}),
        ...(strokeEnabled !== undefined ? { strokeEnabled } : {}),
    };
    return {
        document: {
            ...created.document,
            items: [...created.document.items, item],
            sketch: {
                ...created.document.sketch,
                curves: { ...created.document.sketch.curves, [curveId]: curve },
            },
        },
        itemId,
        endpointFeatures: [
            { kind: "curve-point", curveId, feature: "center" },
            { kind: "curve-point", curveId, feature: "start" },
            { kind: "curve-point", curveId, feature: "end" },
        ],
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

function relationConstraint(
    document: WhiteboardDocument,
    kind: RelationKind,
    features: readonly FeatureRef[],
    id: string,
): { constraint: Constraint; parameter?: { id: string; value: number } } | null {
    const base = { id, enabled: true, origin: "explicit" as const };
    if ((kind === "horizontal" || kind === "vertical") && features.length === 1 && features[0].kind === "curve") {
        return { constraint: { ...base, kind, curveId: features[0].curveId } };
    }
    if (
        (kind === "parallel" || kind === "perpendicular" || kind === "equal-length") &&
        features.length === 2 && features[0].kind === "curve" && features[1].kind === "curve"
    ) return { constraint: { ...base, kind, a: features[0].curveId, b: features[1].curveId } };
    if (kind === "fixed-point" && features.length === 1 && isPointFeature(features[0])) {
        const at = pointFeaturePosition(document, features[0]);
        return at ? { constraint: { ...base, kind, point: features[0], at } } : null;
    }
    if (kind === "distance" && features.length === 2 && features.every(isPointFeature)) {
        const a = pointFeaturePosition(document, features[0]);
        const b = pointFeaturePosition(document, features[1]);
        if (!a || !b) return null;
        const parameterId = newId();
        return {
            constraint: { ...base, kind, a: features[0], b: features[1], value: parameterId },
            parameter: { id: parameterId, value: Math.hypot(b[0] - a[0], b[1] - a[1]) },
        };
    }
    if (kind === "point-on-curve" && features.length === 2) {
        const pair = pointOnCurvePair(document, features);
        return pair ? { constraint: { ...base, kind, point: pair.point, curveId: pair.curve.curveId } } : null;
    }
    if (kind === "tangent" && features.length === 2) {
        const pair = tangentPair(document, features);
        return pair ? { constraint: { ...base, kind, a: pair.arc.curveId, b: pair.segment.curveId } } : null;
    }
    return null;
}

function sameConstraint(a: Constraint, b: Constraint): boolean {
    if (a.kind !== b.kind) return false;
    if ((a.kind === "horizontal" || a.kind === "vertical") && (b.kind === "horizontal" || b.kind === "vertical")) {
        return a.curveId === b.curveId;
    }
    if (
        (a.kind === "parallel" || a.kind === "perpendicular" || a.kind === "equal-length") &&
        (b.kind === "parallel" || b.kind === "perpendicular" || b.kind === "equal-length")
    ) return (a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a);
    if (a.kind === "fixed-point" && b.kind === "fixed-point") {
        return JSON.stringify(a.point) === JSON.stringify(b.point);
    }
    if (a.kind === "distance" && b.kind === "distance") {
        return (JSON.stringify(a.a) === JSON.stringify(b.a) && JSON.stringify(a.b) === JSON.stringify(b.b)) ||
            (JSON.stringify(a.a) === JSON.stringify(b.b) && JSON.stringify(a.b) === JSON.stringify(b.a));
    }
    if (a.kind === "point-on-curve" && b.kind === "point-on-curve") {
        return JSON.stringify(a.point) === JSON.stringify(b.point) && a.curveId === b.curveId;
    }
    if (a.kind === "tangent" && b.kind === "tangent") {
        return (a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a);
    }
    return false;
}

export function addRelationConstraint(
    document: WhiteboardDocument,
    kind: RelationKind,
    features: readonly FeatureRef[],
): GeometryOperationResult {
    const id = newId();
    const payload = relationConstraint(document, kind, features, id);
    if (!payload) return { status: "failed", conflictingConstraintIds: [], diagnostic: "relation is not applicable" };
    if (Object.values(document.sketch.constraints).some((constraint) => sameConstraint(constraint, payload.constraint))) {
        return successful(document);
    }
    const parameters = payload.parameter ? {
        ...document.sketch.parameters,
        [payload.parameter.id]: { ...payload.parameter, unit: "length" as const },
    } : document.sketch.parameters;
    const candidate: WhiteboardDocument = {
        ...document,
        sketch: {
            ...document.sketch,
            parameters,
            constraints: { ...document.sketch.constraints, [id]: payload.constraint },
        },
    };
    try {
        const result = operationFromSolve(solveWhiteboardDocument(candidate, {
            affected: pointRefsForFeatures(document, features),
            drivers: [],
            mode: "commit",
        }));
        return !result.document && result.conflictingConstraintIds.length === 0
            ? { ...result, conflictingConstraintIds: [...Object.keys(document.sketch.constraints).sort(), id] }
            : result;
    } catch (error) {
        return {
            status: "failed",
            conflictingConstraintIds: [],
            diagnostic: error instanceof Error ? error.message : "relation solve failed",
        };
    }
}

/**
 * Replace horizontal/vertical through a non-degenerate, length-preserving
 * initial guess. Without this seed, least-squares stays prefer collapsing a
 * vertical segment to a point when horizontal is requested (and vice versa).
 */
export function switchDirectionalRelationConstraint(
    document: WhiteboardDocument,
    kind: "horizontal" | "vertical",
    features: readonly FeatureRef[],
    replacedConstraintId: string,
): GeometryOperationResult {
    const feature = features.length === 1 && features[0].kind === "curve" ? features[0] : null;
    const curve = feature ? document.sketch.curves[feature.curveId] : null;
    const replaced = document.sketch.constraints[replacedConstraintId];
    if (
        !feature || curve?.kind !== "segment" ||
        (replaced?.kind !== "horizontal" && replaced?.kind !== "vertical") ||
        replaced.curveId !== curve.id || replaced.kind === kind
    ) {
        return { status: "failed", conflictingConstraintIds: [], diagnostic: "direction switch is not applicable" };
    }

    const start = document.sketch.points[curve.start]?.at;
    const end = document.sketch.points[curve.end]?.at;
    if (!start || !end) {
        return { status: "failed", conflictingConstraintIds: [], diagnostic: "segment endpoints are unavailable" };
    }
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) {
        return { status: "failed", conflictingConstraintIds: [replacedConstraintId], diagnostic: "cannot switch a degenerate segment direction" };
    }

    const midpoint: Pair = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const sign = Math.sign(kind === "horizontal" ? (dx || dy) : (dy || dx)) || 1;
    const half = length / 2;
    const nextStart: Pair = kind === "horizontal"
        ? [midpoint[0] - sign * half, midpoint[1]]
        : [midpoint[0], midpoint[1] - sign * half];
    const nextEnd: Pair = kind === "horizontal"
        ? [midpoint[0] + sign * half, midpoint[1]]
        : [midpoint[0], midpoint[1] + sign * half];
    const withoutReplaced = removeConstraint(document, replacedConstraintId);
    const seeded: WhiteboardDocument = {
        ...withoutReplaced,
        sketch: {
            ...withoutReplaced.sketch,
            points: {
                ...withoutReplaced.sketch.points,
                [curve.start]: { ...withoutReplaced.sketch.points[curve.start], at: nextStart },
                [curve.end]: { ...withoutReplaced.sketch.points[curve.end], at: nextEnd },
            },
        },
    };
    return addRelationConstraint(seeded, kind, features);
}

function dimensionEndpoints(document: WhiteboardDocument, features: readonly FeatureRef[]): [PointFeatureRef, PointFeatureRef] | null {
    if (features.length === 1 && features[0].kind === "curve") {
        const refs = pointRefsForCurve(document, features[0].curveId);
        return refs.length === 2 ? [refs[0], refs[1]] : null;
    }
    return features.length === 2 && features.every(isPointFeature)
        ? [features[0], features[1]]
        : null;
}

/** Length dimensions whose endpoints are the currently selected segment or point pair. */
export function lengthDimensionsForSelection(
    document: WhiteboardDocument,
    features: readonly FeatureRef[],
): LengthDimension[] {
    const endpoints = dimensionEndpoints(document, features);
    if (!endpoints) return [];
    const selected = endpoints.map((feature) => pointFeaturePointId(document, feature));
    return Object.values(document.dimensions ?? {}).filter((dimension) => {
        const a = pointFeaturePointId(document, dimension.a);
        const b = pointFeaturePointId(document, dimension.b);
        return (a === selected[0] && b === selected[1]) || (a === selected[1] && b === selected[0]);
    });
}

export function addLengthDimension(
    document: WhiteboardDocument,
    features: readonly FeatureRef[],
    mode: LengthDimension["mode"],
): GeometryOperationResult {
    const endpoints = dimensionEndpoints(document, features);
    if (!endpoints) return { status: "failed", conflictingConstraintIds: [], diagnostic: "length dimension is not applicable" };
    const dimensionId = newId();
    if (mode === "reference") {
        return successful({
            ...document,
            dimensions: {
                ...document.dimensions,
                [dimensionId]: { id: dimensionId, kind: "length", mode, a: endpoints[0], b: endpoints[1] },
            },
        });
    }
    const existingConstraintId = Object.values(document.sketch.constraints).find((constraint) =>
        constraint.kind === "distance" && (
            (JSON.stringify(constraint.a) === JSON.stringify(endpoints[0]) && JSON.stringify(constraint.b) === JSON.stringify(endpoints[1])) ||
            (JSON.stringify(constraint.a) === JSON.stringify(endpoints[1]) && JSON.stringify(constraint.b) === JSON.stringify(endpoints[0]))
        )
    )?.id;
    if (existingConstraintId) {
        return successful({
            ...document,
            dimensions: {
                ...document.dimensions,
                [dimensionId]: {
                    id: dimensionId,
                    kind: "length",
                    mode,
                    a: endpoints[0],
                    b: endpoints[1],
                    constraintId: existingConstraintId,
                },
            },
        });
    }
    const relation = addRelationConstraint(document, "distance", endpoints);
    if (!relation.document) return relation;
    const constraintId = Object.keys(relation.document.sketch.constraints)
        .find((id) => !document.sketch.constraints[id]);
    if (!constraintId) return { status: "failed", conflictingConstraintIds: [], diagnostic: "dimension constraint was not created" };
    return {
        ...relation,
        document: {
            ...relation.document,
            dimensions: {
                ...relation.document.dimensions,
                [dimensionId]: {
                    id: dimensionId,
                    kind: "length",
                    mode,
                    a: endpoints[0],
                    b: endpoints[1],
                    constraintId,
                },
            },
        },
    };
}

export function lengthDimensionValue(document: WhiteboardDocument, dimensionId: string): number | null {
    const dimension = document.dimensions?.[dimensionId];
    if (!dimension) return null;
    if (dimension.mode === "driving" && dimension.constraintId) {
        const constraint = document.sketch.constraints[dimension.constraintId];
        if (constraint?.kind === "distance") return document.sketch.parameters[constraint.value]?.value ?? null;
    }
    const a = pointFeaturePosition(document, dimension.a);
    const b = pointFeaturePosition(document, dimension.b);
    return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : null;
}

export function removeLengthDimension(document: WhiteboardDocument, dimensionId: string): WhiteboardDocument {
    const dimension = document.dimensions?.[dimensionId];
    if (!dimension) return document;
    const dimensions = { ...document.dimensions };
    delete dimensions[dimensionId];
    const withoutDimension = { ...document, dimensions };
    const shared = dimension.constraintId && Object.values(dimensions).some((candidate) =>
        candidate.constraintId === dimension.constraintId
    );
    return dimension.constraintId && !shared
        ? removeConstraint(withoutDimension, dimension.constraintId)
        : withoutDimension;
}

export function editDrivingLengthDimension(
    document: WhiteboardDocument,
    dimensionId: string,
    value: number,
): GeometryOperationResult {
    const dimension = document.dimensions?.[dimensionId];
    if (!dimension || dimension.mode !== "driving" || !dimension.constraintId || !Number.isFinite(value) || value < 0) {
        return { status: "failed", conflictingConstraintIds: [], diagnostic: "dimension value must be a finite non-negative length" };
    }
    const constraint = document.sketch.constraints[dimension.constraintId];
    if (!constraint || constraint.kind !== "distance") {
        return { status: "failed", conflictingConstraintIds: [], diagnostic: "driving dimension is missing its distance constraint" };
    }
    const candidate: WhiteboardDocument = {
        ...document,
        sketch: {
            ...document.sketch,
            parameters: {
                ...document.sketch.parameters,
                [constraint.value]: { ...document.sketch.parameters[constraint.value], value },
            },
        },
    };
    return operationFromSolve(solveWhiteboardDocument(candidate, {
        affected: [dimension.a, dimension.b],
        drivers: [],
        mode: "commit",
    }));
}

function itemId(item: WhiteboardItem): string {
    return item.kind === "baked" ? item.element.id : item.id;
}

function smartItemPointIds(document: WhiteboardDocument, item: WhiteboardItem): string[] {
    if (item.kind === "sketch-point-marker") return [item.pointId];
    const curveIds = item.kind === "sketch-path"
        ? item.uses.map((use) => use.curveId)
        : item.kind === "sketch-curve" ? [item.curveId] : [];
    return curveIds.flatMap((curveId) => {
        const curve = document.sketch.curves[curveId];
        if (!curve) return [];
        if (curve.kind === "segment") return [curve.start, curve.end];
        if (curve.kind === "arc") return [curve.center, curve.start, curve.end];
        return [curve.center];
    });
}

export function translateWhiteboardItems(
    document: WhiteboardDocument,
    itemIds: readonly string[],
    delta: Pair,
    mode: "preview" | "commit" = "commit",
): GeometryOperationResult {
    const selected = new Set(itemIds);
    const pointIds = [...new Set(document.items
        .filter((item) => selected.has(itemId(item)) && item.kind !== "baked")
        .flatMap((item) => smartItemPointIds(document, item)))].sort();
    let next = document;
    let result: GeometryOperationResult = successful(document);
    if (pointIds.length > 0) {
        const refs = pointIds.map((pointId) => ({ kind: "point" as const, pointId }));
        const solved = solveWhiteboardDocument(document, {
            affected: refs,
            drivers: refs.map((feature) => ({
                feature,
                target: [
                    document.sketch.points[feature.pointId].at[0] + delta[0],
                    document.sketch.points[feature.pointId].at[1] + delta[1],
                ],
            })),
            mode,
        });
        result = operationFromSolve(solved);
        if (!solved.document) return result;
        next = solved.document;
    }
    const items = next.items.map((item) =>
        item.kind === "baked" && selected.has(item.element.id)
            ? { ...item, element: translateElement(item.element, delta[0], delta[1]) }
            : item
    );
    return { ...result, document: { ...next, items } };
}

function transformWhiteboardItems(
    document: WhiteboardDocument,
    itemIds: readonly string[],
    pointTarget: (point: Pair) => Pair,
    bakedTransform: (element: SceneElement) => SceneElement,
    radialTransform: (curve: Extract<SketchCurve, { kind: "circle" | "arc" }>) => SketchCurve,
    mode: "preview" | "commit",
): GeometryOperationResult {
    const selected = new Set(itemIds);
    const selectedSmartItems = document.items.filter((item) =>
        item.kind !== "baked" && selected.has(item.id)
    );
    const pointIds = [...new Set(selectedSmartItems.flatMap((item) =>
        smartItemPointIds(document, item)
    ))].sort();
    let next = document;
    let result: GeometryOperationResult = successful(document);
    if (pointIds.length > 0) {
        const refs = pointIds.map((pointId) => ({ kind: "point" as const, pointId }));
        const solved = solveWhiteboardDocument(document, {
            affected: refs,
            drivers: refs.map((feature) => ({
                feature,
                target: pointTarget(document.sketch.points[feature.pointId].at),
            })),
            mode,
        });
        result = operationFromSolve(solved);
        if (!solved.document) return result;
        next = solved.document;
    }

    const selectedCurveIds = new Set(selectedSmartItems.flatMap((item) =>
        item.kind === "sketch-curve" ? [item.curveId] : []
    ));
    const curves = Object.fromEntries(Object.entries(next.sketch.curves).map(([id, curve]) => [
        id,
        selectedCurveIds.has(id) && (curve.kind === "circle" || curve.kind === "arc")
            ? radialTransform(curve)
            : curve,
    ]));
    const items = next.items.map((item) =>
        item.kind === "baked" && selected.has(item.element.id)
            ? { ...item, element: bakedTransform(item.element) }
            : item
    );
    return { ...result, document: { ...next, items, sketch: { ...next.sketch, curves } } };
}

/** Uniformly scale a smart/mixed selection while preserving its constraint component. */
export function scaleWhiteboardItems(
    document: WhiteboardDocument,
    itemIds: readonly string[],
    anchor: Pair,
    factor: number,
    mode: "preview" | "commit" = "commit",
): GeometryOperationResult {
    if (!Number.isFinite(factor) || factor <= 0) {
        return { status: "failed", conflictingConstraintIds: [], diagnostic: "scale must be finite and positive" };
    }
    return transformWhiteboardItems(
        document,
        itemIds,
        (point) => [
            anchor[0] + (point[0] - anchor[0]) * factor,
            anchor[1] + (point[1] - anchor[1]) * factor,
        ],
        (element) => scaleElementBy(element, anchor, [factor, factor]),
        // A smart arc's radius/angles derive from its three points, which
        // `pointTarget` already scales — only a circle's scalar radius needs it.
        (curve) => curve.kind === "circle" ? { ...curve, radius: curve.radius * factor } : curve,
        mode,
    );
}

/** Rotate a smart/mixed selection while preserving its constraint component. */
export function rotateWhiteboardItems(
    document: WhiteboardDocument,
    itemIds: readonly string[],
    pivot: Pair,
    degrees: number,
    mode: "preview" | "commit" = "commit",
): GeometryOperationResult {
    if (!Number.isFinite(degrees)) {
        return { status: "failed", conflictingConstraintIds: [], diagnostic: "rotation must be finite" };
    }
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return transformWhiteboardItems(
        document,
        itemIds,
        (point) => {
            const dx = point[0] - pivot[0];
            const dy = point[1] - pivot[1];
            return [
                pivot[0] + dx * cosine - dy * sine,
                pivot[1] + dx * sine + dy * cosine,
            ];
        },
        (element) => rotateElement(element, pivot, degrees),
        // Both a smart arc (three points) and a circle (center point + scalar
        // radius) rotate entirely through `pointTarget` moving their points: the
        // arc's angles re-derive and a circle's radius is rotation-invariant.
        (curve) => curve,
        mode,
    );
}

export function updateSmartPresentationStyle(
    document: WhiteboardDocument,
    id: string,
    resolved: SceneElement,
): WhiteboardDocument {
    const items = document.items.map((item) => {
        if (item.kind === "baked" || item.id !== id) return item;
        const style = {
            ...(resolved.pen ? { pen: resolved.pen } : {}),
            ...(resolved.strokeEnabled === undefined ? {} : { strokeEnabled: resolved.strokeEnabled }),
        };
        if (item.kind === "sketch-point-marker") return { ...item, ...style };
        return {
            ...item,
            ...style,
            ...(resolved.kind === "path" || resolved.kind === "circle"
                ? (resolved.fillPen ? { fillPen: resolved.fillPen } : { fillPen: undefined })
                : {}),
        };
    });
    return { ...document, items };
}

export function removeConstraint(
    document: WhiteboardDocument,
    constraintId: string,
): WhiteboardDocument {
    if (!document.sketch.constraints[constraintId]) return document;
    const constraints = { ...document.sketch.constraints };
    const removed = constraints[constraintId];
    delete constraints[constraintId];
    const dimensions = Object.fromEntries(Object.entries(document.dimensions ?? {}).filter(([, dimension]) =>
        dimension.constraintId !== constraintId
    ));
    const parameters = { ...document.sketch.parameters };
    if (
        removed.kind === "distance" || removed.kind === "angle" || removed.kind === "radial-distance"
    ) {
        const stillUsed = Object.values(constraints).some((constraint) =>
            (constraint.kind === "distance" || constraint.kind === "angle" || constraint.kind === "radial-distance") &&
            constraint.value === removed.value
        );
        if (!stillUsed) delete parameters[removed.value];
    }
    return {
        ...document,
        ...(document.dimensions ? { dimensions } : {}),
        sketch: { ...document.sketch, parameters, constraints },
    };
}

function referencedPointIds(document: WhiteboardDocument): Set<string> {
    const ids = new Set<string>();
    for (const curve of Object.values(document.sketch.curves)) {
        if (curve.kind === "segment") {
            ids.add(curve.start);
            ids.add(curve.end);
        } else if (curve.kind === "arc") {
            ids.add(curve.center);
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
    const withPoints = { ...next, sketch: { ...next.sketch, points } };
    const featureExists = (ref: PointFeatureRef) => pointFeaturePosition(withPoints, ref) !== null;
    const constraints = Object.fromEntries(Object.entries(next.sketch.constraints).filter(([, constraint]) => {
        switch (constraint.kind) {
            case "coincident":
            case "distance": return featureExists(constraint.a) && featureExists(constraint.b);
            case "fixed-point": return featureExists(constraint.point);
            case "horizontal":
            case "vertical": return Boolean(curves[constraint.curveId]);
            case "parallel":
            case "perpendicular":
            case "equal-length":
            case "angle":
            case "tangent": return Boolean(curves[constraint.a] && curves[constraint.b]);
            case "radial-distance": return Boolean(curves[constraint.curveId]);
            case "point-on-curve": return featureExists(constraint.point) && Boolean(curves[constraint.curveId]);
        }
    }));
    const dimensions = Object.fromEntries(Object.entries(document.dimensions ?? {}).filter(([, dimension]) =>
        featureExists(dimension.a) && featureExists(dimension.b) &&
        (!dimension.constraintId || Boolean(constraints[dimension.constraintId]))
    ));
    const usedParameters = new Set(Object.values(constraints).flatMap((constraint) =>
        constraint.kind === "distance" || constraint.kind === "radial-distance" || constraint.kind === "angle"
            ? [constraint.value]
            : []
    ));
    const parameters = Object.fromEntries(Object.entries(next.sketch.parameters).filter(([id]) => usedParameters.has(id)));
    next = {
        ...next,
        ...(document.dimensions ? { dimensions } : {}),
        sketch: { ...next.sketch, points, parameters, constraints },
    };
    return next;
}

