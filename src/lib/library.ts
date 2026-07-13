import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import type { TriState } from "$lib/components/toggle";
import type { Option } from "$lib/components/combobox";
import type { Engagement, Mastery, ProblemProgress } from "$lib/progress";

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
        /** AoPS community category id, for linking to the test's thread (`/c{id}`). */
        aops_category_id: string | null;
        /** Competition stage (School / Regionals / State / …); null = unclassified. */
        division: string | null;
        /** Paper type (Sprint / Target / Team / …); null = unclassified. */
        format: string | null;
    } | null;
    /** The current user's interaction state, normalized to a single row (or null). */
    progress?: ProblemProgress | null;
    /** The problem's overall skill rating, normalized from the embed (or null). */
    rating?: ProblemRating | null;
};

/**
 * The minimal fields needed to review one answered problem (see the
 * `ProblemReview` component). A structural subset of the trainer's history
 * entry, so any "set of answered problems" — a finished test, a past session —
 * can be rendered for review without dragging along the full attempt state.
 */
export type ProblemReviewEntry = {
    problem: ProblemRow;
    selectedChoice: number | null;
    answer: string;
    correct: boolean | null;
    flagged: boolean;
    /**
     * Explicit skip flag, when the source records one (e.g. a persisted
     * `submissions.skipped`). Preferred over inferring a skip from a blank
     * response — persisted submissions store no free-text answer, so inference
     * would misread graded free-response as skipped. Omit to fall back to
     * inference (the trainer's in-memory history has the typed answer).
     */
    skipped?: boolean;
};

/**
 * The test embed carried on a drawn/reviewed problem row. `aops_category_id`
 * rides down here so a problem's test can be linked to its AoPS thread without a
 * second query. Kept as one token (plain + `!inner`) and reused across every
 * select that embeds a test (trainer draws, review queue, session history) so
 * the projection can't drift out of sync with the `ProblemRow.tests` type above.
 */
export const TESTS_EMBED =
    "tests(name, series_id, series(name), aops_category_id, division, format)";
export const TESTS_EMBED_INNER =
    "tests!inner(name, series_id, series(name), aops_category_id, division, format)";

const AOPS_COMMUNITY = "https://artofproblemsolving.com/community";

/**
 * Link to a problem's AoPS discussion thread (`/h{aops_id}`), or `null` when the
 * problem has no mapped AoPS id.
 */
export function aopsProblemUrl(
    aopsId: number | null | undefined,
): string | null {
    return aopsId != null ? `${AOPS_COMMUNITY}/h${aopsId}` : null;
}

/**
 * Link to an AoPS community category page (`/c{id}`) — used for both tests
 * (`aops_category_id`) and series (`aops_id`). `null` when the id is missing.
 */
export function aopsCommunityUrl(
    categoryId: string | number | null | undefined,
): string | null {
    return categoryId != null && categoryId !== ""
        ? `${AOPS_COMMUNITY}/c${categoryId}`
        : null;
}

// The current user's progress fields, embedded via the problem_progress FK. RLS
// scopes the embed to the signed-in user, so it returns a 0/1-element array per
// problem (always empty for anonymous users).
const PROGRESS_SELECT =
    "problem_progress(times_seen, times_correct, times_reviewed, times_skipped, last_correct, last_reviewed_at, last_submission_at, next_review_at, solved, mastery, engagement)";

// The problem's ratings, embedded via the problem_ratings FK — one row per scope
// (only 'overall' today; topic scopes later). World-readable, so this is populated
// for anonymous users too. Collapsed to the 'overall' row below. Exported so other
// modules that embed problems (e.g. submissions in `progress.ts`) can nest it.
export const RATING_SELECT = "problem_ratings(scope, rating, rd, attempts)";

// Shared state for a DUPLICATE problem. When a row is an alias (canonical_id
// set), its rating and per-user progress live under the canonical, not itself —
// submissions are canonicalized on insert, so an alias never has its own rows.
// This self-referential embed (problems.canonical_id -> problems.id) nests the
// canonical's progress + rating so the app can show shared state on either
// placement. Null for a canonical/standalone row (then its own embeds are used).
export const CANONICAL_STATE_SELECT = `canonical:canonical_id(${PROGRESS_SELECT}, ${RATING_SELECT})`;

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

