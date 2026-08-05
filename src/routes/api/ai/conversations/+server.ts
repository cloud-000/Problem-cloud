import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import {
    ConversationCursorError,
    decodeCursor,
    parseLimit,
} from "$lib/server/ai/conversation-cursor";
import { ensureConversation, listConversations, preferencesFor } from "$lib/server/ai/persistence";
import { assertRateLimit, assertSameOrigin, requireAIUser, stableError } from "$lib/server/ai/security";

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

export const POST: RequestHandler = async ({ locals, request, url }) => {
    const user = await requireAIUser(locals);
    assertSameOrigin(request, url);
    assertRateLimit(user.id, "ai.conversations.create", 20);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);
    try {
        const preferences = await preferencesFor(user.id);
        if (!preferences.history_enabled) {
            return json({ id: crypto.randomUUID(), persisted: false });
        }
        const id = await ensureConversation(user.id, undefined, []);
        return json({ id, persisted: true }, { status: 201 });
    } catch {
        return stableError("conversation_unavailable", "A new conversation could not be created", 503);
    }
};
