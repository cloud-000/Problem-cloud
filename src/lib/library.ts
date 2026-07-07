import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import type { TriState } from "$lib/components/toggle";
import type { Option } from "$lib/components/combobox";
import type { ProblemProgress } from "$lib/progress";

type Supabase = SupabaseClient<Database>;

// Row shapes. Tests/problems carry their joined parent names for display.
export type SeriesRow = Tables<"series">;
export type TestRow = Tables<"tests"> & { series?: { name: string } | null };
/** A problem's Glicko rating for one scope (its skill/difficulty signal). */
export interface ProblemRating {
    rating: number;
    rd: number; // rating deviation (uncertainty)
    attempts: number;
}

export type ProblemRow = Tables<"problems"> & {
    tests?: {
        name: string;
        series_id: number | null;
        series?: { name: string } | null;
    } | null;
    /** The current user's interaction state, normalized to a single row (or null). */
    progress?: ProblemProgress | null;
    /** The problem's overall skill rating, normalized from the embed (or null). */
    rating?: ProblemRating | null;
};

// The current user's progress fields, embedded via the problem_progress FK. RLS
// scopes the embed to the signed-in user, so it returns a 0/1-element array per
// problem (always empty for anonymous users).
const PROGRESS_SELECT =
    "problem_progress(times_correct, times_reviewed, last_correct, next_review_at, solved)";

// The problem's ratings, embedded via the problem_ratings FK — one row per scope
// (only 'overall' today; topic scopes later). World-readable, so this is populated
// for anonymous users too. Collapsed to the 'overall' row below. Exported so other
// modules that embed problems (e.g. submissions in `progress.ts`) can nest it.
export const RATING_SELECT = "problem_ratings(scope, rating, rd, attempts)";

/** Pick the single `overall`-scope rating out of an embedded `problem_ratings` array. */
export function overallProblemRating(
    ratings: (ProblemRating & { scope: string })[] | null | undefined,
): ProblemRating | null {
    const overall = ratings?.find((r) => r.scope === "overall") ?? null;
    return overall
        ? { rating: overall.rating, rd: overall.rd, attempts: overall.attempts }
        : null;
}

/** RD at or above which a rating hasn't converged — shown as provisional. */
export const RATING_PROVISIONAL_RD = 100;

/** True while a rating is still low-confidence (unplayed or high uncertainty). */
export function ratingIsProvisional(
    r: ProblemRating | null | undefined,
): boolean {
    return !r || r.attempts < 1 || r.rd >= RATING_PROVISIONAL_RD;
}

/** The signed-in user's Glicko skill rating for one scope. */
export interface PlayerRating {
    rating: number;
    rd: number; // rating deviation (uncertainty)
    matches: number; // rated matches counted into this rating
    last_match_at: string | null;
}

/** True while a player rating is still low-confidence (unplayed / high RD). */
export function playerRatingIsProvisional(
    r: PlayerRating | null | undefined,
): boolean {
    return !r || r.matches < 1 || r.rd >= RATING_PROVISIONAL_RD;
}

/**
 * Fetch the signed-in user's overall skill rating from `player_ratings`. Returns
 * `null` when the user has no rating row yet (it appears with their first graded
 * submission — ratings update live). `player_ratings` is world-readable, but this
 * is scoped to the given user.
 */
export async function fetchPlayerRating(
    supabase: Supabase,
    userId: string,
): Promise<PlayerRating | null> {
    const { data, error } = await supabase
        .from("player_ratings")
        .select("rating, rd, matches, last_match_at")
        .eq("user_id", userId)
        .eq("scope", "overall")
        .maybeSingle();
    if (error) throw error;
    return data;
}

type ProblemEmbeds = {
    problem_progress?: ProblemProgress[] | null;
    problem_ratings?: (ProblemRating & { scope: string })[] | null;
};

/**
 * Collapse the embedded `problem_progress` (0/1 rows) into `progress` and the
 * `problem_ratings` array into the single `overall`-scope `rating`.
 */
