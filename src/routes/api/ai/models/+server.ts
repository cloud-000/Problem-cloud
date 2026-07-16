import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { buildModelCatalog } from "$lib/server/ai/models/catalog";
import { assertRateLimit, requireAIUser, stableError } from "$lib/server/ai/security";

export const GET: RequestHandler = async ({ locals }) => {
    const user = await requireAIUser(locals);
    assertRateLimit(user.id, "ai.models", 60);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);
    try {
        const catalog = await buildModelCatalog();
        return json(catalog, { headers: { "cache-control": "no-store" } });
    } catch {
        return stableError("catalog_unavailable", "The AI model catalog is unavailable", 503);
    }
};
