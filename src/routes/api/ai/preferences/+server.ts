import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { AISchemaError, parseModelReference } from "$lib/ai/schemas";
import { preferencesFor, updatePreferences } from "$lib/server/ai/persistence";
import { assertRateLimit, assertSameOrigin, requireAIUser, stableError } from "$lib/server/ai/security";

export const GET: RequestHandler = async ({ locals }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.preferences", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);
    try {
        const preferences = await preferencesFor(user.id);
        return json({
            historyEnabled: preferences.history_enabled,
            defaultModel: preferences.default_model,
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
    if (!body || typeof body !== "object") {
        return stableError("invalid_request", "A preferences patch is required", 400);
    }

    // A patch, not a replacement: either field may be sent alone.
    const patch: { historyEnabled?: boolean; defaultModel?: string } = {};
    if (body.historyEnabled !== undefined) {
        if (typeof body.historyEnabled !== "boolean") {
            return stableError("invalid_request", "historyEnabled must be a boolean", 400);
        }
        patch.historyEnabled = body.historyEnabled;
    }
    if (body.defaultModel !== undefined) {
        try {
            patch.defaultModel = parseModelReference(body.defaultModel);
        } catch (error) {
            const message = error instanceof AISchemaError ? error.message : "defaultModel is invalid";
            return stableError("invalid_request", message, 400);
        }
    }
    if (patch.historyEnabled === undefined && patch.defaultModel === undefined) {
        return stableError("invalid_request", "historyEnabled or defaultModel is required", 400);
    }

    try {
        await updatePreferences(user.id, patch);
        return json(patch);
    } catch {
        return stableError("preferences_unavailable", "AI preferences could not be updated", 503);
    }
};
