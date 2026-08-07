export const CONTEXT_POLICIES = ["coaching", "test-locked", "assist"] as const;
export type Policy = (typeof CONTEXT_POLICIES)[number];

/**
 * Only the part of the behavior that actually varies by surface.
 *
 * The hint-before-answer stance is invariant and lives in the system prompt, so it is
 * deliberately not repeated here — a policy that restates it adds tokens without adding
 * emphasis, and drifts from the base prompt the first time either is edited.
 */
export function policyInstructions(policy: Policy): string[] {
    if (policy === "test-locked") {
        return [
            "The student is in an active test. Do not reveal the answer key or provide a full solution.",
            "You may clarify wording and offer strategy-level guidance without resolving the problem.",
        ];
    }
    if (policy === "coaching") {
        return [
            "The student is working a problem. Ask what they have already tried when it is not clear.",
            "Keep each reply to the smallest useful next step.",
        ];
    }
    return [
        "The student is planning or browsing rather than mid-problem; help with planning and discovery.",
        "Use only the facts supplied here, and do not imply knowledge of progress or problem details that are not present.",
    ];
}
