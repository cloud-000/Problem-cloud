import { pointFeaturePointId } from "./features";
import type { FeatureRef, PointFeatureRef, WhiteboardDocument } from "./types";

export type RelationKind =
    | "horizontal"
    | "vertical"
    | "parallel"
    | "perpendicular"
    | "equal-length"
    | "fixed-point"
    | "distance";

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