/** One point in a player's rating climb — a rated match's post-match snapshot. */
export interface PlayerRatingPoint {
    at: string; // the match's submission time (ISO)
    rating: number;
    rd: number; // rating deviation at that point
}

/**
 * Fetch the signed-in user's rating climb from `player_rating_history` — one
 * point per rated match, oldest first. Appended live by the rating trigger and
 * rewritten wholesale on a recompute, so it always matches the current rating.
 * `player_rating_history` is world-readable; this is scoped to the given user
 * and `overall` scope.
 */
export async function fetchPlayerRatingHistory(
    supabase: Supabase,
    userId: string,
): Promise<PlayerRatingPoint[]> {
    const { data, error } = await supabase
        .from("player_rating_history")
        .select("at, rating, rd")
        .eq("user_id", userId)
        .eq("scope", "overall")
        .order("at", { ascending: true });
    if (error) throw error;
    return data ?? [];
}

/**
 * Fetch the `overall`-scope Glicko rating for a single problem from
 * `problem_ratings`. Returns `null` when the problem has no rating row yet (it
 * appears with the first graded submission against it). `problem_ratings` is
 * world-readable, so this works for anonymous users too.
 */
export async function fetchProblemRating(
    supabase: Supabase,
    problemId: number,
): Promise<ProblemRating | null> {
    const { data, error } = await supabase
        .from("problem_ratings")
        .select("rating, rd, attempts")
        .eq("problem_id", problemId)
        .eq("scope", "overall")
        .maybeSingle();
    if (error) throw error;
    return data;
}

// --- Glicko match math (client-side mirror of the DB rating functions) ---------
// These reproduce `glicko_g` / `glicko_e` from the SQL rating pipeline so the
// trainer can preview a match (expected score, projected swing) before the DB
// grades it live. Kept in sync with supabase/schemas/ratings.sql; see
// docs/ratings.md §4c for the authoritative match math.

/** Glicko scaling constant: ln(10) / 400. */
const GLICKO_Q = Math.LN10 / 400;

/** Opponent-uncertainty attenuation `g(RD)` — dampens the swing vs. a hazy opponent. */
export function glickoG(rd: number): number {
    return 1 / Math.sqrt(1 + (3 * GLICKO_Q * GLICKO_Q * rd * rd) / (Math.PI * Math.PI));
}

/** Expected score `E` of a player (rating `r`) against an opponent (`oppR`, `oppRd`). */
export function glickoExpectedScore(r: number, oppR: number, oppRd: number): number {
    return 1 / (1 + Math.pow(10, (-glickoG(oppRd) * (r - oppR)) / 400));
}

/** Pre-submission Glicko preview of the player-vs-problem match. */
export interface GlickoMatchPreview {
    /** Player's expected score in [0, 1] (probability-like solve chance). */
    expected: number;
    /** Rating gap, player − problem (positive = player favored). */
    gap: number;
    /** Opponent attenuation g(problem.rd). */
    g: number;
    /** Projected player rating change on a correct answer (full-weight, effort-free). */
    deltaWin: number;
    /** Projected player rating change on an incorrect answer (full-weight). */
    deltaLoss: number;
}

/**
 * Project this match from the player's side using the same update as
 * `glicko_rate` with weight `w = 1` (a fresh, full-weight encounter and no
 * effort adjustment). The denominator is outcome-independent, so win/loss deltas
 * share it; real live deltas may be smaller once retry/effort weighting applies.
 */
export function glickoMatchPreview(
    player: PlayerRating,
    problem: ProblemRating,
): GlickoMatchPreview {
    const g = glickoG(problem.rd);
    const e = glickoExpectedScore(player.rating, problem.rating, problem.rd);
    const denom = 1 / (player.rd * player.rd) + GLICKO_Q * GLICKO_Q * g * g * e * (1 - e);
    const base = (GLICKO_Q / denom) * g;
    return {
        expected: e,
        gap: player.rating - problem.rating,
        g,
        deltaWin: base * (1 - e),
        deltaLoss: base * (0 - e),
    };
}

