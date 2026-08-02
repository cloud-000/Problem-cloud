import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import {
    CANONICAL_STATE_SELECT,
    PROGRESS_SELECT,
    RATING_SELECT,
    TESTS_EMBED,
    normalizeEmbeds,
    type ProblemRow,
    type ProblemRating,
} from "$lib/library";

type Supabase = SupabaseClient<Database>;

// Embed used wherever a `problems` row is nested (submissions, due reviews) so the
// Problem component's rating badge is populated. Reuses the shared `TESTS_EMBED`
// (carries `aops_category_id` for review AoPS links) and the nested overall-rating
// embed. Collapse the raw rows with `collapseProblemEmbeds`.
const PROBLEM_EMBED = `problems(*, ${TESTS_EMBED}, ${PROGRESS_SELECT}, ${RATING_SELECT}, ${CANONICAL_STATE_SELECT})`;

/** Raw embedded problem before its `problem_ratings` array is collapsed. */
type RawEmbeddedProblem = ProblemRow & {
    canonical_id?: number | null;
    problem_progress?: ProblemProgress[] | null;
    problem_ratings?: (ProblemRating & { scope: string })[] | null;
    canonical?: {
        problem_progress?: ProblemProgress[] | null;
        problem_ratings?: (ProblemRating & { scope: string })[] | null;
    } | null;
};

/** Collapse an embedded problem's persisted progress and ratings into UI state. */
function collapseProblemEmbeds(problem: RawEmbeddedProblem | null): ProblemRow | null {
    if (!problem) return null;
    return normalizeEmbeds(problem);
}

export type Mastery = "needs_work" | "learning" | "confident";
export type Engagement = "working" | "revisit" | "later" | "ignored";
export type ActivityStatus = "unseen" | "skipped_only" | "attempted" | "solved";
export type ReviewSchedule = "unscheduled" | "upcoming" | "due";

/** Shared per-problem state used by Library, Find, Trainer and Progress. */
type ProblemProgressRow = Pick<
    Tables<"problem_progress">,
    | "times_seen"
    | "times_correct"
    | "times_reviewed"
    | "times_skipped"
    | "last_correct"
    | "last_reviewed_at"
    | "last_submission_at"
    | "next_review_at"
    | "solved"
    | "mastery"
    | "engagement"
>;
export type ProblemProgress = Omit<ProblemProgressRow, "mastery" | "engagement"> & {
    mastery: Mastery | null;
    engagement: Engagement | null;
};

/** Activity is derived only from factual counters, never from personal state. */
export function statusFor(progress?: ProblemProgress | null): ActivityStatus {
    if (!progress || progress.times_seen === 0) return "unseen";
    if (progress.solved) return "solved";
    if (progress.times_reviewed === 0) return "skipped_only";
    return "attempted";
}

export function reviewScheduleFor(
    progress?: Pick<ProblemProgress, "next_review_at"> | null,
    now = Date.now(),
): ReviewSchedule {
    if (!progress?.next_review_at) return "unscheduled";
    return new Date(progress.next_review_at).getTime() <= now ? "due" : "upcoming";
}

export type PersonalProblemState = {
    problem_id: number;
    mastery: Mastery | null;
    engagement: Engagement | null;
};

export const MASTERY_LABELS: Record<Mastery, string> = {
    needs_work: "Needs work",
    learning: "Learning",
    confident: "Confident",
};

export const ENGAGEMENT_LABELS: Record<Engagement, string> = {
    working: "Working on",
    revisit: "Revisit",
    later: "Later",
    ignored: "Ignored",
};

export async function setProblemMastery(
    supabase: Supabase,
    problemId: number,
    mastery: Mastery | null,
): Promise<PersonalProblemState> {
    const { data, error } = await supabase.rpc("set_problem_mastery", {
        p_problem_id: problemId,
        p_mastery: mastery as string,
    });
    if (error) throw error;
    return (data?.[0] ?? {
        problem_id: problemId,
        mastery: null,
        engagement: null,
    }) as PersonalProblemState;
}

export async function setProblemEngagement(
    supabase: Supabase,
    problemId: number,
    engagement: Engagement | null,
): Promise<PersonalProblemState> {
    const { data, error } = await supabase.rpc("set_problem_engagement", {
        p_problem_id: problemId,
        p_engagement: engagement as string,
    });
    if (error) throw error;
    return (data?.[0] ?? {
        problem_id: problemId,
        mastery: null,
        engagement: null,
    }) as PersonalProblemState;
}

export type ProblemStateSummary = {
    total: number;
    unseen: number;
    seen: number;
    attempted: number;
    skipped_only: number;
    review_due: number;
    unassessed: number;
    needs_work: number;
    learning: number;
    confident: number;
    no_plan: number;
    working: number;
    revisit: number;
    later: number;
    ignored: number;
};

export async function fetchProblemStateSummary(
    supabase: Supabase,
    seriesId: number | null = null,
): Promise<ProblemStateSummary> {
    const { data, error } = await supabase.rpc(
        "problem_state_summary",
        seriesId == null ? {} : { p_series_id: seriesId },
    );
    if (error) throw error;
    return (data?.[0] ?? {
        total: 0,
        unseen: 0,
        seen: 0,
        attempted: 0,
        skipped_only: 0,
        review_due: 0,
        unassessed: 0,
        needs_work: 0,
        learning: 0,
        confident: 0,
        no_plan: 0,
        working: 0,
        revisit: 0,
        later: 0,
        ignored: 0,
    }) as ProblemStateSummary;
}

export type SubmissionSource = "practice" | "library" | "review";

export type SubmissionInput = {
    problemId: number;
    /** null for skips / non-MCQ answers. */
    selectedChoice: number | null;
    /**
     * Free-text response for non-MCQ (free-response/computational) problems, so a
     * graded answer stays auditable/re-gradable. null/omitted for MCQ and skips.
     */
    answer?: string | null;
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
        answer: input.answer ?? null,
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
            collapseProblemEmbeds(
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
        problems: collapseProblemEmbeds(row.problems as RawEmbeddedProblem | null),
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
        problems: collapseProblemEmbeds(row.problems as RawEmbeddedProblem | null),
    }));
}
