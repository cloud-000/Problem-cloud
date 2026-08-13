import { describe, expect, test } from "bun:test";
import {
    countsAgree,
    normalizeScope,
    parseOperation,
    parsePackagePage,
    parseSyncResult,
} from "./contracts";
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