function normalizeEmbeds<T extends ProblemEmbeds>(
    row: T,
): Omit<T, "problem_progress" | "problem_ratings"> & {
    progress: ProblemProgress | null;
    rating: ProblemRating | null;
} {
    const { problem_progress, problem_ratings, ...rest } = row;
    return {
        ...rest,
        progress: problem_progress?.[0] ?? null,
        rating: overallProblemRating(problem_ratings),
    };
}

export type Level = "series" | "tests" | "problems";
export const LEVELS: Level[] = ["series", "tests", "problems"];

// Topic options: display label vs. the single-letter code stored in the DB / used
// in queries. The combobox binds the `value` (code) while showing the `label`.
export const TOPICS: Option[] = [
    { value: "A", label: "Algebra" },
    { value: "C", label: "Combinatorics" },
    { value: "G", label: "Geometry" },
    { value: "N", label: "Number Theory" },
    { value: "O", label: "Other" },
];

/** Reverse lookup: stored topic code → display label. */
export const TOPIC_LABELS: Record<string, string> = Object.fromEntries(
    TOPICS.map((t) => {
        const o = t as { value: string; label: string };
        return [o.value, o.label];
    }),
);

/** Stored topic code → display label, falling back to the raw code. */
export function topicLabel(code: string | null | undefined): string | null {
    if (!code) return null;
    return TOPIC_LABELS[code] ?? code;
}

export const DIFFICULTY_RANGE: [number, number] = [0, 100];
export const QUALITY_RANGE: [number, number] = [0, 100];
export const YEAR_RANGE: [number, number] = [1950, new Date().getFullYear()];

/**
 * One flat filter shape covering all three levels — fields are optional and each
 * `fetch*` reads only the ones it cares about. A single shape keeps `patchFilters`
 * and the filter UI trivial. `boolean | null`: `null`/absent = no filter ("Any").
 */
export interface Filters {
    // series
    name?: string; // also used by tests
    isOfficial?: boolean | null;
    // tests
    seriesId?: number; // also scopes problems
    year?: [number, number];
    type?: string[];
    isComputational?: boolean | null; // also used by problems
    // problems
    testId?: number;
    topic?: string[];
    tags?: string[];
    difficulty?: [number, number];
    quality?: [number, number];
    verified?: boolean | null;
}

/** Page size for the infinite-scroll result feed. */
export const PAGE_SIZE = 20;

/** Inclusive `[from, to]` row range for a zero-based page. */
function pageRange(page: number): [number, number] {
    const from = page * PAGE_SIZE;
    return [from, from + PAGE_SIZE - 1];
}

/** Tri-state switch value → filter boolean (`neutral` = "Any" = no filter). */
export function triToBool(t: TriState): boolean | null {
    if (t === "on") return true;
    if (t === "off") return false;
    return null;
}

/** Inverse of {@link triToBool}, to seed a switch from a stored filter value. */
export function boolToTri(b: boolean | null | undefined): TriState {
    if (b === true) return "on";
    if (b === false) return "off";
    return "neutral";
}

export async function fetchSeries(
    supabase: Supabase,
    f: Filters = {},
    page = 0,
): Promise<SeriesRow[]> {
    let q = supabase.from("series").select("*");
    if (f.name?.trim()) q = q.ilike("name", `%${f.name.trim()}%`);
    if (f.isOfficial != null) q = q.eq("is_official", f.isOfficial);
    const { data, error } = await q
        .order("name")
        .order("id")
        .range(...pageRange(page));
    if (error) throw error;
    return data ?? [];
}

