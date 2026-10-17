import { error, type RequestHandler } from "@sveltejs/kit";
import { assetResponse, offlineAssetSource } from "#lib/server/offline/assets.js";

export const GET: RequestHandler = async ({ url, fetch }) => {
    const rawTarget = url.searchParams.get("url");
    if (!rawTarget) {
        throw error(400, "Missing 'url' query parameter");
    }

    const validatedUrl = offlineAssetSource(rawTarget);
    if (!validatedUrl) {
        throw error(403, "Target host is not an allowed media origin");
    }

    try {
        return await assetResponse(
            validatedUrl,
            "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
            fetch,
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("OFFLINE_TEMPORARY:")) {
            throw error(502, "Upstream media source unavailable");
        }
        if (message.startsWith("OFFLINE_OPERATION_INVALID:")) {
            throw error(415, "Target is not a valid image");
        }
        if (message.startsWith("OFFLINE_BATCH_TOO_LARGE:")) {
            throw error(413, "Media file is too large");
        }
        throw error(500, "Failed to proxy media");
    }
};
