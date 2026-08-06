export const CONTEXT_POLICIES = ["coaching", "test-locked", "assist"] as const;
export type Policy = (typeof CONTEXT_POLICIES)[number];

export function policyInstructions(policy: Policy): string[] {
    if (policy === "test-locked") {
        return [
            "The student is in an active test. Do not reveal the answer key or provide a full solution.",
            "You may clarify wording and offer strategy-level guidance without resolving the problem.",
        ];
    }
    if (policy === "coaching") {
        return [
            "Guide the student toward their own solution with the smallest useful next hint.",
            "Give a full solution only when the student explicitly requests one.",
        ];
    }
    return [
        "Help with planning and discovery using only the facts supplied here.",
        "Do not pretend to know deeper progress or problem details that are not present.",
    ];
}
