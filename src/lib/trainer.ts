import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import {
    TESTS_EMBED,
    TESTS_EMBED_INNER,
    type ProblemRow,
} from "$lib/library";
import type { Engagement, Mastery, ProblemProgress } from "$lib/progress";
import type { Pacing } from "$lib/test-timing";
export type { ProblemProgress } from "$lib/progress";

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

export type PracticeSettings = {
    mode: PracticeMode;
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
    // UI-only preference for a minimal trainer surface. Stored in session
    // settings jsonb alongside the draw filters.
    focusMode: boolean;
    // Practice-format only: how many attempts the user gets per problem before it
    // is finalized as incorrect. Re-submitting an already-tried answer doesn't
    // consume a try. Optional so older snapshots are tolerated (treated as 2).
    triesPerProblem?: number;
    // Practice-format only: a per-problem answering time limit in seconds. When
    // set, the trainer runs a countdown on the current problem and, at zero,
    // auto-finishes it (grades the entered answer, else skips) and advances to the
    // next. `null`/absent = untimed (count-up). Optional so older snapshots are
    // tolerated (treated as untimed).
    perProblemSeconds?: number | null;
    // Adaptive difficulty. When on, every draw is constrained to problems whose
    // overall Glicko rating sits within `adaptiveRange` points of the player's
    // live rating, falling back to the nearest-rated problem (new draws) or the
    // unconstrained queue (review/skipped) when the band is empty. Optional so
    // older session snapshots are tolerated (adaptive treated as on by default).
    adaptive?: boolean;
    adaptiveRange?: number;
    seriesIds?: string[]; // Optional for backward compatibility with older snapshots
    // Per-series test-level draw scope. Keyed by series id (string, matching
    // `seriesIds`); each entry narrows *that* series' draws to the chosen
    // divisions and/or formats (an empty axis = no narrowing on that axis).
    // Because division/format vocabulary is per-series, the draw is an
    // OR-of-ANDs across series (see {@link seriesScopeFilter}), so one series'
    // "State" never leaks onto another. Entries for series not in `seriesIds`
    // are ignored. Optional so older snapshots are tolerated (no constraint).
    // NOTE: `formats` (paper type — Sprint/Target/Team) is distinct from
    // `format` (SessionFormat) above; don't conflate.
    seriesScopes?: Record<string, { divisions: string[]; formats: string[] }>;
    // Problem-attribute filters — apply to every mode.
    topic: string[];
    difficulty: Range;
    verifiedOnly: boolean;
    computational: boolean | null;
    // Answer availability. "with" = only problems with a recorded answer (the
    // historical default); "without" = only answerless problems (answer_index -1
    // or null) for users helping fill in answers; "any" = both. Optional so older
    // session snapshots without it are tolerated (treated as "with").
    answerAvailability?: "with" | "without" | "any";
    // Solution availability. "with" = only problems with at least one official
    // solution; "without" = only those with none; "any" = both. Optional so older
    // session snapshots without it are tolerated (treated as "any").
    solutionAvailability?: "with" | "without" | "any";
    // Advanced progress filters — apply to the review queue only. `null` = "Any".
    timesSeen: Range | null;
    timesReviewed: Range | null;
    timesCorrect: Range | null;
    timesSkipped: Range | null;
    lastSubmissionDays: number | null; // only reviewed within the last N days
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

/** Cross-load state for interleaving and forward progress through queues. */
export type PracticeSession = {
    /** Problem ids already shown this session (avoids repeats / advances queues). */
    shownIds: Set<number>;
    /** Monotonic draw counter; drives the Mixed-mode interleave pattern. */
    drawIndex: number;
};

export type PracticeResult = {
    problem: ProblemRow | null;
    source: PracticeSource;
    progress: ProblemProgress | null;
};

const PROBLEM_SELECT = `*, ${TESTS_EMBED}`;
const MAX_RANDOM_ATTEMPTS = 6;
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

/** Inner rating embed, so a draw can be band-filtered by overall Glicko rating. */
const RATING_INNER = "problem_ratings!inner(scope, rating, rd, attempts)";

/**
 * Settings augmented with a resolved rating band for adaptive draws. The band is
 * `[center - range, center + range]` around the player's live rating, computed
 * once per draw in {@link nextPracticeProblem}; `null` disables adaptive filtering
 * for this draw (adaptive off, or no player rating yet). Never persisted — it is
 * derived at draw time and layered over the stored {@link PracticeSettings}.
 */
type ResolvedSettings = PracticeSettings & {
    ratingBand?: [number, number] | null;
};

// Mixed-mode interleave: 1 review : 2 new (lead with review so it never starves).
const MIXED_PATTERN: PracticeSource[] = ["review", "practice", "practice"];

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
): PracticeSettings {
    return {
        ...defaultPracticeSettings(),
        format: "test",
        testId,
        timeLimitSeconds,
        pacing,
        strictTiming,
    };
}

