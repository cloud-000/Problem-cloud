/** A finite 2D point in the whiteboard's y-up scene coordinate system. */
export type SolverPoint = readonly [x: number, y: number];

export type PointId = string;
export type SegmentId = string;
export type ConstraintId = string;

export interface PointVariable {
    id: PointId;
    at: SolverPoint;
}

export interface SegmentEntity {
    id: SegmentId;
    start: PointId;
    end: PointId;
}

interface ConstraintBase {
    id: ConstraintId;
}

/**
 * Phase 0's deliberately small constraint vocabulary. It models only point and
 * straight-segment geometry, keeping the solver independent from the future
 * canonical whiteboard document.
 */
export type SolverConstraint =
    | (ConstraintBase & {
          kind: "fixed-point";
          point: PointId;
          at: SolverPoint;
      })
    | (ConstraintBase & {
          kind: "coincident";
          a: PointId;
          b: PointId;
      })
    | (ConstraintBase & {
          kind: "distance";
          a: PointId;
          b: PointId;
          distance: number;
      })
    | (ConstraintBase & {
          kind: "horizontal";
          segment: SegmentId;
      })
    | (ConstraintBase & {
          kind: "vertical";
          segment: SegmentId;
      })
    | (ConstraintBase & {
          kind: "parallel";
          a: SegmentId;
          b: SegmentId;
      })
    | (ConstraintBase & {
          kind: "perpendicular";
          a: SegmentId;
          b: SegmentId;
      })
    | (ConstraintBase & {
          kind: "equal-length";
          a: SegmentId;
          b: SegmentId;
      })
    | (ConstraintBase & {
          /** Smaller directed-vector angle in radians, constrained to [0, π]. */
          kind: "angle";
          a: SegmentId;
          b: SegmentId;
          angle: number;
      });

export interface SolverGraph {
    points: Readonly<Record<PointId, PointVariable>>;
    segments: Readonly<Record<SegmentId, SegmentEntity>>;
    constraints: readonly SolverConstraint[];
}

export type SolverFeatureRef =
    | { kind: "point"; pointId: PointId }
    | { kind: "segment"; segmentId: SegmentId };

/** A strong, temporary request for a point to follow the pointer. */
export interface DriverConstraint {
    pointId: PointId;
    target: SolverPoint;
    /** Relative preference weight. Defaults to 1. */
    weight?: number;
}

/** A weak, temporary preference that removes arbitrary under-constrained drift. */
export interface StayPreference {
    pointId: PointId;
    /** Defaults to the point's committed position in the request graph. */
    target?: SolverPoint;
    /** Relative preference weight. Defaults to 1e-3. */
    weight?: number;
}

export interface SolveRequest {
    graph: SolverGraph;
    /** Optional previous solution used only as the numerical starting point. */
    initialPoints?: Readonly<Record<PointId, SolverPoint>>;
    /** Seeds the connected component to solve. Empty means every constrained component. */
    affected: readonly SolverFeatureRef[];
    drivers: readonly DriverConstraint[];
    stays: readonly StayPreference[];
    mode: "preview" | "commit" | "validate";
}

export type SolveStatus = "solved" | "under-constrained" | "conflicting" | "failed";

export interface SolveResult {
    status: SolveStatus;
    /** Patch for the solved connected component only. */
    pointUpdates: Record<PointId, SolverPoint>;
    /** Maximum absolute normalized residual for each active persisted constraint. */
    residuals: Record<ConstraintId, number>;
    conflictingConstraintIds: ConstraintId[];
    degreesOfFreedom?: number;
    diagnostic?: string;
    iterations: number;
    objective: number;
    maxResidual: number;
}

/** Neutral boundary: callers know neither the numerical method nor its storage. */
export interface ConstraintSolver {
    solve(request: SolveRequest): SolveResult;
}

export interface NonlinearSolverOptions {
    /** Normalized hard-constraint tolerance for commit/validate. Default 1e-7. */
    commitTolerance?: number;
    /** Normalized hard-constraint tolerance for interactive previews. Default 1e-5. */
    previewTolerance?: number;
    /** Maximum accepted LM iterations in commit/validate. Default 80. */
    commitIterations?: number;
    /** Maximum accepted LM iterations in preview. Default 24. */
    previewIterations?: number;
    /** Relative forward-difference step. Default 1e-6. */
    finiteDifferenceStep?: number;
    /** Initial Levenberg-Marquardt damping. Default 1e-3. */
    initialDamping?: number;
    /** Residual multiplier for the preference solve before hard-feasibility projection. Default 1. */
    hardConstraintMultiplier?: number;
    /** Segment length at or below this normalized threshold is direction-degenerate. Default 1e-9. */
    degeneracyTolerance?: number;
}
