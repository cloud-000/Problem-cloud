import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { AISchemaError, parseConversationFlushRequest } from "$lib/ai/schemas";
import { messageText } from "$lib/ai/conversations";
import type { AIConversationFlushRequest } from "$lib/ai/types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import {
    ConversationCursorError,
    decodeCursor,
    parseLimit,
} from "$lib/server/ai/conversation-cursor";
import {
    AIWorkAnchorConflict,
    ensureConversation,
    listConversations,
    preferencesFor,
    saveTranscript,
} from "$lib/server/ai/persistence";
import { anchorConflictResponse, assertRateLimit, assertSameOrigin, requireAIUser, stableError } from "$lib/server/ai/security";

export const GET: RequestHandler = async ({ locals, url }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.conversations", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);

    let limit: number;
    let cursor;
    try {
        limit = parseLimit(url.searchParams.get("limit"));
        const raw = url.searchParams.get("cursor");
        cursor = raw ? decodeCursor(raw) : undefined;
    } catch (error) {
        if (error instanceof ConversationCursorError) {
            return stableError(error.code, error.message, 400);
        }
        return stableError("invalid_cursor", "The conversation cursor is malformed", 400);
    }

    try {
        const preferences = await preferencesFor(user.id);
        if (!preferences.history_enabled) return json({ conversations: [] });
        return json(await listConversations(user.id, cursor, limit));
    } catch {
        return stableError("conversation_unavailable", "Conversation history is unavailable", 503);
    }
};

/**
 * Creates a conversation, optionally with the turns it already has.
 *
 * This is the flush an escalated one-shot performs (§1): the thread existed only in
 * the browser, so promoting it is a single write of the whole transcript rather than
 * an id negotiation — the browser minted the id before its first token, and every
 * message carries the id the transcript uses, so a repeated flush writes nothing new.
 */
export const POST: RequestHandler = async ({ locals, request, url }) => {
    const user = await requireAIUser(locals);
    assertSameOrigin(request, url);
    assertRateLimit(user.id, "ai.conversations.create", 20);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);

    let body: AIConversationFlushRequest = { contexts: [], messages: [] };
    if (request.headers.get("content-type")?.includes("application/json")) {
        try {
            body = parseConversationFlushRequest(await request.json());
        } catch (error) {
            const message = error instanceof AISchemaError ? error.message : "Invalid JSON request";
            return stableError("invalid_request", message, 400);
        }
    }

    try {
        const preferences = await preferencesFor(user.id);
        if (!preferences.history_enabled) {
            return json({ id: body.conversationId ?? crypto.randomUUID(), persisted: false });
        }
        const firstPrompt = body.messages.find((message) => message.role === "user");
        const id = await ensureConversation({
            userId: user.id,
            conversationId: body.conversationId,
            contexts: body.contexts,
            titleSource: firstPrompt && messageText(firstPrompt),
            thread: body.thread,
        });
        await saveTranscript(id, body.messages);
        return json({ id, persisted: true }, { status: 201 });
    } catch (error) {
        if (error instanceof AIWorkAnchorConflict) {
            return anchorConflictResponse(error);
        }
        return stableError("conversation_unavailable", "A new conversation could not be created", 503);
    }
};
