import type {
    ConstraintId,
    ConstraintSolver,
    DriverConstraint,
    NonlinearSolverOptions,
    PointId,
    SegmentEntity,
    SolveRequest,
    SolveResult,
    SolverConstraint,
    SolverGraph,
    SolverPoint,
    StayPreference,
} from "./types";

interface SolverConfig {
    commitTolerance: number;
    previewTolerance: number;
    commitIterations: number;
    previewIterations: number;
    finiteDifferenceStep: number;
    initialDamping: number;
    hardConstraintMultiplier: number;
    degeneracyTolerance: number;
}

interface ActiveProblem {
    pointIds: PointId[];
    constraints: SolverConstraint[];
    drivers: DriverConstraint[];
    stays: StayPreference[];
    scale: number;
}

interface ResidualEntry {
    id: ConstraintId;
    values: number[];
}

interface Evaluation {
    hard: ResidualEntry[];
    weighted: number[];
    rankValues: number[];
}

const DEFAULTS: SolverConfig = {
    commitTolerance: 1e-7,
    previewTolerance: 1e-5,
    commitIterations: 80,
    previewIterations: 24,
    finiteDifferenceStep: 1e-6,
    initialDamping: 1e-3,
    hardConstraintMultiplier: 1e4,
    degeneracyTolerance: 1e-9,
};

const ZERO_RESULT: Omit<SolveResult, "status"> = {
    pointUpdates: {},
    residuals: {},
    conflictingConstraintIds: [],
    iterations: 0,
    objective: 0,
    maxResidual: 0,
};

function failed(diagnostic: string, iterations = 0): SolveResult {
    return { ...ZERO_RESULT, status: "failed", diagnostic, iterations };
}

