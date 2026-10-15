import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "#lib/types/database.types.js";
import {
    TESTS_EMBED,
    PROGRESS_SELECT,
    RATING_SELECT,
    CANONICAL_STATE_SELECT,
    normalizeEmbeds,
    type ProblemRow,
} from "#lib/library.js";
import type { Engagement, Mastery, ProblemProgress } from "#lib/progress.js";
import type { Pacing } from "#lib/test-timing.js";
import { hasComparableAnswer } from "#lib/problem-response.js";
export type { ProblemProgress } from "#lib/progress.js";

type Supabase = SupabaseClient<Database>;

export type PracticeMode = "new" | "review" | "skipped" | "list" | "mixed";

/**
 * The session *format* — how the whole practice run behaves — as opposed to
 * `PracticeMode`, which only chooses where problems are drawn from. "practice" is
 * the free-form default; "test" pins the session to one test and defers grading.
 * (Room reserved for a future "relay" format.)
 */
export type SessionFormat = "practice" | "test";

export type Range = [number, number];

/** PostgreSQL integer counter ceiling, also used as an open upper bound. */
export const MAX_HISTORY_COUNT = 2_147_483_647;

export type PracticeSettings = {
    /** Legacy/offline compatibility only; online selection uses history filters. */
    mode: PracticeMode;
    historyVersion?: 1;
    lastSubmissionWindow?: "within" | "outside";
    historyEngagement?: Engagement | null;
    historyOrder?: "random" | "oldest";
    // Session format. Defaults to "practice"; reads must tolerate older snapshots
    // that predate this field (treat a missing value as "practice").
    format: SessionFormat;
    // Test-format only: the test whose problems are worked through, in order, and
    // the total time allotment in seconds (null = unlimited / untimed).
    testId: number | null;
    timeLimitSeconds: number | null;
    // Test-format only: how the test's time is spent. `pooled` (or absent) is the
    // historical single-clock behavior; `segmented` splits the test into
    // independently-timed segments (MATHCOUNTS Target/Countdown) that lock in
    // order without carrying time over. `timeLimitSeconds` above is kept in sync
    // as the "≈ total" for display/summary. Optional so older snapshots (which
    // predate segmentation) are tolerated as pooled.
    pacing?: Pacing | null;
    // Test-format only: strict expiry (default) hard-locks a segment and
    // auto-advances at 0:00; lenient lets the segment clock run red and overrun
    // until the user submits. Only meaningful for segmented pacing. Optional so
    // older snapshots are tolerated (treated as strict).
    strictTiming?: boolean;
    // Test-format only: allow pausing the session clock (a creation-time opt-in).
    // Tests default to no-pause (a mock should run uninterrupted); flipping this on
    // restores the pause affordance the practice format always has. Optional so
    // older snapshots are tolerated (treated as false / no pause).
    allowPause?: boolean;
    // Test-format only, segmented Countdown (single-problem segments) only: grade
    // and reveal each problem's outcome the moment its segment is submitted, rather
    // than deferring every reveal to the end. Final grading/recording is unchanged
    // (still one append-only grade at submitTest); this only surfaces the outcome
    // early. Optional so older snapshots are tolerated (treated as false).
    revealPerSegment?: boolean;
    // UI-only preference for a minimal trainer surface. Stored in session
    // settings jsonb alongside the draw filters.
    focusMode: boolean;
    // Practice-format only: how many attempts the user gets per problem before it
    // is finalized as incorrect. Re-submitting an already-tried answer doesn't
    // consume a try. Optional so older snapshots are tolerated (treated as 2).
    triesPerProblem?: number;
    // Practice-format only: a per-problem answering time limit in seconds. When
    // set, the trainer runs a countdown on the current problem and, at zero,
    // auto-finishes it in place — grading the entered answer (forced final, no
    // retries), else recording a skip — and reveals it; the user advances. Editable
    // mid-problem, so the countdown window rebases rather than expiring the problem
    // retroactively (`rebaseCountdownBaseline`, `#lib/countdown`). `null`/absent =
    // untimed (count-up). Optional so older snapshots are tolerated.
    perProblemSeconds?: number | null;
    // Adaptive difficulty. When on, every draw is constrained to problems whose
    // overall Glicko rating sits within `adaptiveRange` points of the player's
    // live rating, falling back to the nearest-rated matching problem and then
    // an unrated draw when the band is empty. History filters are never relaxed. Optional so
    // older session snapshots are tolerated (adaptive treated as on by default).
    adaptive?: boolean;
    adaptiveRange?: number;
    seriesIds?: string[]; // Optional for backward compatibility with older snapshots
    // Per-series test-level draw scope. Keyed by series id (string, matching
    // `seriesIds`); each entry narrows *that* series' draws to the chosen
    // divisions, formats, problem-number range, and/or year range (an empty
    // axis = no narrowing on that axis). `problemNumbers` is 1-based inclusive
    // (`problems.n + 1`); omit it for the full number line. `yearRange` is
    // inclusive on `tests.year`; omit it for that series' full span. Because
    // division/format vocabulary is per-series, the draw is an OR-of-ANDs
    // across series (see {@link seriesScopeFilter}), so one series' "State"
    // never leaks onto another. Entries for series not in `seriesIds` are
    // ignored. Optional so older snapshots are tolerated (no constraint).
    // NOTE: `formats` (paper type — Sprint/Target/Team) is distinct from
    // `format` (SessionFormat) above; don't conflate.
    seriesScopes?: Record<
        string,
        {
            divisions: string[];
            formats: string[];
            problemNumbers?: [number, number];
            yearRange?: [number, number];
        }
    >;
    // Problem-attribute filters — apply to every mode.
    topic: string[];
    difficulty: Range;
    verifiedOnly: boolean;
    computational: boolean | null;
    // Reference-answer coverage. "with" = a known, comparable reference answer;
    // "without" = source-missing or needs-review problems where users can help;
    // "any" = no coverage restriction. Optional so older snapshots are tolerated.
    answerAvailability?: "with" | "without" | "any";
    // Solution availability. "with" = only problems with at least one official
    // solution; "without" = only those with none; "any" = both. Optional so older
    // session snapshots without it are tolerated (treated as "any").
    solutionAvailability?: "with" | "without" | "any";
    // History filters apply to every online draw. `null` = "Any".
    timesSeen: Range | null;
    timesReviewed: Range | null;
    timesCorrect: Range | null;
    timesSkipped: Range | null;
    lastSubmissionDays: number | null; // window on last_submission_at, including skips
    lastOutcome: "any" | "correct" | "incorrect";
    /** Legacy snapshot field. Unscheduled rows are no longer served as due. */
    includeUnscheduled: boolean;
    mastery: (Mastery | "unassessed")[];
    listEngagement: Engagement;
};

