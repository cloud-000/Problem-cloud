import type { ProblemFact, ResolvedFact } from "./facts";
import type { Policy } from "./policy";
import { factDoc, fittedDoc, noActiveScopeDoc, sectionsDoc } from "../prompt";
import { fit, minChars } from "./fit";

/**
 * How much context is affordable — and nothing else.
 *
 * What the model reads lives in `$lib/ai/prompt.ts`; how a document is made to fit lives
 * in `./fit.ts`. This module only picks the numbers, which is why it is short: the
 * arithmetic that used to be spread through it is now one algorithm the fitter applies
 * to whatever shape the prompt declares.
 */

const MAX_FACTS = 12;
export const MAX_FACT_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 12_000;

/** Stands in for the scope section once a thread has left the problem it was attached to. */
export const NO_ACTIVE_SCOPE_SECTION = fit(noActiveScopeDoc(), MAX_FACT_CHARS);

/**
 * One bounded, independently budgetable section per fact.
 *
 * The policy is the request's *live* one, applied uniformly to every frame rather than
 * replaying whatever was in force when each turn happened. Entering a test must strip
 * the answer key from the whole transcript, not just from the newest frame — a coaching
 * turn from before the lock would otherwise carry it straight into a locked request.
 */
export function renderFactSections(facts: ResolvedFact[], policy: Policy): string[] {
    return facts
        .slice(0, MAX_FACTS)
        .map((fact) => fit(factDoc(fact, policy), MAX_FACT_CHARS))
        .filter(Boolean);
}

/** Chars these sections need to stay worth including; below it, they are shed. */
export function minimumContextChars(sections: string[]): number {
    return minChars(sectionsDoc(sections.map(fittedDoc)));
}

/** Fits whole fact sections into a budget; every omission is explicitly marked. */
export function fitContextSections(sections: string[], maxChars: number): string {
    return fit(sectionsDoc(sections.map(fittedDoc)), maxChars);
}

/** Joins already-fitted sections without re-truncating them. */
export function joinContextSections(sections: string[]): string {
    return fitContextSections(sections, Number.MAX_SAFE_INTEGER);
}

/** Deterministic, centrally budgeted model context. */
export function renderFacts(facts: ResolvedFact[], policy: Policy): string {
    return fitContextSections(renderFactSections(facts, policy), MAX_CONTEXT_CHARS);
}

/** Exposed for tests: one problem section at its full section budget. */
export function renderProblem(fact: ProblemFact, policy: Policy = "coaching"): string {
    return fit(factDoc(fact, policy), MAX_FACT_CHARS);
}
