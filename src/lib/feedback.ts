import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";

type Supabase = SupabaseClient<Database>;
type FeedbackInsert = Database["public"]["Tables"]["user_submitted_feedback"]["Insert"];

/** The single problem-scoped feedback payload used by the trainer. */
export interface ProblemReportInput {
    problemId: number;
    answerIndex?: number | null;
    message?: string | null;
}

/**
 * Convert the UI contract to the database row while enforcing the same basic
 * invariants as the declarative schema. Exported separately for inexpensive
 * unit testing; the database remains authoritative.
 */
export function problemReportInsert(
    userId: string,
    input: ProblemReportInput,
): FeedbackInsert {
    const message = input.message?.trim() || null;
    const answerIndex = input.answerIndex ?? null;

    if (!Number.isInteger(input.problemId) || input.problemId <= 0) {
        throw new Error("A valid problem is required.");
    }
    if (answerIndex != null && (!Number.isInteger(answerIndex) || answerIndex < 0)) {
        throw new Error("The suggested answer is invalid.");
    }
    if (answerIndex == null && message == null) {
        throw new Error("Write a message or suggest an answer.");
    }

    return {
        user_id: userId,
        problem_id: input.problemId,
        type: "problem_report",
        answer_index: answerIndex,
        message,
    };
}

/** Submit a problem report to the append-only feedback inbox. */
export async function submitProblemReport(
    supabase: Supabase,
    userId: string,
    input: ProblemReportInput,
): Promise<void> {
    const { error } = await supabase
        .from("user_submitted_feedback")
        .insert(problemReportInsert(userId, input));
    if (error) throw error;
}