/**
 * Per-format behavior flags consumed by the practice view, so format differences
 * are declared in one place rather than scattered as `if (format === …)` checks.
 * "practice" is the historical behavior; "test" defers grading and keeps every
 * problem editable (no per-problem freeze) until a single final submission.
 */
export const FORMAT_BEHAVIOR: Record<
    SessionFormat,
    {
        /** Freeze a problem once navigated away from (practice) vs. keep editable (test). */
        freezeOnNavigate: boolean;
        /** Grade + record each answer immediately (practice) vs. all at the end (test). */
        gradeImmediately: boolean;
        /** Reveal correct/incorrect state on the answer UI as you go. */
        revealAnswerState: boolean;
        /** Show the running solved/incorrect/skipped chips, bar and status tags. */
        showLiveFeedback: boolean;
        /** Allow pausing the timer. */
        allowPause: boolean;
    }
> = {
    practice: {
        freezeOnNavigate: true,
        gradeImmediately: true,
        revealAnswerState: true,
        showLiveFeedback: true,
        allowPause: true,
    },
    test: {
        freezeOnNavigate: false,
        gradeImmediately: false,
        revealAnswerState: false,
        showLiveFeedback: false,
        allowPause: false,
    },
};

export type PracticeSource = "practice" | "review";

export type PracticeAttempt = {
    problemId: number;
    selectedChoice: number | null;
    correct: boolean | null;
    elapsedMs: number;
    skipped: boolean;
    flagged: boolean;
};

/** Cross-load state for forward progress through matching problems. */
export type PracticeSession = {
    /** Problem ids already shown this session (avoids repeats / advances queues). */
    shownIds: Set<number>;
    /** Monotonic count of successful draws. */
    drawIndex: number;
};

export type PracticeResult = {
    problem: ProblemRow | null;
    source: PracticeSource;
    progress: ProblemProgress | null;
};

const PROBLEM_SELECT = `*, ${TESTS_EMBED}`;
const FALLBACK_PAGE_SIZE = 25;

