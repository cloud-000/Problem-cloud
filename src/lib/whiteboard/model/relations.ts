import { pointFeaturePointId } from "./features";
import type { CurveFeatureRef, FeatureRef, PointFeatureRef, SketchCurve, WhiteboardDocument } from "./types";

export type RelationKind =
    | "horizontal"
    | "vertical"
    | "parallel"
    | "perpendicular"
    | "equal-length"
    | "fixed-point"
    | "distance"
    | "point-on-curve"
    | "tangent";

export interface RelationAction {
    kind: RelationKind;
    label: string;
}

export interface ContextualRelationAction extends RelationAction {
    constraintId?: string;
}

const RELATION_ACTIONS: Readonly<Record<RelationKind, RelationAction>> = {
    horizontal: { kind: "horizontal", label: "Horizontal" },
    vertical: { kind: "vertical", label: "Vertical" },
    parallel: { kind: "parallel", label: "Parallel" },
    perpendicular: { kind: "perpendicular", label: "Perpendicular" },
    "equal-length": { kind: "equal-length", label: "Equal length" },
    "fixed-point": { kind: "fixed-point", label: "Fix point" },
    distance: { kind: "distance", label: "Fix distance" },
    "point-on-curve": { kind: "point-on-curve", label: "Point on curve" },
    tangent: { kind: "tangent", label: "Tangent" },
};

export function featureKey(feature: FeatureRef): string {
    if (feature.kind === "curve") return `curve:${feature.curveId}`;
    if (feature.kind === "point") return `point:${feature.pointId}`;
    return `curve-point:${feature.curveId}:${feature.feature}`;
}

export function isPointFeature(feature: FeatureRef): feature is PointFeatureRef {
    return feature.kind !== "curve";
}

function isSegmentFeature(document: WhiteboardDocument, feature: FeatureRef): boolean {
    return feature.kind === "curve" && document.sketch.curves[feature.curveId]?.kind === "segment";
}

function curveOfKind(
    document: WhiteboardDocument,
    feature: FeatureRef,
    kinds: readonly SketchCurve["kind"][],
): (CurveFeatureRef & { curve: SketchCurve }) | null {
    if (feature.kind !== "curve") return null;
    const curve = document.sketch.curves[feature.curveId];
    return curve && kinds.includes(curve.kind) ? { ...feature, curve } : null;
}

/** The point ids that *define* a curve — its endpoints/center — never on-curve targets. */
function definingPointIds(curve: SketchCurve): string[] {
    if (curve.kind === "segment") return [curve.start, curve.end];
    if (curve.kind === "arc") return [curve.center, curve.start, curve.end];
    return [curve.center];
}

/**
 * A point-feature + curve-feature pair eligible for `point-on-curve`: the curve
 * is a segment or arc, the point resolves, and it is not one of the curve's own
 * defining points (which lie on it trivially).
 */
export function pointOnCurvePair(
    document: WhiteboardDocument,
    features: readonly FeatureRef[],
): { point: PointFeatureRef; curve: CurveFeatureRef } | null {
    const pointFeature = features.find(isPointFeature);
    const curveMatch = features
        .map((feature) => curveOfKind(document, feature, ["segment", "arc"]))
        .find((match): match is CurveFeatureRef & { curve: SketchCurve } => match !== null);
    if (!pointFeature || !curveMatch) return null;
    const pointId = pointFeaturePointId(document, pointFeature);
    if (!pointId || definingPointIds(curveMatch.curve).includes(pointId)) return null;
    return { point: pointFeature, curve: { kind: "curve", curveId: curveMatch.curveId } };
}

/** An arc-curve + segment-curve pair eligible for `tangent`. */
export function tangentPair(
    document: WhiteboardDocument,
    features: readonly FeatureRef[],
): { arc: CurveFeatureRef; segment: CurveFeatureRef } | null {
    const arc = features.map((feature) => curveOfKind(document, feature, ["arc"]))
        .find((match): match is CurveFeatureRef & { curve: SketchCurve } => match !== null);
    const segment = features.map((feature) => curveOfKind(document, feature, ["segment"]))
        .find((match): match is CurveFeatureRef & { curve: SketchCurve } => match !== null);
    if (!arc || !segment) return null;
    return {
        arc: { kind: "curve", curveId: arc.curveId },
        segment: { kind: "curve", curveId: segment.curveId },
    };
}

