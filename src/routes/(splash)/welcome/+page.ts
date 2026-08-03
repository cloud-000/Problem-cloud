import type { PageLoad } from "./$types";

/** The corpus is the page's strongest claim, so it is measured rather than
 *  asserted: these figures come from the database on every render and stay
 *  true as content syncs land. All four tables are world-readable (see the
 *  "viewable by everyone" policies in `supabase/schemas/problems.sql`), so
 *  this works for signed-out visitors. A failure drops the figure rather
 *  than the section. */
export const load: PageLoad = async ({ parent }) => {
    const { supabase } = await parent();

    const [problems, tests, series, oldest, newest] = await Promise.all([
        supabase.from("problems").select("id", { count: "exact", head: true }),
        supabase.from("tests").select("id", { count: "exact", head: true }),
        supabase.from("series").select("name").order("name"),
        supabase
            .from("tests")
            .select("year")
            .not("year", "is", null)
            .order("year", { ascending: true })
            .limit(1)
            .maybeSingle(),
        supabase
            .from("tests")
            .select("year")
            .not("year", "is", null)
            .order("year", { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);

    return {
        problemCount: problems.error ? null : (problems.count ?? null),
        testCount: tests.error ? null : (tests.count ?? null),
        seriesNames: series.error ? [] : series.data.map((s) => s.name),
        earliestYear: oldest.data?.year ?? null,
        latestYear: newest.data?.year ?? null,
    };
};
