import { problemLabel } from "$lib/utils";
import { PROBLEM_QUICK_ACTIONS } from "../quick-actions";
import type { AIContextSource, CoachContextLayer, CoachQuickAction } from "../types";
import type { Policy } from "./policy";

/**
 * How the surfaces that can summon the Coach declare their context.
 *
 * The registry (`./registry.ts`) resolves *which* layer wins; this decides what a layer
 * looks like in the first place. Both used to be written out by hand at each call site,
 * so the priority ladder existed only as bare numbers in two `.svelte` files and the
 * canonical-id rule was re-derived independently at each one.
 */

/**
 * The ladder the registry sorts on: an explicitly selected thing outranks the trainer's
 * current problem, which outranks whatever route the student happens to be on.
 *
 * Named here so the ordering is legible in one place and reviewable as a whole, rather
 * than inferred from `priority={20}` and `priority={30}` in two unrelated components.
 */
export const CONTEXT_PRIORITY = {
    route: 10,
    trainer: 20,
    modal: 25,
    selection: 30,
} as const satisfies Record<AIContextSource, number>;

/** The fields a problem row must carry to become Coach context. */
export interface ContextProblem {
    id: number;
    n: number;
    canonical_id?: number | null;
    tests?: { name?: string | null } | null;
}

export interface ProblemContextLayerOptions {
    /** Which registration this replaces on re-render; one per surface. */
    ownerId: string;
    source: AIContextSource;
    problem: ContextProblem;
    policy: Policy;
    quickActions?: readonly CoachQuickAction[];
}

/**
 * The single definition of a problem context layer.
 *
 * The canonical id is resolved here and used for **both** the model reference and the
 * descriptor's UI identity. Two surfaces holding different placements of the same shared
 * problem (AMC 10A #18 == AMC 12A #12) therefore collapse to one chip and one fact,
 * which keying the descriptor on the placement id quietly failed to do.
 */
export function problemContextLayer(options: ProblemContextLayerOptions): CoachContextLayer {
    const canonicalId = options.problem.canonical_id ?? options.problem.id;
    return {
        ownerId: options.ownerId,
        source: options.source,
        priority: CONTEXT_PRIORITY[options.source],
        policy: options.policy,
        descriptors: [
            {
                id: `problem:${canonicalId}`,
                label: problemLabel(options.problem),
                ref: { kind: "problem", id: canonicalId },
            },
        ],
        quickActions: [...(options.quickActions ?? PROBLEM_QUICK_ACTIONS)],
    };
}
