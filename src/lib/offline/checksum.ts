/**
 * Page checksums: RFC 8785 (JSON Canonicalization Scheme) + SHA-256, base64url.
 *
 * `docs/offline-contracts.md` §2c pins the digest to a *canonical* serialization
 * rather than to the bytes on the wire, for one concrete reason: the checksum
 * has to survive the transport. HTTP compression, a proxy re-encoding, and a
 * different key order from a JSON serializer all change the bytes without
 * changing the page — and a checksum that fails on any of those would make a
 * correct retry look like a corrupt one, which is precisely the case the staged
 * install must distinguish (`stagePackagePage` is idempotent for the same page
 * with the same checksum, and fails the package for a different one).
 *
 * The two properties that make this work: object keys are sorted by UTF-16 code
 * unit (which is what `Array.prototype.sort` does by default), and numbers are
 * serialized exactly as ECMAScript prints them (which is what `JSON.stringify`
 * does for finite numbers).
 */

export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

/**
 * Serialize `value` per RFC 8785. Throws on values JSON cannot canonicalize —
 * `undefined`, `NaN`, `Infinity`, functions — rather than silently dropping
 * them, since a dropped field is a checksum that agrees about the wrong page.
 */
export function canonicalJson(value: unknown): string {
    if (value === null) return "null";

    switch (typeof value) {
        case "boolean":
            return value ? "true" : "false";
        case "number":
            if (!Number.isFinite(value)) {
                throw new TypeError(`cannot canonicalize the number ${value}`);
            }
            // -0 and 0 are the same JSON number; ES prints -0 as "0" already.
            return JSON.stringify(value);
        case "string":
            // JSON.stringify already emits RFC 8785's escaping: the short forms
            // for the seven special characters and lowercase \u00xx elsewhere.
            return JSON.stringify(value);
        case "object":
            break;
        default:
            throw new TypeError(`cannot canonicalize a ${typeof value}`);
    }

    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
    const body = keys
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",");
    return `{${body}}`;
}

function base64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** base64url SHA-256 of a UTF-8 string. */
export async function sha256Base64Url(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64Url(new Uint8Array(digest));
}

/**
 * The checksum a package page must carry: the digest of the canonical JSON of
 * `{ packageId, checkoutId, packageRevision, pageIndex, records }` — the page's
 * identity and its payload, and deliberately not its counts or cursor, which are
 * navigational metadata the server may legitimately recompute.
 */
export async function pageChecksum(input: {
    packageId: string;
    checkoutId: string;
    packageRevision: string;
    pageIndex: number;
    records: unknown;
}): Promise<string> {
    return sha256Base64Url(
        canonicalJson({
            packageId: input.packageId,
            checkoutId: input.checkoutId,
            packageRevision: input.packageRevision,
            pageIndex: input.pageIndex,
            records: input.records as JsonValue,
        }),
    );
}

/** Decoded size of a page's canonical JSON, for the per-page byte limit. */
export function canonicalByteLength(value: unknown): number {
    return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

/**
 * The stable key for one asset URL: base64url SHA-256 of the normalized
 * absolute URL. Content-addressing the *URL* (not the bytes) is what lets the
 * service worker answer a request for the original URL out of a package's media
 * cache without having fetched it first.
 */
export async function assetKey(url: string): Promise<string> {
    return sha256Base64Url(normalizeAssetUrl(url));
}

/**
 * Normalize an asset URL before keying it. Two statements referencing the same
 * image with a different case host or a stray default port must produce one
 * asset, or the package downloads it twice and the media cache misses.
 */
export function normalizeAssetUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        return parsed.toString();
    } catch {
        // A relative or malformed reference is kept verbatim; it is still a
        // stable key, and the installer reports it as an unfetchable asset.
        return url.trim();
    }
}
