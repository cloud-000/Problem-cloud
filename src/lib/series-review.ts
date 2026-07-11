import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import {
    reviewScheduleFor,
    statusFor,
    type ActivityStatus,
    type Mastery,
    type ProblemProgress,
} from "$lib/progress";

type Supabase = SupabaseClient<Database>;

export type SeriesReviewProgress = ProblemProgress;

export type SeriesReviewProblem = Pick<Tables<"problems">, "id" | "n"> & {
    progress: SeriesReviewProgress | null;
};

export type SeriesReviewTest = {
    id: number;
    name: string;
    year: number | null;
    division: string | null;
    division_order: number | null;
    format: string | null;
    format_order: number | null;
    problems: SeriesReviewProblem[];
};

export type SeriesReviewStatus = ActivityStatus;

type RawReviewProblem = Pick<Tables<"problems">, "id" | "n"> & {
    problem_progress?: SeriesReviewProgress[] | null;
};

type RawReviewTest = Omit<SeriesReviewTest, "problems"> & {
    problems?: RawReviewProblem[] | null;
};

const PROGRESS_FIELDS = [
    "times_seen",
    "times_reviewed",
    "times_correct",
    "times_skipped",
    "last_correct",
    "last_reviewed_at",
    "next_review_at",
    "solved",
    "mastery",
    "engagement",
].join(",");

/** Load the compact all-time state needed by the series review matrix. */
export async function fetchSeriesReview(
    supabase: Supabase,
    seriesId: number,
): Promise<SeriesReviewTest[]> {
    const { data, error } = await supabase
        .from("tests")
        .select(
            `id,name,year,division,division_order,format,format_order,problems!inner(id,n,problem_progress(${PROGRESS_FIELDS}))`,
        )
        .eq("series_id", seriesId);
    if (error) throw error;

    return ((data ?? []) as unknown as RawReviewTest[])
        .map((test) => ({
            ...test,
            problems: (test.problems ?? [])
                .map(({ problem_progress, ...problem }) => ({
                    ...problem,
                    progress: problem_progress?.[0] ?? null,
                }))
                .sort((a, b) => a.n - b.n),
        }))
        .filter((test) => test.problems.length > 0)
        .sort(compareReviewTests);
}

/** A `{ value, label }` choice for a division/format filter control. */
export type DimensionOption = { value: string; label: string };

/** The minimal test shape needed to derive division/format filter options. */
export type SeriesDimensionRow = {
    division: string | null;
    division_order: number | null;
    format: string | null;
    format_order: number | null;
};

/**
 * The distinct, order-sorted division (or format) values present across a
 * series' tests, as filter options. Pass `empty` to append an explicit
 * "unclassified" choice (e.g. `{ value: "__no_division__", label: "No division" }`)
 * — only surfaced when unclassified tests sit alongside real values, since a
 * wholly-unclassified dimension is not a useful filter. Omit `empty` (the
 * trainer's case) to leave unclassified tests unselectable.
 */
export function dimensionOptions(
    rows: SeriesDimensionRow[],
    dimension: "division" | "format",
    empty?: DimensionOption,
): DimensionOption[] {
    const orderField = `${dimension}_order` as
        | "division_order"
        | "format_order";
    const values = new Map<string, { label: string; order: number }>();
    let hasEmpty = false;
    for (const row of rows) {
        const value = row[dimension]?.trim();
        if (!value) {
            hasEmpty = true;
            continue;
        }
        const order = row[orderField] ?? Number.MAX_SAFE_INTEGER;
        const current = values.get(value);
        if (!current || order < current.order) {
            values.set(value, { label: value, order });
        }
    }

    const options = [...values.entries()]
        .sort(
            ([, a], [, b]) => a.order - b.order || a.label.localeCompare(b.label),
        )
        .map(([value, option]) => ({ value, label: option.label }));
    if (empty && hasEmpty && options.length > 0) {
        options.push(empty);
    }
    return options;
}

/**
 * The compact per-test division/format metadata for a series — just enough to
 * populate the trainer's division/format filter options, without pulling every
 * problem and its progress the way {@link fetchSeriesReview} does.
 */
export async function fetchSeriesDimensions(
    supabase: Supabase,
    seriesId: number,
): Promise<SeriesDimensionRow[]> {
    const { data, error } = await supabase
        .from("tests")
        .select("division, division_order, format, format_order")
        .eq("series_id", seriesId);
    if (error) throw error;
    return (data ?? []) as unknown as SeriesDimensionRow[];
}

export function statusForReview(
    progress: SeriesReviewProgress | null,
): SeriesReviewStatus {
    return statusFor(progress);
}

export function reviewIsDue(
    progress: SeriesReviewProgress | null,
    now = Date.now(),
): boolean {
    return reviewScheduleFor(progress, now) === "due";
}

export function compareReviewTests(a: SeriesReviewTest, b: SeriesReviewTest) {
    const yearA = a.year ?? Number.NEGATIVE_INFINITY;
    const yearB = b.year ?? Number.NEGATIVE_INFINITY;
    if (yearA !== yearB) return yearB - yearA;

    const divisionOrderA = a.division_order ?? Number.MAX_SAFE_INTEGER;
    const divisionOrderB = b.division_order ?? Number.MAX_SAFE_INTEGER;
    if (divisionOrderA !== divisionOrderB) return divisionOrderA - divisionOrderB;

    const divisionCompare = compareOptionalLabel(a.division, b.division);
    if (divisionCompare) return divisionCompare;

    const formatOrderA = a.format_order ?? Number.MAX_SAFE_INTEGER;
    const formatOrderB = b.format_order ?? Number.MAX_SAFE_INTEGER;
    if (formatOrderA !== formatOrderB) return formatOrderA - formatOrderB;

    const formatCompare = compareOptionalLabel(a.format, b.format);
    return formatCompare || a.name.localeCompare(b.name) || a.id - b.id;
}

export function reviewRowLabel(test: SeriesReviewTest): string {
    const parts = [test.division, test.format].filter(
        (part): part is string => Boolean(part?.trim()),
    );
    if (parts.length > 0) return parts.join(" · ");

    const withoutYear = test.year
        ? test.name.replace(new RegExp(`^${test.year}\\s*`), "").trim()
        : test.name;
    return withoutYear || test.name;
}

function compareOptionalLabel(a: string | null, b: string | null): number {
    const aLabel = a?.trim() || null;
    const bLabel = b?.trim() || null;
    if (aLabel && !bLabel) return -1;
    if (!aLabel && bLabel) return 1;
    return (aLabel ?? "").localeCompare(bLabel ?? "");
}

export type SeriesReviewSummary = {
    total: number;
    attempted: number;
    due: number;
    mastery: Record<Mastery | "unassessed", number>;
};

export function summarizeSeriesReview(
    tests: SeriesReviewTest[],
): SeriesReviewSummary {
    const problems = tests.flatMap((test) => test.problems);
    return {
        total: problems.length,
        attempted: problems.filter(
            (problem) => (problem.progress?.times_reviewed ?? 0) > 0,
        ).length,
        due: problems.filter((problem) => reviewIsDue(problem.progress)).length,
        mastery: {
            unassessed: problems.filter((problem) => !problem.progress?.mastery).length,
            needs_work: problems.filter(
                (problem) => problem.progress?.mastery === "needs_work",
            ).length,
            learning: problems.filter(
                (problem) => problem.progress?.mastery === "learning",
            ).length,
            confident: problems.filter(
                (problem) => problem.progress?.mastery === "confident",
            ).length,
        },
    };
}