/**
 * Whether the draw filters on any `tests`-level attribute. Scoping is always
 * anchored to `seriesIds` (a division/format scope only narrows a selected
 * series), so this reduces to "any series selected". When true, the `tests`
 * embed must be inner-joined so the filter constrains the parent
 * `problems`/`problem_progress` rows.
 */
function scopesTests(settings: PracticeSettings): boolean {
    return (settings.seriesIds?.length ?? 0) > 0;
}

/** Whether any selected series carries a division/format narrowing. */
function hasSeriesScope(settings: PracticeSettings): boolean {
    const scopes = settings.seriesScopes ?? {};
    return (settings.seriesIds ?? []).some((id) => {
        const scope = scopes[id];
        return (
            (scope?.divisions?.length ?? 0) > 0 ||
            (scope?.formats?.length ?? 0) > 0
        );
    });
}

/** Double-quote + escape a value for a PostgREST `in.(…)` list literal. */
function pgQuote(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The comma-separated OR body scoping a draw to the selected series, narrowing
 * each series by its own divisions/formats. Because vocabulary is per-series,
 * this is an OR-of-ANDs — one branch per series, each requiring that series'
 * id and (if set) its division/format membership — so a division chosen for one
 * series never applies to another. A series with no narrowing contributes a
 * bare `series_id.eq.N` branch (all its problems pass). Consumed via `.or(body,
 * { referencedTable })` against the (possibly nested) embedded `tests` table.
 * Only called when {@link hasSeriesScope} is true; otherwise the plainer
 * `series_id in (…)` membership filter is used.
 */
function seriesScopeFilter(settings: PracticeSettings): string {
    const scopes = settings.seriesScopes ?? {};
    return (settings.seriesIds ?? [])
        .map((id) => {
            const scope = scopes[id];
            const terms = [`series_id.eq.${Number(id)}`];
            if (scope?.divisions?.length) {
                terms.push(`division.in.(${scope.divisions.map(pgQuote).join(",")})`);
            }
            if (scope?.formats?.length) {
                terms.push(`format.in.(${scope.formats.map(pgQuote).join(",")})`);
            }
            return terms.length === 1 ? terms[0] : `and(${terms.join(",")})`;
        })
        .join(",");
}

/** PostgREST `in` list literal, or null when there is nothing to exclude. */
function exclusionList(ids: Iterable<number>): string | null {
    const arr = [...ids];
    return arr.length ? `(${arr.join(",")})` : null;
}

/**
 * Base eligibility + problem-attribute filters. `prefix` targets an embedded
 * resource ("problems.") when filtering through `problem_progress`, or "" when
 * querying the `problems` table directly.
 */
function applyAttributeFilters(
    query: any,
    settings: ResolvedSettings,
    prefix: "" | "problems." = "",
) {
    // Eligibility floor: a usable problem always has a non-blank statement.
    let next = query
        .not(`${prefix}statement`, "is", null)
        .neq(`${prefix}statement`, "");

    // Answer availability. "no answer" is `answer_index = -1` (the column default)
    // or null; "with" requires a real index (>= 0); "any" drops the constraint.
    const answerAvailability = settings.answerAvailability ?? "with";
    if (answerAvailability === "with") {
        // Graded draws also need comparable choices. A graded problem's correct
        // answer is `choices[answer_index]` — MCQ (>1 choice) or computational
        // free-response (a single choice holding the answer) — so an `answer_index
        // >= 0` row must carry a non-empty `choices` array. Excluding the empty
        // array (`{}`) here keeps the SQL pool aligned with `isEligibleProblem`
        // so the count/candidate/fallback draws don't overcount and whiff.
        next = next
            .gte(`${prefix}answer_index`, 0)
            .not(`${prefix}choices`, "is", null)
            .neq(`${prefix}choices`, "{}");
    } else if (answerAvailability === "without") {
        // Answerless problems (incl. computational free-response stubs with an
        // empty `choices` array) run ungraded — the "help contribute answers"
        // pool — so choices are intentionally *not* required here.
        // `.or()` against an embedded resource needs the referenced table named.
        next =
            prefix === "problems."
                ? next.or("answer_index.is.null,answer_index.lt.0", {
                      referencedTable: "problems",
                  })
                : next.or("answer_index.is.null,answer_index.lt.0");
    }

    // Solution availability. Solutions live in `official_solutions` (text[]):
    // "with" needs a non-empty array, "without" wants null/empty, "any" drops it.
    const solutionAvailability = settings.solutionAvailability ?? "any";
    if (solutionAvailability === "with") {
        next = next
            .not(`${prefix}official_solutions`, "is", null)
            .neq(`${prefix}official_solutions`, "{}");
    } else if (solutionAvailability === "without") {
        next =
            prefix === "problems."
                ? next.or(
                      "official_solutions.is.null,official_solutions.eq.{}",
                      { referencedTable: "problems" },
                  )
                : next.or(
                      "official_solutions.is.null,official_solutions.eq.{}",
                  );
    }

    if (settings.topic.length > 0) {
        next = next.in(`${prefix}topic`, settings.topic);
    }
    // Difficulty is no longer a column filter — it resolves into `ratingBand`
    // (see nextPracticeProblem / manualRatingBand) and is applied via the rating
    // embed below, exactly like the adaptive band.
    if (settings.verifiedOnly) next = next.eq(`${prefix}verified`, true);
    if (settings.computational != null) {
        next = next.eq(`${prefix}is_computational`, settings.computational);
    }
    // Series scope. With no per-series division/format narrowing this is plain
    // `series_id` membership (unchanged behavior). When at least one series is
    // narrowed, switch to the per-series OR-of-ANDs so each series is filtered by
    // its *own* divisions/formats. Both target the embedded `tests` table
    // (nested under `problems` when drawing through `problem_progress`); the
    // embed is inner-joined (see the `*Select` helpers) so these drop the parent.
    if (settings.seriesIds && settings.seriesIds.length > 0) {
        const embed = prefix === "" ? "tests" : "problems.tests";
        if (hasSeriesScope(settings)) {
            next = next.or(seriesScopeFilter(settings), { referencedTable: embed });
        } else {
            next = next.in(`${embed}.series_id`, settings.seriesIds.map(Number));
        }
    }

    // Adaptive difficulty: keep only problems whose overall-scope rating sits in
    // the band. Filtered through the inner `problem_ratings` embed (nested under
    // `problems` when drawing via progress), so the select strings must carry
    // `RATING_INNER` whenever a band is present — see the `*Select` helpers.
    if (settings.ratingBand) {
        const rp = `${prefix}problem_ratings.`;
        next = next
            .eq(`${rp}scope`, "overall")
            .gte(`${rp}rating`, settings.ratingBand[0])
            .lte(`${rp}rating`, settings.ratingBand[1]);
    }

    return next;
}

/** Select for a direct `problems` draw, widened for series scope / adaptive band. */
function problemsDirectSelect(settings: ResolvedSettings): string {
    const tests = scopesTests(settings) ? TESTS_EMBED_INNER : TESTS_EMBED;
    const rating = settings.ratingBand ? `, ${RATING_INNER}` : "";
    return `*, ${tests}${rating}`;
}

/** Minimal head-count select for a direct `problems` draw (ids + join anchors). */
function problemsCountSelect(settings: ResolvedSettings): string {
    let sel = "id";
    if (scopesTests(settings)) {
        sel += ", tests!inner(series_id, division, format)";
    }
    if (settings.ratingBand) sel += ", problem_ratings!inner(rating)";
    return sel;
}

/** Select for a `problem_progress` review draw, with the embedded problem widened. */
function reviewSelect(settings: ResolvedSettings): string {
    const tests = scopesTests(settings) ? TESTS_EMBED_INNER : TESTS_EMBED;
    const rating = settings.ratingBand ? `, ${RATING_INNER}` : "";
    return `problem_id, next_review_at, times_seen, times_reviewed, times_correct, times_skipped, last_submission_at, last_reviewed_at, last_correct, solved, mastery, engagement, problems!inner(*, ${tests}${rating})`;
}

/** Whether the settings permit answerless problems (any availability but "with"). */
function allowsAnswerless(settings: PracticeSettings): boolean {
    return (settings.answerAvailability ?? "with") !== "with";
}

function isEligibleProblem(
    problem: ProblemRow | null,
    allowAnswerless = false,
): problem is ProblemRow {
    if (!problem?.statement?.trim()) return false;
    // When answerless problems are permitted, the recorded answer AND choices are
    // both optional: answerless computational free-response stubs carry an empty
    // `choices` array and run ungraded (the "help contribute answers" pool). The
    // draw query has already narrowed to the requested availability.
    if (allowAnswerless) return true;
    // Graded problems need comparable choices — MCQ options, or a single choice
    // holding a computational answer — with `answer_index` pointing into them.
    if (!problem.choices?.length) return false;
    if (problem.answer_index == null) return false;
    return problem.answer_index >= 0 && problem.answer_index < problem.choices.length;
}

async function fetchRandomCandidate(
    supabase: Supabase,
    settings: ResolvedSettings,
    exclude: string | null,
    count: number,
): Promise<ProblemRow | null> {
    const offset = Math.floor(Math.random() * count);
    // Exclude duplicate aliases (canonical_id set): the same real-world problem
    // is served once, under its canonical. Aliases still appear in list/test-mode
    // draws (which target a specific test), just not in cross-catalog discovery.
    let query = applyAttributeFilters(
        supabase.from("problems").select(problemsDirectSelect(settings)),
        settings,
    ).is("canonical_id", null);
    if (exclude) query = query.not("id", "in", exclude);

    const { data, error } = await query.order("id").range(offset, offset).maybeSingle();

    if (error) throw error;
    return (data as unknown as ProblemRow | null) ?? null;
}

/**
 * Problem ids to exclude from a "new" draw: everything already interacted with
 * (`problem_progress`; RLS scopes to the current user, anon → none) plus anything
 * already shown this session. Shared by the random and adaptive-nearest draws.
 */
async function seenProblemIds(
    supabase: Supabase,
    settings: PracticeSettings,
    session: PracticeSession,
): Promise<Set<number>> {
    const excludeIds = new Set(session.shownIds);
    const { data: seen, error } = await supabase
        .from("problem_progress")
        .select("problem_id, times_seen, mastery, engagement");
    if (error) throw error;
    for (const row of seen ?? []) {
        const mastery = settings.mastery ?? [];
        const masteryMatches =
            mastery.length === 0 ||
            (row.mastery == null
                ? mastery.includes("unassessed")
                : mastery.includes(row.mastery as Mastery));
        if (row.times_seen > 0 || row.engagement === "ignored" || !masteryMatches) {
            excludeIds.add(row.problem_id);
        }
    }
    return excludeIds;
}

/**
 * A problem the user has not seen yet: no `problem_progress` row, and not already
 * shown this session. Reuses the random-offset selection so picks stay varied.
 */
async function fetchNewProblem(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
): Promise<ProblemRow | null> {
    if (
        settings.mastery?.length > 0 &&
        !settings.mastery.includes("unassessed")
    ) {
        const draw = await runReviewDraw(
            excludeIgnored(buildReviewBaseQuery(supabase, settings, session))
                .eq("times_seen", 0)
                .order("problem_id"),
            allowsAnswerless(settings),
        );
        return draw.problem;
    }

    const exclude = exclusionList(await seenProblemIds(supabase, settings, session));

    // `.is("canonical_id", null)` keeps the count aligned with the alias-excluded
    // draws below (a duplicate is discovered once, under its canonical).
    let countQuery = applyAttributeFilters(
        supabase
            .from("problems")
            .select(problemsCountSelect(settings), { count: "exact", head: true }),
        settings,
    ).is("canonical_id", null);
    if (exclude) countQuery = countQuery.not("id", "in", exclude);
    const { count, error } = await countQuery;

    if (error) throw error;
    if (!count) return null;

    const allowAnswerless = allowsAnswerless(settings);
    for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i += 1) {
        const candidate = await fetchRandomCandidate(supabase, settings, exclude, count);
        if (isEligibleProblem(candidate, allowAnswerless)) return candidate;
    }

    let fallback = applyAttributeFilters(
        supabase.from("problems").select(problemsDirectSelect(settings)),
        settings,
    ).is("canonical_id", null);
    if (exclude) fallback = fallback.not("id", "in", exclude);
    const { data, error: fallbackError } = await fallback
        .order("id")
        .limit(FALLBACK_PAGE_SIZE);

    if (fallbackError) throw fallbackError;

    const eligible = ((data ?? []) as unknown as ProblemRow[]).filter((p) =>
        isEligibleProblem(p, allowAnswerless),
    );
    if (eligible.length === 0) return null;

    return eligible[Math.floor(Math.random() * eligible.length)];
}

