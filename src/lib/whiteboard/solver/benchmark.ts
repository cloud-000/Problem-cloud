/**
 * Manual Phase 0 measurement harness.
 *
 * Run with:
 *   bun run src/lib/whiteboard/solver/benchmark.ts
 *
 * It is intentionally not part of the unit suite: wall-clock measurements are
 * machine-dependent, while the solver's correctness/determinism tests are not.
 */

import {
    DampedLeastSquaresSolver,
    type PointVariable,
    type SegmentEntity,
    type SolveRequest,
    type SolveResult,
    type SolverConstraint,
    type SolverGraph,
    type SolverPoint,
} from ".";

interface Measurement {
    name: string;
    points: number;
    variables: number;
    hardConstraints: number;
    samples: number;
    medianMs: number;
    p95Ms: number;
    maxMs: number;
    medianIterations: number;
    status: SolveResult["status"];
    maxResidual: number;
}

const solver = new DampedLeastSquaresSolver();

function chainRequest(pointCount: number, mode: SolveRequest["mode"]): SolveRequest {
    const points: Record<string, PointVariable> = {};
    const segments: Record<string, SegmentEntity> = {};
    const constraints: SolverConstraint[] = [];
    for (let index = 0; index < pointCount; index++) {
        const id = `p${index.toString().padStart(3, "0")}`;
        points[id] = {
            id,
            at: [
                index + Math.sin(index * 1.7) * 0.025,
                Math.cos(index * 0.9) * 0.025,
            ],
        };
        if (index === 0) continue;
        const previous = `p${(index - 1).toString().padStart(3, "0")}`;
        const segmentId = `s${(index - 1).toString().padStart(3, "0")}`;
        segments[segmentId] = { id: segmentId, start: previous, end: id };
        constraints.push(
            { id: `${segmentId}-horizontal`, kind: "horizontal", segment: segmentId },
            { id: `${segmentId}-length`, kind: "distance", a: previous, b: id, distance: 1 },
        );
    }
    const graph: SolverGraph = { points, segments, constraints };
    return {
        graph,
        affected: [{ kind: "point", pointId: "p000" }],
        drivers: [{ pointId: "p000", target: [0, 0] }],
        stays: Object.keys(points).slice(1).map((pointId) => ({ pointId, weight: 1e-4 })),
        mode,
    };
}

function percentile(sorted: readonly number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function rounded(value: number): number {
    return Number(value.toFixed(3));
}

function measure(name: string, request: SolveRequest, samples: number): Measurement {
    for (let index = 0; index < 5; index++) solver.solve(request);
    const durations: number[] = [];
    const iterations: number[] = [];
    let result = solver.solve(request);
    for (let index = 0; index < samples; index++) {
        const start = performance.now();
        result = solver.solve(request);
        durations.push(performance.now() - start);
        iterations.push(result.iterations);
    }
    durations.sort((a, b) => a - b);
    iterations.sort((a, b) => a - b);
    return {
        name,
        points: Object.keys(request.graph.points).length,
        variables: Object.keys(request.graph.points).length * 2,
        hardConstraints: request.graph.constraints.length,
        samples,
        medianMs: rounded(percentile(durations, 0.5)),
        p95Ms: rounded(percentile(durations, 0.95)),
        maxMs: rounded(durations.at(-1) ?? 0),
        medianIterations: percentile(iterations, 0.5),
        status: result.status,
        maxResidual: Number(result.maxResidual.toExponential(3)),
    };
}

function graphWithUpdates(graph: SolverGraph, updates: Record<string, SolverPoint>): SolverGraph {
    const points: Record<string, PointVariable> = {};
    for (const [id, point] of Object.entries(graph.points)) {
        points[id] = { ...point, at: updates[id] ?? point.at };
    }
    return { ...graph, points };
}

function measureContinuousDrag(pointCount: number, frames: number): Measurement {
    let request = chainRequest(pointCount, "preview");
    const durations: number[] = [];
    const iterations: number[] = [];
    let result = solver.solve(request);
    for (let frame = 0; frame < frames + 5; frame++) {
        request = {
            ...request,
            graph: graphWithUpdates(request.graph, result.pointUpdates),
            drivers: [{ pointId: "p000", target: [frame * 0.01, frame * 0.004] }],
        };
        const start = performance.now();
        result = solver.solve(request);
        const elapsed = performance.now() - start;
        if (frame >= 5) {
            durations.push(elapsed);
            iterations.push(result.iterations);
        }
    }
    durations.sort((a, b) => a - b);
    iterations.sort((a, b) => a - b);
    return {
        name: "continuous-preview-drag",
        points: pointCount,
        variables: pointCount * 2,
        hardConstraints: request.graph.constraints.length,
        samples: frames,
        medianMs: rounded(percentile(durations, 0.5)),
        p95Ms: rounded(percentile(durations, 0.95)),
        maxMs: rounded(durations.at(-1) ?? 0),
        medianIterations: percentile(iterations, 0.5),
        status: result.status,
        maxResidual: Number(result.maxResidual.toExponential(3)),
    };
}

const measurements = [
    measure("preview-chain-small", chainRequest(8, "preview"), 100),
    measure("preview-chain-medium", chainRequest(24, "preview"), 40),
    measure("preview-chain-large", chainRequest(48, "preview"), 15),
    measure("commit-chain-medium", chainRequest(24, "commit"), 30),
    measureContinuousDrag(24, 80),
];

console.log(JSON.stringify(measurements, null, 2));
