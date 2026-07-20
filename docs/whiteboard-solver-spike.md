# Whiteboard Solver Spike

Phase 0 measurement and decision record for the smart-geometry solver. The
implementation is isolated under `src/lib/whiteboard/solver/`; it is not imported
by the whiteboard store, tools, renderer, persistence, Svelte components, or the
existing `Scene` model.

Date measured: **2026-07-18**.

---

## 1. Outcome

The dependency-free TypeScript approach is sufficient for the next smart-point
and straight-segment prototypes. The spike implements a neutral solver boundary,
a deterministic dense Levenberg-Marquardt-style solver with numerical
Jacobians, connected-component isolation, temporary drivers/stays, explicit
statuses, and the eight Phase 0 constraint families.

No production dependency was added. The solver remains unreferenced by the
production whiteboard, so this phase adds no code to the current browser bundle.

Use the TypeScript solver behind the neutral interface for Phase 2 prototyping,
then re-evaluate its numerical behavior and dense-matrix scaling before advanced
circle/arc/tangency work. A SolveSpace/WASM integration remains a possible later
replacement, not the Phase 0 choice.

---

## 2. Files and boundary

| File | Purpose |
| --- | --- |
| `src/lib/whiteboard/solver/types.ts` | Neutral graph, constraint, request/result, driver/stay, and solver interfaces. |
| `src/lib/whiteboard/solver/solver.ts` | Pure deterministic nonlinear solver implementation. |
| `src/lib/whiteboard/solver/index.ts` | Public barrel for the isolated spike. |
| `src/lib/whiteboard/solver/solver.test.ts` | Correctness, stability, conflict, determinism, degeneracy, and finiteness tests. |
| `src/lib/whiteboard/solver/benchmark.ts` | Manual representative-component measurement harness. |

The spike graph contains only stable points and straight segments. This is
intentional: Phase 1 owns the canonical document model, and this spike must not
pre-empt or couple itself to that migration.

The public boundary is:

```ts
interface ConstraintSolver {
    solve(request: SolveRequest): SolveResult;
}

interface SolveRequest {
    graph: SolverGraph;
    affected: readonly SolverFeatureRef[];
    drivers: readonly DriverConstraint[];
    stays: readonly StayPreference[];
    mode: "preview" | "commit" | "validate";
}

interface SolveResult {
    status: "solved" | "under-constrained" | "conflicting" | "failed";
    pointUpdates: Record<PointId, SolverPoint>;
    residuals: Record<ConstraintId, number>;
    conflictingConstraintIds: ConstraintId[];
    degreesOfFreedom?: number;
    diagnostic?: string;
    iterations: number;
    objective: number;
    maxResidual: number;
}
```

The solver returns a patch and never mutates its request. `conflicting` and
`failed` results deliberately return no point patch.

---

## 3. Numerical method

The implementation uses a damped nonlinear least-squares loop:

1. Validate all IDs, references, targets, weights, and finite coordinates.
2. Starting from affected features and drivers, collect only connected points
   and hard constraints.
3. Sort point and constraint IDs before assigning variables/equations.
4. Normalize positional residuals by a local component scale derived from its
   bounding diagonal and driving distances.
5. Build a forward numerical Jacobian with a step based on local component scale,
   not absolute world coordinates. This preserves translation invariance for a
   small sketch located far from the origin.
6. Solve damped normal equations with deterministic partial-pivot Gaussian
   elimination.
7. Accept only objective-reducing steps; reduce damping after acceptance and
   increase it after rejection.
8. If the preference solve remains outside tolerance, run a feasibility-only
   projection from that candidate using persisted constraints alone.
9. Validate persisted hard residuals independently from driver/stay preferences.
10. Estimate active degrees of freedom from the numerical Jacobian rank of hard
   constraints plus drivers; stays are excluded from the rank.

Persisted constraints use the same base weight as the pointer driver in the
initial preference solve, which produces a pointer/stay-aware candidate without
making the dense normal equations unnecessarily ill-conditioned. A
feasibility-only projection then
makes persisted constraints the true priority whenever that candidate remains
outside tolerance. A driver defaults to relative weight `1`; a stay defaults to
`1e-3`. This is not a persisted strength system—drivers and stays exist only in
the request.

### Residuals