/** Adaptive difficulty: default half-width of the rating band (points ±). */
export const ADAPTIVE_RANGE_DEFAULT = 200;
/** Slider bounds for the adaptive rating-band half-width. */
export const ADAPTIVE_RANGE_BOUNDS: Range = [50, 600];

/**
 * Bounds for the manual Difficulty control, which is a Glicko-rating band on the
 * problem's overall rating (the deprecated `problems.difficulty` column is dead —
 * every row is 0 — so difficulty now targets the live rating). Only consulted when
 * Adaptive difficulty is off; adaptive centers its own band on the player instead.
 * Wide enough to cover the corpus (currently ~500–2400) with headroom.
 */
export const RATING_RANGE: Range = [500, 2500];

/**
 * Resolve the manual Difficulty range into a rating band, or `null` for "no
 * constraint". Returns null at (or beyond) full range, and — defensively —
 * whenever the stored range sits entirely below the rating floor, which is how a
 * legacy snapshot (difficulty in the old 0–100 domain) reads; those must not be
 * interpreted as a 0–100 *rating* band (which would match nothing).
 */
function manualRatingBand(range: Range | undefined): [number, number] | null {
    if (!range) return null;
    const [rawLo, rawHi] = range;
    if (rawHi < RATING_RANGE[0]) return null;
    const lo = Math.max(rawLo, RATING_RANGE[0]);
    const hi = Math.min(rawHi, RATING_RANGE[1]);
    if (lo <= RATING_RANGE[0] && hi >= RATING_RANGE[1]) return null;
    if (lo > hi) return null;
    return [lo, hi];
}

/**
 * Settings augmented with a resolved rating band for adaptive draws. The band is
 * `[center - range, center + range]` around the player's live rating, computed
 * once per draw in {@link nextPracticeProblem}; `null` disables adaptive filtering
 * for this draw (adaptive off, or no player rating yet). Never persisted — it is
 * derived at draw time and layered over the stored {@link PracticeSettings}.
 */
type ResolvedSettings = PracticeSettings & {
    ratingBand?: [number, number] | null;
    historyNow?: number;
};

export function createSession(): PracticeSession {
    return { shownIds: new Set<number>(), drawIndex: 0 };
}

/**
 * The canonical default practice settings. Used to seed the panel for root
 * (ungrouped) practice and to snapshot settings when starting a new session
 * from the hub (where there is no live panel to read from).
 */
export function defaultPracticeSettings(): PracticeSettings {
    return {
        mode: "new",
        historyVersion: 1,
        lastSubmissionWindow: "outside",
        historyEngagement: null,
        historyOrder: "random",
        format: "practice",
        testId: null,
        timeLimitSeconds: null,
        focusMode: false,
        triesPerProblem: 2,
        perProblemSeconds: null,
        seriesIds: [],
        seriesScopes: {},
        topic: [],
        difficulty: [...RATING_RANGE],
        verifiedOnly: false,
        computational: null,
        answerAvailability: "with",
        solutionAvailability: "any",
        adaptive: true,
        adaptiveRange: ADAPTIVE_RANGE_DEFAULT,
        timesSeen: null,
        timesReviewed: null,
        timesCorrect: null,
        timesSkipped: null,
        lastSubmissionDays: null,
        lastOutcome: "any",
        includeUnscheduled: false,
        mastery: [],
        listEngagement: "working",
    };
}

/**
 * Default settings for a Test-format session pinned to `testId`. The draw filters
 * are irrelevant (problems come straight from the test, in order), so this just
 * overrides format/test/time onto the practice defaults.
 */
export function defaultTestSettings(
    testId: number,
    timeLimitSeconds: number | null,
    pacing: Pacing | null = null,
    strictTiming = true,
    allowPause = false,
    revealPerSegment = false,
): PracticeSettings {
    return {
        ...defaultPracticeSettings(),
        format: "test",
        testId,
        timeLimitSeconds,
        pacing,
        strictTiming,
        allowPause,
        revealPerSegment,
    };
}

/** A stored 1-based problem-number pair that actually narrows that series. */
function storedProblemNumbers(
    scope: { problemNumbers?: [number, number] } | undefined,
): [number, number] | null {
    const range = scope?.problemNumbers;
    if (!range) return null;
    const lo = range[0];
    const hi = range[1];
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) {
        return null;
    }
    return [lo, hi];
}

