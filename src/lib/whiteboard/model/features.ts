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
    if (curve.kind === "arc" || curve.kind === "elliptical-arc") {
        if (feature === "center") return curve.center;
        if (feature === "start") return curve.start;
        return curve.end;
    }
    return feature === "center" ? curve.center : null;
}

function pointProjectedToEllipse(
    center: Pair,
    point: Pair,
    axisX: Pair,
    axisY: Pair,
    fallback: Pair,
): Pair {
    const determinant = axisX[0] * axisY[1] - axisX[1] * axisY[0];
    if (Math.abs(determinant) <= 1e-12) return fallback;
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const localX = (dx * axisY[1] - dy * axisY[0]) / determinant;
    const localY = (-dx * axisX[1] + dy * axisX[0]) / determinant;
    const length = Math.hypot(localX, localY);
    if (length <= 1e-12) return fallback;
    return [
        center[0] + axisX[0] * localX / length + axisY[0] * localY / length,
        center[1] + axisX[1] * localX / length + axisY[1] * localY / length,
    ];
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
    // Every point feature — including an arc's center/start/end — now resolves to
    // a real sketch point, so a single registry lookup suffices.
    const pointId = pointFeaturePointId(document, ref);
    return pointId ? document.sketch.points[pointId]?.at ?? null : null;
}

function pointProjectedToRadius(
    center: Pair,
    point: readonly [number, number],
    radius: number,
    fallback: Pair,
): Pair {
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const pointRadius = Math.hypot(dx, dy);
    if (pointRadius <= 1e-12) return fallback;
    return [
        center[0] + (dx / pointRadius) * radius,
        center[1] + (dy / pointRadius) * radius,
    ];
}

/**
 * The position an interaction handle represents. Most features expose their
 * raw sketch point; a smart arc's end exposes the rim point actually rendered:
 * its raw point contributes only the angle, while the start defines the radius.
 */
export function pointFeatureInteractionPosition(
    document: WhiteboardDocument,
    ref: PointFeatureRef,
): Pair | null {
    const raw = pointFeaturePosition(document, ref);
    if (
        !raw ||
        ref.kind !== "curve-point" ||
        (ref.feature !== "start" && ref.feature !== "end")
    ) return raw;
    const curve = document.sketch.curves[ref.curveId];
    if (!curve || (curve.kind !== "arc" && curve.kind !== "elliptical-arc")) return raw;
    const center = document.sketch.points[curve.center]?.at;
    const start = document.sketch.points[curve.start]?.at;
    if (!center || !start) return raw;
    if (curve.kind === "elliptical-arc") {
        const fallback = [
            center[0] + curve.axisX[0],
            center[1] + curve.axisX[1],
        ] as Pair;
        return pointProjectedToEllipse(center, raw, curve.axisX, curve.axisY, fallback);
    }
    if (ref.feature === "start") return raw;
    const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
    return pointProjectedToRadius(center, raw, radius, start);
}

/**
 * Distance between a smart arc's two rendered rim endpoints if `ref` were
 * dragged to `target`. This intentionally ignores radial pointer drift: the
 * renderer uses `start` for radius and `end` only for direction.
 */
export function arcEndpointInteractionGap(
    document: WhiteboardDocument,
    ref: PointFeatureRef,
    target: readonly [number, number],
): number | null {
    if (
        ref.kind !== "curve-point" ||
        (ref.feature !== "start" && ref.feature !== "end")
    ) return null;
    const curve = document.sketch.curves[ref.curveId];
    if (!curve || (curve.kind !== "arc" && curve.kind !== "elliptical-arc")) return null;
    const center = document.sketch.points[curve.center]?.at;
    const start = document.sketch.points[curve.start]?.at;
    const end = document.sketch.points[curve.end]?.at;
    if (!center || !start || !end) return null;

    if (curve.kind === "elliptical-arc") {
        const fallback = [
            center[0] + curve.axisX[0],
            center[1] + curve.axisX[1],
        ] as Pair;
        const visibleStart = pointProjectedToEllipse(
            center,
            ref.feature === "start" ? target : start,
            curve.axisX,
            curve.axisY,
            fallback,
        );
        const visibleEnd = pointProjectedToEllipse(
            center,
            ref.feature === "end" ? target : end,
            curve.axisX,
            curve.axisY,
            fallback,
        );
        return Math.hypot(visibleEnd[0] - visibleStart[0], visibleEnd[1] - visibleStart[1]);
    }
    if (ref.feature === "end") {
        const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
        const visibleEnd = pointProjectedToRadius(center, target, radius, start);
        return Math.hypot(visibleEnd[0] - start[0], visibleEnd[1] - start[1]);
    }

    const radius = Math.hypot(target[0] - center[0], target[1] - center[1]);
    const visibleEnd = pointProjectedToRadius(center, end, radius, [target[0], target[1]]);
    return Math.hypot(visibleEnd[0] - target[0], visibleEnd[1] - target[1]);
}

