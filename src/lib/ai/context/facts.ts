import type { Policy } from "./policy";

/** Stable, compact references. This is the only context shape persisted with a turn. */
export type FactRef =
    | { kind: "problem"; id: number }
    | { kind: "test"; id: number }
    | { kind: "series"; id: number }
    | {
          kind: "attempt";
          problemId: number;
          answer: string | null;
          triesUsed: number;
          submitted: boolean;
          revealed: boolean;
          elapsedMs: number;
      }
    | { kind: "user-profile" }
    | { kind: "selection"; text: string };

/**
 * Versioned payload stored in `ai_messages.context_snapshot`.
 *
 * Scope describes the durable environment a run of turns shares. Attachments are
 * intentionally one-turn-only. Keeping them separate lets the request compiler emit a
 * problem once per context epoch without losing explicit selections or attempt details.
 */
export interface ContextSnapshot {
    version: 2;
    policy: Policy;
    scope: FactRef[];
    attachments: FactRef[];
}

export function contextSnapshot(refs: FactRef[], policy: Policy): ContextSnapshot {
    const scope: FactRef[] = [];
    const attachments: FactRef[] = [];
    for (const ref of refs) {
        if (ref.kind === "problem" || ref.kind === "test" || ref.kind === "series") scope.push(ref);
        else attachments.push(ref);
    }
    return { version: 2, policy, scope, attachments };
}

export interface FactWarning {
    code: "missing" | "answer_missing" | "answer_unverified";
    message: string;
}

export interface ProblemFact {
    kind: "problem";
    id: number;
    statement: string;
    choices: string[] | null;
    warnings: FactWarning[];
}

export interface TestFact {
    kind: "test";
    id: number;
    name: string;
    series: string | null;
    warnings: FactWarning[];
}

export interface SeriesFact {
    kind: "series";
    id: number;
    name: string;
    warnings: FactWarning[];
}

export type AttemptFact = Extract<FactRef, { kind: "attempt" }>;

export interface UserProfileFact {
    kind: "user-profile";
    rating: number | null;
    activeSession: string | null;
    recentTopics: string[];
    warnings: FactWarning[];
}

export type ResolvedFact =
    | ProblemFact
    | TestFact
    | SeriesFact
    | AttemptFact
    | UserProfileFact
    | Extract<FactRef, { kind: "selection" }>;

export interface CoachContextDescriptor {
    /** UI identity for attach/detach behavior; never persisted. */
    id: string;
    /** Human-readable context-chip label; never used as model context. */
    label: string;
    /** The durable fact reference captured on each user turn. */
    ref: FactRef;
}
