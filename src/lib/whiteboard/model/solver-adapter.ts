import type { Pair } from "../../asy/scene/types";
import {
    DampedLeastSquaresSolver,
    type ConstraintSolver,
    type DriverConstraint,
    type SolveResult,
    type SolverConstraint,
    type SolverGraph,
    type StayPreference,
} from "../solver";
import { pointFeaturePointId } from "./features";
import type { PointFeatureRef, WhiteboardDocument } from "./types";

export interface DocumentSolveRequest {
    affected: PointFeatureRef[];
    drivers: Array<{ feature: PointFeatureRef; target: Pair; weight?: number }>;
    stays?: PointFeatureRef[];
    mode: "preview" | "commit" | "validate";
}

export interface DocumentSolveResult extends SolveResult {
    document?: WhiteboardDocument;
}

function requiredPointId(document: WhiteboardDocument, ref: PointFeatureRef): string {
    const id = pointFeaturePointId(document, ref);
    if (!id) throw new Error(`feature ${JSON.stringify(ref)} is not an independent solver point`);
    return id;
}

export function documentToSolverGraph(document: WhiteboardDocument): SolverGraph {
    const points = Object.fromEntries(Object.keys(document.sketch.points).sort().map((id) => [
        id,
        { id, at: document.sketch.points[id].at },
    ]));
    const segments = Object.fromEntries(Object.keys(document.sketch.curves).sort().flatMap((id) => {
        const curve = document.sketch.curves[id];
        return curve.kind === "segment" ? [[id, { id, start: curve.start, end: curve.end }]] : [];
    }));
    const constraints: SolverConstraint[] = [];
    for (const id of Object.keys(document.sketch.constraints).sort()) {
        const constraint = document.sketch.constraints[id];
        if (!constraint.enabled) continue;
        switch (constraint.kind) {
            case "coincident":
                constraints.push({
                    id,
                    kind: "coincident",
                    a: requiredPointId(document, constraint.a),
                    b: requiredPointId(document, constraint.b),
                });
                break;
            case "horizontal":
            case "vertical":
                constraints.push({ id, kind: constraint.kind, segment: constraint.curveId });
                break;
            case "parallel":
            case "perpendicular":
            case "equal-length":
                constraints.push({ id, kind: constraint.kind, a: constraint.a, b: constraint.b });
                break;
            case "distance":
                constraints.push({
                    id,
                    kind: "distance",
                    a: requiredPointId(document, constraint.a),
                    b: requiredPointId(document, constraint.b),
                    distance: document.sketch.parameters[constraint.value].value,
                });
                break;
            case "angle":
                constraints.push({
                    id,
                    kind: "angle",
                    a: constraint.a,
                    b: constraint.b,
                    angle: document.sketch.parameters[constraint.value].value,
                });
                break;
            case "fixed-point":
                constraints.push({
                    id,
                    kind: "fixed-point",
                    point: requiredPointId(document, constraint.point),
                    at: constraint.at,
                });
                break;
            case "radial-distance":
                throw new Error(`${constraint.kind} is outside the point/segment solver adapter`);
        }
    }
    return { points, segments, constraints };
}

function patchedDocument(
    document: WhiteboardDocument,
    pointUpdates: SolveResult["pointUpdates"],
): WhiteboardDocument {
    const points = { ...document.sketch.points };
    for (const [id, at] of Object.entries(pointUpdates)) {
        if (points[id]) points[id] = { ...points[id], at };
    }
    return { ...document, sketch: { ...document.sketch, points } };
}

export function solveWhiteboardDocument(
    document: WhiteboardDocument,
    request: DocumentSolveRequest,
    solver: ConstraintSolver = new DampedLeastSquaresSolver(),
): DocumentSolveResult {
    const drivers: DriverConstraint[] = request.drivers.map((driver) => ({
        pointId: requiredPointId(document, driver.feature),
        target: driver.target,
        ...(driver.weight === undefined ? {} : { weight: driver.weight }),
    }));
    const drivenPointIds = new Set(drivers.map((driver) => driver.pointId));
    const stayRefs = request.stays ?? Object.keys(document.sketch.points).sort()
        .filter((pointId) => !drivenPointIds.has(pointId))
        .map((pointId) => ({ kind: "point" as const, pointId }));
    const stays: StayPreference[] = stayRefs.map((ref) => ({
        pointId: requiredPointId(document, ref),
    }));
    const result = solver.solve({
        graph: documentToSolverGraph(document),
        affected: request.affected.map((ref) => ({
            kind: "point" as const,
            pointId: requiredPointId(document, ref),
        })),
        drivers,
        stays,
        mode: request.mode,
    });
    return result.status === "conflicting" || result.status === "failed"
        ? result
        : { ...result, document: patchedDocument(document, result.pointUpdates) };
}
