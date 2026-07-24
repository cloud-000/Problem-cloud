/**
 * ConstraintService — relation, dimension, and solver orchestration
 * (ARCHITECTURE.md §5).
 *
 * The service owns the reactive constraint/dimension selection and solver
 * feedback state. It reads the current Document and feature selection through
 * its host, builds model-layer transactions, and hands successful commits back
 * to the host as one history step. The Document remains the only editable
 * model; no method reads or reconciles a Scene (INVARIANTS §0 and §4).
 */

import type { Pair } from "$lib/asy/scene/types";
import {
    addCoincidentConstraint,
    addLengthDimension,
    addRelationConstraint,
    applicableRelationActions,
    contextualRelationActions,
    editDrivingLengthDimension,
    lengthDimensionValue,
    lengthDimensionsForSelection,
    pointFeaturePosition,
    removeConstraint,
    removeLengthDimension,
    solveWhiteboardDocument,
    switchDirectionalRelationConstraint,
    type Constraint,
    type DocumentSolveRequest,
    type DocumentSolveResult,
    type FeatureRef,
    type GeometryOperationResult,
    type PointFeatureRef,
    type RelationKind,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

export interface ConstraintHost {
    readonly document: WhiteboardDocument;
    readonly featureSelection: readonly FeatureRef[];
    selection: string[];
    applyDocument(next: WhiteboardDocument): void;
}

export interface ConstraintGlyph {
    id: string;
    at: Pair;
    a: Pair;
    b: Pair;
    selected: boolean;
}

export interface DimensionGlyph {
    id: string;
    a: Pair;
    b: Pair;
    at: Pair;
    value: number;
    mode: "driving" | "reference";
    selected: boolean;
}

function snapshot(document: WhiteboardDocument): WhiteboardDocument {
    return $state.snapshot(document) as WhiteboardDocument;
}

export class ConstraintService {
    selectedConstraintId = $state<string | null>(null);
    selectedDimensionId = $state<string | null>(null);
    solverDiagnostic = $state<string | null>(null);
    conflictingConstraintIds = $state<string[]>([]);

    #host: ConstraintHost;

    constructor(host: ConstraintHost) {
        this.#host = host;
    }

    clearConstraintSelection(): void {
        this.selectedConstraintId = null;
    }

    clearDimensionSelection(): void {
        this.selectedDimensionId = null;
    }

    clearSolverFeedback(): void {
        this.solverDiagnostic = null;
        this.conflictingConstraintIds = [];
    }

    recordSolverResult(result: GeometryOperationResult | DocumentSolveResult): void {
        this.solverDiagnostic = result.diagnostic ?? (result.status === "under-constrained"
            ? `Geometry remains under-constrained${result.degreesOfFreedom === undefined ? "" : ` (${result.degreesOfFreedom} DOF)`}`
            : null);
        this.conflictingConstraintIds = [...result.conflictingConstraintIds];
    }

    solveDocument(document: WhiteboardDocument, request: DocumentSolveRequest): DocumentSolveResult {
        const result = solveWhiteboardDocument(document, request);
        this.recordSolverResult(result);
        return result;
    }

    addCoincident(
        document: WhiteboardDocument,
        a: PointFeatureRef,
        b: PointFeatureRef,
        origin: Constraint["origin"] = "inferred",
    ): WhiteboardDocument | null {
        return addCoincidentConstraint(document, a, b, origin);
    }

    get constraintGlyphs(): ConstraintGlyph[] {
        const document = this.#host.document;
        return Object.values(document.sketch.constraints).flatMap((constraint) => {
            if (!constraint.enabled) return [];
            let a: Pair | null = null;
            let b: Pair | null = null;
            if (constraint.kind === "coincident" || constraint.kind === "distance") {
                a = pointFeaturePosition(document, constraint.a);
                b = pointFeaturePosition(document, constraint.b);
            } else if (constraint.kind === "fixed-point") {
                a = pointFeaturePosition(document, constraint.point);
                b = a;
            } else if (constraint.kind === "horizontal" || constraint.kind === "vertical") {
                const refs = this.#curvePointRefs(constraint.curveId);
                a = refs[0] ? pointFeaturePosition(document, refs[0]) : null;
                b = refs[1] ? pointFeaturePosition(document, refs[1]) : null;
            } else if (
                constraint.kind === "parallel" || constraint.kind === "perpendicular" ||
                constraint.kind === "equal-length" || constraint.kind === "angle"
            ) {
                a = this.#curveMidpoint(constraint.a);
                b = this.#curveMidpoint(constraint.b);
            } else return [];
            if (!a || !b) return [];
            return [{
                id: constraint.id,
                at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
                a,
                b,
                kind: constraint.kind,
                selected: this.selectedConstraintId === constraint.id,
            }];
        });
    }

    #curvePointRefs(curveId: string): PointFeatureRef[] {
        const curve = this.#host.document.sketch.curves[curveId];
        if (curve?.kind === "segment") {
            return [
                { kind: "curve-point", curveId, feature: "start" },
                { kind: "curve-point", curveId, feature: "end" },
            ];
        }
        if (curve?.kind === "arc") {
            return [
                { kind: "point", pointId: curve.center },
                { kind: "point", pointId: curve.start },
                { kind: "point", pointId: curve.end },
            ];
        }
        return [];
    }

    #curveMidpoint(curveId: string): Pair | null {
        const refs = this.#curvePointRefs(curveId);
        if (refs.length < 2) return null;
        const a = pointFeaturePosition(this.#host.document, refs[0]);
        const b = pointFeaturePosition(this.#host.document, refs[1]);
        return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
    }

    get dimensionGlyphs(): DimensionGlyph[] {
        const document = this.#host.document;
        return Object.values(document.dimensions ?? {}).flatMap((dimension) => {
            let a: Pair | null = null;
            let b: Pair | null = null;
            if (dimension.kind === "length") {
                a = pointFeaturePosition(document, dimension.a);
                b = pointFeaturePosition(document, dimension.b);
            } else return [];
            if (!a || !b) return [];
            const value = lengthDimensionValue(document, dimension.id);
            if (value === null) return [];
            const offset = dimension.labelOffset ?? [0, 0];
            return [{
                id: dimension.id,
                a,
                b,
                at: [(a[0] + b[0]) / 2 + offset[0], (a[1] + b[1]) / 2 + offset[1]],
                value,
                mode: dimension.mode,
                selected: this.selectedDimensionId === dimension.id,
            }];
        });
    }

    get applicableRelationActions() {
        return applicableRelationActions(this.#host.document, this.#host.featureSelection);
    }

    get contextualRelationActions() {
        return contextualRelationActions(this.#host.document, this.#host.featureSelection);
    }

    get selectedFeatureGeometry(): {
        points: Pair[];
        segments: Array<{ a: Pair; b: Pair }>;
    } {
        const points: Pair[] = [];
        const segments: Array<{ a: Pair; b: Pair }> = [];
        for (const feature of this.#host.featureSelection) {
            if (feature.kind !== "curve") {
                const at = pointFeaturePosition(this.#host.document, feature);
                if (at) points.push(at);
                continue;
            }
            const refs = this.#curvePointRefs(feature.curveId);
            if (refs.length === 2) {
                const a = pointFeaturePosition(this.#host.document, refs[0]);
                const b = pointFeaturePosition(this.#host.document, refs[1]);
                if (a && b) segments.push({ a, b });
            } else {
                for (const ref of refs) {
                    const at = pointFeaturePosition(this.#host.document, ref);
                    if (at) points.push(at);
                }
            }
        }
        return { points, segments };
    }

    get canDimensionSelection(): boolean {
        const selection = this.#host.featureSelection;
        if (selection.length === 1 && selection[0].kind === "curve") {
            return this.#host.document.sketch.curves[selection[0].curveId]?.kind === "segment";
        }
        return selection.length === 2 && selection.every((feature) => feature.kind !== "curve");
    }

    get selectedFeatureDimensions() {
        const document = this.#host.document;
        return lengthDimensionsForSelection(document, this.#host.featureSelection).flatMap((dimension) => {
            const value = lengthDimensionValue(document, dimension.id);
            return value === null ? [] : [{ ...dimension, value }];
        });
    }

    applyRelation(kind: RelationKind): boolean {
        const current = snapshot(this.#host.document);
        const result = addRelationConstraint(current, kind, this.#host.featureSelection);
        this.recordSolverResult(result);
        if (!result.document || JSON.stringify(result.document) === JSON.stringify(current)) return false;
        this.#host.applyDocument(result.document);
        return true;
    }

    toggleRelation(kind: RelationKind): boolean {
        const active = this.contextualRelationActions.find((action) => action.kind === kind)?.constraintId;
        if (active) return this.removeRelationConstraint(active);
        if (kind === "horizontal" || kind === "vertical") {
            const opposite = kind === "horizontal" ? "vertical" : "horizontal";
            const replaced = this.contextualRelationActions.find((action) => action.kind === opposite)?.constraintId;
            if (replaced) {
                const result = switchDirectionalRelationConstraint(
                    snapshot(this.#host.document),
                    kind,
                    this.#host.featureSelection,
                    replaced,
                );
                this.recordSolverResult(result);
                if (!result.document) return false;
                this.#host.applyDocument(result.document);
                return true;
            }
        }
        return this.applyRelation(kind);
    }

    removeRelationConstraint(constraintId: string): boolean {
        const next = removeConstraint(this.#host.document, constraintId);
        if (next === this.#host.document) return false;
        this.#host.applyDocument(next);
        if (this.selectedConstraintId === constraintId) this.selectedConstraintId = null;
        this.clearSolverFeedback();
        return true;
    }

    addLengthDimension(mode: "driving" | "reference"): boolean {
        const current = this.#host.document;
        const result = addLengthDimension(snapshot(current), this.#host.featureSelection, mode);
        this.recordSolverResult(result);
        if (!result.document) return false;
        const newId = Object.keys(result.document.dimensions ?? {}).find((id) => !current.dimensions?.[id]);
        this.#host.applyDocument(result.document);
        this.selectedDimensionId = newId ?? null;
        this.selectedConstraintId = null;
        return true;
    }

    removeDimension(dimensionId: string): boolean {
        const next = removeLengthDimension(this.#host.document, dimensionId);
        if (next === this.#host.document) return false;
        this.#host.applyDocument(next);
        if (this.selectedDimensionId === dimensionId) this.selectedDimensionId = null;
        this.clearSolverFeedback();
        return true;
    }

    editDimension(dimensionId: string, value: number): boolean {
        const result = editDrivingLengthDimension(snapshot(this.#host.document), dimensionId, value);
        this.recordSolverResult(result);
        if (!result.document) return false;
        this.#host.applyDocument(result.document);
        this.selectedDimensionId = dimensionId;
        return true;
    }

    selectDimension(id: string | null): void {
        this.selectedDimensionId = id && this.#host.document.dimensions?.[id] ? id : null;
        if (this.selectedDimensionId) {
            this.selectedConstraintId = null;
            this.#host.selection = [];
        }
    }

    selectConstraint(id: string | null): void {
        this.selectedConstraintId = id && this.#host.document.sketch.constraints[id] ? id : null;
        if (this.selectedConstraintId) this.#host.selection = [];
        if (this.selectedConstraintId) this.selectedDimensionId = null;
    }
}
