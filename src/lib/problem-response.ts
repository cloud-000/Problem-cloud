import { isMultipleChoice } from "$lib/utils";

export const RESPONSE_KINDS = [
    "mcq",
    "short_answer",
    "proof",
    "construction",
    "estimation",
    "interactive",
    "unknown",
] as const;

export type ResponseKind = (typeof RESPONSE_KINDS)[number];

export const ANSWER_STATUSES = [
    "known",
    "source_missing",
    "not_applicable",
    "needs_review",
] as const;

export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export type ResponseInputMode =
    | "choice"
    | "short-text"
    | "long-text"
    | "unsupported";

export type SubmissionOutcome =
    | "correct"
    | "incorrect"
    | "ungraded"
    | "skipped";

type ProblemResponseFields = {
    response_kind?: unknown;
    answer_status?: unknown;
    choices?: string[] | null;
    answer_index?: number | null;
};

type SubmissionOutcomeFields = {
    skipped?: boolean | null;
    is_correct?: boolean | null;
};

export function isResponseKind(value: unknown): value is ResponseKind {
    return (
        typeof value === "string" &&
        (RESPONSE_KINDS as readonly string[]).includes(value)
    );
}

export function isAnswerStatus(value: unknown): value is AnswerStatus {
    return (
        typeof value === "string" &&
        (ANSWER_STATUSES as readonly string[]).includes(value)
    );
}

/**
 * Resolve a problem's response kind at the application boundary. Persisted problem
 * metadata wins; the choices fallback exists only for legacy rows and is never
 * written back by runtime code.
 */
export function resolveResponseKind(problem: ProblemResponseFields): ResponseKind {
    if (isResponseKind(problem.response_kind)) return problem.response_kind;
    if (isMultipleChoice(problem.choices)) return "mcq";
    if (problem.choices?.length === 1) return "short_answer";
    return "unknown";
}

export function inputModeFor(kind: ResponseKind): ResponseInputMode {
    switch (kind) {
        case "mcq":
            return "choice";
        case "short_answer":
        case "estimation":
        case "unknown":
            return "short-text";
        case "proof":
            return "long-text";
        case "construction":
        case "interactive":
            return "unsupported";
    }
}

/** True only when metadata says a key is known and the overloaded key is usable. */
export function hasComparableAnswer(problem: ProblemResponseFields): boolean {
    if (problem.answer_status !== "known") return false;
    const index = problem.answer_index;
    return (
        Number.isInteger(index) &&
        index != null &&
        index >= 0 &&
        index < (problem.choices?.length ?? 0)
    );
}

/** Missing-answer contribution flows include ambiguity, never inapplicability. */
export function isReferenceAnswerMissing(problem: ProblemResponseFields): boolean {
    return (
        problem.answer_status === "source_missing" ||
        problem.answer_status === "needs_review"
    );
}

export function submissionOutcome(
    submission: SubmissionOutcomeFields,
): SubmissionOutcome {
    if (submission.skipped === true) return "skipped";
    if (submission.is_correct === true) return "correct";
    if (submission.is_correct === false) return "incorrect";
    return "ungraded";
}
