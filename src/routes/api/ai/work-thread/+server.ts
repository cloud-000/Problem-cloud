import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { preferencesFor, workConversationForAnchor } from "$lib/server/ai/persistence";
import { assertRateLimit, requireAIUser, stableError } from "$lib/server/ai/security";

/** A row id from the query string. Absent and malformed are different answers here. */
function rowIdParam(raw: string | null): number | null | undefined {
    if (raw === null || raw === "") return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * The live work thread for an anchor, if the user has one (docs/ai-coach-sessions.md §2).
 *
 * This is what makes "you have an existing session — continue or start new chat?"
 * possible: the unique index guarantees at most one row per (user, problem, sitting), so
 * this is a lookup rather than a search, and a null answer is the ordinary case — no
 * prompt, blank Coach — not an error.
 *
 * Staleness is deliberately decided by the caller: §5's `workResumable` also needs
 * attempt state that only the trainer holds, so the row's `lastActiveAt` is handed back
 * and the one pure rule runs in one place.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.work-thread", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);

    const problemId = rowIdParam(url.searchParams.get("problemId"));
    if (!problemId) return stableError("invalid_request", "A problem id is required", 400);
    const practiceSessionId = rowIdParam(url.searchParams.get("practiceSessionId"));
    if (practiceSessionId === undefined) {
        return stableError("invalid_request", "The practice session id is malformed", 400);
    }

    try {
        const preferences = await preferencesFor(user.id);
        // Saving is off, so no thread was ever written: there is nothing to resume, and
        // the trainer should open blank rather than be told a lookup failed.
        if (!preferences.history_enabled) return json({ conversation: null });
        return json({
            conversation: await workConversationForAnchor(user.id, {
                problemId,
                practiceSessionId,
            }),
        });
    } catch {
        return stableError("conversation_unavailable", "Coach threads are unavailable", 503);
    }
};
