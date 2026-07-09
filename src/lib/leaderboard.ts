import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";

type Supabase = SupabaseClient<Database>;

/** One ranked row on the leaderboard — a player and their overall skill rating. */
export interface LeaderboardEntry {
    user_id: string;
    username: string | null;
    rating: number;
    rd: number; // rating deviation (uncertainty)
    matches: number; // rated matches counted into this rating
    last_match_at: string | null; // carried so `playerRatingIsProvisional` accepts a row
}

/**
 * Fetch the top players by overall Glicko rating for the leaderboard, highest
 * first. `player_ratings` and `profiles` are both world-readable, so this works
 * for anonymous and authenticated visitors alike. Ties on rating fall back to
 * more matches first for a stable order. Uses `profiles!inner` so rows without a
 * matching profile are dropped. The `(scope, rating desc)` index backs the sort.
 */
export async function fetchLeaderboard(
    supabase: Supabase,
    limit = 50,
): Promise<LeaderboardEntry[]> {
    const { data, error } = await supabase
        .from("player_ratings")
        .select(
            "user_id, rating, rd, matches, last_match_at, profiles!inner(username)",
        )
        .eq("scope", "overall")
        .order("rating", { ascending: false })
        .order("matches", { ascending: false })
        .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => ({
        user_id: r.user_id,
        username: r.profiles?.username ?? null,
        rating: r.rating,
        rd: r.rd,
        matches: r.matches,
        last_match_at: r.last_match_at,
    }));
}