/**
 * The unseen problem whose overall rating is closest to `center` — the "next
 * closest" fallback when the adaptive band itself is empty. Queried through the
 * `problem_ratings` table (a to-one embed to `problems`) so it can be ordered by
 * the rating column directly, which a to-many embed on `problems` can't. Grabs a
 * page just above and just below `center`, then picks the nearest eligible one.
 */
async function fetchNearestNewProblem(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
    center: number,
): Promise<ProblemRow | null> {
    const exclude = exclusionList(await seenProblemIds(supabase, settings, session));
    const allowAnswerless = allowsAnswerless(settings);
    const tests = scopesTests(settings) ? TESTS_EMBED_INNER : TESTS_EMBED;
    const select = `problem_id, rating, problems!inner(*, ${tests})`;

    // The band is intentionally dropped here (nearest lives *outside* it); every
    // other attribute filter still applies, under the `problems.` embed prefix.
    const base = () => {
        let q = applyAttributeFilters(
            supabase.from("problem_ratings").select(select),
            { ...settings, ratingBand: null },
            "problems.",
        ).eq("scope", "overall");
        if (exclude) q = q.not("problem_id", "in", exclude);
        return q;
    };

    type NearestRow = { rating: number; problems: ProblemRow | null };
    const [above, below] = await Promise.all([
        base().gte("rating", center).order("rating", { ascending: true }).limit(FALLBACK_PAGE_SIZE),
        base().lt("rating", center).order("rating", { ascending: false }).limit(FALLBACK_PAGE_SIZE),
    ]);
    if (above.error) throw above.error;
    if (below.error) throw below.error;

    const rows = [
        ...((above.data ?? []) as unknown as NearestRow[]),
        ...((below.data ?? []) as unknown as NearestRow[]),
    ].filter((r) => isEligibleProblem(r.problems, allowAnswerless));
    if (rows.length === 0) return null;

    let best = rows[0];
    let bestDist = Math.abs(best.rating - center);
    for (const r of rows.slice(1)) {
        const dist = Math.abs(r.rating - center);
        if (dist < bestDist) {
            best = r;
            bestDist = dist;
        }
    }
    return best.problems;
}

