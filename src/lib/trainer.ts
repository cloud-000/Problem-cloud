import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import { DIFFICULTY_RANGE, type ProblemRow } from "$lib/library";

type Supabase = SupabaseClient<Database>;

export type PracticeMode = "new" | "review" | "mixed";

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
    seriesIds?: string[]; // Optional for backward compatibility with older snapshots
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
    // Advanced progress filters — apply to the review queue only. `null` = "Any".
    timesSeen: Range | null;
    timesReviewed: Range | null;
    timesCorrect: Range | null;
    timesSkipped: Range | null;
    lastSubmissionDays: number | null; // only reviewed within the last N days
    lastOutcome: "any" | "correct" | "incorrect";
    // Also surface seen problems with no scheduled review (`next_review_at IS NULL`).
    includeUnscheduled: boolean;
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

/** Per-user progress for the shown problem (null for never-seen / New). */
export type ProblemProgress = {
    timesSeen: number;
    timesReviewed: number;
    timesCorrect: number;
    timesSkipped: number;
    lastSubmissionAt: string | null;
    lastCorrect: boolean | null;
    nextReviewAt: string | null;
};

export type PracticeResult = {
    problem: ProblemRow | null;
    source: PracticeSource;
    progress: ProblemProgress | null;
};

const PROBLEM_SELECT = "*, tests(name, series_id, series(name))";
const REVIEW_SELECT =
    "problem_id, next_review_at, times_seen, times_reviewed, times_correct, times_skipped, last_submission_at, last_correct, problems!inner(*, tests(name, series_id, series(name)))";
const MAX_RANDOM_ATTEMPTS = 6;
const FALLBACK_PAGE_SIZE = 25;

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
        seriesIds: [],
        topic: [],
        difficulty: [...DIFFICULTY_RANGE],
        verifiedOnly: false,
        computational: null,
        answerAvailability: "with",
        timesSeen: null,
        timesReviewed: null,
        timesCorrect: null,
        timesSkipped: null,
        lastSubmissionDays: null,
        lastOutcome: "any",
        includeUnscheduled: false,
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
): PracticeSettings {
    return {
        ...defaultPracticeSettings(),
        format: "test",
        testId,
        timeLimitSeconds,
    };
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
    settings: PracticeSettings,
    prefix: "" | "problems." = "",
) {
    let next = query
        .not(`${prefix}statement`, "is", null)
        .not(`${prefix}choices`, "is", null);

    // Answer availability. "no answer" is `answer_index = -1` (the column default)
    // or null; "with" requires a real index (>= 0); "any" drops the constraint.
    const answerAvailability = settings.answerAvailability ?? "with";
    if (answerAvailability === "with") {
        next = next.gte(`${prefix}answer_index`, 0);
    } else if (answerAvailability === "without") {
        // `.or()` against an embedded resource needs the referenced table named.
        next =
            prefix === "problems."
                ? next.or("answer_index.is.null,answer_index.lt.0", {
                      referencedTable: "problems",
                  })
                : next.or("answer_index.is.null,answer_index.lt.0");
    }

    if (settings.topic.length > 0) {
        next = next.in(`${prefix}topic`, settings.topic);
    }
    if (settings.difficulty) {
        next = next
            .gte(`${prefix}difficulty`, settings.difficulty[0])
            .lte(`${prefix}difficulty`, settings.difficulty[1]);
    }
    if (settings.verifiedOnly) next = next.eq(`${prefix}verified`, true);
    if (settings.computational != null) {
        next = next.eq(`${prefix}is_computational`, settings.computational);
    }
    if (settings.seriesIds && settings.seriesIds.length > 0) {
        if (prefix === "") {
            next = next.in("tests.series_id", settings.seriesIds.map(Number));
        } else {
            next = next.in("problems.tests.series_id", settings.seriesIds.map(Number));
        }
    }

    return next;
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
    if (!problem.choices?.length) return false;
    // When answerless problems are permitted, the recorded answer is optional;
    // the draw query has already narrowed to the requested availability.
    if (allowAnswerless) return true;
    if (problem.answer_index == null) return false;
    return problem.answer_index >= 0 && problem.answer_index < problem.choices.length;
}

async function fetchRandomCandidate(
    supabase: Supabase,
    settings: PracticeSettings,
    exclude: string | null,
    count: number,
): Promise<ProblemRow | null> {
    const offset = Math.floor(Math.random() * count);
    let selectStr = PROBLEM_SELECT;
    if (settings.seriesIds && settings.seriesIds.length > 0) {
        selectStr = `*, tests!inner(name, series_id, series(name))`;
    }
    let query = applyAttributeFilters(
        supabase.from("problems").select(selectStr),
        settings,
    );
    if (exclude) query = query.not("id", "in", exclude);

    const { data, error } = await query.order("id").range(offset, offset).maybeSingle();

    if (error) throw error;
    return (data as unknown as ProblemRow | null) ?? null;
}

/**
 * A problem the user has not seen yet: no `problem_progress` row, and not already
 * shown this session. Reuses the random-offset selection so picks stay varied.
 */
