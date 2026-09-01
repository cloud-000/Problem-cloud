/**
 * Phase two: the only file in `$lib/goals` that talks to Supabase.
 *
 * Each family maps to one `security invoker` RPC taking an array of requests
 * and returning one row per request, so a goals list of any size costs at most
 * four calls (`docs/goals.md` §8). Scope resolution happens inside those
 * functions, through `goal_scope_canonicals` — never re-derived here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "$lib/types/database.types";
import { newlyAchieved, requestedFamilies } from "./plan";
import type { GoalFamilyResults, GoalRequestPlan } from "./plan";
import { targetOf, validateTarget } from "./registry";
import type {
    Goal,
    GoalFamily,
    GoalProgressResult,
    GoalScope,
    GoalTargetData,
    SeriesScope,
} from "./types";

type Supabase = SupabaseClient<Database>;
type GoalRow = Database["public"]["Tables"]["goals"]["Row"];

const RPC_FOR: Record<GoalFamily, keyof Database["public"]["Functions"]> = {
    set: "goal_set_progress",
    window: "goal_window_progress",
    accumulation: "goal_volume_progress",
    period: "goal_streak_progress",
};

/**
 * Normalize a stored scope. Scope is jsonb the owner can PATCH, and a missing
 * axis must read as "no narrowing" rather than crash a list — the SQL resolver
 * is equally forgiving, so this only has to agree with it.
 */
export function scopeOf(raw: unknown): GoalScope {
    const source = (raw ?? {}) as Partial<GoalScope>;
    const seriesScopes: Record<string, SeriesScope> = {};
    for (const [id, entry] of Object.entries(source.seriesScopes ?? {})) {
        seriesScopes[id] = {
            divisions: [...(entry?.divisions ?? [])],
            formats: [...(entry?.formats ?? [])],
            ...(entry?.problemNumbers
                ? {
                      problemNumbers: [
                          entry.problemNumbers[0],
                          entry.problemNumbers[1],
                      ] as [number, number],
                  }
                : {}),
        };
    }
    return {
        topic: [...(source.topic ?? [])],
        seriesIds: [...(source.seriesIds ?? [])],
        seriesScopes,
        yearRange: source.yearRange ?? null,
    };
}

