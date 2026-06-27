import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import type { PracticeSettings } from "$lib/trainer";

type Supabase = SupabaseClient<Database>;

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
    input: { name?: string | null; settings: PracticeSettings },
): Promise<PracticeSessionRow> {
    const { data, error } = await supabase
        .from("practice_sessions")
        .insert({
            user_id: userId,
            name: input.name ?? null,
            // PracticeSettings is plain JSON; stored verbatim in the jsonb column.
            settings: input.settings as unknown as Tables<"practice_sessions">["settings"],
        })
        .select()
        .single();
    if (error) throw error;
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

/** Mark a session ended (sets status + ended_at). */
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
 * Delete a session. Its submissions fall back to the root (session_id set null)
 * via the FK's `on delete set null`, preserving the user's history.
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
 * The problem ids already attempted (answered or skipped) in a session, used to
 * seed the draw-state so a resumed session doesn't re-show problems it has
 * already covered. RLS scopes rows to the authenticated user.
 */
export async function fetchSessionProblemIds(
    supabase: Supabase,
    sessionId: number,
): Promise<number[]> {
    const { data, error } = await supabase
        .from("submissions")
        .select("problem_id")
        .eq("session_id", sessionId);
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
        .order("started_at", { ascending: false });
    if (options.status) query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as PracticeSessionRow[];
}
