/**
 * Per-instance whiteboard store (like `LibraryStore`, not a global singleton):
 * a whiteboard is a scoped document editor and there may be more than one open
 * at once (e.g. a scratch overlay plus a "trace this diagram" board).
 *
 * It bridges the three pure-TS layers to the Svelte view:
 *   - `toolKind` and transient view state (preview/guides/snap) are reactive
 *     `$state`; item/feature/marquee selection delegates to SelectionModel
 *     (`$lib/whiteboard/selection.svelte`) and is exposed via getters/setters
 *   - the document, its snapshot history, undo/redo, and the Scene projection
 *     delegate to DocumentController (`$lib/whiteboard/document-controller.svelte`);
 *     the store exposes `document` / `scene` / `canUndo` / `canRedo` via getters
 *     and only resets its own view state after an undo/redo jumps the document
 *   - edits flow through the engine tools and are recorded in snapshot history
 *   - pen/tool defaults, inspector properties, and property edits delegate to
 *     StyleModel (`$lib/whiteboard/style.svelte`)
 *   - relations, dimensions, and solver invocation delegate to ConstraintService
 *     (`$lib/whiteboard/constraint-service.svelte`)
 *   - `toAsy` / `loadAsy` / `persist` / `restore` delegate to PersistenceIO
 *     (`$lib/whiteboard/persistence`); the store keeps only the reactive glue.
 *
 * SSR caveat (per repo conventions): never mutate at module load; the
 * `browser`-guard for localStorage lives in PersistenceIO.
 */

