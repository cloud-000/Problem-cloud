/**
 * Pipeline A → Document: lifting a `ToolCommit` to one Document transaction
 * (ARCHITECTURE.md §3.2, INVARIANTS.md §4).
 *
 * This module is the *only* place a tool's committed delta becomes a Document
 * mutation. It replaced the retired Scene → Document reconciliation seam, so it
 * is deliberately pure: every function takes a `WhiteboardDocument` (plus the
 * small `LiftContext` the gesture supplies) and returns a new one. No Scene is
 * ever treated as authoritative and folded back; the tool describes *what it
 * changed* and these functions map that intent onto the Document.
 *
 * Creation with the line/rectangle/point/arc tools lifts to **smart** sketch
 * items (with snap-inferred coincidence); pen/label, full-circle arcs, and every
 * imported element stay **baked**.
 */

import type { Pair, Scene, SceneElement } from "$lib/asy/scene/types";
import type { ToolCommit } from "$lib/asy/engine";
import type { WhiteboardToolKind } from "$lib/whiteboard/style.svelte";
import {
    addCoincidentConstraint,
    addDefaultRectangleConstraints,
    appendSmartPathNode,
    closeSmartPath,
    createSmartArc,
    createSmartPath,
    createSmartPointMarker,
    deleteWhiteboardItems,
    nearestPointFeature,
    pointFeaturePointId,
    pointFeaturePosition,
    type PointFeatureRef,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

/** The gesture-scoped inputs the lift needs beyond the Document itself. */
export interface LiftContext {
    /** Which tool produced the commit — decides smart vs. baked. */
    readonly toolKind: WhiteboardToolKind;
    /** Scene units per screen pixel, for the snap radius. */
    readonly sceneUnitsPerPixel: number;
    /** Snap inference is suppressed for this gesture. */
    readonly suppressSnap: boolean;
}

/** The transient "this endpoint snapped there" hint the view renders. */
export interface SnapProposal {
    readonly from: readonly [number, number];
    readonly to: readonly [number, number];
}

export interface SnapPreviewResult {
    readonly scene: Scene | null;
    /**
     * `undefined` leaves the host's current proposal untouched; `null` clears
     * it. (Matches the pre-split branch-by-branch behavior exactly.)
     */
    readonly snapProposal?: SnapProposal | null;
}

const SNAP_RADIUS_PIXELS = 8;

function snapRadius(ctx: LiftContext): number {
    return SNAP_RADIUS_PIXELS * ctx.sceneUnitsPerPixel;
}

/**
 * Lift a committed tool gesture to ONE Document transaction. Returns `null`
 * when the commit maps to no document change.
 */
export function liftCommit(
    document: WhiteboardDocument,
    commit: ToolCommit,
    ctx: LiftContext,
): WhiteboardDocument | null {
    switch (commit.kind) {
        case "add":
            return liftAdd(document, commit.elements, ctx);
        case "replace":
            return replaceBakedElements(document, commit.elements);
        case "erase":
            return deleteWhiteboardItems(document, [...commit.elementIds]);
        case "extend-path": {
            // Continuation only ever follows a line-tool smart path; a baked
            // target has no smart continuation and is left untouched.
            const item = document.items.find((candidate) =>
                candidate.kind === "sketch-path" && candidate.id === commit.elementId
            );
            if (item?.kind !== "sketch-path") return null;
            const appended = appendSmartPathNode(document, commit.elementId, commit.node);
            return conjoinCreatedFeature(appended.document, appended.feature, document, ctx);
        }
        case "close-path":
            return closeSmartPath(document, commit.elementId);
    }
}

export function liftAdd(
    document: WhiteboardDocument,
    elements: readonly SceneElement[],
    ctx: LiftContext,
): WhiteboardDocument | null {
    const added = elements[0];
    if (ctx.toolKind === "line" && added?.kind === "path") {
        const created = createSmartPath(
            document,
            [...added.path.nodes],
            false,
            added.pen,
            added.fillPen,
            added.id,
        );
        return conjoinCreatedFeatures(created.document, created.endpointFeatures, document, ctx);
    }
    if (ctx.toolKind === "rectangle" && added?.kind === "path") {
        const rawStart = added.path.nodes[0];
        const rawEnd = added.path.nodes[2];
        if (!rawStart || !rawEnd) return appendBaked(document, elements);
        const snappedStart = ctx.suppressSnap
            ? rawStart
            : nearestPointFeature(document, rawStart, snapRadius(ctx))?.at ?? rawStart;
        const snappedEnd = ctx.suppressSnap
            ? rawEnd
            : nearestPointFeature(document, rawEnd, snapRadius(ctx))?.at ?? rawEnd;
        const created = createSmartPath(
            document,
            [
                snappedStart,
                [snappedEnd[0], snappedStart[1]],
                snappedEnd,
                [snappedStart[0], snappedEnd[1]],
            ],
            true,
            added.pen,
            added.fillPen,
            added.id,
        );
        // The rectangle's defining right angles ride along with it: author them
        // while the shape is still perfectly square (constraints are satisfied),
        // then let snap inference solve any endpoint coincidence on top.
        const constrained = addDefaultRectangleConstraints(created.document, created.itemId);
        return conjoinCreatedFeatures(
            constrained,
            [created.endpointFeatures[0], created.endpointFeatures[2]].filter(
                (feature): feature is PointFeatureRef => feature !== undefined,
            ),
            document,
            ctx,
        );
    }
    if (ctx.toolKind === "point" && added?.kind === "dot") {
        const created = createSmartPointMarker(document, added.at, added.pen, added.id);
        return conjoinCreatedFeatures(created.document, created.endpointFeatures, document, ctx);
    }
    if (ctx.toolKind === "arc" && added?.kind === "arc") {
        // A full turn (or a degenerate sweep) can't be a three-point smart arc —
        // its rim endpoints would coincide — so it stays baked.
        const sweep = ((added.angle2 - added.angle1) % 360 + 360) % 360;
        if (sweep < 0.5 || sweep > 359.5) return appendBaked(document, elements);
        const a1 = (added.angle1 * Math.PI) / 180;
        const a2 = (added.angle2 * Math.PI) / 180;
        const start: Pair = [
            added.center[0] + added.radius * Math.cos(a1),
            added.center[1] + added.radius * Math.sin(a1),
        ];
        const end: Pair = [
            added.center[0] + added.radius * Math.cos(a2),
            added.center[1] + added.radius * Math.sin(a2),
        ];
        const created = createSmartArc(
            document,
            added.center,
            start,
            end,
            added.pen,
            added.strokeEnabled,
            added.id,
        );
        return conjoinCreatedFeatures(created.document, created.endpointFeatures, document, ctx);
    }
    return appendBaked(document, elements);
}

/** Append raw geometry as baked items (pen · label · full-circle arc · imported ink). */
export function appendBaked(
    document: WhiteboardDocument,
    elements: readonly SceneElement[],
): WhiteboardDocument {
    return {
        ...document,
        items: [
            ...document.items,
            ...elements.map((element) => ({ kind: "baked" as const, element })),
        ],
    };
}

/**
 * Re-emit transformed baked elements in place, matched by id. Smart items are
 * intercepted upstream by Pipeline B, so they are never present in a tool
 * `replace` and are left untouched even if an id somehow collides. Exported
 * because baked vertex deletion (store `deletePathVertex`) is the same edit
 * arriving from the inspector rather than from a tool.
 */
export function replaceBakedElements(
    document: WhiteboardDocument,
    elements: readonly SceneElement[],
): WhiteboardDocument {
    const byId = new Map(elements.map((element) => [element.id, element]));
    return {
        ...document,
        items: document.items.map((item) =>
            item.kind === "baked" && byId.has(item.element.id)
                ? { ...item, element: byId.get(item.element.id)! }
                : item
        ),
    };
}

export function conjoinCreatedFeatures(
    document: WhiteboardDocument,
    features: readonly PointFeatureRef[],
    candidateSource: WhiteboardDocument,
    ctx: LiftContext,
): WhiteboardDocument {
    return features.reduce(
        (current, feature) => conjoinCreatedFeature(current, feature, candidateSource, ctx),
        document,
    );
}

/**
 * Snap inference *inside* the lift: if a freshly created endpoint landed on an
 * existing point feature, move it exactly onto it and record the coincidence.
 * Reads the Document only — never a Scene (INVARIANTS §4).
 */
export function conjoinCreatedFeature(
    document: WhiteboardDocument,
    feature: PointFeatureRef,
    candidateSource: WhiteboardDocument,
    ctx: LiftContext,
): WhiteboardDocument {
    if (ctx.suppressSnap) return document;
    const at = pointFeaturePosition(document, feature);
    if (!at) return document;
    const candidate = nearestPointFeature(candidateSource, at, snapRadius(ctx));
    if (!candidate) return document;
    const pointId = pointFeaturePointId(document, feature);
    if (!pointId) return document;
    const points = {
        ...document.sketch.points,
        [pointId]: { ...document.sketch.points[pointId], at: candidate.at },
    };
    const positioned = { ...document, sketch: { ...document.sketch, points } };
    return addCoincidentConstraint(positioned, feature, candidate.ref, "inferred") ?? document;
}

/**
 * Pull a creation tool's in-flight preview onto a nearby point feature. Purely
 * a render-time adjustment: the returned Scene is never stored, and the
 * proposal is the hint the overlay draws.
 */
export function snapCreationPreview(
    document: WhiteboardDocument,
    currentScene: Scene,
    scene: Scene | null,
    ctx: LiftContext,
): SnapPreviewResult {
    const toolKind = ctx.toolKind;
    if (!scene || (toolKind !== "line" && toolKind !== "rectangle" && toolKind !== "point")) {
        return { scene, snapProposal: null };
    }
    const currentIds = currentScene.elements.map(({ id }) => id);
    const added = scene.elements.findLast((element) => !currentIds.includes(element.id));
    if (!added) return { scene };
    const at = added.kind === "dot"
        ? added.at
        : added.kind === "path"
          ? added.path.nodes[toolKind === "rectangle" ? 2 : added.path.nodes.length - 1]
          : undefined;
    if (!at) return { scene, snapProposal: null };
    const candidate = nearestPointFeature(document, at, snapRadius(ctx));
    if (!candidate) return { scene, snapProposal: null };
    const addedId = added.id;
    return {
        snapProposal: { from: at, to: candidate.at },
        scene: {
            ...scene,
            elements: scene.elements.map((element) => {
                if (element.id !== addedId) return element;
                if (element.kind === "dot") return { ...element, at: candidate.at };
                if (element.kind === "path") {
                    const start = element.path.nodes[0];
                    const nodes = toolKind === "rectangle" && start
                        ? [
                              start,
                              [candidate.at[0], start[1]] as const,
                              candidate.at,
                              [start[0], candidate.at[1]] as const,
                          ]
                        : element.path.nodes.map((node, index) =>
                              index === element.path.nodes.length - 1 ? candidate.at : node
                          );
                    return { ...element, path: { ...element.path, nodes } };
                }
                return element;
            }),
        },
    };
}