export function mapGoalRow(row: GoalRow): Goal {
    return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        scope: scopeOf(row.scope),
        // Left as-is on purpose: an unrecognised target must reach the UI as an
        // unreadable goal, so the narrowing happens at render (`targetOf`) and
        // not by silently dropping the row here.
        target: row.target as GoalTargetData,
        isPrimary: row.is_primary,
        deadline: row.deadline,
        achievedAt: row.achieved_at,
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export async function fetchGoals(
    supabase: Supabase,
    { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<Goal[]> {
    let query = supabase.from("goals").select("*");
    if (!includeArchived) query = query.is("archived_at", null);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapGoalRow);
}

/**
 * Phase two for a whole page: one call per family that has requests, issued
 * together. Families are independent, so a slow one never blocks the others,
 * and a failed one leaves its goals unevaluated rather than failing the page —
 * `evaluateGoals` maps a missing family to null.
 */
export async function fetchGoalProgress(
    supabase: Supabase,
    plan: GoalRequestPlan,
): Promise<GoalFamilyResults> {
    const families = requestedFamilies(plan);
    const results: GoalFamilyResults = {};

    await Promise.all(
        families.map(async (family) => {
            const { data, error } = await supabase.rpc(RPC_FOR[family], {
                p_requests: plan.requests[family] as unknown as Json,
            });
            if (error) throw error;
            const rows = (data ?? []) as Record<string, number>[];
            // Rows come back keyed by `idx` — the caller's own position in the
            // request array — so they are placed rather than appended. A family
            // that returned rows out of order, or dropped an empty one, would
            // otherwise silently shift every later goal's answer.
            switch (family) {
                case "set":
                    results.set = place(rows, (r) => ({
                        attempted: Number(r.attempted),
                        solved: Number(r.solved),
                        eligibleTotal: Number(r.eligible_total),
                    }));
                    break;
                case "window":
                    results.window = place(rows, (r) => ({
                        freshSample: Number(r.fresh_sample),
                        freshCorrect: Number(r.fresh_correct),
                        gradedSample: Number(r.graded_sample),
                        gradedCorrect: Number(r.graded_correct),
                        timedSample: Number(r.timed_sample),
                        timedTotalMs: Number(r.timed_total_ms),
                    }));
                    break;
                case "accumulation":
                    results.accumulation = place(rows, (r) => ({
                        gradedSubmissions: Number(r.graded_submissions),
                    }));
                    break;
                case "period":
                    results.period = place(rows, (r) => ({
                        streakDays: Number(r.streak_days),
                        todayCount: Number(r.today_count),
                    }));
                    break;
            }
        }),
    );

    return results;
}

function place<T>(
    rows: Record<string, number>[],
    map: (row: Record<string, number>) => T,
): T[] {
    const out: T[] = [];
    for (const row of rows) out[Number(row.idx)] = map(row);
    return out;
}

/**
 * The eligible denominator for a scope on its own, for the creation preview and
 * for validating a count target against something real. Same resolver, same
 * numbers as the goal will report once it exists (§7) — the preview must never
 * be computed a second way.
 */
export async function fetchScopeTotals(
    supabase: Supabase,
    scope: GoalScope,
): Promise<{ attempted: number; solved: number; eligibleTotal: number }> {
    const { data, error } = await supabase.rpc("goal_set_progress", {
        p_requests: [{ scope }] as unknown as Json,
    });
    if (error) throw error;
    const row = (data ?? [])[0];
    return {
        attempted: Number(row?.attempted ?? 0),
        solved: Number(row?.solved ?? 0),
        eligibleTotal: Number(row?.eligible_total ?? 0),
    };
}

export type NewGoal = {
    title: string;
    scope: GoalScope;
    target: GoalTargetData;
    deadline?: string | null;
};

export async function createGoal(
    supabase: Supabase,
    userId: string,
    goal: NewGoal,
    ctx: { eligibleTotal?: number } = {},
): Promise<Goal> {
    // Client-side validation is not a guard — RLS lets an owner PATCH `target`
    // to anything — but it is the only place that can explain the problem in
    // words, so it runs on the write path rather than only in the form.
    const invalid = validateTarget(goal.target, ctx);
    if (invalid) throw new Error(invalid);

    const { data, error } = await supabase
        .from("goals")
        .insert({
            user_id: userId,
            title: goal.title,
            scope: goal.scope as unknown as Json,
            target: goal.target as unknown as Json,
            deadline: goal.deadline ?? null,
        })
        .select("*")
        .single();
    if (error) throw error;
    return mapGoalRow(data);
}

/**
 * Stamp achievement, once. `achieved_at is null` in the filter is what makes
 * this idempotent and first-writer-wins across tabs: achievement is sticky, so
 * a second observation must never move the date, and later catalog drift must
 * never clear it (`docs/goals.md` §7).
 *
 * The client stamping this is a settled decision (§11): a server RPC would need
 * a second implementation of every evaluator in SQL, and the only thing it
 * would prevent is a student lying to themselves about their own private goal.
 */
export async function markGoalAchieved(
    supabase: Supabase,
    goalId: number,
    achievedAt: string = new Date().toISOString(),
): Promise<Goal | null> {
    const { data, error } = await supabase
        .from("goals")
        .update({ achieved_at: achievedAt })
        .eq("id", goalId)
        .is("achieved_at", null)
        .select("*")
        .maybeSingle();
    if (error) throw error;
    return data ? mapGoalRow(data) : null;
}

/**
 * Stamp every finish line that is met but unrecorded, and return the goals with
 * the stamped rows replaced.
 *
 * Every surface that evaluates goals also stamps them — the goals list and the
 * home page both do — so this is one function rather than one per surface: two
 * implementations of "which goals just crossed the line" is how the app would
 * end up with two answers. Concurrency is safe by construction: the update is
 * `where achieved_at is null`, so a second tab (or the other surface, a moment
 * later) cannot move a date that already exists.
 *
 * A failed stamp is swallowed per goal: not recording an achievement is a
 * missing date, while failing the page over it costs the student everything
 * else on it.
 */
export async function stampAchievedGoals(
    supabase: Supabase,
    goals: Goal[],
    results: Map<number, GoalProgressResult | null>,
): Promise<{ goals: Goal[]; stamped: Goal[] }> {
    const ids = newlyAchieved(goals, results);
    if (ids.length === 0) return { goals, stamped: [] };

    const rows = await Promise.all(
        ids.map((id) => markGoalAchieved(supabase, id).catch(() => null)),
    );
    const stamped = rows.filter((row): row is Goal => row !== null);
    if (stamped.length === 0) return { goals, stamped };

    const byId = new Map(stamped.map((row) => [row.id, row]));
    return { goals: goals.map((goal) => byId.get(goal.id) ?? goal), stamped };
}

/**
 * Changing scope or the finish line changes what the goal MEANS, so an achieved
 * goal must explicitly reopen; title and deadline preserve achievement (§7).
 * Callers warn before passing `reopen`.
 */
export async function updateGoal(
    supabase: Supabase,
    goalId: number,
    changes: Partial<Pick<NewGoal, "title" | "scope" | "target" | "deadline">>,
    { reopen = false }: { reopen?: boolean } = {},
): Promise<Goal> {
    if (changes.target) {
        const target = targetOf(changes.target);
        if (!target) throw new Error("Unrecognised goal target.");
        const invalid = validateTarget(target);
        if (invalid) throw new Error(invalid);
    }

    const patch: Database["public"]["Tables"]["goals"]["Update"] = {};
    if (changes.title !== undefined) patch.title = changes.title;
    if (changes.deadline !== undefined) patch.deadline = changes.deadline;
    if (changes.scope !== undefined) patch.scope = changes.scope as unknown as Json;
    if (changes.target !== undefined) {
        patch.target = changes.target as unknown as Json;
    }
    if (reopen) patch.achieved_at = null;

    const { data, error } = await supabase
        .from("goals")
        .update(patch)
        .eq("id", goalId)
        .select("*")
        .single();
    if (error) throw error;
    return mapGoalRow(data);
}

/** Archiving keeps a goal readable but stops promoting it; deletion is final. */
export async function archiveGoal(
    supabase: Supabase,
    goalId: number,
    archived = true,
): Promise<void> {
    const { error } = await supabase
        .from("goals")
        // The update trigger clears primary selection when archiving. Restoring
        // deliberately leaves the student in control of a new selection.
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq("id", goalId);
    if (error) throw error;
}

/** Select one active goal as the student's explicit main destination. */
export async function setPrimaryGoal(
    supabase: Supabase,
    goalId: number,
): Promise<Goal> {
    const { data, error } = await supabase.rpc("set_primary_goal", {
        p_goal_id: goalId,
    });
    if (error) throw error;
    return mapGoalRow(data);
}

export async function deleteGoal(
    supabase: Supabase,
    goalId: number,
): Promise<void> {
    const { error } = await supabase.from("goals").delete().eq("id", goalId);
    if (error) throw error;
}
