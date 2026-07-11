import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import { TESTS_EMBED, type ProblemRow } from "$lib/library";
import type { ProblemProgress } from "$lib/progress";
import { defaultPracticeSettings, type PracticeSettings } from "$lib/trainer";

type Supabase = SupabaseClient<Database>;

const SESSION_PROGRESS_EMBED =
    "problem_progress(times_seen, times_correct, times_reviewed, times_skipped, last_correct, last_reviewed_at, last_submission_at, next_review_at, solved, mastery, engagement)";

export type PracticeSessionRow = Tables<"practice_sessions">;

export type SessionStatus = "active" | "ended";

/**
 * Start a new practice session, snapshotting the current practice settings.
 * Returns the inserted row (with its generated id). RLS requires the row to be
 * owned by the caller, so `userId` must be the authenticated user's id.
 */
export async function startSession(
    supabase: Supabase,
    userId: string,
    input: { name?: string | null; settings: PracticeSettings; isRoot?: boolean },
): Promise<PracticeSessionRow> {
    const { data, error } = await supabase
        .from("practice_sessions")
        .insert({
            user_id: userId,
            name: input.name ?? null,
            is_root: input.isRoot ?? false,
            // PracticeSettings is plain JSON; stored verbatim in the jsonb column.
            settings: input.settings as unknown as Tables<"practice_sessions">["settings"],
        })
        .select()
        .single();
    if (error) throw error;
    return data as PracticeSessionRow;
}

/**
 * The user's single always-present "root" (practice freely) session. A DB
 * trigger creates it with the profile and a one-time migration backfilled it for
 * existing users, so it virtually always already exists; this get-or-create is
 * the robust single entry point and also covers any user missing one. The unique
 * index `practice_sessions_one_root_per_user` makes a concurrent create collide
 * (23505), on which we simply re-select the winner's row. RLS scopes everything
 * to the caller, so `userId` must be the authenticated user's id.
 */
export async function getOrCreateRootSession(
    supabase: Supabase,
    userId: string,
): Promise<PracticeSessionRow> {
    const existing = await supabase
        .from("practice_sessions")
        .select("*")
        .eq("is_root", true)
        .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data as PracticeSessionRow;

    const { data, error } = await supabase
        .from("practice_sessions")
        .insert({
            user_id: userId,
            is_root: true,
            settings:
                defaultPracticeSettings() as unknown as Tables<"practice_sessions">["settings"],
        })
        .select()
        .single();
    if (error) {
        // 23505 = unique_violation: another tab created it first — re-select it.
        if (error.code === "23505") {
            const { data: row, error: reselectError } = await supabase
                .from("practice_sessions")
                .select("*")
                .eq("is_root", true)
                .single();
            if (reselectError) throw reselectError;
            return row as PracticeSessionRow;
        }
        throw error;
    }
    return data as PracticeSessionRow;
}

/**
 * Fetch a single session by id, or null if it doesn't exist / isn't visible.
 * RLS scopes the row to the authenticated owner. Used to resume a session
 * directly from a URL (`/practice?session=<id>`), surviving refresh/deep-link.
 */
