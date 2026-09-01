import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type { AIBootstrap } from "$lib/ai/types";
import { parseBootstrap } from "$lib/ai/schemas";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { catalogFor } from "$lib/ai/catalog";
import { providerRegistry } from "$lib/server/ai/providers/registry";
import { catalogWithHostedQuota } from "$lib/server/ai/hosted-usage";
import { preferencesFor } from "$lib/server/ai/persistence";
import { assertRateLimit, requireAIUser, stableError } from "$lib/server/ai/security";

/**
 * Preferences, saved history, and the connections the *server* owns. The user's own
 * BYOK connections are absent by design: their keys never leave the browser, so the
 * client probes them itself and merges the two catalogs.
 */
export const GET: RequestHandler = async ({ locals }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.bootstrap", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);

    try {
        const [{ providers, models }, preferences] = await Promise.all([
            catalogFor(providerRegistry()).then((catalog) => catalogWithHostedQuota(user.id, catalog)),
            preferencesFor(user.id),
        ]);
        // No server-owned connection is a normal state, not a failure: the user's own
        // connections may still make the Coach fully usable.
        //
        // No transcript either: assist threads do not auto-resume (§1). Opening the
        // Coach starts fresh and history is one click away, so bootstrap no longer
        // hands back whichever thread happened to be newest.
        const bootstrap: AIBootstrap = {
            enabled: true,
            connections: providers,
            models,
            defaultModel: preferences.default_model as AIBootstrap["defaultModel"],
            historyEnabled: preferences.history_enabled,
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