/**
 * The draggable sketch-point feature behind one of a smart arc's edit handles
 * (`center` / `start` / `end`), or `null` when the item is not a smart arc or
 * the control is a baked-only handle (`radius` / `focus1` / `focus2`). This is
 * the arc analogue of `pathNodeFeature`: it lets the pointer-down router send an
 * arc-handle grab into Pipeline B (INVARIANTS §3.1).
 */
export function arcControlFeature(
    document: WhiteboardDocument,
    itemId: string,
    control: string,
): PointFeatureRef | null {
    if (control !== "center" && control !== "start" && control !== "end") return null;
    const item = document.items.find(
        (candidate) => candidate.kind === "sketch-curve" && candidate.id === itemId,
    );
    if (!item || item.kind !== "sketch-curve") return null;
    const curve = document.sketch.curves[item.curveId];
    if (!curve || (curve.kind !== "arc" && curve.kind !== "elliptical-arc")) return null;
    return { kind: "curve-point", curveId: item.curveId, feature: control };
}

export interface ArcEndpointClosure {
    counterpart: PointFeatureRef;
    /** Existing inferred closure relation, removed when the endpoint is pulled apart. */
    inferredConstraintId: string | null;
}

/**
 * Describe the other rim endpoint of a smart arc and any inferred coincidence
 * currently closing the pair. Centers and non-arc features have no closure.
 */
export function arcEndpointClosure(
    document: WhiteboardDocument,
    ref: PointFeatureRef,
): ArcEndpointClosure | null {
    if (
        ref.kind !== "curve-point" ||
        (ref.feature !== "start" && ref.feature !== "end")
    ) return null;
    const curve = document.sketch.curves[ref.curveId];
    if (!curve || (curve.kind !== "arc" && curve.kind !== "elliptical-arc")) return null;
    const counterpart: PointFeatureRef = {
        kind: "curve-point",
        curveId: ref.curveId,
        feature: ref.feature === "start" ? "end" : "start",
    };
    const sourcePointId = pointFeaturePointId(document, ref);
    const targetPointId = pointFeaturePointId(document, counterpart);
    if (!sourcePointId || !targetPointId) {
        return { counterpart, inferredConstraintId: null };
    }
    const inferredConstraintId = Object.values(document.sketch.constraints).find((constraint) =>
        constraint.kind === "coincident" &&
        constraint.origin === "inferred" &&
        (
            (
                pointFeaturePointId(document, constraint.a) === sourcePointId &&
                pointFeaturePointId(document, constraint.b) === targetPointId
            ) ||
            (
                pointFeaturePointId(document, constraint.a) === targetPointId &&
                pointFeaturePointId(document, constraint.b) === sourcePointId
            )
        )
    )?.id ?? null;
    return { counterpart, inferredConstraintId };
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
        } else if (curve.kind === "arc" || curve.kind === "elliptical-arc") {
            // A smart arc surfaces all three of its real points, so they can be
            // dragged, snapped to, and attached to like any endpoint/center.
            const arcFeatures = [
                { feature: "center", pointId: curve.center, kind: "center" },
                { feature: "start", pointId: curve.start, kind: "endpoint" },
                { feature: "end", pointId: curve.end, kind: "endpoint" },
            ] as const;
            for (const { feature, pointId, kind } of arcFeatures) {
                const at = document.sketch.points[pointId]?.at;
                if (at) features.push({
                    ref: { kind: "curve-point", curveId, feature },
                    at,
                    pointId,
                    kind,
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
        if (itemId && !itemIdsForCurve(document, curve.id).includes(itemId)) return [];
        if (curve.kind === "segment") {
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
        }
        if (curve.kind === "arc" || curve.kind === "elliptical-arc") {
            const center = document.sketch.points[curve.center]?.at;
            const start = document.sketch.points[curve.start]?.at;
            if (!center || !start) return [];
            const distance = curve.kind === "arc"
                ? Math.abs(
                      Math.hypot(at[0] - center[0], at[1] - center[1]) -
                      Math.hypot(start[0] - center[0], start[1] - center[1]),
                  )
                : Math.hypot(
                      at[0] - pointProjectedToEllipse(
                          center,
                          at,
                          curve.axisX,
                          curve.axisY,
                          [center[0] + curve.axisX[0], center[1] + curve.axisX[1]],
                      )[0],
                      at[1] - pointProjectedToEllipse(
                          center,
                          at,
                          curve.axisX,
                          curve.axisY,
                          [center[0] + curve.axisX[0], center[1] + curve.axisX[1]],
                      )[1],
                  );
            return distance <= radius ? [{ ref: { kind: "curve" as const, curveId: curve.id }, distance }] : [];
        }
        return [];
    });
    candidates.sort((a, b) => a.distance - b.distance || a.ref.curveId.localeCompare(b.ref.curveId));
    return candidates[0] ?? null;
}
