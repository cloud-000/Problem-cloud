import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { catalogFor } from "$lib/ai/catalog";
import { providerRegistry } from "$lib/server/ai/providers/registry";
import { catalogWithHostedQuota } from "$lib/server/ai/hosted-usage";
import { assertRateLimit, requireAIUser, stableError } from "$lib/server/ai/security";

/** The server-owned model catalog. BYOK models are discovered in the browser instead. */
export const GET: RequestHandler = async ({ locals }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.models", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);
    try {
        const catalog = await catalogWithHostedQuota(user.id, await catalogFor(providerRegistry()));
        return json(catalog, { headers: { "cache-control": "no-store" } });
    } catch {
        return stableError("catalog_unavailable", "The AI model catalog is unavailable", 503);
    }
};
