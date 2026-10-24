import type { PageLoad } from "./$types";
import {
    WELCOME_PREFERRED_SERIES,
    loadWelcomeProblems,
} from "./welcome-trainer";

/** The corpus is the page's strongest claim, so it is measured rather than
 *  asserted: these figures come from the database on every render and stay
 *  true as content syncs land. Both tables are world-readable (see the
 *  "viewable by everyone" policies in `supabase/schemas/problems.sql`), so
 *  this works for signed-out visitors. A failure drops the figure rather
 *  than the section. The hero trainer is the same contract: a real problem
 *  from that table, or nothing if the catalog cannot be read. */
export const load: PageLoad = async ({ parent }) => {
    const { supabase } = await parent();

    const [problems, series, preferredWelcomeProblems] = await Promise.all([
        supabase.from("problems").select("id", { count: "exact", head: true }),
        supabase
            .from("series")
            .select("id, name")
            .order("name"),
        loadWelcomeProblems(supabase, WELCOME_PREFERRED_SERIES),
    ]);

    const seriesRows = series.error ? [] : (series.data ?? []);
    let welcomeProblems = preferredWelcomeProblems;
    if (welcomeProblems.length === 0) {
        welcomeProblems = await loadWelcomeProblems(supabase, null);
    }

    return {
        problemCount: problems.error ? null : (problems.count ?? null),
        series: seriesRows,
        problems: welcomeProblems,
    };
};