/** A stored inclusive year pair that actually narrows that series. */
function storedYearRange(
    scope: { yearRange?: [number, number] } | undefined,
): [number, number] | null {
    const range = scope?.yearRange;
    if (!range) return null;
    const lo = range[0];
    const hi = range[1];
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) {
        return null;
    }
    return [lo, hi];
}

/**
 * Whether any selected series carries a division/format/year narrowing.
 *
 * Exported for the goals scope-contract test: the SQL resolver owns the
 * definition of scope matching and this filter is its mirror, so the test must
 * exercise this code rather than a copy of it (`docs/goals.md` §3).
 */
export function hasSeriesScope(settings: PracticeSettings): boolean {
    const scopes = settings.seriesScopes ?? {};
    return (settings.seriesIds ?? []).some((id) => {
        const scope = scopes[id];
        return (
            (scope?.divisions?.length ?? 0) > 0 ||
            (scope?.formats?.length ?? 0) > 0 ||
            storedYearRange(scope) != null
        );
    });
}

/**
 * Whether any selected series carries a problem-number range. Full-range
 * sliders omit the field, so presence is the narrowing.
 */
export function hasProblemNumberScope(settings: PracticeSettings): boolean {
    const scopes = settings.seriesScopes ?? {};
    return (settings.seriesIds ?? []).some((id) => storedProblemNumbers(scopes[id]) != null);
}

