/**
 * SelectionModel — the whiteboard's selection concern (ARCHITECTURE.md §5).
 *
 * Owns item selection, feature (point/curve) selection, and the marquee
 * (plus the marquee's candidate `selectionPreview`) as reactive `$state`. It is
 * the model for "what is currently selected", nothing more: it reads the
 * Document to resolve feature hits but never mutates it, and it holds no tool,
 * preview, or history state.
 *
 * Boundary: selection is not the source of truth (INVARIANTS §0) — this class
 * neither applies transactions nor reads the Scene as truth. Where selecting a
 * feature must also drop a stale constraint/dimension selection or solver
 * feedback (owned by ConstraintService), it asks the host to clear them rather
 * than reaching across concerns itself.
 */

import {
    featureKey,
    nearestSegmentFeature,
    type FeatureRef,
    type PointFeatureRef,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

/** Marquee rubber-band rect in asy-space (matches the store's prior field). */
export interface Marquee {
    start: readonly [number, number];
    end: readonly [number, number];
}

/**
 * The store capabilities SelectionModel needs: the Document (read-only, to
 * resolve feature hits), the active px→asy scale for hit tolerances, and the
 * three cross-concern clears it must trigger when selection changes.
 */
export interface SelectionHost {
    readonly document: WhiteboardDocument;
    readonly sceneUnitsPerPixel: number;
    /** A new feature selection supersedes any selected constraint. */
    clearConstraintSelection(): void;
    /** A new item/feature selection supersedes any selected dimension. */
    clearDimensionSelection(): void;
    /** Feature selection cleared → drop its solver diagnostic + conflicts. */
    clearSolverFeedback(): void;
}

export class SelectionModel {
    /** Selected item ids (draw-order stable). */
    selection = $state<string[]>([]);
    /** Candidate selection while a marquee drag is in progress. */
    selectionPreview = $state<string[] | null>(null);
    marquee = $state<Marquee | null>(null);
    /** Selected sketch features (points/curves) for relations/dimensions. */
    featureSelection = $state<FeatureRef[]>([]);

    #host: SelectionHost;

    constructor(host: SelectionHost) {
        this.#host = host;
    }

    /** True when any of `itemIds` (default: the current selection) is smart. */
    selectionHasSmartItems(itemIds: readonly string[] = this.selection): boolean {
        return this.#host.document.items.some((item) => item.kind !== "baked" && itemIds.includes(item.id));
    }

    get containsSmartItems(): boolean {
        return this.selectionHasSmartItems();
    }

    /** The point feature a smart point-marker item stands for, if any. */
    markerFeature(itemId: string): PointFeatureRef | null {
        const item = this.#host.document.items.find((candidate) =>
            candidate.kind === "sketch-point-marker" && candidate.id === itemId
        );
        return item?.kind === "sketch-point-marker"
            ? { kind: "point", pointId: item.pointId }
            : null;
    }

    selectFeature(feature: FeatureRef, additive = false): void {
        const key = featureKey(feature);
        if (!additive) this.featureSelection = [feature];
        else if (this.featureSelection.some((selected) => featureKey(selected) === key)) {
            this.featureSelection = this.featureSelection.filter((selected) => featureKey(selected) !== key);
        } else this.featureSelection = [...this.featureSelection, feature];
        this.#host.clearConstraintSelection();
        this.#host.clearDimensionSelection();
    }

    selectCurveFeatureForItem(itemId: string, additive = false): void {
        const document = this.#host.document;
        const item = document.items.find((candidate) => candidate.kind !== "baked" && candidate.id === itemId);
        const curveId = item?.kind === "sketch-path" ? item.uses[0]?.curveId
            : item?.kind === "sketch-curve" ? item.curveId : undefined;
        const kind = curveId ? document.sketch.curves[curveId]?.kind : undefined;
        if (curveId && (kind === "segment" || kind === "arc")) {
            this.selectFeature({ kind: "curve", curveId }, additive);
        }
    }

    selectCurveFeatureAt(itemId: string, at: readonly [number, number], additive = false): void {
        const feature = nearestSegmentFeature(this.#host.document, at, 12 * this.#host.sceneUnitsPerPixel, itemId);
        if (feature) this.selectFeature(feature.ref, additive);
    }

    selectFeatureAtItem(
        itemId: string,
        at: readonly [number, number],
        additive = false,
        additiveBase?: readonly FeatureRef[],
    ): void {
        // Pointer-down may either preserve feature selection (same item) or clear
        // it (another item). Always continue Shift-click from the pointer-down
        // snapshot so both paths have identical additive behavior.
        if (additive && additiveBase) this.featureSelection = [...additiveBase];
        const marker = this.markerFeature(itemId);
        if (marker) {
            this.selectFeature(marker, additive);
            return;
        }
        this.selectCurveFeatureAt(itemId, at, additive);
    }

    clearFeatureSelection(): void {
        this.featureSelection = [];
        this.#host.clearSolverFeedback();
    }
}
