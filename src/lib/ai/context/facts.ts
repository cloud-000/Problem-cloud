import type { Policy } from "./policy";

/** Stable, re-resolvable context shared across adjacent turns. */
export type ScopeRef =
    | { kind: "problem"; id: number }
    | { kind: "test"; id: number }
    | { kind: "series"; id: number };

/** Explicit, one-turn context that cannot be re-resolved later. */
export type AttachmentRef = { kind: "selection"; text: string };

/** The only active context shapes persisted with a turn. */
export type FactRef = ScopeRef | AttachmentRef;

/**
 * Versioned payload stored in `ai_messages.context_snapshot`.
 *
 * Scope describes the durable environment a run of turns shares. Attachments are
 * intentionally one-turn-only. Keeping them separate lets the request compiler emit a
 * problem once per context epoch without losing explicit selections.
 */
export interface ContextSnapshot {
    version: 2;
    policy: Policy;
    scope: ScopeRef[];
    attachments: AttachmentRef[];
}

export function contextSnapshot(refs: FactRef[], policy: Policy): ContextSnapshot {
    const scope: ScopeRef[] = [];
    const attachments: AttachmentRef[] = [];
    for (const ref of refs) {
        if (ref.kind === "selection") attachments.push(ref);
        else scope.push(ref);
    }
    return { version: 2, policy, scope, attachments };
}

export interface FactWarning {
    code: "missing";
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

export type ResolvedFact =
    | ProblemFact
    | TestFact
    | SeriesFact
    | AttachmentRef;

export interface CoachContextDescriptor {
    /** UI identity for attach/detach behavior; never persisted. */
    id: string;
    /** Human-readable context-chip label; never used as model context. */
    label: string;
    /** The durable fact reference captured on each user turn. */
    ref: FactRef;
}