async function fetchNewProblem(
    supabase: Supabase,
    settings: PracticeSettings,
    session: PracticeSession,
): Promise<ProblemRow | null> {
    const excludeIds = new Set(session.shownIds);

    // Problems already interacted with (RLS scopes to the current user; anon → none).
    const { data: seen, error: seenError } = await supabase
        .from("problem_progress")
        .select("problem_id");
    if (seenError) throw seenError;
    for (const row of seen ?? []) excludeIds.add(row.problem_id);

    const exclude = exclusionList(excludeIds);

    let countQuerySelect = "id";
    if (settings.seriesIds && settings.seriesIds.length > 0) {
        countQuerySelect = "id, tests!inner(series_id)";
    }
    let countQuery = applyAttributeFilters(
        supabase.from("problems").select(countQuerySelect, { count: "exact", head: true }),
        settings,
    );
    if (exclude) countQuery = countQuery.not("id", "in", exclude);
    const { count, error } = await countQuery;

    if (error) throw error;
    if (!count) return null;

    const allowAnswerless = allowsAnswerless(settings);
    for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i += 1) {
        const candidate = await fetchRandomCandidate(supabase, settings, exclude, count);
        if (isEligibleProblem(candidate, allowAnswerless)) return candidate;
    }

    let fallbackSelect = PROBLEM_SELECT;
    if (settings.seriesIds && settings.seriesIds.length > 0) {
        fallbackSelect = `*, tests!inner(name, series_id, series(name))`;
    }
    let fallback = applyAttributeFilters(
        supabase.from("problems").select(fallbackSelect),
        settings,
    );
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
    last_correct: boolean | null;
    problems: ProblemRow | null;
};

function toProgress(row: ReviewRow): ProblemProgress {
    return {
        timesSeen: row.times_seen,
        timesReviewed: row.times_reviewed,
        timesCorrect: row.times_correct,
        timesSkipped: row.times_skipped,
        lastSubmissionAt: row.last_submission_at,
        lastCorrect: row.last_correct,
        nextReviewAt: row.next_review_at,
    };
}

/**
 * Filters shared by every review-queue tier — attribute, progress-counter,
 * recency, outcome, and session-exclusion. The caller layers on the
 * `next_review_at` time condition and ordering.
 */
function buildReviewBaseQuery(
    supabase: Supabase,
    settings: PracticeSettings,
    session: PracticeSession,
) {
    let selectStr = REVIEW_SELECT;
    if (settings.seriesIds && settings.seriesIds.length > 0) {
        selectStr = "problem_id, next_review_at, times_seen, times_reviewed, times_correct, times_skipped, last_submission_at, last_correct, problems!inner(*, tests!inner(name, series_id, series(name)))";
    }
    let query = applyAttributeFilters(
        supabase.from("problem_progress").select(selectStr),
        settings,
        "problems.",
    );

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

/** Execute a single-row review query and map it to a Draw. */
async function runReviewDraw(query: any, allowAnswerless = false): Promise<Draw> {
    const { data, error } = await query.limit(1);
    if (error) throw error;

    const rows = (data ?? []) as unknown as ReviewRow[];
    const row = rows.find((r) => isEligibleProblem(r.problems, allowAnswerless));

    return row?.problems
        ? { problem: row.problems, progress: toProgress(row) }
        : { problem: null, progress: null };
}

/**
 * The review problem whose scheduled date is nearest to now, preferring dates
 * that have already passed (closest-passed = least overdue first). When nothing
 * is due, fall back to the soonest upcoming review in the future. With
 * `includeUnscheduled`, seen problems that have no scheduled date at all are
 * considered before the future fallback (they are reviewable at any time).
 */
async function fetchDueReviewProblem(
    supabase: Supabase,
    settings: PracticeSettings,
    session: PracticeSession,
): Promise<Draw> {
    const now = new Date().toISOString();
    const allowAnswerless = allowsAnswerless(settings);

    // 1. Closest review date that has already passed (nearest to now first).
    let draw = await runReviewDraw(
        buildReviewBaseQuery(supabase, settings, session)
            .not("next_review_at", "is", null)
            .lte("next_review_at", now)
            .order("next_review_at", { ascending: false }),
        allowAnswerless,
    );
    if (draw.problem) return draw;

    // 2. Seen problems with no scheduled review at all (opt-in).
    if (settings.includeUnscheduled) {
        draw = await runReviewDraw(
            buildReviewBaseQuery(supabase, settings, session).is("next_review_at", null),
            allowAnswerless,
        );
        if (draw.problem) return draw;
    }

    // 3. Fallback: the soonest upcoming review still in the future.
    return runReviewDraw(
        buildReviewBaseQuery(supabase, settings, session)
            .gt("next_review_at", now)
            .order("next_review_at", { ascending: true }),
        allowAnswerless,
    );
}

async function drawFromSource(
    supabase: Supabase,
    settings: PracticeSettings,
    session: PracticeSession,
    source: PracticeSource,
): Promise<Draw> {
    return source === "review"
        ? fetchDueReviewProblem(supabase, settings, session)
        : { problem: await fetchNewProblem(supabase, settings, session), progress: null };
}

/**
 * Pick the next practice problem for the active mode. For Mixed, follows the
 * 1:2 review:new pattern and falls back to the other queue when the preferred
 * one is empty, so neither new problems nor reviews can starve the other.
 *
 * The caller records the returned problem's id in `session.shownIds` and bumps
 * `session.drawIndex` after a successful draw.
 */
export async function nextPracticeProblem(
    supabase: Supabase,
    settings: PracticeSettings,
    session: PracticeSession,
): Promise<PracticeResult> {
    if (settings.mode === "new") {
        return {
            problem: await fetchNewProblem(supabase, settings, session),
            source: "practice",
            progress: null,
        };
    }
    if (settings.mode === "review") {
        const draw = await fetchDueReviewProblem(supabase, settings, session);
        return { problem: draw.problem, source: "review", progress: draw.progress };
    }

    // Mixed: try the patterned source first, then the other.
    const preferred = MIXED_PATTERN[session.drawIndex % MIXED_PATTERN.length];
    const fallback: PracticeSource = preferred === "review" ? "practice" : "review";

    let draw = await drawFromSource(supabase, settings, session, preferred);
    if (draw.problem) {
        return { problem: draw.problem, source: preferred, progress: draw.progress };
    }

    draw = await drawFromSource(supabase, settings, session, fallback);
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
