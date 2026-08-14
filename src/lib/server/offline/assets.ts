import { PACKAGE_MAX_TOTAL_BYTES } from "$lib/offline/limits";

const ALLOWED_ASSET_HOSTS = new Set([
    "latex.artofproblemsolving.com",
    "cdn.jsdelivr.net",
]);

/** Only known immutable problem-image origins may cross the server fallback. */
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
    const response = await fetcher(url, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
    });
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
    return { body, contentType };
}