export function applicableRelationActions(
    document: WhiteboardDocument,
    selection: readonly FeatureRef[],
): RelationAction[] {
    const unique = [...new Map(selection.map((feature) => [featureKey(feature), feature])).values()];
    if (unique.length === 1) {
        if (isSegmentFeature(document, unique[0])) {
            return [RELATION_ACTIONS.horizontal, RELATION_ACTIONS.vertical];
        }
        if (isPointFeature(unique[0]) && pointFeaturePointId(document, unique[0])) {
            return [RELATION_ACTIONS["fixed-point"]];
        }
    }
    if (unique.length === 2 && unique.every((feature) => isSegmentFeature(document, feature))) {
        return [
            RELATION_ACTIONS.parallel,
            RELATION_ACTIONS.perpendicular,
            RELATION_ACTIONS["equal-length"],
        ];
    }
    if (
        unique.length === 2 && unique.every(isPointFeature) &&
        pointFeaturePointId(document, unique[0]) !== pointFeaturePointId(document, unique[1])
    ) return [RELATION_ACTIONS.distance];
    if (unique.length === 2 && tangentPair(document, unique)) {
        return [RELATION_ACTIONS.tangent];
    }
    if (unique.length === 2 && pointOnCurvePair(document, unique)) {
        return [RELATION_ACTIONS["point-on-curve"]];
    }
    return [];
}

function selectedPointId(document: WhiteboardDocument, feature: FeatureRef): string | null {
    return isPointFeature(feature) ? pointFeaturePointId(document, feature) : null;
}

function constraintMatchesSelection(
    document: WhiteboardDocument,
    kind: RelationKind,
    selection: readonly FeatureRef[],
): (constraint: WhiteboardDocument["sketch"]["constraints"][string]) => boolean {
    const curveIds = selection.flatMap((feature) => feature.kind === "curve" ? [feature.curveId] : []);
    const pointIds = selection.flatMap((feature) => {
        const id = selectedPointId(document, feature);
        return id ? [id] : [];
    });
    return (constraint) => {
        if (!constraint.enabled || constraint.kind !== kind) return false;
        if ((kind === "horizontal" || kind === "vertical") && (constraint.kind === "horizontal" || constraint.kind === "vertical")) {
            return curveIds.length === 1 && constraint.curveId === curveIds[0];
        }
        if (
            (kind === "parallel" || kind === "perpendicular" || kind === "equal-length") &&
            (constraint.kind === "parallel" || constraint.kind === "perpendicular" || constraint.kind === "equal-length")
        ) {
            return curveIds.length === 2 && (
                (constraint.a === curveIds[0] && constraint.b === curveIds[1]) ||
                (constraint.a === curveIds[1] && constraint.b === curveIds[0])
            );
        }
        if (kind === "fixed-point" && constraint.kind === "fixed-point") {
            return pointIds.length === 1 && pointFeaturePointId(document, constraint.point) === pointIds[0];
        }
        if (kind === "distance" && constraint.kind === "distance") {
            const a = pointFeaturePointId(document, constraint.a);
            const b = pointFeaturePointId(document, constraint.b);
            return pointIds.length === 2 && (
                (a === pointIds[0] && b === pointIds[1]) ||
                (a === pointIds[1] && b === pointIds[0])
            );
        }
        if (kind === "point-on-curve" && constraint.kind === "point-on-curve") {
            return pointIds.length === 1 && curveIds.length === 1 &&
                pointFeaturePointId(document, constraint.point) === pointIds[0] &&
                constraint.curveId === curveIds[0];
        }
        if (kind === "tangent" && constraint.kind === "tangent") {
            return curveIds.length === 2 && (
                (constraint.a === curveIds[0] && constraint.b === curveIds[1]) ||
                (constraint.a === curveIds[1] && constraint.b === curveIds[0])
            );
        }
        return false;
    };
}

/** Applicable relation actions annotated with the matching active constraint, if any. */
export function contextualRelationActions(
    document: WhiteboardDocument,
    selection: readonly FeatureRef[],
): ContextualRelationAction[] {
    const constraints = Object.values(document.sketch.constraints);
    return applicableRelationActions(document, selection).map((action) => {
        const active = constraints.find(constraintMatchesSelection(document, action.kind, selection));
        return active ? { ...action, constraintId: active.id } : action;
    });
}