/**
 * A "new" draw honoring the adaptive band: an in-band problem first, then the
 * nearest-rated one when the band is empty, and finally an unconstrained draw
 * when nothing rated matches at all (so a fresh/unrated corpus never dead-ends).
 * With no band this is just {@link fetchNewProblem}.
 */
async function fetchNewProblemDraw(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
    center: number | null,
): Promise<ProblemRow | null> {
    if (!settings.ratingBand || center == null) {
        return fetchNewProblem(supabase, settings, session);
    }
    const inBand = await fetchNewProblem(supabase, settings, session);
    if (inBand) return inBand;
    const nearest = await fetchNearestNewProblem(supabase, settings, session, center);
    if (nearest) return nearest;
    return fetchNewProblem(supabase, { ...settings, ratingBand: null }, session);
}

/**
 * The most overdue due-for-review problem (`next_review_at <= now`, ascending),
 * honoring attribute + advanced progress filters and skipping anything already
 * shown this session so the queue always advances.
 */
/** A single queue draw: the chosen problem plus its progress (review queue only). */
type Draw = { problem: ProblemRow | null; progress: ProblemProgress | null };

/** Row shape returned by the review query: progress columns + embedded problem. */
type ReviewRow = {
    next_review_at: string | null;
    times_seen: number;
    times_reviewed: number;
    times_correct: number;
    times_skipped: number;
    last_submission_at: string | null;
    last_reviewed_at: string | null;
    last_correct: boolean | null;
    solved: boolean;
    mastery: Mastery | null;
    engagement: Engagement | null;
    problems: ProblemRow | null;
};

