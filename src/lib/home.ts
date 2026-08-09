import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import { fetchByIds, type ProblemRow } from "$lib/library";

type Supabase = SupabaseClient<Database>;

export type WorklistReason = "due" | "needs_work";

export type WorklistItem = {
    problem: ProblemRow;
    reason: WorklistReason;
    seriesId: number;
};

type Candidate = {
    problemId: number;
    seriesId: number;
    reason: WorklistReason;
    /** Sort key within its reason bucket; "" sorts first (unset = most stale). */
    rank: string;
};

/**
 * Up to `perSeriesCap` due-for-review / needs-work candidates for one series —
 * due first (soonest overdue), then needs-work (staleest-reviewed first) filling
 * any remaining slots. Called once per focused series so no single series can
 * dominate the blended worklist regardless of how it ranks globally.
 */
async function fetchSeriesCandidates(
    supabase: Supabase,
    seriesId: number,
    perSeriesCap: number,
): Promise<Candidate[]> {
    const { data: due, error: dueError } = await supabase
        .from("user_problem_index")
        .select("problem_id, next_review_at")
        .eq("series_id", seriesId)
        .not("next_review_at", "is", null)
        .lte("next_review_at", new Date().toISOString())
        .order("next_review_at", { ascending: true })
        .limit(perSeriesCap);
    if (dueError) throw dueError;

    const dueCandidates: Candidate[] = (due ?? [])
        .filter((row): row is typeof row & { problem_id: number } => row.problem_id != null)
        .map((row) => ({
            problemId: row.problem_id,
            seriesId,
            reason: "due" as const,
            rank: row.next_review_at ?? "",
        }));

    const remaining = perSeriesCap - dueCandidates.length;
    if (remaining <= 0) return dueCandidates;

    const dueIds = new Set(dueCandidates.map((c) => c.problemId));
    // Overfetch by dueCandidates.length so that even if every early row happens
    // to collide with an already-picked due id, `remaining` survivors are left
    // after filtering (see fetchFocusedSeriesWorklist's doc for the guarantee).
    const { data: needsWork, error: needsWorkError } = await supabase
        .from("user_problem_index")
        .select("problem_id, last_reviewed_at")
        .eq("series_id", seriesId)
        .eq("mastery", "needs_work")
        .order("last_reviewed_at", { ascending: true, nullsFirst: true })
        .limit(perSeriesCap + dueCandidates.length);
    if (needsWorkError) throw needsWorkError;

    const needsWorkCandidates: Candidate[] = (needsWork ?? [])
        .filter(
            (row): row is typeof row & { problem_id: number } =>
                row.problem_id != null && !dueIds.has(row.problem_id),
        )
        .slice(0, remaining)
        .map((row) => ({
            problemId: row.problem_id,
            seriesId,
            reason: "needs_work" as const,
            rank: row.last_reviewed_at ?? "",
        }));

    return [...dueCandidates, ...needsWorkCandidates];
}

/**
 * A ranked "what to do next" worklist blended across the user's focused series:
 * due-for-review and needs-work/low-mastery problems only (never
 * skipped/unsolved — that's a distinct backlog). Each series contributes at
 * most `perSeriesCap` candidates before the global urgency ranking (due before
 * needs-work, most urgent first) and `limit` slice, so one series with many
 * overdue problems can't crowd the others out entirely. The full series review
 * matrix (`/progress?view=matrix`) remains the browse-everything view; this is
 * only ever a short, actionable slice for the home page.
 */
export async function fetchFocusedSeriesWorklist(
    supabase: Supabase,
    seriesIds: number[],
    limit = 8,
    perSeriesCap = 4,
): Promise<WorklistItem[]> {
    if (seriesIds.length === 0) return [];

    const perSeries = await Promise.all(
        seriesIds.map((id) => fetchSeriesCandidates(supabase, id, perSeriesCap)),
    );
    const ranked = perSeries
        .flat()
        .sort((a, b) => {
            if (a.reason !== b.reason) return a.reason === "due" ? -1 : 1;
            return a.rank.localeCompare(b.rank);
        })
        .slice(0, limit);
    if (ranked.length === 0) return [];

    const rows = (await fetchByIds(
        supabase,
        "problems",
        ranked.map((c) => c.problemId),
    )) as ProblemRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));

    return ranked
        .map((c) => {
            const problem = byId.get(c.problemId);
            return problem
                ? { problem, reason: c.reason, seriesId: c.seriesId }
                : null;
        })
        .filter((item): item is WorklistItem => item != null);
}
