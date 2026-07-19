import type { Pair } from "../../asy/scene/types";
import type {
    PointFeatureRef,
    PointId,
    SketchCurve,
    WhiteboardDocument,
} from "./types";

export type PointFeatureKind = "endpoint" | "center" | "explicit-point";

export interface DiscoveredPointFeature {
    ref: PointFeatureRef;
    at: Pair;
    pointId?: PointId;
    kind: PointFeatureKind;
    itemIds: string[];
    zIndex: number;
}

export interface PointSnapCandidate extends DiscoveredPointFeature {
    distance: number;
}

function curvePointId(
    curve: SketchCurve,
    feature: Extract<PointFeatureRef, { kind: "curve-point" }>['feature'],
): PointId | null {
    if (curve.kind === "segment") {
        if (feature === "start") return curve.start;
        if (feature === "end") return curve.end;
        return null;
    }
    return feature === "center" ? curve.center : null;
}

/** Resolve an independent or curve-owned point feature through one registry. */
export function pointFeaturePointId(
    document: WhiteboardDocument,
    ref: PointFeatureRef,
): PointId | null {
    if (ref.kind === "point") return document.sketch.points[ref.pointId] ? ref.pointId : null;
    const curve = document.sketch.curves[ref.curveId];
    return curve ? curvePointId(curve, ref.feature) : null;
}

export function pointFeaturePosition(
    document: WhiteboardDocument,
    ref: PointFeatureRef,
): Pair | null {
    const pointId = pointFeaturePointId(document, ref);
    if (pointId) return document.sketch.points[pointId]?.at ?? null;
    if (ref.kind !== "curve-point") return null;
    const curve = document.sketch.curves[ref.curveId];
    if (!curve || curve.kind !== "arc" || ref.feature === "center") return null;
    const center = document.sketch.points[curve.center]?.at;
    if (!center) return null;
    const angle = ref.feature === "start"
        ? curve.startAngle
        : curve.startAngle + curve.sweepAngle;
    return [
        center[0] + curve.radius * Math.cos(angle),
        center[1] + curve.radius * Math.sin(angle),
    ];
}

function itemIdsForCurve(document: WhiteboardDocument, curveId: string): string[] {
    return document.items.flatMap((item) => {
        if (item.kind === "sketch-curve" && item.curveId === curveId) return [item.id];
        if (item.kind === "sketch-path" && item.uses.some((use) => use.curveId === curveId)) {
            return [item.id];
        }
        return [];
    });
}

function topIndex(document: WhiteboardDocument, itemIds: readonly string[]): number {
    const ids = new Set(itemIds);
    for (let index = document.items.length - 1; index >= 0; index -= 1) {
        const item = document.items[index];
        const id = item.kind === "baked" ? item.element.id : item.id;
        if (ids.has(id)) return index;
    }
    return -1;
}

/** Stable point features used by snapping, selection, constraints, and overlays. */
export function discoverPointFeatures(document: WhiteboardDocument): DiscoveredPointFeature[] {
    const features: DiscoveredPointFeature[] = [];
    for (const curveId of Object.keys(document.sketch.curves).sort()) {
        const curve = document.sketch.curves[curveId];
        const itemIds = itemIdsForCurve(document, curveId);
        const zIndex = topIndex(document, itemIds);
        if (curve.kind === "segment") {
            for (const feature of ["start", "end"] as const) {
                const pointId = curve[feature];
                const at = document.sketch.points[pointId]?.at;
                if (at) features.push({
                    ref: { kind: "curve-point", curveId, feature },
                    at,
                    pointId,
                    kind: "endpoint",
                    itemIds,
                    zIndex,
                });
            }
        } else {
            const at = document.sketch.points[curve.center]?.at;
            if (at) features.push({
                ref: { kind: "curve-point", curveId, feature: "center" },
                at,
                pointId: curve.center,
                kind: "center",
                itemIds,
                zIndex,
            });
        }
    }
    for (let index = 0; index < document.items.length; index += 1) {
        const item = document.items[index];
        if (item.kind !== "sketch-point-marker") continue;
        const at = document.sketch.points[item.pointId]?.at;
        if (at) features.push({
            ref: { kind: "point", pointId: item.pointId },
            at,
            pointId: item.pointId,
            kind: "explicit-point",
            itemIds: [item.id],
            zIndex: index,
        });
    }
    return features;
}

const FEATURE_PRIORITY: Record<PointFeatureKind, number> = {
    endpoint: 0,
    center: 0,
    "explicit-point": 1,
};

export function nearestPointFeature(
    document: WhiteboardDocument,
    at: Pair,
    radius: number,
    excluding?: PointFeatureRef,
): PointSnapCandidate | null {
    const excludedPointId = excluding ? pointFeaturePointId(document, excluding) : null;
    const candidates = discoverPointFeatures(document).flatMap((feature) => {
        if (excludedPointId && feature.pointId === excludedPointId) return [];
        const distance = Math.hypot(feature.at[0] - at[0], feature.at[1] - at[1]);
        return distance <= radius ? [{ ...feature, distance }] : [];
    });
    candidates.sort((a, b) =>
        a.distance - b.distance ||
        FEATURE_PRIORITY[a.kind] - FEATURE_PRIORITY[b.kind] ||
        b.zIndex - a.zIndex ||
        JSON.stringify(a.ref).localeCompare(JSON.stringify(b.ref))
    );
    return candidates[0] ?? null;
}

export function pathNodeFeature(
    document: WhiteboardDocument,
    itemId: string,
    nodeIndex: number,
): PointFeatureRef | null {
    const item = document.items.find((candidate) =>
        candidate.kind === "sketch-path" && candidate.id === itemId
    );
    if (!item || item.kind !== "sketch-path" || nodeIndex < 0) return null;
    if (nodeIndex === 0) {
        const use = item.uses[0];
        if (!use) return null;
        return { kind: "curve-point", curveId: use.curveId, feature: use.reversed ? "end" : "start" };
    }
    const use = item.uses[nodeIndex - 1];
    if (!use) return null;
    return { kind: "curve-point", curveId: use.curveId, feature: use.reversed ? "start" : "end" };
}

export function nearestSegmentFeature(
    document: WhiteboardDocument,
    at: Pair,
    radius: number,
    itemId?: string,
): { ref: { kind: "curve"; curveId: string }; distance: number } | null {
    const candidates = Object.values(document.sketch.curves).flatMap((curve) => {
        if (curve.kind !== "segment") return [];
        if (itemId && !itemIdsForCurve(document, curve.id).includes(itemId)) return [];
        const start = document.sketch.points[curve.start]?.at;
        const end = document.sketch.points[curve.end]?.at;
        if (!start || !end) return [];
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared <= 1e-20 ? 0 : Math.max(0, Math.min(1,
            ((at[0] - start[0]) * dx + (at[1] - start[1]) * dy) / lengthSquared,
        ));
        const distance = Math.hypot(at[0] - (start[0] + t * dx), at[1] - (start[1] + t * dy));
        return distance <= radius ? [{ ref: { kind: "curve" as const, curveId: curve.id }, distance }] : [];
    });
    candidates.sort((a, b) => a.distance - b.distance || a.ref.curveId.localeCompare(b.ref.curveId));
    return candidates[0] ?? null;
}