/** Double-quote + escape a value for a PostgREST `in.(…)` list literal. */
function pgQuote(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type SeriesScopeFilterOptions = {
    /**
     * Build the problem-number OR body (`n` on the problems resource plus a
     * per-series empty-embed `not.is.null`). PostgREST cannot put `tests.series_id`
     * inside `and()` — after a table name the parser only accepts `not` or an
     * operator — so series/division/format/year live on `{alias}:tests()` filters
     * applied by {@link applySeriesScopeFilter}, not in this string.
     */
    qualifyForProblemNumbers?: boolean;
};

/**
 * Empty `tests` embed alias for one series. Negative ids become `sn940001`
 * (`-` is not a PostgREST identifier character).
 */
export function seriesScopeEmbedAlias(seriesId: string): string {
    return `s${seriesId.replaceAll("-", "n")}`;
}

/**
 * Extra select fragments for those aliases. Must be present on the query
 * whenever {@link hasProblemNumberScope} is true, or the alias filters are
 * silently dropped.
 */
export function seriesScopeSelectAliases(settings: PracticeSettings): string {
    if (!hasProblemNumberScope(settings)) return "";
    return (settings.seriesIds ?? [])
        .map((id) => `, ${seriesScopeEmbedAlias(id)}:tests()`)
        .join("");
}

/**
 * The comma-separated OR body scoping a draw to the selected series, narrowing
 * each series by its own divisions/formats and optional problem-number or year
 * range. Because vocabulary is per-series, this is an OR-of-ANDs — one branch
 * per series, each requiring that series' id and (if set) its own narrowing —
 * so a division, #21–25, or 2010–2024 chosen for one series never applies to
 * another. A series with no narrowing contributes a bare `series_id.eq.N`
 * branch.
 *
 * When {@link hasProblemNumberScope} is true (or `qualifyForProblemNumbers` is
 * passed), the body is applied on the *problems* resource: `n` lives there, not
 * on tests, and `{ referencedTable: "tests" }` would look for `tests.n`. Each
 * branch is `and(n.gte,n.lte,{alias}.not.is.null)` (or just the alias when that
 * series has no number range). Otherwise the unprefixed tests-column form is
 * consumed via `.or(body, { referencedTable })` as before.
 */
export function seriesScopeFilter(
    settings: PracticeSettings,
    options: SeriesScopeFilterOptions = {},
): string {
    const qualify =
        options.qualifyForProblemNumbers ?? hasProblemNumberScope(settings);
    const scopes = settings.seriesScopes ?? {};
    if (qualify) {
        return (settings.seriesIds ?? [])
            .map((id) => {
                const alias = seriesScopeEmbedAlias(id);
                const numbers = storedProblemNumbers(scopes[id]);
                const terms: string[] = [`${alias}.not.is.null`];
                if (numbers) {
                    terms.unshift(
                        `n.gte.${numbers[0] - 1}`,
                        `n.lte.${numbers[1] - 1}`,
                    );
                }
                return terms.length === 1 ? terms[0] : `and(${terms.join(",")})`;
            })
            .join(",");
    }
    return (settings.seriesIds ?? [])
        .map((id) => {
            const scope = scopes[id];
            const terms = [`series_id.eq.${Number(id)}`];
            if (scope?.divisions?.length) {
                terms.push(
                    `division.in.(${scope.divisions.map(pgQuote).join(",")})`,
                );
            }
            if (scope?.formats?.length) {
                terms.push(`format.in.(${scope.formats.map(pgQuote).join(",")})`);
            }
            const years = storedYearRange(scope);
            if (years) {
                terms.push(`year.gte.${years[0]}`, `year.lte.${years[1]}`);
            }
            return terms.length === 1 ? terms[0] : `and(${terms.join(",")})`;
        })
        .join(",");
}

/**
 * Apply series / division / format / problem-number / year scope to a
 * PostgREST query. Shared with the goals scope-contract test so the two cannot
 * drift.
 */
export function applySeriesScopeFilter(
    query: any,
    settings: PracticeSettings,
    prefix: "" | "problems." = "",
): any {
    if (!settings.seriesIds?.length) return query;
    const embed = prefix === "" ? "tests" : "problems.tests";
    if (hasProblemNumberScope(settings)) {
        let next = query;
        for (const id of settings.seriesIds) {
            const col = `${prefix}${seriesScopeEmbedAlias(id)}`;
            next = next.eq(`${col}.series_id`, Number(id));
            const scope = settings.seriesScopes?.[id];
            if (scope?.divisions?.length) {
                next = next.in(`${col}.division`, scope.divisions);
            }
            if (scope?.formats?.length) {
                next = next.in(`${col}.format`, scope.formats);
            }
            const years = storedYearRange(scope);
            if (years) {
                next = next.gte(`${col}.year`, years[0]).lte(`${col}.year`, years[1]);
            }
        }
        const body = seriesScopeFilter(settings, {
            qualifyForProblemNumbers: true,
        });
        return prefix === "problems."
            ? next.or(body, { referencedTable: "problems" })
            : next.or(body);
    }
    if (hasSeriesScope(settings)) {
        return query.or(seriesScopeFilter(settings), {
            referencedTable: embed,
        });
    }
    return query.in(`${embed}.series_id`, settings.seriesIds.map(Number));
}

/** PostgREST `in` list literal, or null when there is nothing to exclude. */
function exclusionList(ids: Iterable<number>): string | null {
    const arr = [...ids];
    return arr.length ? `(${arr.join(",")})` : null;
}

/** Translate old mode snapshots once; new snapshots have no mode-dependent logic. */
export function normalizePracticeHistory(raw: Partial<PracticeSettings>): PracticeSettings {
    const settings = { ...defaultPracticeSettings(), ...raw };
    if (raw.historyVersion !== 1 && raw.mode) {
        if (raw.mode === "new") settings.timesReviewed ??= [0, 0];
        if (raw.mode === "review") {
            settings.timesReviewed = [Math.max(1, settings.timesReviewed?.[0] ?? 1), settings.timesReviewed?.[1] ?? MAX_HISTORY_COUNT];
            if (raw.lastSubmissionDays == null) {
                settings.lastSubmissionDays = 7;
                settings.lastSubmissionWindow = "outside";
            }
        }
        if (raw.mode === "skipped") {
            settings.timesSkipped = [Math.max(1, settings.timesSkipped?.[0] ?? 1), settings.timesSkipped?.[1] ?? MAX_HISTORY_COUNT];
            settings.timesCorrect ??= [0, 0];
        }
        if (raw.mode === "list") settings.historyEngagement = raw.listEngagement ?? "working";
        if (raw.lastSubmissionDays != null) settings.lastSubmissionWindow = "within";
    }
    return { ...settings, mode: "new", historyVersion: 1 };
}

/** The Review shortcut is a preset of the same filters, never a separate queue. */
export function defaultReviewSettings(): PracticeSettings {
    return {
        ...defaultPracticeSettings(),
        timesReviewed: [1, MAX_HISTORY_COUNT],
        lastSubmissionDays: 7,
        lastSubmissionWindow: "outside",
        historyOrder: "oldest",
    };
}

function applyMasteryFilter(query: any, mastery: PracticeSettings["mastery"]) {
    if (!mastery?.length) return query;
    const includeNull = mastery.includes("unassessed");
    const values = mastery.filter((value) => value !== "unassessed");
    if (includeNull && values.length === 0) return query.is("mastery", null);
    if (!includeNull) return query.in("mastery", values);
    return query.or(`mastery.is.null,mastery.in.(${values.join(",")})`);
}

/** One history contract, applied before counting, ordering or paging. */
export function applyPracticeHistoryFilters(
    query: any,
    settings: PracticeSettings,
    now = Date.now(),
): any {
    let next = applyMasteryFilter(query, settings.mastery);
    for (const [column, range] of [
        ["times_seen", settings.timesSeen],
        ["times_reviewed", settings.timesReviewed],
        ["times_correct", settings.timesCorrect],
        ["times_skipped", settings.timesSkipped],
    ] as const) {
        if (range) next = next.gte(column, range[0]).lte(column, range[1]);
    }
    if (settings.lastSubmissionDays != null) {
        const cutoff = new Date(now - settings.lastSubmissionDays * 86_400_000).toISOString();
        next = settings.lastSubmissionWindow === "outside"
            ? next.or(`last_submission_at.is.null,last_submission_at.lt.${cutoff}`)
            : next.gte("last_submission_at", cutoff);
    }
    if (settings.lastOutcome === "correct") next = next.eq("last_correct", true);
    if (settings.lastOutcome === "incorrect") next = next.eq("last_correct", false);
    return settings.historyEngagement
        ? next.eq("engagement", settings.historyEngagement)
        : next.eq("is_ignored", false);
}

/** The flat index carries placement scope and canonical-owned progress together. */
function practiceIndexQuery(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
    options: { count?: "exact"; head?: boolean } = {},
) {
    let query = applyPracticeHistoryFilters(
        supabase.from("user_problem_index").select("problem_id, canonical_id", options),
        settings,
        settings.historyNow ?? Date.now(),
    ).eq("has_statement", true);
    if (!settings.seriesIds?.length) query = query.is("canonical_id", null);
    else {
        const scopes = settings.seriesScopes ?? {};
        const clauses = settings.seriesIds.map((id) => {
            const scope = scopes[id];
            const terms = [`series_id.eq.${Number(id)}`];
            if (scope?.divisions?.length) terms.push(`division.in.(${scope.divisions.map(pgQuote).join(",")})`);
            if (scope?.formats?.length) terms.push(`format.in.(${scope.formats.map(pgQuote).join(",")})`);
            const numbers = storedProblemNumbers(scope);
            if (numbers) terms.push(`n.gte.${numbers[0] - 1}`, `n.lte.${numbers[1] - 1}`);
            const years = storedYearRange(scope);
            if (years) terms.push(`year.gte.${years[0]}`, `year.lte.${years[1]}`);
            return terms.length === 1 ? terms[0] : `and(${terms.join(",")})`;
        });
        query = query.or(clauses.join(","));
    }
    if (settings.topic.length) query = query.in("topic", settings.topic);
    if (settings.verifiedOnly) query = query.eq("verified", true);
    if (settings.computational != null) query = query.eq("is_computational", settings.computational);
    if (settings.answerAvailability === "without") query = query.in("answer_status", ["source_missing", "needs_review"]);
    else if ((settings.answerAvailability ?? "with") === "with") {
        query = query.eq("answer_status", "known").gte("answer_index", 0).eq("has_choices", true);
    }
    if (settings.solutionAvailability === "with") query = query.eq("has_solution", true);
    if (settings.solutionAvailability === "without") query = query.eq("has_solution", false);
    if (settings.ratingBand) query = query.gte("rating", settings.ratingBand[0]).lte("rating", settings.ratingBand[1]);
    const exclude = exclusionList(session.shownIds);
    if (exclude) {
        query = query.not("problem_id", "in", exclude)
            .or(`canonical_id.is.null,canonical_id.not.in.${exclude}`);
    }
    return query;
}

async function eligibleIndexRows(supabase: Supabase, ids: number[], settings: PracticeSettings) {
    if (!ids.length) return [];
    const { data, error } = await supabase.from("problems")
        .select(`*, ${TESTS_EMBED}, ${PROGRESS_SELECT}, ${RATING_SELECT}, ${CANONICAL_STATE_SELECT}`)
        .in("id", ids);
    if (error) throw error;
    const rows = ((data ?? []) as unknown as (ProblemRow & Parameters<typeof normalizeEmbeds>[0])[]).map(normalizeEmbeds);
    const byId = new Map<number, ProblemRow>(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is ProblemRow =>
        Boolean(row?.statement?.trim()) &&
        ((settings.answerAvailability ?? "with") !== "with" || hasComparableAnswer(row!)),
    );
}

async function drawMatchingProblem(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
): Promise<ProblemRow | null> {
    const { count, error } = await practiceIndexQuery(supabase, settings, session, { count: "exact", head: true });
    if (error) throw error;
    if (!count) return null;
    const offset = settings.historyOrder === "oldest" ? 0 : Math.floor(Math.random() * count);
    // Scan beyond an invalid reference key/blank statement instead of allowing
    // one malformed candidate to hide later eligible results.
    for (const [start, end] of [[offset, count], [0, offset]]) {
        for (let from = start; from < end; from += FALLBACK_PAGE_SIZE) {
            let query = practiceIndexQuery(supabase, settings, session);
            if (settings.historyOrder === "oldest") query = query.order("last_submission_at", { ascending: true, nullsFirst: true });
            const { data, error: pageError } = await query.order("problem_id")
                .range(from, Math.min(end, from + FALLBACK_PAGE_SIZE) - 1);
            if (pageError) throw pageError;
            const ids = (data ?? []).map((row: { problem_id: number }) => row.problem_id);
            const rows = await eligibleIndexRows(supabase, ids, settings);
            if (rows.length) return rows[0];
        }
    }
    return null;
}

/** Nearest-rated fallback preserves every explicit scope/history requirement. */
async function nearestMatchingProblem(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
    center: number,
): Promise<ProblemRow | null> {
    const base = () => practiceIndexQuery(supabase, { ...settings, ratingBand: null }, session);
    const [above, below] = await Promise.all([
        base().gte("rating", center).order("rating").order("problem_id").limit(FALLBACK_PAGE_SIZE),
        base().lt("rating", center).order("rating", { ascending: false }).order("problem_id").limit(FALLBACK_PAGE_SIZE),
    ]);
    if (above.error) throw above.error;
    if (below.error) throw below.error;
    const ordered = [...(above.data ?? []), ...(below.data ?? [])];
    const rows = await eligibleIndexRows(supabase, ordered.map((row) => row.problem_id!), settings);
    return rows.sort((a, b) => Math.abs((a.rating?.rating ?? Infinity) - center) - Math.abs((b.rating?.rating ?? Infinity) - center))[0] ?? null;
}

/** All online practice uses the same filters; due dates never gate selection. */
export async function nextPracticeProblem(
    supabase: Supabase,
    raw: PracticeSettings,
    session: PracticeSession,
    playerRating: number | null = null,
): Promise<PracticeResult> {
    const settings = normalizePracticeHistory(raw);
    const center = settings.adaptive && playerRating != null ? playerRating : null;
    const range = settings.adaptiveRange ?? ADAPTIVE_RANGE_DEFAULT;
    const ratingBand = center != null ? [center - range, center + range] as Range
        : settings.adaptive ? null : manualRatingBand(settings.difficulty);
    const resolved: ResolvedSettings = { ...settings, ratingBand, historyNow: Date.now() };
    let problem = await drawMatchingProblem(supabase, resolved, session);
    if (!problem && center != null) {
        problem = await nearestMatchingProblem(supabase, resolved, session, center)
            ?? await drawMatchingProblem(supabase, { ...resolved, ratingBand: null }, session);
    }
    const progress = problem?.progress ?? null;
    return { problem, progress, source: (progress?.times_reviewed ?? 0) > 0 ? "review" : "practice" };
}

/**
 * Every usable problem belonging to a test, in problem-number order. Unlike
 * the random/review draws, Test format works through a fixed, fully-known set, so
 * this is fetched once (unpaginated) and the whole sequence becomes the session's
 * navigable history. Only blank statements are dropped: unsupported capture and
 * ungraded response kinds stay visible instead of silently shortening the test.
 */
export async function fetchTestProblems(
    supabase: Supabase,
    testId: number,
): Promise<ProblemRow[]> {
    const { data, error } = await supabase
        .from("problems")
        .select(PROBLEM_SELECT)
        .eq("test_id", testId)
        .order("n")
        .order("id");
    if (error) throw error;
    return ((data ?? []) as unknown as ProblemRow[]).filter((p) =>
        Boolean(p.statement?.trim()),
    );
}