type ProblemEmbeds = {
    canonical_id?: number | null;
    problem_progress?: ProblemProgress[] | null;
    problem_ratings?: (ProblemRating & { scope: string })[] | null;
    // The canonical's shared state, present only for alias rows (see
    // CANONICAL_STATE_SELECT). Its embeds override the row's own empty ones.
    canonical?: {
        problem_progress?: ProblemProgress[] | null;
        problem_ratings?: (ProblemRating & { scope: string })[] | null;
    } | null;
};

/**
 * Collapse the embedded `problem_progress` (0/1 rows) into `progress` and the
 * `problem_ratings` array into the single `overall`-scope `rating`.
 */
function normalizeEmbeds<T extends ProblemEmbeds>(
    row: T,
): Omit<T, "problem_progress" | "problem_ratings" | "canonical"> & {
    progress: ProblemProgress | null;
    rating: ProblemRating | null;
} {
    const { problem_progress, problem_ratings, canonical, ...rest } = row;
    // An alias shares the canonical's rating + progress; a canonical/standalone
    // row (canonical == null) uses its own embeds.
    const progressRows = canonical?.problem_progress ?? problem_progress;
    const ratingRows = canonical?.problem_ratings ?? problem_ratings;
    return {
        ...rest,
        progress: progressRows?.[0] ?? null,
        rating: overallProblemRating(ratingRows),
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
    mastery?: (Mastery | "unassessed")[];
    engagement?: (Engagement | "none")[];
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
    // Page ids through the caller-scoped flat index first. Personal-state filters
    // therefore run before pagination and null means truly unassessed/no plan,
    // including problems with no problem_progress row.
    let index = supabase.from("user_problem_index").select("problem_id");
    if (f.testId != null) index = index.eq("test_id", f.testId);
    else if (f.seriesId != null) index = index.eq("series_id", f.seriesId);
    if (f.topic?.length) index = index.in("topic", f.topic);
    if (f.tags?.length) index = index.contains("tags", f.tags);
    if (f.difficulty)
        index = index
            .gte("difficulty", f.difficulty[0])
            .lte("difficulty", f.difficulty[1]);
    if (f.quality)
        index = index.gte("quality", f.quality[0]).lte("quality", f.quality[1]);
    if (f.isComputational != null)
        index = index.eq("is_computational", f.isComputational);
    if (f.verified != null) index = index.eq("verified", f.verified);
    index = applyNullableStateFilter(index, "mastery", f.mastery, "unassessed");
    index = applyNullableStateFilter(index, "engagement", f.engagement, "none");

    const { data: idRows, error: indexError } = await index
        .order("n")
        .order("problem_id")
        .range(...pageRange(page));
    if (indexError) throw indexError;
    const ids = (idRows ?? [])
        .map((row) => row.problem_id)
        .filter((id): id is number => id != null);
    if (ids.length === 0) return [];

    const { data, error } = await supabase
        .from("problems")
        .select(
            `*, tests(name, series_id, series(name), aops_category_id, division, format), ${PROGRESS_SELECT}, ${RATING_SELECT}, ${CANONICAL_STATE_SELECT}`,
        )
        .in("id", ids);
    if (error) throw error;
    const order = new Map(ids.map((id, i) => [id, i]));
    return ((data ?? []) as unknown as Array<ProblemRow & ProblemEmbeds>)
        .map(normalizeEmbeds)
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function applyNullableStateFilter(
    query: any,
    column: "mastery" | "engagement",
    values: string[] | undefined,
    nullValue: "unassessed" | "none",
) {
    if (!values?.length) return query;
    const includeNull = values.includes(nullValue);
    const concrete = values.filter((value) => value !== nullValue);
    if (includeNull && concrete.length === 0) return query.is(column, null);
    if (!includeNull) return query.in(column, concrete);
    return query.or(`${column}.is.null,${column}.in.(${concrete.join(",")})`);
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
            `*, tests(name, series_id, series(name)), ${PROGRESS_SELECT}, ${RATING_SELECT}, ${CANONICAL_STATE_SELECT}`,
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