function finitePoint(point: SolverPoint): boolean {
    return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function sortedUnique(values: Iterable<string>): string[] {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function segmentPointIds(graph: SolverGraph, id: string): PointId[] {
    const segment = graph.segments[id];
    return segment ? [segment.start, segment.end] : [];
}

function constraintPointIds(graph: SolverGraph, constraint: SolverConstraint): PointId[] {
    switch (constraint.kind) {
        case "fixed-point":
            return [constraint.point];
        case "coincident":
        case "distance":
            return sortedUnique([constraint.a, constraint.b]);
        case "horizontal":
        case "vertical":
            return segmentPointIds(graph, constraint.segment);
        case "parallel":
        case "perpendicular":
        case "equal-length":
        case "angle":
            return sortedUnique([
                ...segmentPointIds(graph, constraint.a),
                ...segmentPointIds(graph, constraint.b),
            ]);
    }
}

function validateRequest(request: SolveRequest, config: SolverConfig): string | null {
    const { graph } = request;
    for (const [key, point] of Object.entries(graph.points)) {
        if (point.id !== key) return `point key ${key} does not match id ${point.id}`;
        if (!finitePoint(point.at)) return `point ${key} has a non-finite coordinate`;
    }
    for (const [key, segment] of Object.entries(graph.segments)) {
        if (segment.id !== key) return `segment key ${key} does not match id ${segment.id}`;
        if (!graph.points[segment.start] || !graph.points[segment.end]) {
            return `segment ${key} references a missing point`;
        }
    }

    const constraintIds = new Set<string>();
    for (const constraint of graph.constraints) {
        if (!constraint.id) return "constraint id must be non-empty";
        if (constraintIds.has(constraint.id)) return `duplicate constraint id ${constraint.id}`;
        constraintIds.add(constraint.id);
        if (constraint.kind === "fixed-point") {
            if (!graph.points[constraint.point]) return `constraint ${constraint.id} references a missing point`;
            if (!finitePoint(constraint.at)) return `constraint ${constraint.id} has a non-finite fixed position`;
        } else if (constraint.kind === "coincident" || constraint.kind === "distance") {
            if (!graph.points[constraint.a] || !graph.points[constraint.b]) {
                return `constraint ${constraint.id} references a missing point`;
            }
            if (
                constraint.kind === "distance" &&
                (!Number.isFinite(constraint.distance) || constraint.distance < 0)
            ) {
                return `constraint ${constraint.id} has an invalid distance`;
            }
        } else if (constraint.kind === "horizontal" || constraint.kind === "vertical") {
            if (!graph.segments[constraint.segment]) {
                return `constraint ${constraint.id} references a missing segment`;
            }
        } else {
            if (!graph.segments[constraint.a] || !graph.segments[constraint.b]) {
                return `constraint ${constraint.id} references a missing segment`;
            }
            if (
                constraint.kind === "angle" &&
                (!Number.isFinite(constraint.angle) || constraint.angle < 0 || constraint.angle > Math.PI)
            ) {
                return `constraint ${constraint.id} has an angle outside [0, pi]`;
            }
        }
    }

    for (const feature of request.affected) {
        if (feature.kind === "point" && !graph.points[feature.pointId]) {
            return `affected feature references missing point ${feature.pointId}`;
        }
        if (feature.kind === "segment" && !graph.segments[feature.segmentId]) {
            return `affected feature references missing segment ${feature.segmentId}`;
        }
    }
    for (const driver of request.drivers) {
        if (!graph.points[driver.pointId]) return `driver references missing point ${driver.pointId}`;
        if (!finitePoint(driver.target)) return `driver for ${driver.pointId} has a non-finite target`;
        if (driver.weight !== undefined && (!Number.isFinite(driver.weight) || driver.weight <= 0)) {
            return `driver for ${driver.pointId} has an invalid weight`;
        }
    }
    for (const stay of request.stays) {
        if (!graph.points[stay.pointId]) return `stay references missing point ${stay.pointId}`;
        if (stay.target !== undefined && !finitePoint(stay.target)) {
            return `stay for ${stay.pointId} has a non-finite target`;
        }
        if (stay.weight !== undefined && (!Number.isFinite(stay.weight) || stay.weight <= 0)) {
            return `stay for ${stay.pointId} has an invalid weight`;
        }
    }
    if (
        config.commitTolerance <= 0 ||
        config.previewTolerance <= 0 ||
        config.commitIterations <= 0 ||
        config.previewIterations <= 0 ||
        config.finiteDifferenceStep <= 0 ||
        config.initialDamping <= 0 ||
        config.hardConstraintMultiplier <= 0 ||
        config.degeneracyTolerance <= 0
    ) return "solver options must be finite positive values";
    return null;
}

function featurePointIds(graph: SolverGraph, request: SolveRequest): PointId[] {
    const seeds: PointId[] = [];
    for (const feature of request.affected) {
        if (feature.kind === "point") seeds.push(feature.pointId);
        else seeds.push(...segmentPointIds(graph, feature.segmentId));
    }
    for (const driver of request.drivers) seeds.push(driver.pointId);
    if (seeds.length === 0) {
        for (const constraint of graph.constraints) seeds.push(...constraintPointIds(graph, constraint));
    }
    if (seeds.length === 0) {
        for (const stay of request.stays) seeds.push(stay.pointId);
    }
    return sortedUnique(seeds);
}

function problemScale(graph: SolverGraph, pointIds: readonly PointId[], constraints: readonly SolverConstraint[]): number {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let target = 0;
    for (const id of pointIds) {
        const [x, y] = graph.points[id].at;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    for (const constraint of constraints) {
        if (constraint.kind === "distance") target = Math.max(target, constraint.distance);
    }
    const diagonal = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
    return Math.max(1, diagonal, target);
}

function buildActiveProblem(request: SolveRequest): ActiveProblem {
    const { graph } = request;
    const active = new Set(featurePointIds(graph, request));
    const constraints = [...graph.constraints].sort((a, b) => a.id.localeCompare(b.id));

    let changed = true;
    while (changed) {
        changed = false;
        for (const constraint of constraints) {
            const ids = constraintPointIds(graph, constraint);
            if (!ids.some((id) => active.has(id))) continue;
            for (const id of ids) {
                if (active.has(id)) continue;
                active.add(id);
                changed = true;
            }
        }
    }

    const activeConstraints = constraints.filter((constraint) =>
        constraintPointIds(graph, constraint).some((id) => active.has(id))
    );
    const pointIds = sortedUnique(active);
    const drivers = [...request.drivers]
        .filter((driver) => active.has(driver.pointId))
        .sort((a, b) =>
            a.pointId.localeCompare(b.pointId) ||
            a.target[0] - b.target[0] ||
            a.target[1] - b.target[1]
        );
    const stays = [...request.stays]
        .filter((stay) => active.has(stay.pointId))
        .sort((a, b) => a.pointId.localeCompare(b.pointId));
    return {
        pointIds,
        constraints: activeConstraints,
        drivers,
        stays,
        scale: problemScale(graph, pointIds, activeConstraints),
    };
}

function initialVector(graph: SolverGraph, pointIds: readonly PointId[]): number[] {
    return pointIds.flatMap((id) => [graph.points[id].at[0], graph.points[id].at[1]]);
}

function pointReader(pointIds: readonly PointId[], vector: readonly number[]): (id: PointId) => SolverPoint {
    const offsets = new Map(pointIds.map((id, index) => [id, index * 2]));
    return (id) => {
        const offset = offsets.get(id);
        if (offset === undefined) throw new Error(`inactive point ${id}`);
        return [vector[offset], vector[offset + 1]];
    };
}

function vectorBetween(a: SolverPoint, b: SolverPoint): SolverPoint {
    return [b[0] - a[0], b[1] - a[1]];
}

function vectorLength(vector: SolverPoint): number {
    return Math.hypot(vector[0], vector[1]);
}

function segmentVector(segment: SegmentEntity, point: (id: PointId) => SolverPoint): SolverPoint {
    return vectorBetween(point(segment.start), point(segment.end));
}

function normalizedDirection(
    segment: SegmentEntity,
    point: (id: PointId) => SolverPoint,
    denominatorFloor: number,
): SolverPoint {
    const vector = segmentVector(segment, point);
    const length = Math.max(vectorLength(vector), denominatorFloor);
    return [vector[0] / length, vector[1] / length];
}

function constraintResiduals(
    graph: SolverGraph,
    constraint: SolverConstraint,
    point: (id: PointId) => SolverPoint,
    scale: number,
    degeneracyTolerance: number,
): number[] {
    switch (constraint.kind) {
        case "fixed-point": {
            const at = point(constraint.point);
            return [(at[0] - constraint.at[0]) / scale, (at[1] - constraint.at[1]) / scale];
        }
        case "coincident": {
            const a = point(constraint.a);
            const b = point(constraint.b);
            return [(a[0] - b[0]) / scale, (a[1] - b[1]) / scale];
        }
        case "distance":
            return [(vectorLength(vectorBetween(point(constraint.a), point(constraint.b))) - constraint.distance) / scale];
        case "horizontal": {
            const segment = graph.segments[constraint.segment];
            return [(point(segment.end)[1] - point(segment.start)[1]) / scale];
        }
        case "vertical": {
            const segment = graph.segments[constraint.segment];
            return [(point(segment.end)[0] - point(segment.start)[0]) / scale];
        }
        case "equal-length": {
            const a = vectorLength(segmentVector(graph.segments[constraint.a], point));
            const b = vectorLength(segmentVector(graph.segments[constraint.b], point));
            return [(a - b) / scale];
        }
        case "parallel":
        case "perpendicular":
        case "angle": {
            const floor = degeneracyTolerance * scale;
            const a = normalizedDirection(graph.segments[constraint.a], point, floor);
            const b = normalizedDirection(graph.segments[constraint.b], point, floor);
            const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
            if (constraint.kind === "parallel") return [a[0] * b[1] - a[1] * b[0]];
            if (constraint.kind === "perpendicular") return [dot];
            return [(Math.acos(dot) - constraint.angle) / Math.PI];
        }
    }
}

function evaluate(
    graph: SolverGraph,
    problem: ActiveProblem,
    vector: readonly number[],
    config: SolverConfig,
): Evaluation {
    const point = pointReader(problem.pointIds, vector);
    const hard = problem.constraints.map((constraint) => ({
        id: constraint.id,
        values: constraintResiduals(
            graph,
            constraint,
            point,
            problem.scale,
            config.degeneracyTolerance,
        ),
    }));
    const hardValues = hard.flatMap((entry) => entry.values);
    const driverValues = problem.drivers.flatMap((driver) => {
        const at = point(driver.pointId);
        const multiplier = Math.sqrt(driver.weight ?? 1);
        return [
            ((at[0] - driver.target[0]) / problem.scale) * multiplier,
            ((at[1] - driver.target[1]) / problem.scale) * multiplier,
        ];
    });
    const stayValues = problem.stays.flatMap((stay) => {
        const at = point(stay.pointId);
        const target = stay.target ?? graph.points[stay.pointId].at;
        const multiplier = Math.sqrt(stay.weight ?? 1e-3);
        return [
            ((at[0] - target[0]) / problem.scale) * multiplier,
            ((at[1] - target[1]) / problem.scale) * multiplier,
        ];
    });
    return {
        hard,
        weighted: [
            ...hardValues.map((value) => value * config.hardConstraintMultiplier),
            ...driverValues,
            ...stayValues,
        ],
        rankValues: [
            ...hardValues,
            ...driverValues,
        ],
    };
}

function objective(residuals: readonly number[]): number {
    let value = 0;
    for (const residual of residuals) value += residual * residual;
    return value / 2;
}

function allFinite(values: readonly number[]): boolean {
    return values.every(Number.isFinite);
}

function numericalJacobian(
    vector: readonly number[],
    base: readonly number[],
    scale: number,
    relativeStep: number,
    evaluateValues: (candidate: readonly number[]) => readonly number[],
): number[][] | null {
    const rows = Array.from({ length: base.length }, () => Array(vector.length).fill(0));
    for (let column = 0; column < vector.length; column++) {
        // Scale by the local component extent, not by the absolute coordinate.
        // That keeps the Jacobian translation-invariant for drawings far from
        // the origin (for example, a 10-unit sketch around x = 1_000_000).
        const step = relativeStep * Math.max(1, scale);
        const candidate = [...vector];
        candidate[column] += step;
        const next = evaluateValues(candidate);
        if (next.length !== base.length || !allFinite(next)) return null;
        for (let row = 0; row < base.length; row++) {
            rows[row][column] = (next[row] - base[row]) / step;
        }
    }
    return rows;
}

function normalEquations(jacobian: readonly number[][], residuals: readonly number[]): {
    matrix: number[][];
    gradient: number[];
} {
    const columns = jacobian[0]?.length ?? 0;
    const matrix = Array.from({ length: columns }, () => Array(columns).fill(0));
    const gradient = Array(columns).fill(0);
    for (let row = 0; row < jacobian.length; row++) {
        for (let a = 0; a < columns; a++) {
            const ja = jacobian[row][a];
            gradient[a] += ja * residuals[row];
            for (let b = a; b < columns; b++) matrix[a][b] += ja * jacobian[row][b];
        }
    }
    for (let a = 0; a < columns; a++) {
        for (let b = 0; b < a; b++) matrix[a][b] = matrix[b][a];
    }
    return { matrix, gradient };
}

function solveLinearSystem(matrix: readonly number[][], rhs: readonly number[]): number[] | null {
    const size = rhs.length;
    if (matrix.length !== size || matrix.some((row) => row.length !== size)) return null;
    const augmented = matrix.map((row, index) => [...row, rhs[index]]);

    for (let column = 0; column < size; column++) {
        let pivot = column;
        for (let row = column + 1; row < size; row++) {
            if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
        }
        if (!Number.isFinite(augmented[pivot][column]) || Math.abs(augmented[pivot][column]) <= 1e-20) {
            return null;
        }
        if (pivot !== column) [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

        for (let row = column + 1; row < size; row++) {
            const factor = augmented[row][column] / augmented[column][column];
            if (factor === 0) continue;
            for (let entry = column; entry <= size; entry++) {
                augmented[row][entry] -= factor * augmented[column][entry];
            }
        }
    }

    const result = Array(size).fill(0);
    for (let row = size - 1; row >= 0; row--) {
        let value = augmented[row][size];
        for (let column = row + 1; column < size; column++) value -= augmented[row][column] * result[column];
        result[row] = value / augmented[row][row];
    }
    return allFinite(result) ? result : null;
}

function matrixRank(matrix: readonly number[][]): number {
    if (matrix.length === 0 || (matrix[0]?.length ?? 0) === 0) return 0;
    const work = matrix.map((row) => [...row]);
    const rows = work.length;
    const columns = work[0].length;
    const maximum = Math.max(...work.flatMap((row) => row.map(Math.abs)), 1);
    const tolerance = maximum * 1e-8;
    let rank = 0;

    for (let column = 0; column < columns && rank < rows; column++) {
        let pivot = rank;
        for (let row = rank + 1; row < rows; row++) {
            if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
        }
        if (Math.abs(work[pivot][column]) <= tolerance) continue;
        if (pivot !== rank) [work[rank], work[pivot]] = [work[pivot], work[rank]];
        const divisor = work[rank][column];
        for (let entry = column; entry < columns; entry++) work[rank][entry] /= divisor;
        for (let row = 0; row < rows; row++) {
            if (row === rank) continue;
            const factor = work[row][column];
            if (Math.abs(factor) <= tolerance) continue;
            for (let entry = column; entry < columns; entry++) {
                work[row][entry] -= factor * work[rank][entry];
            }
        }
        rank++;
    }
    return rank;
}

function directionDegeneracy(
    graph: SolverGraph,
    problem: ActiveProblem,
    vector: readonly number[],
    tolerance: number,
): string | null {
    const point = pointReader(problem.pointIds, vector);
    const threshold = tolerance * problem.scale;
    const segmentIds = new Set<string>();
    for (const constraint of problem.constraints) {
        if (
            constraint.kind === "horizontal" ||
            constraint.kind === "vertical" ||
            constraint.kind === "parallel" ||
            constraint.kind === "perpendicular" ||
            constraint.kind === "angle"
        ) {
            if (constraint.kind === "horizontal" || constraint.kind === "vertical") {
                segmentIds.add(constraint.segment);
            } else {
                segmentIds.add(constraint.a);
                segmentIds.add(constraint.b);
            }
        }
    }
    for (const id of [...segmentIds].sort((a, b) => a.localeCompare(b))) {
        if (vectorLength(segmentVector(graph.segments[id], point)) <= threshold) {
            return `direction constraint references degenerate segment ${id}`;
        }
    }
    return null;
}

function residualSummary(hard: readonly ResidualEntry[]): {
    residuals: Record<ConstraintId, number>;
    maxResidual: number;
} {
    const residuals: Record<ConstraintId, number> = {};
    let maxResidual = 0;
    for (const entry of hard) {
        const value = Math.max(0, ...entry.values.map(Math.abs));
        residuals[entry.id] = value;
        maxResidual = Math.max(maxResidual, value);
    }
    return { residuals, maxResidual };
}

/**
 * Dependency-free deterministic Levenberg-Marquardt spike with forward
 * numerical Jacobians. It is intentionally scoped to Phase 0's point/segment
 * graph and is not wired into the production whiteboard.
 */
export class DampedLeastSquaresSolver implements ConstraintSolver {
    readonly #config: SolverConfig;

    constructor(options: NonlinearSolverOptions = {}) {
        this.#config = { ...DEFAULTS, ...options };
    }

    solve(request: SolveRequest): SolveResult {
        const validation = validateRequest(request, this.#config);
        if (validation) return failed(validation);

        const problem = buildActiveProblem(request);
        if (problem.pointIds.length === 0) {
            return {
                ...ZERO_RESULT,
                status: "under-constrained",
                degreesOfFreedom: 0,
                diagnostic: "request has no active geometry",
            };
        }

        let vector = initialVector(request.graph, problem.pointIds);
        const initialDegeneracy = directionDegeneracy(
            request.graph,
            problem,
            vector,
            this.#config.degeneracyTolerance,
        );
        if (initialDegeneracy) return failed(initialDegeneracy);

        let evaluation = evaluate(request.graph, problem, vector, this.#config);
        if (!allFinite(evaluation.weighted)) return failed("initial residual evaluation is non-finite");
        let cost = objective(evaluation.weighted);
        let damping = this.#config.initialDamping;
        const maxIterations = request.mode === "preview"
            ? this.#config.previewIterations
            : this.#config.commitIterations;
        let iterations = 0;

        for (; iterations < maxIterations; iterations++) {
            if (evaluation.weighted.length === 0 || vector.length === 0) break;
            const jacobian = numericalJacobian(
                vector,
                evaluation.weighted,
                problem.scale,
                this.#config.finiteDifferenceStep,
                (candidate) => evaluate(request.graph, problem, candidate, this.#config).weighted,
            );
            if (!jacobian) return failed("numerical Jacobian is non-finite", iterations);
            const { matrix, gradient } = normalEquations(jacobian, evaluation.weighted);
            const gradientMaximum = Math.max(0, ...gradient.map(Math.abs));
            if (gradientMaximum <= 1e-12) break;
            for (let index = 0; index < matrix.length; index++) {
                matrix[index][index] += damping * Math.max(1, matrix[index][index]);
            }
            const step = solveLinearSystem(matrix, gradient.map((value) => -value));
            if (!step) return failed("damped normal equations are singular", iterations);
            const stepLength = Math.hypot(...step);
            if (!Number.isFinite(stepLength)) return failed("solver step is non-finite", iterations);
            if (stepLength <= 1e-11 * problem.scale) break;

            const candidate = vector.map((value, index) => value + step[index]);
            if (!allFinite(candidate)) return failed("candidate geometry is non-finite", iterations);
            const candidateEvaluation = evaluate(request.graph, problem, candidate, this.#config);
            if (!allFinite(candidateEvaluation.weighted)) {
                damping *= 10;
                if (!Number.isFinite(damping)) return failed("solver damping overflowed", iterations);
                continue;
            }
            const candidateCost = objective(candidateEvaluation.weighted);
            if (candidateCost < cost) {
                const improvement = cost - candidateCost;
                vector = candidate;
                evaluation = candidateEvaluation;
                cost = candidateCost;
                damping = Math.max(1e-12, damping / 3);
                if (improvement <= 1e-14 * Math.max(1, cost)) break;
            } else {
                damping *= 10;
                if (damping > 1e20) break;
            }
        }

        if (!allFinite(vector) || !Number.isFinite(cost)) {
            return failed("final solver state is non-finite", iterations);
        }
        const finalDegeneracy = directionDegeneracy(
            request.graph,
            problem,
            vector,
            this.#config.degeneracyTolerance,
        );
        if (finalDegeneracy) return failed(finalDegeneracy, iterations);

        evaluation = evaluate(request.graph, problem, vector, this.#config);
        const { residuals, maxResidual } = residualSummary(evaluation.hard);
        const tolerance = request.mode === "preview"
            ? this.#config.previewTolerance
            : this.#config.commitTolerance;
        const conflictingConstraintIds = Object.entries(residuals)
            .filter(([, residual]) => residual > tolerance)
            .map(([id]) => id)
            .sort((a, b) => a.localeCompare(b));
        const pointUpdates: Record<PointId, SolverPoint> = {};
        for (let index = 0; index < problem.pointIds.length; index++) {
            pointUpdates[problem.pointIds[index]] = [vector[index * 2], vector[index * 2 + 1]];
        }

        if (conflictingConstraintIds.length > 0) {
            return {
                status: "conflicting",
                pointUpdates: {},
                residuals,
                conflictingConstraintIds,
                iterations,
                objective: cost,
                maxResidual,
                diagnostic: `hard constraints exceed normalized tolerance ${tolerance}`,
            };
        }

        const rankJacobian = numericalJacobian(
            vector,
            evaluation.rankValues,
            problem.scale,
            this.#config.finiteDifferenceStep,
            (candidate) => evaluate(request.graph, problem, candidate, this.#config).rankValues,
        );
        if (!rankJacobian) return failed("rank Jacobian is non-finite", iterations);
        const degreesOfFreedom = Math.max(0, vector.length - matrixRank(rankJacobian));
        return {
            status: degreesOfFreedom === 0 ? "solved" : "under-constrained",
            pointUpdates,
            residuals,
            conflictingConstraintIds: [],
            degreesOfFreedom,
            iterations,
            objective: cost,
            maxResidual,
        };
    }
}
