import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import {
    AIPersistenceError,
    archiveConversation,
    concludeConversation,
    conversationById,
    preferencesFor,
    retireConversation,
} from "$lib/server/ai/persistence";
import { assertRateLimit, assertSameOrigin, requireAIUser, stableError } from "$lib/server/ai/security";

export const GET: RequestHandler = async ({ locals, params }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.conversations.detail", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);
    try {
        const preferences = await preferencesFor(user.id);
        if (!preferences.history_enabled) {
            return stableError("conversation_not_found", "Conversation not found", 404);
        }
        return json({ conversation: await conversationById(user.id, params.id) });
    } catch (error) {
        if (error instanceof AIPersistenceError && error.code === "conversation_not_found") {
            return stableError(error.code, error.message, 404);
        }
        return stableError("conversation_unavailable", "Conversation history is unavailable", 503);
    }
};

export const PATCH: RequestHandler = async ({ locals, params, request, url }) => {
    const user = await requireAIUser(locals);
    assertSameOrigin(request, url);
    assertRateLimit(user.id, "ai.conversations.archive", 30);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);

    let body: { archived?: unknown; retired?: unknown; concludedSubmissionId?: unknown } | null;
    try {
        body = await request.json();
    } catch {
        return stableError("invalid_request", "Invalid JSON request", 400);
    }
    // Two different facts, deliberately not one flag (§5): `retired` releases a work
    // thread's anchor slot and leaves it in history, `archived` is the user deleting it.
    const retiring = body?.retired === true;
    const submissionId = body?.concludedSubmissionId;
    const concluding = Number.isSafeInteger(submissionId) && Number(submissionId) > 0;
    if (!retiring && body?.archived !== true && !concluding) {
        return stableError(
            "invalid_request",
            "Only archive, retire, or a positive concludedSubmissionId is supported",
            400,
        );
    }

    try {
        if (concluding) {
            await concludeConversation(user.id, params.id, Number(submissionId));
            return json({ concludedSubmissionId: submissionId });
        }
        if (retiring) {
            await retireConversation(user.id, params.id);
            return json({ retired: true });
        }
        await archiveConversation(user.id, params.id);
        return json({ archived: true });
    } catch (error) {
        if (error instanceof AIPersistenceError && error.code === "conversation_not_found") {
            return stableError(error.code, error.message, 404);
        }
        return stableError(
            retiring ? "retire_failed" : "archive_failed",
            `The conversation could not be ${retiring ? "retired" : "archived"}`,
            503,
        );
    }
};
