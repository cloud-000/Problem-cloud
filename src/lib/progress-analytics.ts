import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";

type Supabase = SupabaseClient<Database>;

/** The axis a breakdown groups by. Mirrors `progress_breakdown.p_dimension`. */
export type ProgressDimension = "topic" | "series" | "difficulty" | "day";

/**
 * Filters accepted by `progress_breakdown`. All optional; omitted = no
 * constraint. `from`/`to` are ISO timestamps ([from, to) — `to` is exclusive).
 * `tz` is an IANA zone used only for `dimension: "day"` bucketing.
 */
export type ProgressFilters = {
    from?: string | null;
    to?: string | null;
    tz?: string;
    topics?: string[] | null;
    seriesIds?: number[] | null;
    difficultyMin?: number | null;
    difficultyMax?: number | null;
    source?: string | null;
    computational?: boolean | null;
};

/**
 * One group's raw counts, exactly as returned by the RPC. Ratios are derived
 * client-side (see helpers below) so a zero denominator stays `null` instead of
 * a misleading 0%.
 */
export type BreakdownRow = {
    bucket_key: string;
    bucket_label: string;
    seen: number;
    graded: number;
    correct: number;
    skipped: number;
    first_graded: number;
    first_correct: number;
    distinct_problems: number;
    graded_time_ms: number;
    graded_timed: number;
    last_activity: string | null;
};

/**
 * Group the current user's submissions along `dimension`, returning one
 * `BreakdownRow` per bucket. RLS scopes rows to the authenticated user. Powers
 * the Topic lens (`"topic"`), difficulty calibration within a topic
 * (`"difficulty"` + `topics`), and the timeline (`"day"`).
 */
export async function fetchProgressBreakdown(
    supabase: Supabase,
    dimension: ProgressDimension,
    filters: ProgressFilters = {},
): Promise<BreakdownRow[]> {
    // Omitted args (undefined) fall through to each param's SQL DEFAULT NULL, so
    // `?? undefined` collapses a caller's explicit null to "no constraint".
    const params = {
        p_dimension: dimension,
        p_from: filters.from ?? undefined,
        p_to: filters.to ?? undefined,
        p_tz: filters.tz ?? "UTC",
        p_topics: filters.topics ?? undefined,
        p_series: filters.seriesIds ?? undefined,
        p_difficulty_min: filters.difficultyMin ?? undefined,
        p_difficulty_max: filters.difficultyMax ?? undefined,
        p_source: filters.source ?? undefined,
        p_computational: filters.computational ?? undefined,
    };
    const { data, error } = await supabase
        .rpc("progress_breakdown", params)
        .returns<BreakdownRow[]>();
    if (error) throw error;
    return data ?? [];
}

/** Eventual accuracy: correct graded attempts ÷ graded attempts. */
export function accuracy(row: BreakdownRow): number | null {
    return row.graded > 0 ? row.correct / row.graded : null;
}

/**
 * First-attempt accuracy: correct-on-first-try ÷ problems first attempted. The
 * "competition" metric — one shot, no retries.
 */
export function firstAccuracy(row: BreakdownRow): number | null {
    return row.first_graded > 0 ? row.first_correct / row.first_graded : null;
}

/** Mean time per graded, timed attempt, in ms. */
export function avgTimeMs(row: BreakdownRow): number | null {
    return row.graded_timed > 0 ? row.graded_time_ms / row.graded_timed : null;
}

/**
 * Rank buckets weakest-first for the "drill this weakness" panel. Drops
 * low-volume buckets (default: fewer than 3 first attempts) so a 0/1 sample
 * can't top the list, and sorts ascending by first-attempt accuracy.
 */
export function rankWeaknesses(
    rows: BreakdownRow[],
    minFirstGraded = 3,
): BreakdownRow[] {
    return rows
        .filter((r) => r.first_graded >= minFirstGraded)
        .sort((a, b) => (firstAccuracy(a) ?? 1) - (firstAccuracy(b) ?? 1));
}
