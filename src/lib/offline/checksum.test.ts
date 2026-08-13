import { describe, expect, test } from "bun:test";
import {
    assetKey,
    canonicalByteLength,
    canonicalJson,
    normalizeAssetUrl,
    pageChecksum,
    sha256Base64Url,
} from "./checksum";

describe("canonical JSON", () => {
    test("sorts object keys by code unit, at every depth", () => {
        expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
            '{"a":{"c":3,"d":2},"b":1}',
        );
    });

    test("preserves array order", () => {
        expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    });

    test("drops undefined members rather than emitting them", () => {
        expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    });

    test("refuses values JSON cannot represent", () => {
        expect(() => canonicalJson({ a: NaN })).toThrow(TypeError);
        expect(() => canonicalJson({ a: Infinity })).toThrow(TypeError);
    });

    test("emits the RFC 8785 escapes", () => {
        expect(canonicalJson('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    });
});

describe("page checksums", () => {
    const records = {
        memberships: [{ packageId: "p", packageRevision: "r", canonicalId: 2 }],
        problems: [],
    };

    test("are stable across key order — the point of canonicalizing", async () => {
        const a = await pageChecksum({
            packageId: "p",
            checkoutId: "c",
            packageRevision: "r",
            pageIndex: 0,
            records,
        });
        const b = await pageChecksum({
            checkoutId: "c",
            pageIndex: 0,
            packageRevision: "r",
            packageId: "p",
            records: {
                problems: [],
                memberships: [
                    { canonicalId: 2, packageRevision: "r", packageId: "p" },
                ],
            },
        });
        expect(a).toBe(b);
    });

    test("change when the records change", async () => {
        const a = await pageChecksum({
            packageId: "p",
            checkoutId: "c",
            packageRevision: "r",
            pageIndex: 0,
            records,
        });
        const b = await pageChecksum({
            packageId: "p",
            checkoutId: "c",
            packageRevision: "r",
            pageIndex: 0,
            records: { ...records, problems: [{ canonicalId: 3 }] },
        });
        expect(a).not.toBe(b);
    });

    test("change when the page's identity changes", async () => {
        const first = await pageChecksum({
            packageId: "p",
            checkoutId: "c",
            packageRevision: "r",
            pageIndex: 0,
            records,
        });
        const second = await pageChecksum({
            packageId: "p",
            checkoutId: "c",
            packageRevision: "r",
            pageIndex: 1,
            records,
        });
        expect(first).not.toBe(second);
    });

    test("are base64url — no padding, no + or /", async () => {
        const digest = await sha256Base64Url("hello");
        expect(digest).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(digest.length).toBe(43);
    });
});

describe("asset keys", () => {
    test("normalize away a fragment, so one image is one asset", async () => {
        expect(normalizeAssetUrl("https://cdn.test/a.png#frag")).toBe(
            "https://cdn.test/a.png",
        );
        expect(await assetKey("https://cdn.test/a.png#one")).toBe(
            await assetKey("https://cdn.test/a.png#two"),
        );
    });

    test("keep an unparseable reference verbatim rather than dropping it", () => {
        expect(normalizeAssetUrl("  images/a.png ")).toBe("images/a.png");
    });

    test("canonicalByteLength measures the decoded canonical form", () => {
        expect(canonicalByteLength({ a: 1 })).toBe(7);
    });
});
