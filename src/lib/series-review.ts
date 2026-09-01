import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import { LocalCatalogUnavailable } from "$lib/library";
import { catalogReadRuntime } from "$lib/offline/read-mode-runtime";
import {
    BROWSE_INTENT,
    type BrowseQueryV1,
    type OfflinePlacementV1,
} from "$lib/offline/types";
import {
    reviewScheduleFor,
    statusFor,
    type ActivityStatus,
    type Mastery,
    type PersonalProblemState,
    type ProblemProgress,
} from "$lib/progress";

type Supabase = SupabaseClient<Database>;

export type SeriesReviewProgress = ProblemProgress;

export type SeriesReviewProblem = Pick<Tables<"problems">, "id" | "n"> & {
    /** Canonical/standalone id that owns this placement's shared user state. */
    stateProblemId: number;
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

type RawReviewProblem = Pick<Tables<"problems">, "id" | "n" | "canonical_id"> & {
    problem_progress?: SeriesReviewProgress[] | null;
    canonical?: {
        problem_progress?: SeriesReviewProgress[] | null;
    } | null;
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
    "last_submission_at",
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
    if (typeof window !== "undefined" && catalogReadRuntime.effective === "local") throw new LocalCatalogUnavailable("not-downloaded");
    const { data, error } = await supabase
        .from("tests")
        .select(
            `id,name,year,division,division_order,format,format_order,problems!inner(id,n,canonical_id,problem_progress(${PROGRESS_FIELDS}),canonical:canonical_id(problem_progress(${PROGRESS_FIELDS})))`,
        )
        .eq("series_id", seriesId);
    if (error) {
        if (typeof window !== "undefined") catalogReadRuntime.noteRemoteFailure();
        throw typeof window !== "undefined" ? new LocalCatalogUnavailable("not-downloaded") : error;
    }

    return ((data ?? []) as unknown as RawReviewTest[])
        .map((test) => ({
            ...test,
            problems: (test.problems ?? [])
                .map(normalizeReviewProblem)
                .sort((a, b) => a.n - b.n),
        }))
        .filter((test) => test.problems.length > 0)
        .sort(compareReviewTests);
}

/** Resolve one test placement onto the progress owned by its canonical problem. */
export function normalizeReviewProblem({
    id,
    n,
    canonical_id,
    problem_progress,
    canonical,
}: RawReviewProblem): SeriesReviewProblem {
    const progressRows = canonical_id == null
        ? problem_progress
        : canonical?.problem_progress;
    return {
        id,
        n,
        stateProblemId: canonical_id ?? id,
        progress: progressRows?.[0] ?? null,
    };
}

const EMPTY_REVIEW_PROGRESS: SeriesReviewProgress = {
    times_seen: 0,
    times_correct: 0,
    times_reviewed: 0,
    times_skipped: 0,
    last_correct: null,
    last_reviewed_at: null,
    last_submission_at: null,
    next_review_at: null,
    solved: false,
    mastery: null,
    engagement: null,
};

/** Apply an RPC organization result to every placement sharing its state owner. */
export function applyPersonalProblemState(
    problem: SeriesReviewProblem,
    state: PersonalProblemState,
): SeriesReviewProblem {
    if (problem.stateProblemId !== state.problem_id) return problem;
    return {
        ...problem,
        progress: {
            ...EMPTY_REVIEW_PROGRESS,
            ...problem.progress,
            mastery: state.mastery,
            engagement: state.engagement,
        },
    };
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
 * The stored 1-based range if it actually narrows, else `null`. Pass `length`
 * (1-based max) to treat a full `[1, L]` as absent; omit it at filter time,
 * where a missing field already means no narrowing.
 */
export function problemNumberRange(
    scope: { problemNumbers?: [number, number] } | undefined | null,
    length?: number,
): [number, number] | null {
    const range = scope?.problemNumbers;
    if (!range) return null;
    const lo = range[0];
    const hi = range[1];
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) {
        return null;
    }
    if (length != null && length >= 1 && lo <= 1 && hi >= length) return null;
    return [lo, hi];
}

/**
 * Fit a stored range onto a (possibly shorter) number line. A range that
 * starts past the new length — e.g. 21–25 after switching to an 8-problem
 * format — resets to unset (full). `[1, L]` is also unset.
 */
export function clampProblemNumbers(
    range: [number, number] | undefined | null,
    length: number,
): [number, number] | undefined {
    if (length < 1 || !range) return undefined;
    if (range[0] > length) return undefined;
    const lo = Math.max(1, range[0]);
    const hi = Math.min(range[1], length);
    if (lo > hi) return undefined;
    if (lo <= 1 && hi >= length) return undefined;
    return [lo, hi];
}

async function localSeriesPlacements(seriesId: number): Promise<OfflinePlacementV1[]> {
    const { offlineRepository } = await import("$lib/offline/browser");
    const repository = await offlineRepository();
    const marker = await repository.getAccountMarker();
    if (!marker) throw new LocalCatalogUnavailable("signed-out");
    const query: BrowseQueryV1 = {
        version: 1,
        intent: BROWSE_INTENT,
        userId: marker.userId,
        packageIds: [],
        filters: { seriesId },
        offset: 0,
        limit: 10_000,
    };
    const result = await repository.browseProblems(query);
    if (result.status !== "ok") throw new LocalCatalogUnavailable("not-downloaded");
    catalogReadRuntime.noteLocalRead();
    return result.problems.map((row) => row.placement);
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
    if (typeof window !== "undefined" && catalogReadRuntime.effective === "local") {
        return fetchLocalSeriesDimensions(seriesId);
    }
    try {
        const { data, error } = await supabase
            .from("tests")
            .select("division, division_order, format, format_order")
            .eq("series_id", seriesId);
        if (error) throw error;
        if (typeof window !== "undefined") catalogReadRuntime.noteRemoteSuccess();
        return (data ?? []) as unknown as SeriesDimensionRow[];
    } catch (error) {
        if (typeof window === "undefined") throw error;
        catalogReadRuntime.noteRemoteFailure();
        return fetchLocalSeriesDimensions(seriesId);
    }
}

async function fetchLocalSeriesDimensions(
    seriesId: number,
): Promise<SeriesDimensionRow[]> {
    return (await localSeriesPlacements(seriesId)).map((placement) => ({
        division: placement.test?.division ?? null,
        division_order: null,
        format: placement.test?.format ?? null,
        format_order: null,
    }));
}

export type SeriesNumberLineScope = {
    divisions: string[];
    formats: string[];
    testId?: number;
};

/**
 * 1-based length of a series' number line (`max(n) + 1`) after optional
 * division/format/test narrowing. 0 when the series has no matching problems.
 */
export async function fetchSeriesNumberLine(
    supabase: Supabase,
    seriesId: number,
    scope?: SeriesNumberLineScope,
): Promise<number> {
    if (typeof window !== "undefined" && catalogReadRuntime.effective === "local") {
        return fetchLocalSeriesNumberLine(seriesId, scope);
    }
    try {
        let query = supabase
            .from("problems")
            .select("n, tests!inner(series_id)")
            .eq("tests.series_id", seriesId)
            .order("n", { ascending: false })
            .limit(1);
        if (scope?.testId != null) query = query.eq("test_id", scope.testId);
        if (scope?.divisions.length) query = query.in("tests.division", scope.divisions);
        if (scope?.formats.length) query = query.in("tests.format", scope.formats);
        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        if (typeof window !== "undefined") catalogReadRuntime.noteRemoteSuccess();
        const n = (data as { n?: number } | null)?.n;
        return typeof n === "number" ? n + 1 : 0;
    } catch (error) {
        if (typeof window === "undefined") throw error;
        catalogReadRuntime.noteRemoteFailure();
        return fetchLocalSeriesNumberLine(seriesId, scope);
    }
}

async function fetchLocalSeriesNumberLine(
    seriesId: number,
    scope?: SeriesNumberLineScope,
): Promise<number> {
    let max = -1;
    for (const placement of await localSeriesPlacements(seriesId)) {
        if (scope?.testId != null && placement.testId !== scope.testId) continue;
        if (
            scope?.divisions.length &&
            (!placement.test?.division ||
                !scope.divisions.includes(placement.test.division))
        ) {
            continue;
        }
        if (
            scope?.formats.length &&
            (!placement.test?.format ||
                !scope.formats.includes(placement.test.format))
        ) {
            continue;
        }
        if (placement.problemNumber > max) max = placement.problemNumber;
    }
    return max >= 0 ? max + 1 : 0;
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
