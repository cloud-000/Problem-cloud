import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/database.types";

export async function getRating(
    supabase: SupabaseClient<Database>,
    id: string | null,
) {
    if (!id) {
        return 0;
    }
    return supabase
        .from("Profiles")
        .select("rating")
        .eq("id", id)
        .single()
        .then((d) => d.data?.rating);
}
