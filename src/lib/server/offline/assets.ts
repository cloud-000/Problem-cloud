import { PACKAGE_MAX_TOTAL_BYTES } from "#lib/offline/limits.js";
import { ALLOWED_ASSET_HOSTS, extractImageDimensions } from "#lib/utils/media.js";

export { ALLOWED_ASSET_HOSTS };

const assetMemoryCache = new Map<string, { body: ArrayBuffer; contentType: string }>();

export function clearAssetMemoryCache(): void {
    assetMemoryCache.clear();
}

export function offlineAssetSource(raw: string): URL | null {
    try {
        const url = new URL(raw);
        if (url.protocol !== "https:" || !ALLOWED_ASSET_HOSTS.has(url.hostname)) {
            return null;
        }
        url.hash = "";
        return url;
    } catch {
        return null;
    }
}

export async function fetchOfflineAssetSource(
    url: URL,
    fetcher: typeof fetch = fetch,
): Promise<{ body: ArrayBuffer; contentType: string }> {
    const useCache = fetcher === fetch;
    const cacheKey = url.href;
    if (useCache) {
        const cached = assetMemoryCache.get(cacheKey);
        if (cached) {
            return {
                body: cached.body.slice(0),
                contentType: cached.contentType,
            };
        }
    }

    const headers: Record<string, string> = {
        "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: `${url.origin}/`,
    };

    let response = await fetcher(url, {
        headers,
        credentials: "omit",
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
    });

    if (
        !response.ok &&
        (url.hostname === "artofproblemsolving.com" ||
            url.hostname.endsWith(".artofproblemsolving.com"))
    ) {
        try {
            const archiveUrl = new URL(`https://web.archive.org/web/2/${url.href}`);
            const archiveResp = await fetcher(archiveUrl, {
                headers,
                credentials: "omit",
                redirect: "follow",
                signal: AbortSignal.timeout(15_000),
            });
            if (
                archiveResp.ok &&
                archiveResp.headers.get("content-type")?.startsWith("image/")
            ) {
                response = archiveResp;
            }
        } catch (_) {}
    }

    if (!response.ok) {
        throw new Error(`OFFLINE_TEMPORARY:asset HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
    if (!contentType.startsWith("image/")) {
        throw new Error("OFFLINE_OPERATION_INVALID:asset is not an image");
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > PACKAGE_MAX_TOTAL_BYTES) {
        throw new Error("OFFLINE_BATCH_TOO_LARGE:asset");
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > PACKAGE_MAX_TOTAL_BYTES) {
        throw new Error("OFFLINE_BATCH_TOO_LARGE:asset");
    }

    if (useCache) {
        if (assetMemoryCache.size >= 200) {
            const oldest = assetMemoryCache.keys().next().value;
            if (oldest) assetMemoryCache.delete(oldest);
        }
        assetMemoryCache.set(cacheKey, { body, contentType });
    }

    return { body, contentType };
}

export async function assetResponse(
    url: URL,
    cacheControl: string = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    fetcher: typeof fetch = fetch,
): Promise<Response> {
    const fetched = await fetchOfflineAssetSource(url, fetcher);
    const dims = extractImageDimensions(fetched.body, fetched.contentType);
    const headers: Record<string, string> = {
        "content-type": fetched.contentType,
        "cache-control": cacheControl,
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "cross-origin",
        "access-control-allow-origin": "*",
    };
    if (dims) {
        headers["x-image-width"] = String(dims.width);
        headers["x-image-height"] = String(dims.height);
        headers["access-control-expose-headers"] = "x-image-width, x-image-height";
    }
    return new Response(fetched.body, { headers });
}
