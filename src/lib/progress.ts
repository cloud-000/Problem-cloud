import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import {
    RATING_SELECT,
    TESTS_EMBED,
    overallProblemRating,
    type ProblemRow,
    type ProblemRating,
} from "$lib/library";

type Supabase = SupabaseClient<Database>;

// Embed used wherever a `problems` row is nested (submissions, due reviews) so the
// Problem component's rating badge is populated. Reuses the shared `TESTS_EMBED`
// (carries `aops_category_id` for review AoPS links) and the nested overall-rating
// embed. Collapse the raw rows with `collapseRating`.
const PROBLEM_EMBED = `problems(*, ${TESTS_EMBED}, ${RATING_SELECT})`;

/** Raw embedded problem before its `problem_ratings` array is collapsed. */
type RawEmbeddedProblem = ProblemRow & {
    problem_ratings?: (ProblemRating & { scope: string })[] | null;
};

/** Collapse an embedded problem's `problem_ratings` array into `rating`. */
function collapseRating(problem: RawEmbeddedProblem | null): ProblemRow | null {
    if (!problem) return null;
    const { problem_ratings, ...rest } = problem;
    return { ...rest, rating: overallProblemRating(problem_ratings) };
}

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
    /** Practice session this submission belongs to; null = root (ungrouped). */
    sessionId: number | null;
    /**
     * Wrong attempts burned before this recorded (final) outcome in multi-try
     * practice; 0 = first-try. Preserves the first-try signal that would be lost
     * by logging only the final outcome. Analytics-only (ratings ignore it).
     * Defaults to 0 when omitted.
     */
    triesUsed?: number;
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
        session_id: input.sessionId,
        tries_used: input.triesUsed ?? 0,
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
        .select(`next_review_at, ${PROBLEM_EMBED}`)
        .not("next_review_at", "is", null)
        .lte("next_review_at", new Date().toISOString())
        .order("next_review_at")
        .limit(limit);
    if (error) throw error;
    return (data ?? [])
        .map((row) =>
            collapseRating(
                (row as unknown as { problems: RawEmbeddedProblem | null })
                    .problems,
            ),
        )
        .filter((p): p is ProblemRow => p != null);
}

export type RecentSubmissionRow = Tables<"submissions"> & {
    problems: ProblemRow | null;
};

/**
 * Fetch the current user's submissions with embedded problem + test + series data.
 * RLS scopes the query to only return the authenticated user's records.
 */
export async function fetchRecentSubmissions(
    supabase: Supabase,
    limit = 100,
): Promise<RecentSubmissionRow[]> {
    const { data, error } = await supabase
        .from("submissions")
        .select(`*, ${PROBLEM_EMBED}`)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) throw error;
    return ((data ?? []) as unknown as RecentSubmissionRow[]).map((row) => ({
        ...row,
        problems: collapseRating(row.problems as RawEmbeddedProblem | null),
    }));
}

/**
 * Fetch the submissions belonging to a single practice session, newest first,
 * with embedded problem + test + series data. RLS scopes the query to the
 * authenticated user's own records.
 */
export async function fetchSessionSubmissions(
    supabase: Supabase,
    sessionId: number,
    limit = 100,
): Promise<RecentSubmissionRow[]> {
    const { data, error } = await supabase
        .from("submissions")
        .select(`*, ${PROBLEM_EMBED}`)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) throw error;
    return ((data ?? []) as unknown as RecentSubmissionRow[]).map((row) => ({
        ...row,
        problems: collapseRating(row.problems as RawEmbeddedProblem | null),
    }));
}
