import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";

type Supabase = SupabaseClient<Database>;

export const MAX_FOCUSED_SERIES = 3;

/**
 * Persist the user's "focused series" — up to {@link MAX_FOCUSED_SERIES}
 * contest series (`series.id`) driving the home page's per-series stats and
 * worklist. RLS scopes the update to the authenticated owner; the DB also
 * enforces the cap (`focused_series_max_three`), this check just gives fast
 * client-side feedback instead of surfacing a raw constraint violation.
 */
export async function updateFocusedSeries(
    supabase: Supabase,
    userId: string,
    seriesIds: number[],
): Promise<void> {
    if (seriesIds.length > MAX_FOCUSED_SERIES) {
        throw new Error(`Focus at most ${MAX_FOCUSED_SERIES} series.`);
    }
    const { error } = await supabase
        .from("profiles")
        .update({ focused_series: seriesIds })
        .eq("id", userId);
    if (error) throw error;
}
