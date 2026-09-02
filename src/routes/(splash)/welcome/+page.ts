import type { PageLoad } from "./$types";
import {
    WELCOME_PREFERRED_SERIES,
    loadWelcomeProblems,
} from "./welcome-trainer";

type SeriesEmbed = {
    id: number;
    name: string;
    tests: { count: number }[] | null;
};

/** The corpus is the page's strongest claim, so it is measured rather than
 *  asserted: these figures come from the database on every render and stay
 *  true as content syncs land. Both tables are world-readable (see the
 *  "viewable by everyone" policies in `supabase/schemas/problems.sql`), so
 *  this works for signed-out visitors. A failure drops the figure rather
 *  than the section. The hero trainer is the same contract: a real problem
 *  from that table, or nothing if the catalog cannot be read. */
export const load: PageLoad = async ({ parent }) => {
    const { supabase } = await parent();

    const [problems, series] = await Promise.all([
        supabase.from("problems").select("id", { count: "exact", head: true }),
        supabase
            .from("series")
            .select("id, name, tests(count)")
            .order("name"),
    ]);

    const seriesRows = series.error
        ? []
        : (series.data as unknown as SeriesEmbed[]).map((row) => ({
              id: row.id,
              name: row.name,
              testCount: row.tests?.[0]?.count ?? 0,
          }));
    const preferredSeriesId =
        seriesRows.find((row) => row.name === WELCOME_PREFERRED_SERIES)?.id ?? null;
    let welcomeProblems = await loadWelcomeProblems(supabase, preferredSeriesId);
    if (welcomeProblems.length === 0 && preferredSeriesId != null) {
        welcomeProblems = await loadWelcomeProblems(supabase, null);
    }

    return {
        problemCount: problems.error ? null : (problems.count ?? null),
        series: seriesRows,
        problems: welcomeProblems,
    };
};
