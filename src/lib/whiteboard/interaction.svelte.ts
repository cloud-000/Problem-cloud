/**
 * InteractionController — pointer routing and the two-pipeline boundary
 * (ARCHITECTURE.md §3, §5).
 *
 * Ownership is decided **once, on pointer-down**, by a single hit-test
 * (`#routePointerDown`): a smart feature / smart selection takes Pipeline B
 * (`smart-gestures.svelte.ts` — `operations.ts` + the solver), everything else
 * takes Pipeline A (the `Tool` state machine). The chosen pipeline is stored as
 * one explicit `ActiveGesture` value, so `pointerMove` / `pointerUp` dispatch on
 * a single discriminant instead of re-probing parallel nullable fields — there
 * is no mid-gesture pipeline switch (INVARIANTS §3).
 *
 * Both pipelines converge on one write target: the Document. A tool's
 * `ToolCommit` becomes a Document transaction at exactly one place, the
 * `liftCommit` call in `#dispatch` (`commit-lift.ts`); no Scene is ever edited
 * and folded back (INVARIANTS §4). Previews are transient renders only.
 */

import type { Pen, Scene } from "$lib/asy/scene/types";
import {
    createTool,
    hitTest,
    type ArcGuide,
    type LineContinuation,
    type PointerInput,
    type SelectionTransformGesture,
    type StrokeProcessingOptions,
    type Tool,
    type ToolContext,
    type ToolResult,
} from "$lib/asy/engine";
import { liftCommit, snapCreationPreview, type LiftContext } from "$lib/whiteboard/commit-lift";
import type { ConstraintService } from "$lib/whiteboard/constraint-service.svelte";
import type { SelectionModel } from "$lib/whiteboard/selection.svelte";
import {
    SmartGestureController,
    type SmartGesture,
    type SmartGestureHost,
    type SmartSelectionTransform,
} from "$lib/whiteboard/smart-gestures.svelte";
import type { StyleModel, WhiteboardToolKind } from "$lib/whiteboard/style.svelte";
import {
    pathNodeFeature,
    pointFeaturePosition,
    type PointFeatureRef,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

/** The store-owned reactive view state and document access the controller drives. */
export interface InteractionHost extends SmartGestureHost {
    readonly document: WhiteboardDocument;
    readonly scene: Scene;
    applyDocument(next: WhiteboardDocument): void;

    readonly toolKind: WhiteboardToolKind;
    setTool(kind: WhiteboardToolKind): void;

    preview: Scene | null;
    snapProposal: { from: readonly [number, number]; to: readonly [number, number] } | null;
    lineContinuation: LineContinuation | null;
    arcGuide: ArcGuide | null;

    readonly tolerance: number;
    readonly penTapTolerance: number;
    readonly strokeProcessing: StrokeProcessingOptions;
    readonly sceneUnitsPerPixel: number;
    readonly promptLabel?: (at: readonly [number, number]) => string | null;
}

/**
 * The one gesture value. `tool` covers both "Pipeline A owns this gesture" and
 * "idle" — a stray move/up with no pointer-down goes to the tool state machine,
 * which is exactly what it did before. The Pipeline B arms are `SmartGesture`.
 */
type ActiveGesture = { kind: "tool" } | SmartGesture;

/** What the single pointer-down hit-test decided. */
type PointerRoute =
    | { pipeline: "tool" }
    | { pipeline: "transform"; gesture: SmartSelectionTransform; itemIds: string[] }
    | { pipeline: "translate"; itemIds: string[]; directMoveIds: string[] | null }
    | { pipeline: "drag-feature"; feature: PointFeatureRef; directMoveIds: string[] | null };

function documentSnapshot(document: WhiteboardDocument): WhiteboardDocument {
    return $state.snapshot(document) as WhiteboardDocument;
}

function pointOf(p: PointerInput): readonly [number, number] {
    return "point" in p ? p.point : p;
}

export class InteractionController {
    #host: InteractionHost;
    #selection: SelectionModel;
    #style: StyleModel;
    #constraints: ConstraintService;
    #smart: SmartGestureController;

    #tool: Tool = createTool("select");
    #gesture: ActiveGesture = { kind: "tool" };
    #suppressSnapCommit = false;

    constructor(
        host: InteractionHost,
        selection: SelectionModel,
        style: StyleModel,
        constraints: ConstraintService,
    ) {
        this.#host = host;
        this.#selection = selection;
        this.#style = style;
        this.#constraints = constraints;
        this.#smart = new SmartGestureController(host, constraints);
    }

    /** Cancel the in-flight gesture and swap the active tool (store `setTool`). */
    setTool(kind: WhiteboardToolKind): void {
        this.#tool.onCancel();
        this.#gesture = { kind: "tool" };
        if (kind !== "pan") this.#tool = createTool(kind);
    }

    // --- pointer plumbing (the view maps screen->asy before calling these) ----

    pointerDown(
        p: PointerInput,
        selectionTransform?: SelectionTransformGesture,
        suppressSnap = false,
        additiveFeatureSelection = false,
    ): void {
        const point = pointOf(p);
        const route = this.#routePointerDown(point, selectionTransform);
        switch (route.pipeline) {
            case "transform": {
                this.#beginSmartGesture({
                    kind: "transform",
                    base: documentSnapshot(this.#host.document),
                    start: point,
                    pointerOffset: route.gesture.kind === "resize"
                        ? [point[0] - route.gesture.handle[0], point[1] - route.gesture.handle[1]]
                        : [0, 0],
                    gesture: route.gesture,
                    itemIds: route.itemIds,
                });
                this.#constraints.selectedDimensionId = null;
                return;
            }
            case "translate": {
                if (route.directMoveIds) this.#selectForDirectMove(route.directMoveIds);
                this.#beginSmartGesture({
                    kind: "translate",
                    base: documentSnapshot(this.#host.document),
                    start: point,
                    itemIds: route.itemIds,
                });
                this.#constraints.selectedDimensionId = null;
                return;
            }
            case "drag-feature": {
                if (route.directMoveIds) this.#selectForDirectMove(route.directMoveIds);
                const at = pointFeaturePosition(this.#host.document, route.feature);
                if (!at) return;
                const gesture = this.#beginSmartGesture({
                    kind: "drag-feature",
                    base: documentSnapshot(this.#host.document),
                    feature: route.feature,
                    pointerOffset: [point[0] - at[0], point[1] - at[1]],
                    candidate: null,
                    seed: undefined,
                });
                this.#selection.selectFeature(route.feature, additiveFeatureSelection);
                if (!suppressSnap) this.#smart.preview(gesture, point, false, false);
                return;
            }
            case "tool": {
                this.#gesture = { kind: "tool" };
                this.#constraints.selectedConstraintId = null;
                this.#withSnapSuppressed(suppressSnap, () =>
                    this.#dispatch(this.#tool.onPointerDown(
                        this.#host.scene,
                        p,
                        this.#ctx({ selectionTransform }),
                    ))
                );
                return;
            }
        }
    }

    pointerMove(p: PointerInput, shiftKey = false, suppressSnap = false): void {
        const gesture = this.#gesture;
        if (gesture.kind !== "tool") {
            this.#smart.preview(gesture, pointOf(p), shiftKey, suppressSnap);
            return;
        }
        this.#withSnapSuppressed(suppressSnap, () =>
            this.#dispatch(this.#tool.onPointerMove(
                this.#host.scene,
                p,
                this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey }),
            ))
        );
    }

    pointerMoves(points: readonly PointerInput[], shiftKey = false, suppressSnap = false): void {
        if (points.length === 0) return;
        const gesture = this.#gesture;
        if (gesture.kind !== "tool") {
            this.#smart.preview(
                gesture,
                pointOf(points[points.length - 1]),
                shiftKey,
                suppressSnap,
            );
            return;
        }
        const ctx = this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey });
        const result = this.#tool.onPointerMoves
            ? this.#tool.onPointerMoves(this.#host.scene, points, ctx)
            : this.#tool.onPointerMove(this.#host.scene, points[points.length - 1], ctx);
        this.#withSnapSuppressed(suppressSnap, () => this.#dispatch(result));
    }

    pointerUp(
        p: PointerInput,
        shiftKey = false,
        pendingMoves: readonly PointerInput[] = [],
        suppressSnap = false,
    ): void {
        const gesture = this.#gesture;
        if (gesture.kind !== "tool") {
            this.#gesture = { kind: "tool" };
            this.#smart.commit(gesture, pointOf(p), shiftKey, suppressSnap);
            return;
        }
        this.#withSnapSuppressed(suppressSnap, () =>
            this.#dispatch(this.#tool.onPointerUp(
                this.#host.scene,
                p,
                this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey }),
                pendingMoves,
            ))
        );
    }

    cancel(): void {
        this.#gesture = { kind: "tool" };
        this.#host.snapProposal = null;
        this.#selection.clearFeatureSelection();
        this.#dispatch(this.#tool.onCancel());
    }

    // --- pipeline ownership (decided once, here) -------------------------------

    /**
     * The single ownership branch (ARCHITECTURE.md §3.1). One hit-test, one
     * decision; nothing downstream re-opens it.
     */
    #routePointerDown(
        point: readonly [number, number],
        selectionTransform?: SelectionTransformGesture,
    ): PointerRoute {
        const selection = this.#selection.selection;
        if (
            selectionTransform &&
            (selectionTransform.kind === "resize" || selectionTransform.kind === "rotate") &&
            selection.length > 0 &&
            this.#selection.selectionHasSmartItems(selection)
        ) {
            return { pipeline: "transform", gesture: selectionTransform, itemIds: [...selection] };
        }
        const directMoveIds =
            !selectionTransform && this.#host.toolKind === "select" && !this.#host.lineContinuation
                ? (() => {
                      const hit = hitTest(this.#host.scene, point, this.#host.tolerance);
                      if (!hit || hit.kind === "raw") return null;
                      return selection.includes(hit.id) ? [...selection] : [hit.id];
                  })()
                : null;
        const movingIds = selectionTransform?.kind === "move" ? [...selection] : directMoveIds;
        const feature = selectionTransform?.kind === "vertex"
            ? pathNodeFeature(this.#host.document, selectionTransform.elementId, selectionTransform.nodeIndex)
            : movingIds?.length === 1
              ? this.#selection.markerFeature(movingIds[0])
              : null;
        if (movingIds && !feature && this.#selection.selectionHasSmartItems(movingIds)) {
            return { pipeline: "translate", itemIds: movingIds, directMoveIds };
        }
        if (feature) return { pipeline: "drag-feature", feature, directMoveIds };
        return { pipeline: "tool" };
    }

    /** Shared Pipeline B entry: arm the gesture and freeze the current render. */
    #beginSmartGesture<T extends SmartGesture>(gesture: T): T {
        this.#gesture = gesture;
        this.#host.preview = this.#host.scene;
        this.#constraints.selectedConstraintId = null;
        return gesture;
    }

    #selectForDirectMove(itemIds: string[]): void {
        this.#selection.selection = itemIds;
        this.#selection.featureSelection = [];
        this.#constraints.selectedDimensionId = null;
    }

    // --- Pipeline A: the Tool state machine ------------------------------------

    #withSnapSuppressed(suppressSnap: boolean, run: () => void): void {
        this.#suppressSnapCommit = suppressSnap;
        try {
            run();
        } finally {
            this.#suppressSnapCommit = false;
        }
    }

    #ctx(
        overrides: Pick<
            ToolContext,
            "selectionTransform" | "snapRotation" | "lockAspectRatio"
        > = {},
    ): ToolContext {
        return {
            pen: $state.snapshot(this.#style.activePen(this.#host.toolKind)) as Pen,
            fillPen: this.#host.toolKind === "rectangle" && this.#style.rectangleFillEnabled
                ? ($state.snapshot(this.#style.rectangleFillPen) as Pen)
                : undefined,
            eraserRadius: this.#style.eraserSize,
            tolerance: this.#host.tolerance,
            penTapTolerance: this.#host.penTapTolerance,
            strokeProcessing: { ...this.#host.strokeProcessing },
            sceneUnitsPerPixel: this.#host.sceneUnitsPerPixel,
            selection: $state.snapshot(this.#selection.selection) as string[],
            lineContinuation: this.#host.lineContinuation
                ? ($state.snapshot(this.#host.lineContinuation) as LineContinuation)
                : null,
            promptLabel: this.#host.promptLabel,
            ...overrides,
        };
    }

    /** The gesture-scoped inputs `commit-lift.ts` needs (INVARIANTS §4). */
    #liftContext(): LiftContext {
        return {
            toolKind: this.#host.toolKind,
            sceneUnitsPerPixel: this.#host.sceneUnitsPerPixel,
            suppressSnap: this.#suppressSnapCommit,
        };
    }

    #dispatch(result: ToolResult): void {
        if (result.consoleMessage) console.info(result.consoleMessage);
        if (result.selection !== undefined) {
            this.#selection.selection = result.selection;
            this.#selection.featureSelection = [];
            this.#constraints.selectedDimensionId = null;
        }
        if (result.selectionPreview !== undefined) {
            this.#selection.selectionPreview = result.selectionPreview;
        }
        if (result.marquee !== undefined) this.#selection.marquee = result.marquee;
        if (result.lineContinuation !== undefined) {
            this.#host.lineContinuation = result.lineContinuation;
        }
        if (result.arcGuide !== undefined) this.#host.arcGuide = result.arcGuide;
        if (result.commit !== undefined) {
            // The ONLY site where a ToolCommit becomes a Document mutation.
            const lifted = liftCommit(this.#host.document, result.commit, this.#liftContext());
            if (lifted) this.#host.applyDocument(lifted);
            this.#host.preview = null;
            this.#host.snapProposal = null;
            this.#selection.selectionPreview = null;
            this.#selection.marquee = null;
            if (result.nextTool) {
                const continuation = result.lineContinuation;
                const committedSelection = result.selection;
                this.#host.setTool(result.nextTool);
                if (committedSelection !== undefined) this.#selection.selection = committedSelection;
                if (continuation !== undefined) this.#host.lineContinuation = continuation;
            }
        } else if (result.preview !== undefined) {
            const snapped = snapCreationPreview(
                this.#host.document,
                this.#host.scene,
                result.preview,
                this.#liftContext(),
            );
            if (snapped.snapProposal !== undefined) this.#host.snapProposal = snapped.snapProposal;
            this.#host.preview = snapped.scene;
        }
    }
}
