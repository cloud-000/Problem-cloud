import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import type { ProblemRow } from "$lib/library";

type Supabase = SupabaseClient<Database>;

/** The few progress fields surfaced alongside a problem (see `library.ts`). */
export type ProblemProgress = Pick<
    Tables<"problem_progress">,
    "times_correct" | "times_reviewed" | "last_correct" | "next_review_at" | "solved"
>;

/** Derived interaction state used by the Explore indicator. */
export type ProgressStatus = "unseen" | "attempted" | "solved";

/** No row → unseen; solved → solved; otherwise (seen/attempted) → attempted. */
export function statusFor(progress?: ProblemProgress | null): ProgressStatus {
    if (!progress) return "unseen";
    if (progress.solved) return "solved";
    return "attempted";
}

export type SubmissionSource = "practice" | "library" | "review";

export type SubmissionInput = {
    problemId: number;
    /** null for skips / non-MCQ answers. */
    selectedChoice: number | null;
    /** null when skipped. */
    isCorrect: boolean | null;
    skipped: boolean;
    flagged: boolean;
    elapsedMs: number;
    source: SubmissionSource;
};

/**
 * Record one problem interaction. Inserts a single `submissions` row; a DB
 * trigger maintains the `problem_progress` aggregate (counters + SM-2 schedule).
 * Fire-and-forget: failures are logged, not thrown, so the UI is never blocked.
 */
export async function recordSubmission(
    supabase: Supabase,
    userId: string,
    input: SubmissionInput,
): Promise<void> {
    const { error } = await supabase.from("submissions").insert({
        user_id: userId,
        problem_id: input.problemId,
        selected_choice: input.selectedChoice,
        is_correct: input.isCorrect,
        skipped: input.skipped,
        flagged: input.flagged,
        elapsed_ms: input.elapsedMs,
        source: input.source,
    });
    if (error) console.error("Failed to record submission:", error);
}

/**
 * Problems whose review is due (`next_review_at <= now`), soonest first, with
 * the problem embedded for display. RLS scopes rows to the current user. Powers
 * a future review queue / Trainer "review mode".
 */
export async function fetchDueReviews(
    supabase: Supabase,
    limit = 20,
): Promise<ProblemRow[]> {
    const { data, error } = await supabase
        .from("problem_progress")
        .select("next_review_at, problems(*, tests(name, series_id, series(name)))")
        .not("next_review_at", "is", null)
        .lte("next_review_at", new Date().toISOString())
        .order("next_review_at")
        .limit(limit);
    if (error) throw error;
    return (data ?? [])
        .map((row) => (row as unknown as { problems: ProblemRow | null }).problems)
        .filter((p): p is ProblemRow => p != null);
}
