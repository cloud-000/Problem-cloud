import { describe, expect, test } from "bun:test";
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

const solver = new DampedLeastSquaresSolver();

function graph(
    pointCoordinates: Record<string, SolverPoint>,
    segments: SegmentEntity[],
    constraints: SolverConstraint[],
): SolverGraph {
    const points: Record<string, PointVariable> = {};
    for (const [id, at] of Object.entries(pointCoordinates)) points[id] = { id, at };
    return {
        points,
        segments: Object.fromEntries(segments.map((segment) => [segment.id, segment])),
        constraints,
    };
}

function request(
    value: SolverGraph,
    overrides: Partial<Omit<SolveRequest, "graph">> = {},
): SolveRequest {
    return {
        graph: value,
        affected: [],
        drivers: [],
        stays: [],
        mode: "commit",
        ...overrides,
    };
}

function point(result: SolveResult, id: string): SolverPoint {
    const value = result.pointUpdates[id];
    if (!value) throw new Error(`missing point update ${id}: ${result.diagnostic ?? result.status}`);
    return value;
}

function distance(a: SolverPoint, b: SolverPoint): number {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function direction(a: SolverPoint, b: SolverPoint): SolverPoint {
    const length = distance(a, b);
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
}

function angleBetween(a: SolverPoint, b: SolverPoint, c: SolverPoint, d: SolverPoint): number {
    const u = direction(a, b);
    const v = direction(c, d);
    return Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
}

function expectSatisfied(result: SolveResult, constraintId: string): void {
    expect(["solved", "under-constrained"]).toContain(result.status);
    expect(result.residuals[constraintId]).toBeLessThanOrEqual(1e-7);
    expect(result.maxResidual).toBeLessThanOrEqual(1e-7);
}

describe("DampedLeastSquaresSolver individual constraints", () => {
    test("fixed point", () => {
        const result = solver.solve(request(graph(
            { a: [4, 7] },
            [],
            [{ id: "fixed", kind: "fixed-point", point: "a", at: [1, 2] }],
        ), { affected: [{ kind: "point", pointId: "a" }] }));
        expect(result.status).toBe("solved");
        expect(result.pointUpdates.a[0]).toBeCloseTo(1, 7);
        expect(result.pointUpdates.a[1]).toBeCloseTo(2, 7);
        expectSatisfied(result, "fixed");
    });
    test("coincidence", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [2, 1] },
            [],
            [{ id: "coincident", kind: "coincident", a: "a", b: "b" }],
        )));

        expectSatisfied(result, "coincident");
        expect(point(result, "a")[0]).toBeCloseTo(point(result, "b")[0], 7);
        expect(point(result, "a")[1]).toBeCloseTo(point(result, "b")[1], 7);
    });

    test("distance", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [3, 0] },
            [],
            [{ id: "distance", kind: "distance", a: "a", b: "b", distance: 5 }],
        )));

        expectSatisfied(result, "distance");
        expect(distance(point(result, "a"), point(result, "b"))).toBeCloseTo(5, 6);
    });

    test("horizontal", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [2, 2] },
            [{ id: "ab", start: "a", end: "b" }],
            [{ id: "horizontal", kind: "horizontal", segment: "ab" }],
        )));

        expectSatisfied(result, "horizontal");
        expect(point(result, "a")[1]).toBeCloseTo(point(result, "b")[1], 7);
    });

    test("vertical", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [2, 2] },
            [{ id: "ab", start: "a", end: "b" }],
            [{ id: "vertical", kind: "vertical", segment: "ab" }],
        )));

        expectSatisfied(result, "vertical");
        expect(point(result, "a")[0]).toBeCloseTo(point(result, "b")[0], 7);
    });

    test("parallel", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [2, 0], c: [0, 2], d: [1, 3] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "cd", start: "c", end: "d" },
            ],
            [{ id: "parallel", kind: "parallel", a: "ab", b: "cd" }],
        )));

        expectSatisfied(result, "parallel");
        const u = direction(point(result, "a"), point(result, "b"));
        const v = direction(point(result, "c"), point(result, "d"));
        expect(Math.abs(u[0] * v[1] - u[1] * v[0])).toBeLessThan(1e-7);
    });

    test("perpendicular", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [2, 0], c: [0, 2], d: [1, 3] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "cd", start: "c", end: "d" },
            ],
            [{ id: "perpendicular", kind: "perpendicular", a: "ab", b: "cd" }],
        )));

        expectSatisfied(result, "perpendicular");
        const u = direction(point(result, "a"), point(result, "b"));
        const v = direction(point(result, "c"), point(result, "d"));
        expect(Math.abs(u[0] * v[0] + u[1] * v[1])).toBeLessThan(1e-7);
    });

    test("equal length", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [3, 0], c: [0, 2], d: [1, 2] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "cd", start: "c", end: "d" },
            ],
            [{ id: "equal", kind: "equal-length", a: "ab", b: "cd" }],
        )));

        expectSatisfied(result, "equal");
        expect(distance(point(result, "a"), point(result, "b"))).toBeCloseTo(
            distance(point(result, "c"), point(result, "d")),
            6,
        );
    });

    test("angle", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [2, 0], c: [0, 2], d: [1, 3] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "cd", start: "c", end: "d" },
            ],
            [{ id: "angle", kind: "angle", a: "ab", b: "cd", angle: Math.PI / 3 }],
        )));

        expectSatisfied(result, "angle");
        expect(angleBetween(
            point(result, "a"),
            point(result, "b"),
            point(result, "c"),
            point(result, "d"),
        )).toBeCloseTo(Math.PI / 3, 6);
    });
});

