/**
 * InteractionController — pointer routing and the two-pipeline boundary
 * (ARCHITECTURE.md §3, §5).
 *
 * Ownership is decided **once, on pointer-down**, by a single hit-test
 * (`#routePointerDown`): a smart feature / smart selection takes Pipeline B
 * (`operations.ts` + the solver), everything else takes Pipeline A (the `Tool`
 * state machine). The chosen pipeline is stored as one explicit
 * `ActiveGesture` value, so `pointerMove` / `pointerUp` dispatch on a single
 * discriminant instead of re-probing parallel nullable fields — there is no
 * mid-gesture pipeline switch (INVARIANTS §3).
 *
 * Both pipelines converge on one write target: the Document. A tool's
 * `ToolCommit` becomes a Document transaction at exactly one place,
 * `#liftCommit`; no Scene is ever edited and folded back (INVARIANTS §4).
 * Previews are transient renders only.
 */

import type { Pen, Scene, SceneElement } from "$lib/asy/scene/types";
import {
    createTool,
    hitTest,
    type ArcGuide,
    type LineContinuation,
    type PointerInput,
    type SelectionTransformGesture,
    type StrokeProcessingOptions,
    type Tool,
    type ToolCommit,
    type ToolContext,
    type ToolResult,
} from "$lib/asy/engine";
import type { ConstraintService } from "$lib/whiteboard/constraint-service.svelte";
import type { SelectionModel } from "$lib/whiteboard/selection.svelte";
import type { StyleModel, WhiteboardToolKind } from "$lib/whiteboard/style.svelte";
import {
    addCoincidentConstraint,
    appendSmartPathNode,
    closeSmartPath,
    createSmartPath,
    createSmartPointMarker,
    deleteWhiteboardItems,
    nearestPointFeature,
    pathNodeFeature,
    pointFeaturePointId,
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

/** The store-owned reactive view state and document access the controller drives. */
export interface InteractionHost {
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

type SmartSelectionTransform = Extract<
    SelectionTransformGesture,
    { kind: "resize" } | { kind: "rotate" }
>;

/**
 * The one gesture value. `tool` covers both "Pipeline A owns this gesture" and
 * "idle" — a stray move/up with no pointer-down goes to the tool state machine,
 * which is exactly what it did before.
 */
type ActiveGesture =
    | { kind: "tool" }
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
                this.#beginSmartGesture({
                    kind: "drag-feature",
                    base: documentSnapshot(this.#host.document),
                    feature: route.feature,
                    pointerOffset: [point[0] - at[0], point[1] - at[1]],
                    candidate: null,
                    seed: undefined,
                });
                this.#selection.selectFeature(route.feature, additiveFeatureSelection);
                if (!suppressSnap) this.#previewSmartDrag(point, false);
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
        if (this.#gesture.kind !== "tool") {
            this.#previewSmartGesture(pointOf(p), shiftKey, suppressSnap);
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
        if (this.#gesture.kind !== "tool") {
            this.#previewSmartGesture(pointOf(points[points.length - 1]), shiftKey, suppressSnap);
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
            this.#commitSmartGesture(gesture, pointOf(p), shiftKey, suppressSnap);
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
    #beginSmartGesture(gesture: Exclude<ActiveGesture, { kind: "tool" }>): void {
        this.#gesture = gesture;
        this.#host.preview = this.#host.scene;
        this.#constraints.selectedConstraintId = null;
    }

    #previewSmartGesture(
        point: readonly [number, number],
        shiftKey: boolean,
        suppressSnap: boolean,
    ): void {
        switch (this.#gesture.kind) {
            case "transform":
                return this.#previewSmartTransform(this.#gesture, point, shiftKey);
            case "translate":
                return this.#previewSmartTranslation(this.#gesture, point);
            case "drag-feature":
                return this.#previewSmartDrag(point, suppressSnap);
            case "tool":
                return;
        }
    }

    #commitSmartGesture(
        gesture: Exclude<ActiveGesture, { kind: "tool" }>,
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

    #selectForDirectMove(itemIds: string[]): void {
        this.#selection.selection = itemIds;
        this.#selection.featureSelection = [];
        this.#constraints.selectedDimensionId = null;
    }

    // --- Pipeline B: translate -------------------------------------------------

    #translationResult(
        gesture: Extract<ActiveGesture, { kind: "translate" }>,
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
        gesture: Extract<ActiveGesture, { kind: "translate" }>,
        point: readonly [number, number],
    ): void {
        const result = this.#translationResult(gesture, point, "preview");
        this.#host.preview = result.document
            ? resolveWhiteboardDocument(result.document)
            : this.#host.scene;
        this.#constraints.recordSolverResult(result);
    }

    #commitSmartTranslation(
        gesture: Extract<ActiveGesture, { kind: "translate" }>,
        point: readonly [number, number],
    ): void {
        const result = this.#translationResult(gesture, point, "commit");
        this.#host.preview = null;
        this.#constraints.recordSolverResult(result);
        if (result.document && JSON.stringify(result.document) !== JSON.stringify(gesture.base)) {
            this.#host.applyDocument(result.document);
        }
    }

    // --- Pipeline B: resize / rotate -------------------------------------------

    #smartTransformResult(
        transform: Extract<ActiveGesture, { kind: "transform" }>,
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
        transform: Extract<ActiveGesture, { kind: "transform" }>,
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
        transform: Extract<ActiveGesture, { kind: "transform" }>,
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

    // --- Pipeline B: drag a smart feature --------------------------------------

    #smartDragCandidate(
        drag: Extract<ActiveGesture, { kind: "drag-feature" }>,
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

    #previewSmartDrag(point: readonly [number, number], suppressSnap: boolean): void {
        const drag = this.#gesture;
        if (drag.kind !== "drag-feature") return;
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
        drag: Extract<ActiveGesture, { kind: "drag-feature" }>,
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
            const lifted = this.#liftCommit(result.commit);
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
            this.#host.preview = this.#snapCreationPreview(result.preview);
        }
    }

    /**
     * Lift a committed tool gesture to ONE Document transaction at the pipeline
     * edge. No Scene is ever treated as authoritative and folded back
     * (ARCHITECTURE.md §4): the tool describes *what it changed* and this maps
     * that intent to a document mutation. Creation with the line/rectangle/point
     * tools is lifted to smart sketch items (with snap-inferred coincidence);
     * every other creation, deletion, and baked transform stays baked.
     */
    #liftCommit(commit: ToolCommit): WhiteboardDocument | null {
        const document = this.#host.document;
        switch (commit.kind) {
            case "add":
                return this.#liftAdd(commit.elements);
            case "replace":
                return this.replaceBakedElements(commit.elements);
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
                return this.#conjoinCreatedFeature(appended.document, appended.feature, document);
            }
            case "close-path":
                return closeSmartPath(document, commit.elementId);
        }
    }

    #liftAdd(elements: readonly SceneElement[]): WhiteboardDocument | null {
        const document = this.#host.document;
        const added = elements[0];
        if (this.#host.toolKind === "line" && added?.kind === "path") {
            const created = createSmartPath(
                document,
                [...added.path.nodes],
                false,
                added.pen,
                added.fillPen,
                added.id,
            );
            return this.#conjoinCreatedFeatures(created.document, created.endpointFeatures, document);
        }
        if (this.#host.toolKind === "rectangle" && added?.kind === "path") {
            const rawStart = added.path.nodes[0];
            const rawEnd = added.path.nodes[2];
            if (!rawStart || !rawEnd) return this.#appendBaked(elements);
            const snappedStart = this.#suppressSnapCommit
                ? rawStart
                : nearestPointFeature(document, rawStart, 8 * this.#host.sceneUnitsPerPixel)?.at ?? rawStart;
            const snappedEnd = this.#suppressSnapCommit
                ? rawEnd
                : nearestPointFeature(document, rawEnd, 8 * this.#host.sceneUnitsPerPixel)?.at ?? rawEnd;
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
            return this.#conjoinCreatedFeatures(
                created.document,
                [created.endpointFeatures[0], created.endpointFeatures[2]].filter(
                    (feature): feature is PointFeatureRef => feature !== undefined,
                ),
                document,
            );
        }
        if (this.#host.toolKind === "point" && added?.kind === "dot") {
            const created = createSmartPointMarker(document, added.at, added.pen, added.id);
            return this.#conjoinCreatedFeatures(created.document, created.endpointFeatures, document);
        }
        return this.#appendBaked(elements);
    }

    /** Append raw geometry as baked items (pen · arc · label · imported ink). */
    #appendBaked(elements: readonly SceneElement[]): WhiteboardDocument {
        const document = this.#host.document;
        return {
            ...document,
            items: [
                ...document.items,
                ...elements.map((element) => ({ kind: "baked" as const, element })),
            ],
        };
    }

    /**
     * Re-emit transformed baked elements in place, matched by id. Smart items
     * are intercepted upstream by Pipeline B, so they are never present in a
     * tool `replace` and are left untouched even if an id somehow collides.
     * Public because baked vertex deletion (store `deletePathVertex`) is the
     * same edit arriving from the inspector rather than from a tool.
     */
    replaceBakedElements(elements: readonly SceneElement[]): WhiteboardDocument {
        const document = this.#host.document;
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

    #conjoinCreatedFeatures(
        document: WhiteboardDocument,
        features: readonly PointFeatureRef[],
        candidateSource: WhiteboardDocument,
    ): WhiteboardDocument {
        return features.reduce(
            (current, feature) => this.#conjoinCreatedFeature(current, feature, candidateSource),
            document,
        );
    }

    #conjoinCreatedFeature(
        document: WhiteboardDocument,
        feature: PointFeatureRef,
        candidateSource: WhiteboardDocument,
    ): WhiteboardDocument {
        if (this.#suppressSnapCommit) return document;
        const at = pointFeaturePosition(document, feature);
        if (!at) return document;
        const candidate = nearestPointFeature(
            candidateSource,
            at,
            8 * this.#host.sceneUnitsPerPixel,
        );
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

    #snapCreationPreview(scene: Scene | null): Scene | null {
        const toolKind = this.#host.toolKind;
        if (!scene || (toolKind !== "line" && toolKind !== "rectangle" && toolKind !== "point")) {
            this.#host.snapProposal = null;
            return scene;
        }
        const currentIds = this.#host.scene.elements.map(({ id }) => id);
        const added = scene.elements.findLast((element) => !currentIds.includes(element.id));
        if (!added) return scene;
        const at = added.kind === "dot"
            ? added.at
            : added.kind === "path"
              ? added.path.nodes[toolKind === "rectangle" ? 2 : added.path.nodes.length - 1]
              : undefined;
        if (!at) {
            this.#host.snapProposal = null;
            return scene;
        }
        const candidate = nearestPointFeature(
            this.#host.document,
            at,
            8 * this.#host.sceneUnitsPerPixel,
        );
        if (!candidate) {
            this.#host.snapProposal = null;
            return scene;
        }
        const addedId = added.id;
        this.#host.snapProposal = { from: at, to: candidate.at };
        return {
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
        };
    }
}