| Constraint | Normalized residual |
| --- | --- |
| Coincident | x and y coordinate differences divided by component scale. |
| Distance | Current Euclidean distance minus target, divided by scale. |
| Horizontal / vertical | Endpoint y/x difference divided by scale. |
| Parallel | Cross product of normalized segment directions. |
| Perpendicular | Dot product of normalized segment directions. |
| Equal length | Segment-length difference divided by scale. |
| Angle | `acos(clamped dot) - target`, divided by π; target is in `[0, π]`. |

Direction constraints on a zero-length segment return `failed` with a diagnostic
instead of allowing NaN/infinity into the iteration.

### Status semantics

- `solved`: hard constraints satisfy tolerance and the active hard+driver
  Jacobian has no remaining DOF.
- `under-constrained`: hard constraints satisfy tolerance but active DOF remain.
  Stays stabilize the chosen solution without changing this classification.
- `conflicting`: iteration remains finite, but one or more hard residuals exceed
  the mode tolerance. The current conflicting-ID list is the deterministic set
  of constraints over tolerance, not a proven minimal conflict set.
- `failed`: invalid references/values, direction-degenerate input, singular or
  non-finite numerical work, or another condition for which no candidate is
  safe to return.

---

## 4. Measured tolerances and budgets

Defaults selected by the spike:

| Setting | Value | Reason |
| --- | ---: | --- |
| Commit/validate normalized hard tolerance | `1e-7` | All valid test constructions converge below it while contradictory dimensions remain clearly conflicting. |
| Preview normalized hard tolerance | `1e-5` | Allows a lower iteration cap without treating small interactive error as a conflict. Commit still revalidates at `1e-7`. |
| Direction-degenerate normalized length | `1e-9` | Rejects undefined directions before normalization. |
| Relative numerical-Jacobian step | `1e-6` | Stable in ordinary and million-coordinate translation tests when multiplied by local component scale. |
| Preview iteration cap | `24` per phase | Covers the measured interactive chains without a nondeterministic wall-clock cutoff. |
| Commit/validate iteration cap | `80` per phase | Provides extra convergence room for the preference solve and, when needed, hard-feasibility projection. |
| Initial damping | `1e-3` | Stable across the test corpus. |
| Preference-pass hard multiplier | `1` | Balances the initial candidate with the pointer driver; the separate feasibility pass provides strict priority. |

The solver intentionally has no elapsed-time abort. An iteration cap is
deterministic; a wall-clock abort would make identical solves differ by machine
load. The UI may later abandon a stale preview outside the solver boundary.

Phase 2 performance gates selected from this spike:

- **24-point / 46-hard-constraint continuous preview:** target p95 at or below
  **8 ms** on the recorded arm64 baseline.
- **48-point / 94-hard-constraint preview:** target p95 at or below **10 ms** on
  the recorded arm64 baseline.
- Commit correctness is tolerance-based, not time-based. Commit timing is
  measured and watched, but no synchronous rejection threshold is set yet.

These are baseline regression gates, not cross-device guarantees. Phase 2 must
repeat measurements on representative browser hardware before shipping.

---

## 5. Tests

Command:

```bash
bun test src/lib/whiteboard/solver/solver.test.ts
```

Result on 2026-07-18:

```text
15 pass
0 fail
398 expect() calls
```

Coverage includes:

- coincidence, distance, horizontal, vertical, parallel, perpendicular,
  equal-length, and angle individually;
- a fully determined connected right-angle construction with two dimensions;
- temporary pointer drivers and weak stay preferences;
- stable under-constrained dragging with an unrelated constraint component left
  out of the returned patch;
- contradictory distance constraints returning `conflicting` atomically;
- zero-length direction segments returning `failed` without non-finite output;
- request immutability and exact repeated-result determinism;
- 40 continuous small pointer movements with bounded successive output;
- finite residuals, objective, and coordinates around million-unit world
  positions.

Repository static check:

```text
bun run check
svelte-check found 0 errors and 0 warnings
```

---

## 6. Benchmark harness and results

Command:

```bash
bun run src/lib/whiteboard/solver/benchmark.ts
```

Environment:

- Darwin 25.5.0, arm64
- Bun 1.3.14
- Exact CPU model was not exposed inside the managed sandbox.

The harness creates connected horizontal unit-segment chains with small initial
perturbations, a driver on the first point, and weak stays on the remaining
points. Each link contributes a horizontal and distance constraint. It warms up
five times before recording samples.