export async function fetchSession(
    supabase: Supabase,
    id: number,
): Promise<PracticeSessionRow | null> {
    const { data, error } = await supabase
        .from("practice_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    if (error) throw error;
    return (data as PracticeSessionRow | null) ?? null;
}

/**
 * Mark a session ended (sets status + ended_at). Never called for the root
 * session — it is always active — so callers must not pass a root session id.
 */
export async function endSession(
    supabase: Supabase,
    sessionId: number,
): Promise<void> {
    const { error } = await supabase
        .from("practice_sessions")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", sessionId);
    if (error) throw error;
}

/** Reopen an ended session so work can be appended to it again. */
export async function resumeSession(
    supabase: Supabase,
    sessionId: number,
): Promise<void> {
    const { error } = await supabase
        .from("practice_sessions")
        .update({ status: "active", ended_at: null })
        .eq("id", sessionId);
    if (error) throw error;
}

/**
 * Persist a new settings snapshot for a session. Lets settings tweaks made
 * while practicing in a session be written back, so a later resume hydrates
 * the panel with where the user left off. The column-level UPDATE grant
 * permits clients to write `settings`.
 */
export async function updateSessionSettings(
    supabase: Supabase,
    sessionId: number,
    settings: PracticeSettings,
): Promise<void> {
    const { error } = await supabase
        .from("practice_sessions")
        .update({
            settings: settings as unknown as Tables<"practice_sessions">["settings"],
        })
        .eq("id", sessionId);
    if (error) throw error;
}

/** Rename a session. */
export async function renameSession(
    supabase: Supabase,
    sessionId: number,
    name: string,
): Promise<void> {
    const { error } = await supabase
        .from("practice_sessions")
        .update({ name })
        .eq("id", sessionId);
    if (error) throw error;
}

/**
 * Delete a session. Its submissions fall back to ungrouped (session_id set null)
 * via the FK's `on delete set null`, preserving the user's history. Never called
 * for the root session — it must always exist — so callers must not pass a root
 * session id.
 */
export async function deleteSession(
    supabase: Supabase,
    sessionId: number,
): Promise<void> {
    const { error } = await supabase
        .from("practice_sessions")
        .delete()
        .eq("id", sessionId);
    if (error) throw error;
}

/**
 * Persist (or clear) the session's in-progress problem — the one shown but not
 * yet answered or skipped — along with how long has been spent on it. Resuming
 * the session continues this exact problem instead of generating a new one.
 * Pass `problemId = null` (elapsed 0) once the problem is answered or skipped.
 */
export async function setCurrentProblem(
    supabase: Supabase,
    sessionId: number,
    problemId: number | null,
    elapsedMs: number,
): Promise<void> {
    const { error } = await supabase
        .from("practice_sessions")
        .update({
            current_problem_id: problemId,
            current_elapsed_ms: Math.max(0, Math.round(elapsedMs)),
        })
        .eq("id", sessionId);
    if (error) throw error;
}

/**
 * A prior submission in a session, carrying the full problem so the live view's
 * back-navigation history can be rebuilt on resume. Ordered oldest-first to
 * match the order the problems were originally shown.
 */
export type SessionHistoryEntry = {
    problem: ProblemRow;
    progress: ProblemProgress | null;
    source: string | null;
    selectedChoice: number | null;
    isCorrect: boolean | null;
    skipped: boolean;
    flagged: boolean;
    elapsedMs: number;
};

/** Shape a raw `submissions` row (with embedded `problems`) into a history entry. */
function mapSubmissionRow(row: {
    selected_choice: number | null;
    is_correct: boolean | null;
    skipped: boolean;
    flagged: boolean;
    elapsed_ms: number | null;
    source: string | null;
    problems: unknown;
}): SessionHistoryEntry {
    const { problem_progress, ...problem } = row.problems as ProblemRow & {
        problem_progress?: ProblemProgress[] | null;
    };
    return {
        problem,
        progress: problem_progress?.[0] ?? null,
        source: row.source,
        selectedChoice: row.selected_choice,
        isCorrect: row.is_correct,
        skipped: row.skipped,
        flagged: row.flagged,
        elapsedMs: row.elapsed_ms ?? 0,
    };
}

/**
 * The problems already attempted (answered or skipped) in a session, oldest
 * first, each with its full problem row and outcome. Used to rebuild the live
 * view's history (so a resumed session can be paged back through), seed the
 * draw-state so it doesn't re-show covered problems, and restore the
 * solved/incorrect/skipped tallies. RLS scopes rows to the authenticated user.
 */
export async function fetchSessionHistory(
    supabase: Supabase,
    sessionId: number,
): Promise<SessionHistoryEntry[]> {
    const { data, error } = await supabase
        .from("submissions")
        .select(
            `selected_choice, is_correct, skipped, flagged, elapsed_ms, source, problems(*, ${TESTS_EMBED}, ${SESSION_PROGRESS_EMBED})`,
        )
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? [])
        .filter((row) => row.problems != null)
        .map(mapSubmissionRow);
}

/**
 * One prior attempt in a session, plus the submission id used as the back-paging
 * cursor.
 */
export type OlderSubmission = SessionHistoryEntry & { submissionId: number };

/**
 * The session's newest attempt strictly older than `beforeId` (or the newest of
 * all when `beforeId` is null) — one step back in that session's history. Used to
 * lazily page the back-navigation one problem at a time instead of loading the
 * whole history up front, for every session (including the root "practice freely"
 * session). `submissions.id` is a monotonic identity, so `id` order matches
 * chronological order and gives a stable, gap-free cursor. Only practice/review
 * attempts are considered (library attempts and deferred test grades are
 * excluded). The `problems!inner` join drops submissions whose problem was since
 * deleted, so paging skips straight to the next surviving one rather than
 * stalling on a run of deleted problems. Returns null when nothing older remains.
 * RLS scopes rows to the current user.
 */
export async function fetchOlderSubmission(
    supabase: Supabase,
    sessionId: number,
    beforeId: number | null,
): Promise<OlderSubmission | null> {
    let query = supabase
        .from("submissions")
        .select(
            `id, selected_choice, is_correct, skipped, flagged, elapsed_ms, source, problems!inner(*, ${TESTS_EMBED}, ${SESSION_PROGRESS_EMBED})`,
        )
        .eq("session_id", sessionId)
        .in("source", ["practice", "review"])
        .order("id", { ascending: false })
        .limit(1);
    if (beforeId != null) query = query.lt("id", beforeId);
    const { data, error } = await query;
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) return null;
    return { ...mapSubmissionRow(row), submissionId: row.id };
}

/**
 * The problem ids already attempted (practice/review) in a session — a
 * lightweight companion to lazy back-paging. Seeds the live view's draw-state
 * (`shownIds`) on resume so the queue doesn't re-show a problem already covered
 * this session, without materializing the full history. RLS scopes rows to the
 * current user.
 */
export async function fetchSessionProblemIds(
    supabase: Supabase,
    sessionId: number,
): Promise<number[]> {
    const { data, error } = await supabase
        .from("submissions")
        .select("problem_id")
        .eq("session_id", sessionId)
        .in("source", ["practice", "review"]);
    if (error) throw error;
    return (data ?? []).map((row) => row.problem_id);
}

/**
 * List the current user's sessions, newest first. RLS scopes rows to the
 * authenticated user. Pass `status` to filter to active or ended sessions.
 */
export async function fetchSessions(
    supabase: Supabase,
    options: { status?: SessionStatus } = {},
): Promise<PracticeSessionRow[]> {
    let query = supabase
        .from("practice_sessions")
        .select("*")
        // The root ("practice freely") session is reached via its own entry
        // point, never listed as a normal session in the hub.
        .eq("is_root", false)
        .order("started_at", { ascending: false });
    if (options.status) query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as PracticeSessionRow[];
}