export async function fetchTests(
    supabase: Supabase,
    f: Filters = {},
    page = 0,
): Promise<TestRow[]> {
    let q = supabase.from("tests").select("*, series(name)");
    if (f.seriesId != null) q = q.eq("series_id", f.seriesId);
    if (f.name?.trim()) q = q.ilike("name", `%${f.name.trim()}%`);
    if (f.year) q = q.gte("year", f.year[0]).lte("year", f.year[1]);
    if (f.type?.length) q = q.in("type", f.type);
    if (f.isComputational != null)
        q = q.eq("is_computational", f.isComputational);
    const { data, error } = await q
        .order("year", { ascending: false })
        .order("name")
        .order("id")
        .range(...pageRange(page));
    if (error) throw error;
    return (data ?? []) as unknown as TestRow[];
}

export async function fetchProblems(
    supabase: Supabase,
    f: Filters = {},
    page = 0,
): Promise<ProblemRow[]> {
    // `tests!inner` so filtering through the relationship (series scope) works.
    let q = supabase
        .from("problems")
        .select(
            `*, tests!inner(name, series_id, series(name)), ${PROGRESS_SELECT}, ${RATING_SELECT}`,
        );
    if (f.testId != null) q = q.eq("test_id", f.testId);
    else if (f.seriesId != null) q = q.eq("tests.series_id", f.seriesId);
    if (f.topic?.length) q = q.in("topic", f.topic);
    if (f.tags?.length) q = q.contains("tags", f.tags);
    if (f.difficulty)
        q = q.gte("difficulty", f.difficulty[0]).lte("difficulty", f.difficulty[1]);
    if (f.quality)
        q = q.gte("quality", f.quality[0]).lte("quality", f.quality[1]);
    if (f.isComputational != null)
        q = q.eq("is_computational", f.isComputational);
    if (f.verified != null) q = q.eq("verified", f.verified);
    const { data, error } = await q
        .order("n")
        .order("id")
        .range(...pageRange(page));
    if (error) throw error;
    return ((data ?? []) as unknown as Array<ProblemRow & ProblemEmbeds>).map(
        normalizeEmbeds,
    );
}

/**
 * Look up rows by id for a given level. Used by the Find page (debugging / ad-hoc
 * lookup). Unlike {@link fetchProblems}, problems LEFT-join their test (`tests(...)`
 * not `tests!inner`) so a problem with a null `test_id` still surfaces.
 */
export async function fetchByIds(
    supabase: Supabase,
    level: Level,
    ids: number[],
): Promise<(SeriesRow | TestRow | ProblemRow)[]> {
    if (ids.length === 0) return [];
    if (level === "series") {
        const { data, error } = await supabase
            .from("series")
            .select("*")
            .in("id", ids);
        if (error) throw error;
        return data ?? [];
    }
    if (level === "tests") {
        const { data, error } = await supabase
            .from("tests")
            .select("*, series(name)")
            .in("id", ids);
        if (error) throw error;
        return (data ?? []) as unknown as TestRow[];
    }
    const { data, error } = await supabase
        .from("problems")
        .select(
            `*, tests(name, series_id, series(name)), ${PROGRESS_SELECT}, ${RATING_SELECT}`,
        )
        .in("id", ids);
    if (error) throw error;
    return ((data ?? []) as unknown as Array<ProblemRow & ProblemEmbeds>).map(
        normalizeEmbeds,
    );
}

/**
 * Lightweight test list (id, name, year, default time limit) for pickers such as
 * the Test-session creator. Newest first; unpaginated (bounded by the API's
 * `max_rows`).
 */
export async function fetchAllTests(
    supabase: Supabase,
): Promise<Pick<TestRow, "id" | "name" | "year" | "time_limit_seconds" | "missing_answers_count">[]> {
    const { data, error } = await supabase
        .from("tests")
        .select("id, name, year, time_limit_seconds, missing_answers_count")
        .order("year", { ascending: false })
        .order("name");
    if (error) throw error;
    return data ?? [];
}

/** Lightweight `{id, name}` list to populate the series filter combobox. */
export async function fetchAllSeries(
    supabase: Supabase,
): Promise<Pick<SeriesRow, "id" | "name">[]> {
    const { data, error } = await supabase
        .from("series")
        .select("id, name")
        .order("name");
    if (error) throw error;
    return data ?? [];
}
