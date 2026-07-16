import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type { AIBootstrap } from "$lib/ai/types";
import { parseBootstrap } from "$lib/ai/schemas";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { buildModelCatalog } from "$lib/server/ai/models/catalog";
import { latestConversation, preferencesFor } from "$lib/server/ai/persistence";
import { assertRateLimit, requireAIUser, stableError } from "$lib/server/ai/security";

export const GET: RequestHandler = async ({ locals }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.bootstrap", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);

    try {
        const [{ providers, models }, preferences] = await Promise.all([
            buildModelCatalog(),
            preferencesFor(user.id),
        ]);
        const conversation = preferences.history_enabled
            ? await latestConversation(user.id)
            : undefined;
        const bootstrap: AIBootstrap = {
            enabled: true,
            connection: providers[0] ?? null,
            models,
            defaultModel: preferences.default_model as AIBootstrap["defaultModel"],
            historyEnabled: preferences.history_enabled,
            conversation,
        };
        return json(parseBootstrap(bootstrap), { headers: { "cache-control": "no-store" } });
    } catch {
        return stableError(
            "bootstrap_unavailable",
            "Coach could not load its server configuration",
            503,
        );
    }
};
