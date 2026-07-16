import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { preferencesFor, updateHistoryPreference } from "$lib/server/ai/persistence";
import { assertRateLimit, assertSameOrigin, requireAIUser, stableError } from "$lib/server/ai/security";

export const GET: RequestHandler = async ({ locals }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.preferences", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);
    try {
        const preferences = await preferencesFor(user.id);
        return json({
            historyEnabled: preferences.history_enabled,
            retentionDays: preferences.retention_days,
        });
    } catch {
        return stableError("preferences_unavailable", "AI preferences are unavailable", 503);
    }
};

export const PATCH: RequestHandler = async ({ locals, request, url }) => {
    const user = await requireAIUser(locals);
    assertSameOrigin(request, url);
    assertRateLimit(user.id, "ai.preferences.update", 20);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || typeof body.historyEnabled !== "boolean") {
        return stableError("invalid_request", "historyEnabled must be a boolean", 400);
    }
    try {
        await updateHistoryPreference(user.id, body.historyEnabled);
        return json({ historyEnabled: body.historyEnabled });
    } catch {
        return stableError("preferences_unavailable", "AI preferences could not be updated", 503);
    }
};
