import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import { fetchByIds, fetchProblems, PAGE_SIZE, type ProblemRow } from "$lib/library";
import { catalogReadRuntime } from "$lib/offline/read-mode-runtime";

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

    if (typeof window !== "undefined" && catalogReadRuntime.effective === "local") {
        return fetchLocalFocusedSeriesWorklist(supabase, seriesIds, limit, perSeriesCap);
    }

    try {
        return await fetchRemoteFocusedSeriesWorklist(supabase, seriesIds, limit, perSeriesCap);
    } catch (error) {
        if (typeof window === "undefined") throw error;
        catalogReadRuntime.noteRemoteFailure();
        return fetchLocalFocusedSeriesWorklist(supabase, seriesIds, limit, perSeriesCap);
    }
}

async function fetchRemoteFocusedSeriesWorklist(
    supabase: Supabase,
    seriesIds: number[],
    limit: number,
    perSeriesCap: number,
): Promise<WorklistItem[]> {

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

async function fetchLocalFocusedSeriesWorklist(
    supabase: Supabase,
    seriesIds: number[],
    limit: number,
    perSeriesCap: number,
): Promise<WorklistItem[]> {
    const now = Date.now();
    const groups = await Promise.all(seriesIds.map(async (seriesId) => {
        const rows: ProblemRow[] = [];
        for (let page = 0; ; page += 1) {
            const batch = await fetchProblems(supabase, { seriesId }, page);
            rows.push(...batch);
            if (batch.length < PAGE_SIZE) break;
        }
        const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
        const due = unique
            .filter((row) => row.progress?.next_review_at && new Date(row.progress.next_review_at).getTime() <= now)
            .sort((a, b) => (a.progress?.next_review_at ?? "").localeCompare(b.progress?.next_review_at ?? ""))
            .slice(0, perSeriesCap)
            .map((problem) => ({ problem, reason: "due" as const, seriesId }));
        const dueIds = new Set(due.map((item) => item.problem.id));
        const needs = unique
            .filter((row) => !dueIds.has(row.id) && row.progress?.mastery === "needs_work")
            .sort((a, b) => (a.progress?.last_reviewed_at ?? "").localeCompare(b.progress?.last_reviewed_at ?? ""))
            .slice(0, Math.max(0, perSeriesCap - due.length))
            .map((problem) => ({ problem, reason: "needs_work" as const, seriesId }));
        return [...due, ...needs];
    }));
    return groups.flat().sort((a, b) => {
        if (a.reason !== b.reason) return a.reason === "due" ? -1 : 1;
        const aRank = a.reason === "due" ? a.problem.progress?.next_review_at : a.problem.progress?.last_reviewed_at;
        const bRank = b.reason === "due" ? b.problem.progress?.next_review_at : b.problem.progress?.last_reviewed_at;
        return (aRank ?? "").localeCompare(bRank ?? "");
    }).slice(0, limit);
}
