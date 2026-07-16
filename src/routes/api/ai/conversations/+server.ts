import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { createConversation, latestConversation, preferencesFor } from "$lib/server/ai/persistence";
import { assertRateLimit, assertSameOrigin, requireAIUser, stableError } from "$lib/server/ai/security";

export const GET: RequestHandler = async ({ locals }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.conversations", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);
    try {
        const preferences = await preferencesFor(user.id);
        return json({
            conversation: preferences.history_enabled ? await latestConversation(user.id) : null,
        });
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
        const id = await createConversation(user.id, []);
        return json({ id, persisted: true }, { status: 201 });
    } catch {
        return stableError("conversation_unavailable", "A new conversation could not be created", 503);
    }
};