| Case | Points / variables | Hard constraints | Samples | Median | p95 | Max | Median iterations | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Small preview chain | 8 / 16 | 14 | 100 | 0.607 ms | 1.131 ms | 1.378 ms | 17 | solved |
| Medium preview chain | 24 / 48 | 46 | 40 | 5.359 ms | 5.747 ms | 6.503 ms | 19 | solved |
| Large preview chain | 48 / 96 | 94 | 15 | 7.733 ms | 8.003 ms | 8.003 ms | 5 | solved |
| Medium commit chain | 24 / 48 | 46 | 30 | 5.443 ms | 5.655 ms | 5.655 ms | 19 | solved |
| Continuous preview drag | 24 / 48 | 46 | 80 frames | 5.447 ms | 5.783 ms | 5.935 ms | 19 | solved |

Maximum normalized hard residuals ranged from approximately `4.3e-15` to
`1.2e-13` in these cases.

The 48-point chain taking fewer iterations than the 24-point chain is a property
of these initial perturbations and the component normalization; it is not
evidence of favorable asymptotic scaling. The implementation uses dense
Jacobians and dense normal equations. Numerical-Jacobian construction grows with
residuals × variables, and the linear solve is cubic in variable count. Hundreds
of connected point variables will require new measurements and likely analytic
or automatic derivatives plus sparse/decomposed linear algebra.

---

## 7. TypeScript versus SolveSpace/WASM

| Consideration | TypeScript spike | SolveSpace/WASM integration |
| --- | --- | --- |
| Constraint coverage | The eight required point/segment constraints only. Circles, arcs, tangency, symbolic equations, and mature conflict handling are absent. | SolveSpace has a broad, proven CAD entity/constraint vocabulary and DOF/conflict behavior. |
| API fit | The request/result shape directly uses ProblemCloud IDs, connected components, drivers, stays, residual attribution, and immutable patches. | Requires an adapter for SolveSpace entities/handles, memory ownership, workplanes/groups, result mapping, and deterministic ProblemCloud ID attribution. The official library page describes the solver as heavily coupled to the application. |
| Browser/bundle | No dependency; about 31 KB of unminified TypeScript across the boundary and solver implementation. It currently contributes zero production bundle bytes because nothing imports it. | Requires an Emscripten/WASM build and JavaScript bridge. Bundle/startup/memory cost was not measured because no integration was added; it must be measured rather than assumed. |
| Numerical maintenance | ProblemCloud owns convergence, derivatives, ranks, conflict diagnostics, and future sparse scaling. This is the largest long-term risk. | Mature modified-Newton/symbolic machinery reduces solver invention, but integration follows SolveSpace’s data model and release/build pipeline. |
| Determinism/testing | Stable ID ordering and exact repeated solve results are covered locally. | Must verify deterministic entity ordering, branch selection, and conflict mapping through the WASM boundary. |
| License | Original project code; no new dependency license. | SolveSpace is GPLv3-or-later. Its official library page says embedding is generally incompatible with proprietary linking and suggests commercial licensing inquiries. Product/source-distribution compatibility requires legal/product review before adoption. |

Primary references:

- [SolveSpace technology: symbolic equations and modified Newton solving](https://solvespace.com/tech.pl)
- [SolveSpace library notes: coupling and GPLv3](https://solvespace.com/library.pl)
- [SolveSpace source and GPL-3.0-or-later license](https://github.com/solvespace/solvespace)

The licensing note above is an engineering adoption risk, not legal advice.

---

## 8. Decision and follow-up risks

Phase 0 decision:

1. Keep the neutral `ConstraintSolver` boundary.
2. Use the dependency-free TypeScript solver as the Phase 2 baseline for smart
   points and straight segments.
3. Add no production solver dependency now.
4. Keep SolveSpace/WASM deferred until circle/arc/tangency scope or measured
   scaling justifies an integration spike and license review.
5. Preserve the selected normalized tolerances and deterministic iteration caps
   as explicit defaults and regression-test them.

Known limitations that must not be mistaken for production completion:

- Conflict IDs are residual-based, not a minimal unsatisfiable set.
- Numerical forward differences are slower and less precise than analytic or
  automatic derivatives.
- Dense normal equations do not scale to large connected sketches.
- The smaller-angle convention is adequate for this spike but Phase 4 must still
  settle supplementary/reflex angle UI semantics.
- A direction constraint with a zero-length segment is rejected rather than
  automatically regularized.
- This spike contains no canonical document, persistence, Svelte, tool,
  rendering, or Asymptote integration. Those remain later phases.