function toProgress(row: ReviewRow): ProblemProgress {
    return {
        times_seen: row.times_seen,
        times_reviewed: row.times_reviewed,
        times_correct: row.times_correct,
        times_skipped: row.times_skipped,
        last_submission_at: row.last_submission_at,
        last_reviewed_at: row.last_reviewed_at,
        last_correct: row.last_correct,
        next_review_at: row.next_review_at,
        solved: row.solved,
        mastery: row.mastery,
        engagement: row.engagement,
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

/**
 * Filters shared by every review-queue tier — attribute, progress-counter,
 * recency, outcome, and session-exclusion. The caller layers on the
 * `next_review_at` time condition and ordering.
 */
function buildReviewBaseQuery(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
    options: { count?: "exact"; head?: boolean } = {},
) {
    let query = applyAttributeFilters(
        supabase.from("problem_progress").select(reviewSelect(settings), options),
        settings,
        "problems.",
    );
    query = applyMasteryFilter(query, settings.mastery ?? []);

    const counters: [keyof Database["public"]["Tables"]["problem_progress"]["Row"], Range | null][] =
        [
            ["times_seen", settings.timesSeen],
            ["times_reviewed", settings.timesReviewed],
            ["times_correct", settings.timesCorrect],
            ["times_skipped", settings.timesSkipped],
        ];
    for (const [column, range] of counters) {
        if (range) query = query.gte(column, range[0]).lte(column, range[1]);
    }

    if (settings.lastSubmissionDays != null) {
        const since = new Date(
            Date.now() - settings.lastSubmissionDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        query = query.gte("last_submission_at", since);
    }

    if (settings.lastOutcome === "correct") query = query.eq("last_correct", true);
    else if (settings.lastOutcome === "incorrect") query = query.eq("last_correct", false);

    const exclude = exclusionList(session.shownIds);
    if (exclude) query = query.not("problem_id", "in", exclude);

    return query;
}

function excludeIgnored(query: any) {
    return query.or("engagement.is.null,engagement.neq.ignored");
}

function buildSkippedBaseQuery(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
    options: { count?: "exact"; head?: boolean } = {},
) {
    return excludeIgnored(buildReviewBaseQuery(supabase, settings, session, options))
        .gt("times_skipped", 0)
        .eq("solved", false);
}

/** Execute a review/progress query and map the first eligible row to a Draw. */
async function runReviewDraw(
    query: any,
    allowAnswerless = false,
    limitToOne = true,
): Promise<Draw> {
    const { data, error } = await (limitToOne ? query.limit(1) : query);
    if (error) throw error;

    const rows = (data ?? []) as unknown as ReviewRow[];
    const row = rows.find((r) => isEligibleProblem(r.problems, allowAnswerless));

    return row?.problems
        ? { problem: row.problems, progress: toProgress(row) }
        : { problem: null, progress: null };
}

/**
 * The oldest problem that is actually due. Future and unscheduled rows never
 * enter this queue; explicit Revisit intent owns unscheduled reinforcement.
 */
async function fetchDueReviewProblem(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
): Promise<Draw> {
    const now = new Date().toISOString();
    const allowAnswerless = allowsAnswerless(settings);

    return runReviewDraw(
        excludeIgnored(buildReviewBaseQuery(supabase, settings, session))
            .not("next_review_at", "is", null)
            .lte("next_review_at", now)
            .order("next_review_at", { ascending: true }),
        allowAnswerless,
    );
}

async function fetchListProblem(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
): Promise<Draw> {
    const allowAnswerless = allowsAnswerless(settings);
    return runReviewDraw(
        buildReviewBaseQuery(supabase, settings, session)
            .eq("engagement", settings.listEngagement ?? "working")
            .order("last_submission_at", { ascending: true, nullsFirst: true })
            .order("problem_id", { ascending: true }),
        allowAnswerless,
    );
}

async function fetchSkippedProblem(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
): Promise<Draw> {
    const allowAnswerless = allowsAnswerless(settings);
    const countQuery = buildSkippedBaseQuery(supabase, settings, session, {
        count: "exact",
        head: true,
    });
    const { count, error } = await countQuery;
    if (error) throw error;
    if (!count) return { problem: null, progress: null };

    for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i += 1) {
        const offset = Math.floor(Math.random() * count);
        const draw = await runReviewDraw(
            buildSkippedBaseQuery(supabase, settings, session)
                .order("problem_id")
                .range(offset, offset),
            allowAnswerless,
            false,
        );
        if (draw.problem) return draw;
    }

    const draw = await runReviewDraw(
        buildSkippedBaseQuery(supabase, settings, session)
            .order("last_submission_at", { ascending: false })
            .order("problem_id")
            .limit(FALLBACK_PAGE_SIZE),
        allowAnswerless,
        false,
    );
    return draw;
}

/**
 * A due-review draw honoring the adaptive band, relaxing to the unconstrained
 * review queue when the band leaves nothing due (the schedule, not the band,
 * governs review — the band only reorders which due problem surfaces first).
 */
async function fetchDueReviewDraw(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
): Promise<Draw> {
    const draw = await fetchDueReviewProblem(supabase, settings, session);
    if (draw.problem || !settings.ratingBand) return draw;
    return fetchDueReviewProblem(supabase, { ...settings, ratingBand: null }, session);
}

/** A skipped-queue draw honoring the adaptive band, relaxing it when empty. */
async function fetchSkippedDraw(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
): Promise<Draw> {
    const draw = await fetchSkippedProblem(supabase, settings, session);
    if (draw.problem || !settings.ratingBand) return draw;
    return fetchSkippedProblem(supabase, { ...settings, ratingBand: null }, session);
}

async function fetchListDraw(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
): Promise<Draw> {
    const draw = await fetchListProblem(supabase, settings, session);
    if (draw.problem || !settings.ratingBand) return draw;
    return fetchListProblem(supabase, { ...settings, ratingBand: null }, session);
}

async function drawFromSource(
    supabase: Supabase,
    settings: ResolvedSettings,
    session: PracticeSession,
    source: PracticeSource,
    center: number | null,
): Promise<Draw> {
    return source === "review"
        ? fetchDueReviewDraw(supabase, settings, session)
        : {
              problem: await fetchNewProblemDraw(supabase, settings, session, center),
              progress: null,
          };
}

/**
 * Pick the next practice problem for the active mode. For Mixed, follows the
 * 1:2 review:new pattern and falls back to the other queue when the preferred
 * one is empty, so neither new problems nor reviews can starve the other.
 *
 * The caller records the returned problem's id in `session.shownIds` and bumps
 * `session.drawIndex` after a successful draw.
 *
 * `playerRating` is the drawer's live overall rating; with adaptive on it centers
 * the rating band, so every draw prefers problems near the player's level. It is
 * `null` before the rating loads (or for unrated users), which leaves the draw
 * unconstrained until a rating exists.
 */
export async function nextPracticeProblem(
    supabase: Supabase,
    settings: PracticeSettings,
    session: PracticeSession,
    playerRating: number | null = null,
): Promise<PracticeResult> {
    // Resolve the rating band once and layer it over the stored settings, so
    // every draw path below reads it off `resolved` rather than recomputing it.
    // Two mutually exclusive sources feed the same band:
    //   • Adaptive on  → a *soft* band centered on the player's live rating
    //     (`center` set), which the new-problem draw relaxes to nearest/unrated
    //     when empty so it never dead-ends.
    //   • Adaptive off → the manual Difficulty range as a *hard* rating filter
    //     (`center` stays null → no relaxation on the new-problem draw).
    // When adaptive is on the manual Difficulty is ignored (the UI hides it).
    const center = settings.adaptive && playerRating != null ? playerRating : null;
    const range = settings.adaptiveRange ?? ADAPTIVE_RANGE_DEFAULT;
    const ratingBand =
        center != null
            ? ([center - range, center + range] as [number, number])
            : settings.adaptive
              ? null
              : manualRatingBand(settings.difficulty);
    const resolved: ResolvedSettings = { ...settings, ratingBand };

    if (settings.mode === "new") {
        return {
            problem: await fetchNewProblemDraw(supabase, resolved, session, center),
            source: "practice",
            progress: null,
        };
    }
    if (settings.mode === "review") {
        const draw = await fetchDueReviewDraw(supabase, resolved, session);
        return { problem: draw.problem, source: "review", progress: draw.progress };
    }
    if (settings.mode === "skipped") {
        const draw = await fetchSkippedDraw(supabase, resolved, session);
        return { problem: draw.problem, source: "review", progress: draw.progress };
    }
    if (settings.mode === "list") {
        const draw = await fetchListDraw(supabase, resolved, session);
        return { problem: draw.problem, source: "review", progress: draw.progress };
    }

    // Mixed: try the patterned source first, then the other.
    const preferred = MIXED_PATTERN[session.drawIndex % MIXED_PATTERN.length];
    const fallback: PracticeSource = preferred === "review" ? "practice" : "review";

    let draw = await drawFromSource(supabase, resolved, session, preferred, center);
    if (draw.problem) {
        return { problem: draw.problem, source: preferred, progress: draw.progress };
    }

    draw = await drawFromSource(supabase, resolved, session, fallback, center);
    return { problem: draw.problem, source: fallback, progress: draw.progress };
}

/**
 * Every eligible problem belonging to a test, in problem-number order. Unlike
 * the random/review draws, Test format works through a fixed, fully-known set, so
 * this is fetched once (unpaginated) and the whole sequence becomes the session's
 * navigable history. Ineligible problems (missing statement/choices/answer) are
 * dropped so a test can't strand the user on an unanswerable item.
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
        isEligibleProblem(p),
    );
}
