/**
 * Pipeline B — smart gestures (ARCHITECTURE.md §3).
 *
 * The constraint-driven half of the two-pipeline boundary: dragging a smart
 * feature, and translating / resizing / rotating a smart selection. Each
 * gesture runs `operations.ts` + the solver in `"preview"` mode while the
 * pointer moves (transient, render-only) and once more in `"commit"` mode on
 * release, producing **exactly one** Document transaction (INVARIANTS §3).
 *
 * Ownership is not decided here — `InteractionController` decides it once on
 * pointer-down and hands this controller the armed `SmartGesture`.
 */

import type { Scene } from "$lib/asy/scene/types";
import type { SelectionTransformGesture } from "$lib/asy/engine";
import type { ConstraintService } from "$lib/whiteboard/constraint-service.svelte";
import {
    nearestPointFeature,
    pointFeaturePosition,
    resolveWhiteboardDocument,
    rotateWhiteboardItems,
    scaleWhiteboardItems,
    translateWhiteboardItems,
    type GeometryOperationResult,
    type PointFeatureRef,
    type SnapRelationProposal,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

/** The resize/rotate subset of the view's selection-handle gestures. */
export type SmartSelectionTransform = Extract<
    SelectionTransformGesture,
    { kind: "resize" } | { kind: "rotate" }
>;

/** The Pipeline B arms of the single `ActiveGesture` union. */
export type SmartGesture =
    | {
          kind: "drag-feature";
          base: WhiteboardDocument;
          feature: PointFeatureRef;
          pointerOffset: readonly [number, number];
          candidate: SnapRelationProposal | null;
          seed?: Readonly<Record<string, readonly [number, number]>>;
      }
    | {
          kind: "translate";
          base: WhiteboardDocument;
          start: readonly [number, number];
          itemIds: string[];
      }
    | {
          kind: "transform";
          base: WhiteboardDocument;
          start: readonly [number, number];
          pointerOffset: readonly [number, number];
          gesture: SmartSelectionTransform;
          itemIds: string[];
      };

/** The store-owned state Pipeline B reads and writes. */
export interface SmartGestureHost {
    readonly scene: Scene;
    applyDocument(next: WhiteboardDocument): void;

    preview: Scene | null;
    snapProposal: { from: readonly [number, number]; to: readonly [number, number] } | null;

    readonly sceneUnitsPerPixel: number;
}

export class SmartGestureController {
    #host: SmartGestureHost;
    #constraints: ConstraintService;

    constructor(host: SmartGestureHost, constraints: ConstraintService) {
        this.#host = host;
        this.#constraints = constraints;
    }

    /** Transient solve for the in-flight gesture; writes only `preview`. */
    preview(
        gesture: SmartGesture,
        point: readonly [number, number],
        shiftKey: boolean,
        suppressSnap: boolean,
    ): void {
        switch (gesture.kind) {
            case "transform":
                return this.#previewSmartTransform(gesture, point, shiftKey);
            case "translate":
                return this.#previewSmartTranslation(gesture, point);
            case "drag-feature":
                return this.#previewSmartDrag(gesture, point, suppressSnap);
        }
    }

    /** Release: one solve in `"commit"` mode → at most one Document write. */
    commit(
        gesture: SmartGesture,
        point: readonly [number, number],
        shiftKey: boolean,
        suppressSnap: boolean,
    ): void {
        switch (gesture.kind) {
            case "transform":
                return this.#commitSmartTransform(gesture, point, shiftKey);
            case "translate":
                return this.#commitSmartTranslation(gesture, point);
            case "drag-feature":
                return this.#commitSmartDrag(gesture, point, suppressSnap);
        }
    }

    // --- translate -------------------------------------------------------------

    #translationResult(
        gesture: Extract<SmartGesture, { kind: "translate" }>,
        point: readonly [number, number],
        mode: "preview" | "commit",
    ): GeometryOperationResult {
        return translateWhiteboardItems(
            gesture.base,
            gesture.itemIds,
            [point[0] - gesture.start[0], point[1] - gesture.start[1]],
            mode,
        );
    }

    #previewSmartTranslation(
        gesture: Extract<SmartGesture, { kind: "translate" }>,
        point: readonly [number, number],
    ): void {
        const result = this.#translationResult(gesture, point, "preview");
        this.#host.preview = result.document
            ? resolveWhiteboardDocument(result.document)
            : this.#host.scene;
        this.#constraints.recordSolverResult(result);
    }

    #commitSmartTranslation(
        gesture: Extract<SmartGesture, { kind: "translate" }>,
        point: readonly [number, number],
    ): void {
        const result = this.#translationResult(gesture, point, "commit");
        this.#host.preview = null;
        this.#constraints.recordSolverResult(result);
        if (result.document && JSON.stringify(result.document) !== JSON.stringify(gesture.base)) {
            this.#host.applyDocument(result.document);
        }
    }

    // --- resize / rotate -------------------------------------------------------

    #smartTransformResult(
        transform: Extract<SmartGesture, { kind: "transform" }>,
        point: readonly [number, number],
        snapRotation: boolean,
        mode: "preview" | "commit",
    ): GeometryOperationResult {
        if (transform.gesture.kind === "rotate") {
            const pivot = transform.gesture.pivot;
            const startAngle = Math.atan2(
                transform.start[1] - pivot[1],
                transform.start[0] - pivot[0],
            );
            const pointerAngle = Math.atan2(point[1] - pivot[1], point[0] - pivot[0]);
            let degrees = (pointerAngle - startAngle) * 180 / Math.PI;
            if (snapRotation) degrees = Math.round(degrees / 15) * 15;
            return rotateWhiteboardItems(transform.base, transform.itemIds, pivot, degrees, mode);
        }

        const { anchor, handle, axes, minimumScale } = transform.gesture;
        const startX = handle[0] - anchor[0];
        const startY = handle[1] - anchor[1];
        const adjustedX = point[0] - transform.pointerOffset[0] - anchor[0];
        const adjustedY = point[1] - transform.pointerOffset[1] - anchor[1];
        const activeX = axes.x && Math.abs(startX) > 1e-12;
        const activeY = axes.y && Math.abs(startY) > 1e-12;
        let factor = 1;
        if (activeX && activeY) {
            const lengthSquared = startX * startX + startY * startY;
            factor = (adjustedX * startX + adjustedY * startY) / lengthSquared;
        } else if (activeX) factor = adjustedX / startX;
        else if (activeY) factor = adjustedY / startY;
        const minimum = Math.max(minimumScale[0], minimumScale[1]);
        return scaleWhiteboardItems(
            transform.base,
            transform.itemIds,
            anchor,
            Math.max(minimum, factor),
            mode,
        );
    }

    #previewSmartTransform(
        transform: Extract<SmartGesture, { kind: "transform" }>,
        point: readonly [number, number],
        snapRotation: boolean,
    ): void {
        const result = this.#smartTransformResult(transform, point, snapRotation, "preview");
        this.#constraints.recordSolverResult(result);
        this.#host.preview = result.document
            ? resolveWhiteboardDocument(result.document)
            : this.#host.scene;
    }

    #commitSmartTransform(
        transform: Extract<SmartGesture, { kind: "transform" }>,
        point: readonly [number, number],
        snapRotation: boolean,
    ): void {
        const result = this.#smartTransformResult(transform, point, snapRotation, "commit");
        this.#host.preview = null;
        this.#constraints.recordSolverResult(result);
        if (result.document && JSON.stringify(result.document) !== JSON.stringify(transform.base)) {
            this.#host.applyDocument(result.document);
        } else if (result.diagnostic) console.info(`[Whiteboard] ${result.diagnostic}`);
    }

    // --- drag a smart feature --------------------------------------------------

    #smartDragCandidate(
        drag: Extract<SmartGesture, { kind: "drag-feature" }>,
        target: readonly [number, number],
        suppressSnap: boolean,
    ): SnapRelationProposal | null {
        if (suppressSnap) return null;
        const acquired = drag.candidate;
        const acquiredAt = acquired ? pointFeaturePosition(drag.base, acquired.target) : null;
        if (
            acquired && acquiredAt &&
            Math.hypot(acquiredAt[0] - target[0], acquiredAt[1] - target[1]) <=
                12 * this.#host.sceneUnitsPerPixel
        ) {
            return { ...acquired, from: target, to: acquiredAt };
        }
        const candidate = nearestPointFeature(
            drag.base,
            target,
            8 * this.#host.sceneUnitsPerPixel,
            drag.feature,
        );
        return candidate ? {
            source: drag.feature,
            target: candidate.ref,
            from: target,
            to: candidate.at,
        } : null;
    }

    #previewSmartDrag(
        drag: Extract<SmartGesture, { kind: "drag-feature" }>,
        point: readonly [number, number],
        suppressSnap: boolean,
    ): void {
        const rawTarget = [
            point[0] - drag.pointerOffset[0],
            point[1] - drag.pointerOffset[1],
        ] as const;
        const candidate = this.#smartDragCandidate(drag, rawTarget, suppressSnap);
        drag.candidate = candidate;
        const target = candidate?.to ?? rawTarget;
        const solved = this.#constraints.solveDocument(drag.base, {
            affected: [drag.feature],
            drivers: [{ feature: drag.feature, target }],
            ...(drag.seed ? { initialPoints: drag.seed } : {}),
            mode: "preview",
        });
        if (solved.document) drag.seed = solved.pointUpdates;
        this.#host.preview = solved.document
            ? resolveWhiteboardDocument(solved.document)
            : this.#host.scene;
        this.#host.snapProposal = candidate ? { from: rawTarget, to: candidate.to } : null;
    }

    #commitSmartDrag(
        drag: Extract<SmartGesture, { kind: "drag-feature" }>,
        point: readonly [number, number],
        suppressSnap: boolean,
    ): void {
        const rawTarget = [
            point[0] - drag.pointerOffset[0],
            point[1] - drag.pointerOffset[1],
        ] as const;
        const candidate = this.#smartDragCandidate(drag, rawTarget, suppressSnap);
        const solved = this.#constraints.solveDocument(drag.base, {
            affected: [drag.feature],
            drivers: [{ feature: drag.feature, target: candidate?.to ?? rawTarget }],
            ...(drag.seed ? { initialPoints: drag.seed } : {}),
            mode: "commit",
        });
        this.#host.preview = null;
        this.#host.snapProposal = null;
        if (!solved.document) {
            if (solved.diagnostic) console.info(`[Whiteboard] ${solved.diagnostic}`);
            return;
        }
        const committed = candidate
            ? this.#constraints.addCoincident(solved.document, drag.feature, candidate.target, "inferred")
            : solved.document;
        if (committed && JSON.stringify(committed) !== JSON.stringify(drag.base)) {
            this.#host.applyDocument(committed);
        }
    }
}
