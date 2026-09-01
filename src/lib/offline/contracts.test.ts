import { describe, expect, test } from "bun:test";
import {
    countsAgree,
    normalizeScope,
    parseOperation,
    parsePackageCreateRequest,
    parsePackagePage,
    parseRecords,
    parseSyncResult,
} from "./contracts";
import { pageChecksum } from "./checksum";
import { OfflineParseError, tryParse } from "./parse";
import * as p from "./parse";
import { buildFixturePackage, fixtureUuid, geometryFixtureProblems, GEOMETRY_SCOPE } from "./fixtures";

const USER = fixtureUuid("user");

describe("parser primitives", () => {
    test("name the failing field, not just the shape", () => {
        const result = tryParse(
            p.objectOf<{ a: { b: number } }>({
                a: p.objectOf<{ b: number }>({ b: p.integer }),
            }),
            { a: { b: "2" } },
            "page",
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.path).toBe("page.a.b");
    });

    test("reject an integer outside the safe range instead of rounding it", () => {
        // A rounded id keys local records to the wrong problem, silently.
        expect(() => p.integer(2 ** 53, "id")).toThrow(OfflineParseError);
        expect(p.integer(2 ** 53 - 1, "id")).toBe(2 ** 53 - 1);
    });

    test("distinguish a missing field from an explicit null", () => {
        expect(p.nullable(p.string)(null)).toBeNull();
        expect(() => p.nullable(p.string)(undefined)).toThrow(OfflineParseError);
    });

    test("drop unknown keys rather than failing an additive change", () => {
        const parse = p.objectOf<{ a: number }>({ a: p.integer });
        expect(parse({ a: 1, addedLater: true })).toEqual({ a: 1 });
    });

    test("report an unrecognized union tag as the interesting fact", () => {
        const result = tryParse(parseOperation, { type: "telepathy" }, "op");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('unknown type "telepathy"');
    });
});

describe("scope normalization", () => {
    test("dedupes and sorts so one request has one spelling", () => {
        expect(
            normalizeScope({
                topic: ["G", "A", "G"],
                seriesIds: ["20", "10", "10"],
                seriesScopes: {},
            }),
        ).toEqual({ topic: ["A", "G"], seriesIds: ["10", "20"], seriesScopes: {} });
    });

    test("drops a per-series scope for a series that is not selected", () => {
        // The trainer ignores such an entry, so carrying it would make two
        // identical scopes compare unequal.
        const normalized = normalizeScope({
            topic: [],
            seriesIds: ["10"],
            seriesScopes: {
                "10": { divisions: ["B", "A"], formats: [] },
                "99": { divisions: ["A"], formats: [] },
            },
        });
        expect(normalized.seriesScopes).toEqual({
            "10": { divisions: ["A", "B"], formats: [] },
        });
    });

    test("drops an empty narrowing, which is not a narrowing", () => {
        const normalized = normalizeScope({
            topic: [],
            seriesIds: ["10"],
            seriesScopes: { "10": { divisions: [], formats: [] } },
        });
        expect(normalized.seriesScopes).toEqual({});
    });

    test("keeps a problem-number range as a real narrowing", () => {
        const normalized = normalizeScope({
            topic: [],
            seriesIds: ["10"],
            seriesScopes: {
                "10": {
                    divisions: [],
                    formats: [],
                    problemNumbers: [21, 25] as [number, number],
                },
            },
        });
        expect(normalized.seriesScopes).toEqual({
            "10": { divisions: [], formats: [], problemNumbers: [21, 25] },
        });
    });
});

describe("package creation", () => {
    const request = {
        version: 1,
        packageId: fixtureUuid("package"),
        requestId: fixtureUuid("request"),
        deviceId: fixtureUuid("device"),
        scope: { topic: [], seriesIds: [], seriesScopes: {} },
        problemLimit: 20,
        session: {
            sessionId: null,
            name: "Offline practice",
            settings: { mode: "new", format: "practice" },
        },
    };

    test("accepts the explicit default download amount", () => {
        expect(parsePackageCreateRequest(request).problemLimit).toBe(20);
    });

    test("rejects an absent or out-of-range download amount", () => {
        expect(() =>
            parsePackageCreateRequest({ ...request, problemLimit: undefined }),
        ).toThrow(OfflineParseError);
        expect(() =>
            parsePackageCreateRequest({ ...request, problemLimit: 0 }),
        ).toThrow(OfflineParseError);
        expect(() =>
            parsePackageCreateRequest({ ...request, problemLimit: 10_001 }),
        ).toThrow(OfflineParseError);
    });
});

describe("package pages", () => {
    test("a fixture page parses and its declared counts agree", async () => {
        const fixture = await buildFixturePackage({
            userId: USER,
            scope: GEOMETRY_SCOPE,
            problems: geometryFixtureProblems(),
        });
        for (const page of fixture.pages) {
            const parsed = parsePackagePage(page, "page");
            expect(countsAgree(parsed)).toBe(true);
        }
    });

    test("a page that lies about its counts is caught before anything is written", async () => {
        const fixture = await buildFixturePackage({
            userId: USER,
            scope: GEOMETRY_SCOPE,
            problems: geometryFixtureProblems(),
        });
        const page = structuredClone(fixture.pages[0]);
        page.counts.problems += 1;
        expect(countsAgree(parsePackagePage(page))).toBe(false);
    });

    // The server checksums `parseRecords(...)` for this reason: the client can
    // only hash what it parsed, so an additive server field must not move the
    // digest. Hash the raw records instead and the next new column fails every
    // download with "page 0 failed its checksum".
    test("a field this client has never heard of does not move the page checksum", async () => {
        const fixture = await buildFixturePackage({
            userId: USER,
            scope: GEOMETRY_SCOPE,
            problems: geometryFixtureProblems(),
        });
        const page = fixture.pages[0];
        const withNewColumn = structuredClone(page.records) as Record<string, unknown> & {
            problems: Record<string, unknown>[];
        };
        withNewColumn.problems[0].sourceUrl = "https://example.invalid/next-release";
        withNewColumn.newCollection = [{ canonicalId: 1 }];

        expect(
            await pageChecksum({
                packageId: page.packageId,
                checkoutId: page.checkoutId,
                packageRevision: page.packageRevision,
                pageIndex: page.pageIndex,
                records: parseRecords(withNewColumn),
            }),
        ).toBe(page.checksum);
    });

    test("a page carrying a foreign answer_status is rejected, not coerced", async () => {
        const fixture = await buildFixturePackage({
            userId: USER,
            scope: GEOMETRY_SCOPE,
            problems: geometryFixtureProblems(),
        });
        const page = structuredClone(fixture.pages[0]) as never as {
            records: { problems: { answerStatus: string }[] };
        };
        page.records.problems[0].answerStatus = "probably_fine";
        expect(() => parsePackagePage(page, "page")).toThrow(OfflineParseError);
    });
});

describe("sync results", () => {
    test("discriminate error from success on status", () => {
        const error = parseSyncResult({
            version: 1,
            status: "error",
            code: "auth_required",
            retryable: false,
            message: "sign in",
        });
        expect(error.status).toBe("error");
    });

    test("reject an error code this client has never heard of", () => {
        expect(() =>
            parseSyncResult({
                version: 1,
                status: "error",
                code: "vibes",
                retryable: true,
                message: "",
            }),
        ).toThrow(OfflineParseError);
    });
});
