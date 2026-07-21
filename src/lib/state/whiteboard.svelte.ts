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
 *   - pointer routing, the two interaction pipelines, and lifting a tool commit
 *     to one Document transaction delegate to InteractionController
 *     (`$lib/whiteboard/interaction.svelte`); the store owns only the transient
 *     view state (`preview` / `snapProposal` / `lineContinuation` / `arcGuide`)
 *     the controller writes through this class as its host
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
import { InteractionController } from "$lib/whiteboard/interaction.svelte";
import {
    type SelectionTransformGesture,
    type LineContinuation,
    type ArcGuide,
    DEFAULT_STROKE_PROCESSING_OPTIONS,
    type StrokeProcessingOptions,
    type PointerInput,
} from "$lib/asy/engine";
import {
    emptyWhiteboardDocument,
    deleteWhiteboardItems,
    migrateSceneToWhiteboardDocument,
    nearestPointFeature,
    pathNodeFeature,
    type FeatureRef,
    type RelationKind,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

function documentSnapshot(document: WhiteboardDocument): WhiteboardDocument {
    return $state.snapshot(document) as WhiteboardDocument;
}

export type { WhiteboardToolKind };

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
    #selection: SelectionModel;
    #style: StyleModel;
    #constraints: ConstraintService;
    #interaction: InteractionController;

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
        // The store *is* the controller's host: every field it reads/writes
        // (document, scene, the transient view state, tool kind) is already part
        // of this class's public surface.
        this.#interaction = new InteractionController(
            this,
            this.#selection,
            this.#style,
            this.#constraints,
        );
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
        this.#interaction.setTool(kind);
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
    }

    // --- pointer plumbing (forwarded to InteractionController; the view maps
    //     screen->asy before calling these) ------------------------------------

    pointerDown(
        p: PointerInput,
        selectionTransform?: SelectionTransformGesture,
        suppressSnap = false,
        additiveFeatureSelection = false,
    ): void {
        this.#interaction.pointerDown(p, selectionTransform, suppressSnap, additiveFeatureSelection);
    }
    pointerMove(p: PointerInput, shiftKey = false, suppressSnap = false): void {
        this.#interaction.pointerMove(p, shiftKey, suppressSnap);
    }
    pointerMoves(points: readonly PointerInput[], shiftKey = false, suppressSnap = false): void {
        this.#interaction.pointerMoves(points, shiftKey, suppressSnap);
    }
    pointerUp(
        p: PointerInput,
        shiftKey = false,
        pendingMoves: readonly PointerInput[] = [],
        suppressSnap = false,
    ): void {
        this.#interaction.pointerUp(p, shiftKey, pendingMoves, suppressSnap);
    }
    cancel(): void {
        this.#interaction.cancel();
    }

    clearFeatureSelection(): void {
        this.#selection.clearFeatureSelection();
    }

    get selectionContainsSmartItems(): boolean {
        return this.#selection.containsSmartItems;
    }

    // --- history --------------------------------------------------------------

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
            // A baked path collapsing below two nodes is deleted outright.
            this.applyDocument(deleteWhiteboardItems(this.document, [elementId]));
            this.selection = this.selection.filter((id) => id !== elementId);
        } else {
            const cyclic = element.path.cyclic && nodes.length >= 3;
            const joinCount = cyclic ? nodes.length : nodes.length - 1;
            this.applyDocument(this.#interaction.replaceBakedElements([
                {
                    ...element,
                    path: {
                        ...element.path,
                        nodes,
                        joins: Array.from({ length: joinCount }, () => "--" as const),
                        cyclic,
                    },
                },
            ]));
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
        this.applyDocument(migrateSceneToWhiteboardDocument(sceneFromAsy(asy)));
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
