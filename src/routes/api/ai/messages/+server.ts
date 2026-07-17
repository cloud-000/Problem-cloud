import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { AISchemaError, parsePersistTurnRequest } from "$lib/ai/schemas";
import { aiCoachEnabled } from "$lib/server/ai/config";
import {
    createConversation,
    ensureOwnedConversation,
    preferencesFor,
    saveAssistantMessage,
    saveUserMessage,
} from "$lib/server/ai/persistence";
import { assertRateLimit, assertSameOrigin, requireAIUser, stableError } from "$lib/server/ai/security";

/**
 * Saves a turn the browser streamed itself from the user's own provider.
 *
 * BYOK responses never pass through the server, so this is the only point at which they
 * can be recorded. Writes still go through the service role rather than letting the
 * client touch `ai_messages` directly — that is what keeps role and completion status
 * unspoofable — but the client is the only witness to what was streamed, so the text and
 * usage it reports are taken at face value. Nothing here is authoritative beyond the
 * caller's own conversation.
 */
export const POST: RequestHandler = async ({ locals, request, url }) => {
    const user = await requireAIUser(locals);
    assertSameOrigin(request, url);
    assertRateLimit(user.id, "ai.messages", 40);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);

    let body;
    try {
        body = parsePersistTurnRequest(await request.json());
    } catch (error) {
        const message = error instanceof AISchemaError ? error.message : "Invalid JSON request";
        return stableError("invalid_request", message, 400);
    }

    try {
        const preferences = await preferencesFor(user.id);
        // Saving is off: honour it silently rather than erroring a turn the user has read.
        if (!preferences.history_enabled) return json({ conversationId: null });

        let conversationId = body.conversationId;
        if (conversationId) {
            await ensureOwnedConversation(user.id, conversationId);
        } else {
            conversationId = await createConversation(user.id, body.contexts, body.message);
        }

        await saveUserMessage(conversationId, body.message);
        await saveAssistantMessage({
            id: crypto.randomUUID(),
            conversationId,
            text: body.assistant.text,
            status: body.assistant.status,
            providerId: body.assistant.providerId,
            model: body.assistant.model,
            usage: body.assistant.usage,
            error: body.assistant.error,
        });

        return json({ conversationId });
    } catch {
        return stableError("persist_unavailable", "Coach could not save this conversation", 503);
    }
};