import type { Pen, Scene } from "$lib/asy/scene/types";
import { isStraightPathVertexEditable } from "$lib/asy/scene";
import type {
    EditorPropertyId,
    EditorPropertyValue,
    ResolvedEditorProperty,
} from "$lib/asy/editor-properties";
import {
    documentToAsy,
    persistDocument,
    restoreDocument,
    sceneFromAsy,
} from "$lib/whiteboard/persistence";
import { DocumentController } from "$lib/whiteboard/document-controller.svelte";
import { SelectionModel, type Marquee } from "$lib/whiteboard/selection.svelte";
import { StyleModel, type WhiteboardToolKind } from "$lib/whiteboard/style.svelte";
import {
    ConstraintService,
    type ConstraintGlyph,
    type DimensionGlyph,
} from "$lib/whiteboard/constraint-service.svelte";
import {
    createTool,
    hitTest,
    type Tool,
    type ToolContext,
    type ToolResult,
    type SelectionTransformGesture,
    type LineContinuation,
    type ArcGuide,
    DEFAULT_STROKE_PROCESSING_OPTIONS,
    type StrokeProcessingOptions,
    type PointerInput,
} from "$lib/asy/engine";
import {
    emptyWhiteboardDocument,
    addCoincidentConstraint,
    appendSmartPathNode,
    closeSmartPath,
    createSmartPath,
    createSmartPointMarker,
    deleteWhiteboardItems,
    migrateSceneToWhiteboardDocument,
    nearestPointFeature,
    pathNodeFeature,
    pointFeaturePointId,
    pointFeaturePosition,
    reconcileResolvedScene,
    resolveWhiteboardDocument,
    rotateWhiteboardItems,
    scaleWhiteboardItems,
    translateWhiteboardItems,
    type FeatureRef,
    type GeometryOperationResult,
    type RelationKind,
    type PointFeatureRef,
    type SnapRelationProposal,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

function documentSnapshot(document: WhiteboardDocument): WhiteboardDocument {
    return $state.snapshot(document) as WhiteboardDocument;
}

export type { WhiteboardToolKind };

type SmartSelectionTransform = Extract<SelectionTransformGesture, { kind: "resize" } | { kind: "rotate" }>;

export class WhiteboardStore {
    toolKind = $state<WhiteboardToolKind>("select");
    /** Transient render override during a drag (rubber-band / live move). */
    preview = $state<Scene | null>(null);
    /** Active path continuation offered immediately after a line is drawn. */
    lineContinuation = $state<LineContinuation | null>(null);
    /** Transient construction guide for the active arc tool. */
    arcGuide = $state<ArcGuide | null>(null);
    /** Visible inference feedback; never persisted or exported. */
    snapProposal = $state<{ from: readonly [number, number]; to: readonly [number, number] } | null>(null);
    /** Hit-test / commit tolerance in asy-space; the view keeps this in sync
     *  with its current px->asy scale. */
    tolerance = 0.5;
    /** Pen travel that still counts as a tap; the view derives it from 2 CSS px. */
    penTapTolerance = 0.05;
    /** Freehand cleanup controls. The view keeps distance values in sync with
     *  its current px->scene scale; scalar values remain framework defaults. */
    strokeProcessing: StrokeProcessingOptions = { ...DEFAULT_STROKE_PROCESSING_OPTIONS };
    /** Scene-space distance represented by one CSS pixel at the active zoom. */
    sceneUnitsPerPixel = 1 / 40;
    /** Supplied by the view so the label tool can prompt for text. */
    promptLabel?: (at: readonly [number, number]) => string | null;

    #documents = new DocumentController();
    #tool: Tool = createTool("select");
    #selection: SelectionModel;
    #style: StyleModel;
    #constraints: ConstraintService;
    #smartDrag: {
        base: WhiteboardDocument;
        feature: PointFeatureRef;
        pointerOffset: readonly [number, number];
        candidate: SnapRelationProposal | null;
        seed?: Readonly<Record<string, readonly [number, number]>>;
    } | null = null;
    #smartTranslation: {
        base: WhiteboardDocument;
        start: readonly [number, number];
        itemIds: string[];
    } | null = null;
    #smartTransform: {
        base: WhiteboardDocument;
        start: readonly [number, number];
        pointerOffset: readonly [number, number];
        gesture: SmartSelectionTransform;
        itemIds: string[];
    } | null = null;
    #suppressSnapCommit = false;

    constructor(initial?: Scene | WhiteboardDocument) {
        if (initial) {
            this.document = "schemaVersion" in initial
                ? initial
                : migrateSceneToWhiteboardDocument(initial);
        }
        const self = this;
        this.#selection = new SelectionModel({
            get document() {
                return self.document;
            },
            get sceneUnitsPerPixel() {
                return self.sceneUnitsPerPixel;
            },
            clearConstraintSelection() {
                self.#constraints.clearConstraintSelection();
            },
            clearDimensionSelection() {
                self.#constraints.clearDimensionSelection();
            },
            clearSolverFeedback() {
                self.#constraints.clearSolverFeedback();
            },
        });
        this.#constraints = new ConstraintService({
            get document() {
                return self.document;
            },
            get featureSelection() {
                return self.featureSelection;
            },
            get selection() {
                return self.selection;
            },
            set selection(next) {
                self.selection = next;
            },
            applyDocument: (next) => self.applyDocument(next),
        });
        this.#style = new StyleModel({
            get toolKind() {
                return self.toolKind;
            },
            get selection() {
                return self.selection;
            },
            get scene() {
                return self.scene;
            },
            get document() {
                return self.document;
            },
            set document(next) {
                self.document = next;
            },
            applyDocument: (next) => self.applyDocument(next),
            pushBaseline: (baseline) => self.#documents.pushBaseline(baseline),
        });
    }

    /** The editable source of truth (owned by DocumentController). */
    get document(): WhiteboardDocument {
        return this.#documents.document;
    }
    set document(next: WhiteboardDocument) {
        this.#documents.document = next;
    }

    // Selection state lives in SelectionModel; these forward so tool/interaction
    // code (and the view) keep reading/writing `store.selection` etc. unchanged.
    get selection(): string[] {
        return this.#selection.selection;
    }
    set selection(next: string[]) {
        this.#selection.selection = next;
    }
    get selectionPreview(): string[] | null {
        return this.#selection.selectionPreview;
    }
    set selectionPreview(next: string[] | null) {
        this.#selection.selectionPreview = next;
    }
    get marquee(): Marquee | null {
        return this.#selection.marquee;
    }
    set marquee(next: Marquee | null) {
        this.#selection.marquee = next;
    }
    get featureSelection(): FeatureRef[] {
        return this.#selection.featureSelection;
    }
    set featureSelection(next: FeatureRef[]) {
        this.#selection.featureSelection = next;
    }

    // Constraint/dimension selection and solver feedback stay reactive inside
    // ConstraintService; the public store surface remains unchanged.
    get selectedConstraintId(): string | null {
        return this.#constraints.selectedConstraintId;
    }
    set selectedConstraintId(next: string | null) {
        this.#constraints.selectedConstraintId = next;
    }
    get selectedDimensionId(): string | null {
        return this.#constraints.selectedDimensionId;
    }
    set selectedDimensionId(next: string | null) {
        this.#constraints.selectedDimensionId = next;
    }
    get solverDiagnostic(): string | null {
        return this.#constraints.solverDiagnostic;
    }
    set solverDiagnostic(next: string | null) {
        this.#constraints.solverDiagnostic = next;
    }
    get conflictingConstraintIds(): string[] {
        return this.#constraints.conflictingConstraintIds;
    }
    set conflictingConstraintIds(next: string[]) {
        this.#constraints.conflictingConstraintIds = next;
    }

    /** Undo/redo availability, reflected by the command card (owned by DocumentController). */
    get canUndo(): boolean {
        return this.#documents.canUndo;
    }
    get canRedo(): boolean {
        return this.#documents.canRedo;
    }

    /** Concrete compatibility IR for tools, rendering, hit-testing, and export. */
    get scene(): Scene {
        return this.#documents.scene;
    }

    /** The scene the view should render (preview wins while dragging). */
    get displayScene(): Scene {
        return this.preview ?? this.scene;
    }

    /** Compatibility facade for callers that previously read/wrote one shared pen. */
    get pen(): Pen {
        return this.#style.pen;
    }

    set pen(value: Pen) {
        this.#style.pen = value;
    }

    /** Stroke color the toolbar swatch reflects (owned by StyleModel). */
    get strokeColor(): string {
        return this.#style.strokeColor;
    }

    /** Eraser radius the view cursor mirrors (owned by StyleModel). */
    get eraserSize(): number {
        return this.#style.eraserSize;
    }

    get inspectorTitle(): string {
        if (this.selection.length > 1) return `${this.selection.length} objects`;
        if (this.selection.length === 1) {
            const element = this.scene.elements.find(({ id }) => id === this.selection[0]);
            if (element) return element.kind === "fill" ? "Filled path" : element.kind.replaceAll("-", " ");
        }
        return this.toolKind === "pan" ? "Pan" : this.toolKind[0].toUpperCase() + this.toolKind.slice(1);
    }

    get inspectorProperties(): ResolvedEditorProperty[] {
        return this.#style.inspectorProperties;
    }

    setTool(kind: WhiteboardToolKind): void {
        const changed = kind !== this.toolKind;
        this.commitPropertyEdit();
        this.#tool.onCancel();
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
        this.snapProposal = null;
        this.selectedConstraintId = null;
        this.selectedDimensionId = null;
        this.featureSelection = [];
        if (changed) this.selection = [];
        this.toolKind = kind;
        if (kind !== "pan") this.#tool = createTool(kind);
    }

    // --- pointer plumbing (the view maps screen->asy before calling these) ----

    pointerDown(
        p: PointerInput,
        selectionTransform?: SelectionTransformGesture,
        suppressSnap = false,
        additiveFeatureSelection = false,
    ): void {
        const point = "point" in p ? p.point : p;
        if (
            selectionTransform &&
            (selectionTransform.kind === "resize" || selectionTransform.kind === "rotate") &&
            this.selection.length > 0 &&
            this.#selection.selectionHasSmartItems(this.selection)
        ) {
            this.#smartTransform = {
                base: documentSnapshot(this.document),
                start: point,
                pointerOffset: selectionTransform.kind === "resize"
                    ? [point[0] - selectionTransform.handle[0], point[1] - selectionTransform.handle[1]]
                    : [0, 0],
                gesture: selectionTransform,
                itemIds: [...this.selection],
            };
            this.preview = this.scene;
            this.selectedConstraintId = null;
            this.selectedDimensionId = null;
            return;
        }
        const directMoveIds = !selectionTransform && this.toolKind === "select" && !this.lineContinuation
            ? (() => {
                  const hit = hitTest(this.scene, point, this.tolerance);
                  if (!hit || hit.kind === "raw") return null;
                  return this.selection.includes(hit.id) ? [...this.selection] : [hit.id];
              })()
            : null;
        const movingIds = selectionTransform?.kind === "move"
            ? [...this.selection]
            : directMoveIds;
        const smartFeature = selectionTransform?.kind === "vertex"
            ? pathNodeFeature(this.document, selectionTransform.elementId, selectionTransform.nodeIndex)
            : movingIds?.length === 1
              ? this.#selection.markerFeature(movingIds[0])
              : null;
        if (movingIds && !smartFeature && this.#selection.selectionHasSmartItems(movingIds)) {
            if (directMoveIds) this.#selectForDirectMove(directMoveIds);
            this.#smartTranslation = {
                base: documentSnapshot(this.document),
                start: point,
                itemIds: movingIds,
            };
            this.preview = this.scene;
            this.selectedConstraintId = null;
            this.selectedDimensionId = null;
            return;
        }
        if (smartFeature) {
            if (directMoveIds) this.#selectForDirectMove(directMoveIds);
            const at = pointFeaturePosition(this.document, smartFeature);
            if (!at) return;
            this.#smartDrag = {
                base: documentSnapshot(this.document),
                feature: smartFeature,
                pointerOffset: [point[0] - at[0], point[1] - at[1]],
                candidate: null,
                seed: undefined,
            };
            this.preview = this.scene;
            this.selectedConstraintId = null;
            this.selectFeature(smartFeature, additiveFeatureSelection);
            if (!suppressSnap) this.#previewSmartDrag(point, false);
            return;
        }
        this.selectedConstraintId = null;
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(this.#tool.onPointerDown(this.scene, p, this.#ctx({ selectionTransform })));
        this.#suppressSnapCommit = false;
    }
    pointerMove(p: PointerInput, shiftKey = false, suppressSnap = false): void {
        if (this.#smartTransform) {
            this.#previewSmartTransform("point" in p ? p.point : p, shiftKey);
            return;
        }
        if (this.#smartTranslation) {
            this.#previewSmartTranslation("point" in p ? p.point : p);
            return;
        }
        if (this.#smartDrag) {
            this.#previewSmartDrag("point" in p ? p.point : p, suppressSnap);
            return;
        }
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(this.#tool.onPointerMove(
            this.scene,
            p,
            this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey }),
        ));
        this.#suppressSnapCommit = false;
    }
    pointerMoves(points: readonly PointerInput[], shiftKey = false, suppressSnap = false): void {
        if (points.length === 0) return;
        if (this.#smartTransform) {
            const last = points[points.length - 1];
            this.#previewSmartTransform("point" in last ? last.point : last, shiftKey);
            return;
        }
        if (this.#smartTranslation) {
            const last = points[points.length - 1];
            this.#previewSmartTranslation("point" in last ? last.point : last);
            return;
        }
        if (this.#smartDrag) {
            const last = points[points.length - 1];
            this.#previewSmartDrag("point" in last ? last.point : last, suppressSnap);
            return;
        }
        const ctx = this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey });
        const result = this.#tool.onPointerMoves
            ? this.#tool.onPointerMoves(this.scene, points, ctx)
            : this.#tool.onPointerMove(this.scene, points[points.length - 1], ctx);
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(result);
        this.#suppressSnapCommit = false;
    }
    pointerUp(
        p: PointerInput,
        shiftKey = false,
        pendingMoves: readonly PointerInput[] = [],
        suppressSnap = false,
    ): void {
        if (this.#smartTransform) {
            this.#commitSmartTransform("point" in p ? p.point : p, shiftKey);
            return;
        }
        if (this.#smartTranslation) {
            this.#commitSmartTranslation("point" in p ? p.point : p);
            return;
        }
        if (this.#smartDrag) {
            this.#commitSmartDrag("point" in p ? p.point : p, suppressSnap);
            return;
        }
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(this.#tool.onPointerUp(
            this.scene,
            p,
            this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey }),
            pendingMoves,
        ));
        this.#suppressSnapCommit = false;
    }
    cancel(): void {
        this.#smartDrag = null;
        this.#smartTranslation = null;
        this.#smartTransform = null;
        this.snapProposal = null;
        this.clearFeatureSelection();
        this.#dispatch(this.#tool.onCancel());
    }

    clearFeatureSelection(): void {
        this.#selection.clearFeatureSelection();
    }

    get selectionContainsSmartItems(): boolean {
        return this.#selection.containsSmartItems;
    }

    #selectForDirectMove(itemIds: string[]): void {
        this.selection = itemIds;
        this.featureSelection = [];
        this.selectedDimensionId = null;
    }

    #translationDelta(point: readonly [number, number]): readonly [number, number] {
        return this.#smartTranslation
            ? [point[0] - this.#smartTranslation.start[0], point[1] - this.#smartTranslation.start[1]]
            : [0, 0];
    }

    #previewSmartTranslation(point: readonly [number, number]): void {
        if (!this.#smartTranslation) return;
        const result = translateWhiteboardItems(
            this.#smartTranslation.base,
            this.#smartTranslation.itemIds,
            this.#translationDelta(point),
            "preview",
        );
        this.preview = result.document ? resolveWhiteboardDocument(result.document) : this.scene;
        this.#constraints.recordSolverResult(result);
    }

    #commitSmartTranslation(point: readonly [number, number]): void {
        if (!this.#smartTranslation) return;
        const drag = this.#smartTranslation;
        const result = translateWhiteboardItems(
            drag.base,
            drag.itemIds,
            this.#translationDelta(point),
            "commit",
        );
        this.#smartTranslation = null;
        this.preview = null;
        this.#constraints.recordSolverResult(result);
        if (result.document && JSON.stringify(result.document) !== JSON.stringify(drag.base)) {
            this.applyDocument(result.document);
        }
    }

    #smartTransformResult(
        point: readonly [number, number],
        snapRotation: boolean,
        mode: "preview" | "commit",
    ): GeometryOperationResult {
        const transform = this.#smartTransform;
        if (!transform) {
            return { status: "failed", conflictingConstraintIds: [], diagnostic: "no smart transform is active" };
        }
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

    #previewSmartTransform(point: readonly [number, number], snapRotation: boolean): void {
        const result = this.#smartTransformResult(point, snapRotation, "preview");
        this.#constraints.recordSolverResult(result);
        this.preview = result.document ? resolveWhiteboardDocument(result.document) : this.scene;
    }

    #commitSmartTransform(point: readonly [number, number], snapRotation: boolean): void {
        const transform = this.#smartTransform;
        if (!transform) return;
        const result = this.#smartTransformResult(point, snapRotation, "commit");
        this.#smartTransform = null;
        this.preview = null;
        this.#constraints.recordSolverResult(result);
        if (result.document && JSON.stringify(result.document) !== JSON.stringify(transform.base)) {
            this.applyDocument(result.document);
        } else if (result.diagnostic) console.info(`[Whiteboard] ${result.diagnostic}`);
    }

    #smartDragTarget(point: readonly [number, number]): readonly [number, number] {
        if (!this.#smartDrag) return point;
        return [
            point[0] - this.#smartDrag.pointerOffset[0],
            point[1] - this.#smartDrag.pointerOffset[1],
        ];
    }

    #smartDragCandidate(
        target: readonly [number, number],
        suppressSnap: boolean,
    ): SnapRelationProposal | null {
        if (!this.#smartDrag || suppressSnap) return null;
        const acquired = this.#smartDrag.candidate;
        const acquiredAt = acquired
            ? pointFeaturePosition(this.#smartDrag.base, acquired.target)
            : null;
        if (
            acquired && acquiredAt &&
            Math.hypot(acquiredAt[0] - target[0], acquiredAt[1] - target[1]) <=
                12 * this.sceneUnitsPerPixel
        ) {
            return { ...acquired, from: target, to: acquiredAt };
        }
        const candidate = nearestPointFeature(
            this.#smartDrag.base,
            target,
            8 * this.sceneUnitsPerPixel,
            this.#smartDrag.feature,
        );
        return candidate ? {
            source: this.#smartDrag.feature,
            target: candidate.ref,
            from: target,
            to: candidate.at,
        } : null;
    }

    #previewSmartDrag(point: readonly [number, number], suppressSnap: boolean): void {
        if (!this.#smartDrag) return;
        const rawTarget = this.#smartDragTarget(point);
        const candidate = this.#smartDragCandidate(rawTarget, suppressSnap);
        this.#smartDrag.candidate = candidate;
        const target = candidate?.to ?? rawTarget;
        const solved = this.#constraints.solveDocument(this.#smartDrag.base, {
            affected: [this.#smartDrag.feature],
            drivers: [{ feature: this.#smartDrag.feature, target }],
            ...(this.#smartDrag.seed ? { initialPoints: this.#smartDrag.seed } : {}),
            mode: "preview",
        });
        if (solved.document) this.#smartDrag.seed = solved.pointUpdates;
        this.preview = solved.document ? resolveWhiteboardDocument(solved.document) : this.scene;
        this.snapProposal = candidate ? { from: rawTarget, to: candidate.to } : null;
    }

    #commitSmartDrag(point: readonly [number, number], suppressSnap: boolean): void {
        if (!this.#smartDrag) return;
        const drag = this.#smartDrag;
        const rawTarget = this.#smartDragTarget(point);
        const candidate = this.#smartDragCandidate(rawTarget, suppressSnap);
        const solved = this.#constraints.solveDocument(drag.base, {
            affected: [drag.feature],
            drivers: [{ feature: drag.feature, target: candidate?.to ?? rawTarget }],
            ...(drag.seed ? { initialPoints: drag.seed } : {}),
            mode: "commit",
        });
        this.#smartDrag = null;
        this.preview = null;
        this.snapProposal = null;
        if (!solved.document) {
            if (solved.diagnostic) console.info(`[Whiteboard] ${solved.diagnostic}`);
            return;
        }
        const committed = candidate
            ? this.#constraints.addCoincident(solved.document, drag.feature, candidate.target, "inferred")
            : solved.document;
        if (committed && JSON.stringify(committed) !== JSON.stringify(drag.base)) this.applyDocument(committed);
    }

    #ctx(
        overrides: Pick<
            ToolContext,
            "selectionTransform" | "snapRotation" | "lockAspectRatio"
        > = {},
    ): ToolContext {
        return {
            pen: $state.snapshot(this.#style.activePen(this.toolKind)) as Pen,
            fillPen: this.toolKind === "rectangle" && this.#style.rectangleFillEnabled
                ? ($state.snapshot(this.#style.rectangleFillPen) as Pen)
                : undefined,
            eraserRadius: this.#style.eraserSize,
            tolerance: this.tolerance,
            penTapTolerance: this.penTapTolerance,
            strokeProcessing: { ...this.strokeProcessing },
            sceneUnitsPerPixel: this.sceneUnitsPerPixel,
            selection: $state.snapshot(this.selection) as string[],
            lineContinuation: this.lineContinuation
                ? ($state.snapshot(this.lineContinuation) as LineContinuation)
                : null,
            promptLabel: this.promptLabel,
            ...overrides,
        };
    }

    #dispatch(result: ToolResult): void {
        const priorContinuation = this.lineContinuation;
        if (result.consoleMessage) console.info(result.consoleMessage);
        if (result.selection !== undefined) {
            this.selection = result.selection;
            this.featureSelection = [];
            this.selectedDimensionId = null;
        }
        if (result.selectionPreview !== undefined) this.selectionPreview = result.selectionPreview;
        if (result.marquee !== undefined) this.marquee = result.marquee;
        if (result.lineContinuation !== undefined) {
            this.lineContinuation = result.lineContinuation;
        }
        if (result.arcGuide !== undefined) this.arcGuide = result.arcGuide;
        if (result.commit !== undefined) {
            const smartCommit = this.#smartToolCommit(result.commit, priorContinuation);
            if (smartCommit) this.applyDocument(smartCommit);
            else this.apply(result.commit);
            this.preview = null;
            this.snapProposal = null;
            this.selectionPreview = null;
            this.marquee = null;
            if (result.nextTool) {
                const continuation = result.lineContinuation;
                const committedSelection = result.selection;
                this.setTool(result.nextTool);
                if (committedSelection !== undefined) this.selection = committedSelection;
                if (continuation !== undefined) this.lineContinuation = continuation;
            }
        } else if (result.preview !== undefined) {
            this.preview = this.#snapCreationPreview(result.preview);
        }
    }

    #smartToolCommit(scene: Scene, priorContinuation: LineContinuation | null): WhiteboardDocument | null {
        if (this.toolKind === "select" && priorContinuation) {
            const item = this.document.items.find((candidate) =>
                candidate.kind === "sketch-path" && candidate.id === priorContinuation.elementId
            );
            if (item?.kind === "sketch-path") {
                const committedPath = scene.elements.find((element) =>
                    element.id === item.id && element.kind === "path"
                );
                if (committedPath?.kind !== "path") return null;
                if (committedPath.path.cyclic && !item.cyclic) {
                    return closeSmartPath(this.document, item.id);
                }
                if (committedPath.path.nodes.length === item.uses.length + 2) {
                    const at = committedPath.path.nodes.at(-1)!;
                    const appended = appendSmartPathNode(this.document, item.id, at);
                    return this.#conjoinCreatedFeature(appended.document, appended.feature, this.document);
                }
            }
        }

        const currentIds = this.scene.elements.map(({ id }) => id);
        const added = scene.elements.find((element) => !currentIds.includes(element.id));
        if (this.toolKind === "line" && added?.kind === "path") {
            const created = createSmartPath(
                this.document,
                added.path.nodes,
                false,
                added.pen,
                added.fillPen,
                added.id,
            );
            return this.#conjoinCreatedFeatures(created.document, created.endpointFeatures, this.document);
        }
        if (this.toolKind === "rectangle" && added?.kind === "path") {
            const rawStart = added.path.nodes[0];
            const rawEnd = added.path.nodes[2];
            if (!rawStart || !rawEnd) return null;
            const snappedStart = this.#suppressSnapCommit
                ? rawStart
                : nearestPointFeature(this.document, rawStart, 8 * this.sceneUnitsPerPixel)?.at ?? rawStart;
            const snappedEnd = this.#suppressSnapCommit
                ? rawEnd
                : nearestPointFeature(this.document, rawEnd, 8 * this.sceneUnitsPerPixel)?.at ?? rawEnd;
            const created = createSmartPath(
                this.document,
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
                this.document,
            );
        }
        if (this.toolKind === "point" && added?.kind === "dot") {
            const created = createSmartPointMarker(this.document, added.at, added.pen, added.id);
            return this.#conjoinCreatedFeatures(created.document, created.endpointFeatures, this.document);
        }
        return null;
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
            8 * this.sceneUnitsPerPixel,
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
        if (!scene || (this.toolKind !== "line" && this.toolKind !== "rectangle" && this.toolKind !== "point")) {
            this.snapProposal = null;
            return scene;
        }
        const currentIds = this.scene.elements.map(({ id }) => id);
        const added = scene.elements.findLast((element) => !currentIds.includes(element.id));
        if (!added) return scene;
        const at = added.kind === "dot"
            ? added.at
            : added.kind === "path"
              ? added.path.nodes[this.toolKind === "rectangle" ? 2 : added.path.nodes.length - 1]
              : undefined;
        if (!at) {
            this.snapProposal = null;
            return scene;
        }
        const candidate = nearestPointFeature(this.document, at, 8 * this.sceneUnitsPerPixel);
        if (!candidate) {
            this.snapProposal = null;
            return scene;
        }
        const addedId = added.id;
        this.snapProposal = { from: at, to: candidate.at };
        return {
            ...scene,
            elements: scene.elements.map((element) => {
                if (element.id !== addedId) return element;
                if (element.kind === "dot") return { ...element, at: candidate.at };
                if (element.kind === "path") {
                    const start = element.path.nodes[0];
                    const nodes = this.toolKind === "rectangle" && start
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

    // --- history --------------------------------------------------------------

    /** Reconcile a legacy Scene operation without flattening canonical smart items. */
    apply(next: Scene): void {
        try {
            this.applyDocument(reconcileResolvedScene(documentSnapshot(this.document), next));
        } catch (error) {
            console.info(`[Whiteboard] ${error instanceof Error ? error.message : "unsupported smart edit"}`);
        }
    }

    applyDocument(next: WhiteboardDocument): void {
        this.#documents.applyDocument(next);
    }

    undo(): void {
        if (this.#documents.undo()) this.#resetViewStateAfterHistory();
    }

    redo(): void {
        if (this.#documents.redo()) this.#resetViewStateAfterHistory();
    }

    /** Clear transient view state after an undo/redo jumps the document. */
    #resetViewStateAfterHistory(): void {
        this.selection = [];
        this.preview = null;
        this.selectionPreview = null;
        this.lineContinuation = null;
        this.arcGuide = null;
        this.selectedConstraintId = null;
        this.selectedDimensionId = null;
        this.featureSelection = [];
        this.snapProposal = null;
    }

    // --- editing convenience --------------------------------------------------

    setInspectorProperty(id: EditorPropertyId, value: EditorPropertyValue): void {
        this.#style.setInspectorProperty(id, value);
    }

    beginPropertyEdit(): void {
        this.#style.beginPropertyEdit();
    }

    commitPropertyEdit(): void {
        this.#style.commitPropertyEdit();
    }

    cancelPropertyEdit(): void {
        this.#style.cancelPropertyEdit();
    }

    deletePathVertex(elementId: string, nodeIndex: number): void {
        const smartFeature = pathNodeFeature(this.document, elementId, nodeIndex);
        if (smartFeature) {
            // Structural smart-path vertex deletion changes topology and remains deferred.
            return;
        }
        const element = this.scene.elements.find(({ id }) => id === elementId);
        if (
            element?.kind !== "path" ||
            !isStraightPathVertexEditable(element.path) ||
            nodeIndex < 0 ||
            nodeIndex >= element.path.nodes.length
        ) return;

        const nodes = element.path.nodes.filter((_, index) => index !== nodeIndex);
        if (nodes.length < 2) {
            this.apply({
                ...this.scene,
                elements: this.scene.elements.filter(({ id }) => id !== elementId),
            });
            this.selection = this.selection.filter((id) => id !== elementId);
        } else {
            const cyclic = element.path.cyclic && nodes.length >= 3;
            const joinCount = cyclic ? nodes.length : nodes.length - 1;
            this.apply({
                ...this.scene,
                elements: this.scene.elements.map((candidate) =>
                    candidate.id === elementId && candidate.kind === "path"
                        ? {
                              ...candidate,
                              path: {
                                  ...candidate.path,
                                  nodes,
                                  joins: Array.from({ length: joinCount }, () => "--" as const),
                                  cyclic,
                              },
                          }
                        : candidate,
                ),
            });
        }
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    deleteSelected(): void {
        if (this.selectedDimensionId) {
            this.#constraints.removeDimension(this.selectedDimensionId);
            this.selectedDimensionId = null;
            return;
        }
        if (this.selectedConstraintId) {
            this.deleteSelectedConstraint();
            return;
        }
        if (this.selection.length === 0) return;
        this.applyDocument(deleteWhiteboardItems(this.document, this.selection));
        this.selection = [];
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    selectAll(): void {
        this.selection = this.scene.elements.map(({ id }) => id);
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    clearAll(): void {
        this.applyDocument(emptyWhiteboardDocument());
        this.selection = [];
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    get constraintGlyphs(): ConstraintGlyph[] {
        return this.#constraints.constraintGlyphs;
    }

    get dimensionGlyphs(): DimensionGlyph[] {
        return this.#constraints.dimensionGlyphs;
    }

    get applicableRelationActions() {
        return this.#constraints.applicableRelationActions;
    }

    get contextualRelationActions() {
        return this.#constraints.contextualRelationActions;
    }

    get selectedFeatureGeometry() {
        return this.#constraints.selectedFeatureGeometry;
    }

    get canDimensionSelection(): boolean {
        return this.#constraints.canDimensionSelection;
    }

    get selectedFeatureDimensions() {
        return this.#constraints.selectedFeatureDimensions;
    }

    selectFeature(feature: FeatureRef, additive = false): void {
        this.#selection.selectFeature(feature, additive);
    }

    selectCurveFeatureForItem(itemId: string, additive = false): void {
        this.#selection.selectCurveFeatureForItem(itemId, additive);
    }

    selectCurveFeatureAt(itemId: string, at: readonly [number, number], additive = false): void {
        this.#selection.selectCurveFeatureAt(itemId, at, additive);
    }

    selectFeatureAtItem(
        itemId: string,
        at: readonly [number, number],
        additive = false,
        additiveBase?: readonly FeatureRef[],
    ): void {
        this.#selection.selectFeatureAtItem(itemId, at, additive, additiveBase);
    }

    applyRelation(kind: RelationKind): boolean {
        return this.#constraints.applyRelation(kind);
    }

    toggleRelation(kind: RelationKind): boolean {
        return this.#constraints.toggleRelation(kind);
    }

    removeRelationConstraint(constraintId: string): boolean {
        return this.#constraints.removeRelationConstraint(constraintId);
    }

    addLengthDimension(mode: "driving" | "reference"): boolean {
        return this.#constraints.addLengthDimension(mode);
    }

    removeDimension(dimensionId: string): boolean {
        return this.#constraints.removeDimension(dimensionId);
    }

    editDimension(dimensionId: string, value: number): boolean {
        return this.#constraints.editDimension(dimensionId, value);
    }

    selectDimension(id: string | null): void {
        this.#constraints.selectDimension(id);
    }

    selectConstraint(id: string | null): void {
        this.#constraints.selectConstraint(id);
    }

    updateSnapProposal(at: readonly [number, number], suppressSnap = false): void {
        if (suppressSnap || !["line", "rectangle", "point"].includes(this.toolKind)) {
            this.snapProposal = null;
            return;
        }
        const candidate = nearestPointFeature(this.document, at, 8 * this.sceneUnitsPerPixel);
        this.snapProposal = candidate ? { from: at, to: candidate.at } : null;
    }

    deleteSelectedConstraint(): void {
        if (!this.selectedConstraintId) return;
        this.removeRelationConstraint(this.selectedConstraintId);
        this.snapProposal = null;
    }

    // --- persistence I/O (delegates to PersistenceIO) -------------------------
    // Reactive glue only; the codec + localStorage logic lives in
    // `$lib/whiteboard/persistence`. See ARCHITECTURE.md §5.

    toAsy(): string {
        return documentToAsy(documentSnapshot(this.document));
    }

    /** Replace the scene with the result of parsing asy (undoable). */
    loadAsy(asy: string): void {
        this.apply(sceneFromAsy(asy));
        this.selection = [];
        this.selectionPreview = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    static fromAsy(asy: string): WhiteboardStore {
        return new WhiteboardStore(sceneFromAsy(asy));
    }

    persist(key: string): void {
        persistDocument(key, documentSnapshot(this.document));
    }

    static restore(key: string): WhiteboardDocument | null {
        return restoreDocument(key);
    }
}
