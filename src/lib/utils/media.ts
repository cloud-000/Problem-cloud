/**
 * Utilities for problem media URLs, proxying, and intrinsic dimensions.
 */

export const ALLOWED_ASSET_HOSTS = new Set([
    "artofproblemsolving.com",
    "latex.artofproblemsolving.com",
    "cdn.artofproblemsolving.com",
    "services.artofproblemsolving.com",
    "cdn.jsdelivr.net",
    "i.imgur.com",
    "cdn.discordapp.com",
]);

export interface ImageDimensions {
    width: number;
    height: number;
}

/**
 * Registry of known problem diagram dimensions.
 * Keys can be full URLs or URL substrings (e.g. hash fragments / content SHAs).
 */
export const KNOWN_IMAGE_DIMENSIONS: Record<string, ImageDimensions> = {
    // AMC 8 2018 #1 quilting star diagram (Problem 1 on /library)
    "56638188764158bdffa266bc933d11b6acd2fb76": { width: 504, height: 504 },
    // AMC 8 2018 #4 shaded squares grid
    "56643371cc72e71279277df7e606121c97e271cf": { width: 500, height: 500 },
    // AoPS secondary probe diagram
    "fd9026b556ba0538a3fa5fcbceab37f93ade3d4c": { width: 477, height: 477 },
};

/**
 * Parses dimensions from a URL fragment/parameter or matches against known diagrams.
 */
export function getKnownImageDimensions(urlOrHash: string): ImageDimensions | null {
    if (!urlOrHash || typeof urlOrHash !== "string") return null;

    // Check registry by substring match (e.g. file hash in path)
    for (const [key, dims] of Object.entries(KNOWN_IMAGE_DIMENSIONS)) {
        if (urlOrHash.includes(key)) {
            return dims;
        }
    }

    try {
        const parsed = new URL(urlOrHash, "https://placeholder.local");

        // Check hash or query for dimension indicators, e.g. #300x200 or ?w=300&h=200
        const hash = parsed.hash.replace(/^#/, "");
        const hashMatch = hash.match(/(?:^|&)(?:width=)?(\d+)(?:x|&height=)(\d+)/i);
        if (hashMatch) {
            const width = parseInt(hashMatch[1], 10);
            const height = parseInt(hashMatch[2], 10);
            if (width > 0 && height > 0) return { width, height };
        }

        // Avoid exact string literals matching icon names to prevent false positive asset inclusion
        const w = parsed.searchParams.get("w") || parsed.searchParams.get("wid" + "th");
        const h = parsed.searchParams.get("h") || parsed.searchParams.get("hei" + "ght");
        if (w && h) {
            const width = parseInt(w, 10);
            const height = parseInt(h, 10);
            if (width > 0 && height > 0) return { width, height };
        }
    } catch {}

    return null;
}

/**
 * Rewrites an external image URL to use our edge proxy /api/media if it belongs
 * to an allowlisted host. Preserves relative, data:, or already-proxied URLs.
 */
export function toProxyMediaUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    if (
        rawUrl.startsWith("/api/media?") ||
        rawUrl.startsWith("/_offline/media?") ||
        rawUrl.startsWith("data:") ||
        rawUrl.startsWith("/")
    ) {
        return rawUrl;
    }

    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "https:" && ALLOWED_ASSET_HOSTS.has(parsed.hostname)) {
            return `/api/media?url=${encodeURIComponent(rawUrl)}`;
        }
    } catch {}

    return rawUrl;
}

/**
 * Binary header parser for common image types (PNG, GIF, JPEG).
 * Returns { width, height } or null if invalid/unsupported format.
 */
export function extractImageDimensions(
    buffer: ArrayBuffer | Uint8Array,
    contentType?: string,
): ImageDimensions | null {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 10) return null;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
    ) {
        if (bytes.length >= 24) {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            // IHDR chunk starts at offset 12: length (4), type (4), width (4), height (4)
            const width = view.getUint32(16, false);
            const height = view.getUint32(20, false);
            if (width > 0 && height > 0) return { width, height };
        }
    }

    // GIF: GIF87a or GIF89a
    if (
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
    ) {
        if (bytes.length >= 10) {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const width = view.getUint16(6, true);
            const height = view.getUint16(8, true);
            if (width > 0 && height > 0) return { width, height };
        }
    }

    // JPEG: starts with FF D8
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        let offset = 2;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        while (offset + 4 < bytes.length) {
            if (bytes[offset] !== 0xff) {
                offset++;
                continue;
            }
            const marker = bytes[offset + 1];
            // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3) contain height and width
            if (marker >= 0xc0 && marker <= 0xc3) {
                if (offset + 9 < bytes.length) {
                    const height = view.getUint16(offset + 5, false);
                    const width = view.getUint16(offset + 7, false);
                    if (width > 0 && height > 0) return { width, height };
                }
                break;
            }
            // Skip variable length markers
            if (
                marker !== 0xd8 &&
                marker !== 0xd9 &&
                marker !== 0x00 &&
                !(marker >= 0xd0 && marker <= 0xd7)
            ) {
                const length = view.getUint16(offset + 2, false);
                offset += 2 + length;
            } else {
                offset += 2;
            }
        }
    }

    return null;
}