describe("DampedLeastSquaresSolver connected behavior", () => {
    test("keeps a parallel drag under the pointer without a release jump", () => {
        const value = graph(
            { a: [0, 0], b: [4, 0], c: [0, 5], d: [2, 9] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "cd", start: "c", end: "d" },
            ],
            [{ id: "parallel", kind: "parallel", a: "ab", b: "cd" }],
        );
        const preferences = {
            affected: [{ kind: "point", pointId: "b" }],
            drivers: [{ pointId: "b", target: [4, 3] }],
            stays: [
                { pointId: "a" },
                { pointId: "c" },
                { pointId: "d" },
            ],
        } satisfies Pick<SolveRequest, "affected" | "drivers" | "stays">;
        const preview = solver.solve(request(value, { ...preferences, mode: "preview" }));
        const result = solver.solve(request(value, {
            ...preferences,
            initialPoints: preview.pointUpdates,
            mode: "commit",
        }));

        expectSatisfied(preview, "parallel");
        expectSatisfied(result, "parallel");
        expect(result.status).toBe("under-constrained");
        expect(distance(point(preview, "b"), [4, 3])).toBeLessThan(0.01);
        expect(distance(point(result, "b"), [4, 3])).toBeLessThan(0.01);
        expect(distance(point(preview, "b"), point(result, "b"))).toBeLessThan(0.001);
    });

    test("solves multiple connected constraints with drag drivers", () => {
        const value = graph(
            { a: [0.2, 0.1], b: [3.1, 0.2], c: [0.1, 3.8] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "ac", start: "a", end: "c" },
            ],
            [
                { id: "ab-horizontal", kind: "horizontal", segment: "ab" },
                { id: "ab-length", kind: "distance", a: "a", b: "b", distance: 3 },
                { id: "right-angle", kind: "perpendicular", a: "ab", b: "ac" },
                { id: "ac-length", kind: "distance", a: "a", b: "c", distance: 4 },
            ],
        );
        const result = solver.solve(request(value, {
            affected: [{ kind: "point", pointId: "a" }],
            drivers: [{ pointId: "a", target: [0, 0] }],
            stays: [
                { pointId: "b" },
                { pointId: "c" },
            ],
        }));

        expect(result.status).toBe("solved");
        expect(result.degreesOfFreedom).toBe(0);
        expect(result.maxResidual).toBeLessThanOrEqual(1e-7);
        // Drivers are strong preferences rather than hard persisted constraints;
        // weak stays may leave a sub-milliscene-unit compromise at the anchor.
        expect(point(result, "a")[0]).toBeCloseTo(0, 3);
        expect(point(result, "a")[1]).toBeCloseTo(0, 3);
        expect(distance(point(result, "a"), point(result, "b"))).toBeCloseTo(3, 6);
        expect(distance(point(result, "a"), point(result, "c"))).toBeCloseTo(4, 6);
        expect(angleBetween(
            point(result, "a"),
            point(result, "b"),
            point(result, "a"),
            point(result, "c"),
        )).toBeCloseTo(Math.PI / 2, 6);
    });

    test("under-constrained dragging preserves free coordinates and ignores unrelated components", () => {
        const value = graph(
            { a: [0, 0], b: [2, 0], u: [100, 100], v: [100, 104] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "uv", start: "u", end: "v" },
            ],
            [
                { id: "ab-horizontal", kind: "horizontal", segment: "ab" },
                { id: "uv-vertical", kind: "vertical", segment: "uv" },
            ],
        );
        const result = solver.solve(request(value, {
            affected: [{ kind: "segment", segmentId: "ab" }],
            drivers: [{ pointId: "b", target: [3, 0] }],
            stays: [{ pointId: "a" }],
        }));

        expect(result.status).toBe("under-constrained");
        expect(result.degreesOfFreedom).toBe(1);
        expect(point(result, "a")[0]).toBeCloseTo(0, 6);
        expect(point(result, "a")[1]).toBeCloseTo(0, 6);
        expect(point(result, "b")[0]).toBeCloseTo(3, 5);
        expect(point(result, "b")[1]).toBeCloseTo(0, 6);
        expect(result.pointUpdates.u).toBeUndefined();
        expect(result.pointUpdates.v).toBeUndefined();
        expect(result.residuals["uv-vertical"]).toBeUndefined();
    });

    test("reports impossible hard constraints without returning a geometry patch", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [1, 0] },
            [],
            [
                { id: "distance-one", kind: "distance", a: "a", b: "b", distance: 1 },
                { id: "distance-two", kind: "distance", a: "a", b: "b", distance: 2 },
            ],
        )));

        expect(result.status).toBe("conflicting");
        expect(result.pointUpdates).toEqual({});
        expect(result.conflictingConstraintIds).toEqual(["distance-one", "distance-two"]);
        expect(result.maxResidual).toBeGreaterThan(0.1);
        expect(Number.isFinite(result.objective)).toBe(true);
    });

    test("reports direction constraints on a zero-length segment as failed", () => {
        const result = solver.solve(request(graph(
            { a: [0, 0], b: [0, 0], c: [0, 1], d: [1, 1] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "cd", start: "c", end: "d" },
            ],
            [{ id: "parallel", kind: "parallel", a: "ab", b: "cd" }],
        )));

        expect(result.status).toBe("failed");
        expect(result.pointUpdates).toEqual({});
        expect(result.diagnostic).toContain("degenerate segment ab");
    });

    test("does not mutate the request and repeated solves are deterministic", () => {
        const value = graph(
            { a: [0, 0], b: [2, 1], c: [4, 2] },
            [
                { id: "ab", start: "a", end: "b" },
                { id: "bc", start: "b", end: "c" },
            ],
            [
                { id: "horizontal", kind: "horizontal", segment: "ab" },
                { id: "equal", kind: "equal-length", a: "ab", b: "bc" },
            ],
        );
        const input = request(value, {
            drivers: [{ pointId: "a", target: [-1, 0] }],
            stays: [{ pointId: "c" }],
        });
        const before = structuredClone(input);
        const first = solver.solve(input);

        expect(input).toEqual(before);
        for (let index = 0; index < 10; index++) expect(solver.solve(input)).toEqual(first);
    });

    test("continuous small pointer movements produce continuous finite geometry", () => {
        let value = graph(
            { a: [0, 0], b: [2, 0] },
            [{ id: "ab", start: "a", end: "b" }],
            [{ id: "horizontal", kind: "horizontal", segment: "ab" }],
        );
        let previous = value.points.b.at;

        for (let frame = 1; frame <= 40; frame++) {
            const target: SolverPoint = [2 + frame * 0.005, frame * 0.001];
            const result = solver.solve(request(value, {
                affected: [{ kind: "segment", segmentId: "ab" }],
                drivers: [{ pointId: "b", target }],
                stays: [{ pointId: "a", weight: 0.1 }],
                mode: "preview",
            }));
            expect(["solved", "under-constrained"]).toContain(result.status);
            expect(result.maxResidual).toBeLessThanOrEqual(1e-5);
            for (const update of Object.values(result.pointUpdates)) {
                expect(Number.isFinite(update[0])).toBe(true);
                expect(Number.isFinite(update[1])).toBe(true);
            }
            const next = point(result, "b");
            expect(next[0]).toBeGreaterThanOrEqual(previous[0] - 1e-8);
            expect(distance(previous, next)).toBeLessThan(0.02);
            previous = next;
            value = graph(
                { a: point(result, "a"), b: next },
                [{ id: "ab", start: "a", end: "b" }],
                [{ id: "horizontal", kind: "horizontal", segment: "ab" }],
            );
        }
    });

    test("all successful outputs and diagnostics remain finite at large coordinates", () => {
        const result = solver.solve(request(graph(
            { a: [1_000_000, -1_000_000], b: [1_000_003, -999_996] },
            [{ id: "ab", start: "a", end: "b" }],
            [
                { id: "distance", kind: "distance", a: "a", b: "b", distance: 10 },
                { id: "horizontal", kind: "horizontal", segment: "ab" },
            ],
        ), {
            drivers: [{ pointId: "a", target: [1_000_000, -1_000_000] }],
        }));

        expect(["solved", "under-constrained"]).toContain(result.status);
        expect(Number.isFinite(result.objective)).toBe(true);
        expect(Number.isFinite(result.maxResidual)).toBe(true);
        for (const value of Object.values(result.residuals)) expect(Number.isFinite(value)).toBe(true);
        for (const update of Object.values(result.pointUpdates)) {
            expect(Number.isFinite(update[0])).toBe(true);
            expect(Number.isFinite(update[1])).toBe(true);
        }
    });
});
