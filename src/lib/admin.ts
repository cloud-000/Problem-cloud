import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import type { ProblemRow } from "$lib/library";

type Supabase = SupabaseClient<Database>;

/** Review state of a feedback row plus the filter alias for "everything". */
export type FeedbackStatus = "pending" | "accepted" | "rejected";
export type FeedbackStatusFilter = FeedbackStatus | "all";

/** A feedback row with its problem (+ test/series) and submitter embedded. */
export type AnswerSuggestionRow = Tables<"user_submitted_feedback"> & {
    problems: ProblemRow | null;
    profiles: { username: string | null } | null;
};

/**
 * Fetch `answer_suggestion` feedback for the admin dashboard, newest first, with
 * the problem (+ test/series) and submitter username embedded. RLS returns every
 * row to admins (admin_rank > 0); pass a status to scope the list, or "all".
 */
export async function fetchAnswerSuggestions(
    supabase: Supabase,
    status: FeedbackStatusFilter = "pending",
): Promise<AnswerSuggestionRow[]> {
    let q = supabase
        .from("user_submitted_feedback")
        .select(
            "*, problems(*, tests(name, series_id, series(name))), profiles!user_submitted_feedback_user_id_fkey(username)",
        )
        .eq("type", "answer_suggestion")
        .order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as AnswerSuggestionRow[];
}

/**
 * Act on a suggestion via the security-definer RPC: accept writes the answer onto
 * the problem and marks the row accepted; reject marks it rejected. The in-DB
 * `admin_rank` check authorizes the caller. Pass `answerIndex` to override the
 * suggested choice on accept (defaults to the row's `answer_index`).
 */
export async function reviewAnswerSuggestion(
    supabase: Supabase,
    feedbackId: number,
    accept: boolean,
    answerIndex?: number | null,
): Promise<void> {
    const { error } = await supabase.rpc("review_answer_suggestion", {
        p_feedback_id: feedbackId,
        p_accept: accept,
        p_answer_index: answerIndex ?? undefined,
    });
    if (error) throw error;
}

/** Site-wide (non-problem) feedback categories — the `type` discriminator values. */
export type GeneralFeedbackType = "bug_report" | "feature_suggestion" | "general";

/** Resolution states a site-wide feedback row moves through, plus the "all" alias. */
export type GeneralFeedbackStatus = "pending" | "resolved" | "dismissed";
export type GeneralFeedbackStatusFilter = GeneralFeedbackStatus | "all";

/** A site-wide feedback row with its submitter embedded. */
export type GeneralFeedbackRow = Tables<"user_submitted_feedback"> & {
    profiles: { username: string | null } | null;
};

/**
 * Fetch site-wide feedback (everything except `answer_suggestion`) for the admin
 * triage tab, newest first, with the submitter username embedded. RLS returns
 * every row to admins (admin_rank > 0). Pass a status and/or category to scope
 * the list, or "all" for either. The `profiles` embed is disambiguated to the
 * submitter FK (a second FK, `reviewed_by`, also points at profiles).
 */
export async function fetchGeneralFeedback(
    supabase: Supabase,
    status: GeneralFeedbackStatusFilter = "pending",
    type: GeneralFeedbackType | "all" = "all",
): Promise<GeneralFeedbackRow[]> {
    let q = supabase
        .from("user_submitted_feedback")
        .select(
            "*, profiles!user_submitted_feedback_user_id_fkey(username)",
        )
        .neq("type", "answer_suggestion")
        .order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    if (type !== "all") q = q.eq("type", type);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as GeneralFeedbackRow[];
}

/**
 * Resolve a site-wide feedback row via the security-definer RPC: stamp it
 * `resolved` or `dismissed` (with reviewer + timestamp). The in-DB `admin_rank`
 * check authorizes the caller.
 */
export async function resolveFeedback(
    supabase: Supabase,
    feedbackId: number,
    status: "resolved" | "dismissed",
): Promise<void> {
    const { error } = await supabase.rpc("set_feedback_status", {
        p_feedback_id: feedbackId,
        p_status: status,
    });
    if (error) throw error;
}

export type ProfilesSortOption =
    | "newest"
    | "oldest"
    | "rank_highest"
    | "rank_lowest"
    | "active_newest"
    | "active_oldest";

/**
 * Fetch profiles from public.profiles, ordered by the specified option.
 */
export async function fetchProfiles(
    supabase: Supabase,
    sortBy: ProfilesSortOption = "newest",
): Promise<Tables<"profiles">[]> {
    let q = supabase.from("profiles").select("*");

    if (sortBy === "newest") {
        q = q.order("created_at", { ascending: false });
    } else if (sortBy === "oldest") {
        q = q.order("created_at", { ascending: true });
    } else if (sortBy === "rank_highest") {
        q = q.order("admin_rank", { ascending: false }).order("created_at", { ascending: true });
    } else if (sortBy === "rank_lowest") {
        q = q.order("admin_rank", { ascending: true }).order("created_at", { ascending: true });
    } else if (sortBy === "active_newest") {
        q = q.order("last_active_at", { ascending: false });
    } else if (sortBy === "active_oldest") {
        q = q.order("last_active_at", { ascending: true });
    }

    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
}

