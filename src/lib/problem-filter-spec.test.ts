import { describe, expect, test } from "bun:test";
import { matchesLocalProblemFilters, type LocalProblemCandidate } from "./problem-filter-spec";

function candidate(overrides: Partial<LocalProblemCandidate> = {}): LocalProblemCandidate {
    return {
        canonicalId: 10,
        problem: {
            canonicalId: 10,
            contentRevision: "content-1",
            statement: "Problem",
            topic: "A",
            choices: ["1", "2"],
            answerIndex: 0,
            answerStatus: "known",
            officialSolutions: [],
            verified: true,
            isComputational: false,
            responseKind: "mcq",
            aopsId: null,
            tags: ["algebra", "intro"],
            difficulty: null,
            quality: 80,
            notes: null,
            builtAt: "2026-08-14T00:00:00.000Z",
            assetKeys: [],
        },
        placement: {
            packageRevision: "package-1",
            placementId: 12,
            canonicalId: 10,
            testId: 4,
            problemNumber: 2,
            topic: "A",
            test: null,
            series: { id: 3, name: "Series" },
        },
        rating: null,
        progress: null,
        ...overrides,
    };
}

describe("downloaded catalogue filter parity", () => {
    test("a narrowed rating band drops unrated candidates", () => {
        expect(matchesLocalProblemFilters(candidate(), { difficulty: [0, 1600] })).toBe(false);
    });

    test("nullable progress values use the named UI members", () => {
        expect(matchesLocalProblemFilters(candidate(), { mastery: ["unassessed"] })).toBe(true);
        expect(matchesLocalProblemFilters(candidate(), { engagement: ["none"] })).toBe(true);
        expect(matchesLocalProblemFilters(candidate(), { mastery: ["learning"] })).toBe(false);
    });

    test("tags use contains semantics and ids include aliases", () => {
        expect(matchesLocalProblemFilters(candidate(), { tags: ["algebra", "intro"] })).toBe(true);
        expect(matchesLocalProblemFilters(candidate(), { tags: ["missing"] })).toBe(false);
        expect(matchesLocalProblemFilters(candidate(), { search: "12" })).toBe(true);
        expect(matchesLocalProblemFilters(candidate(), { search: "10" })).toBe(true);
    });

    test("division and format only apply when a series is selected", () => {
        const amc = candidate({
            placement: {
                ...candidate().placement,
                test: {
                    name: "2024 AMC 10A",
                    seriesId: 3,
                    division: "A",
                    format: "A",
                    year: 2024,
                    aopsCategoryId: null,
                },
            },
        });
        expect(
            matchesLocalProblemFilters(amc, {
                seriesId: 3,
                divisions: ["A"],
                formats: ["A"],
            }),
        ).toBe(true);
        expect(
            matchesLocalProblemFilters(amc, {
                seriesId: 3,
                divisions: ["B"],
            }),
        ).toBe(false);
        expect(matchesLocalProblemFilters(amc, { divisions: ["B"] })).toBe(true);
        expect(
            matchesLocalProblemFilters(amc, {
                seriesId: 3,
                testId: 4,
                divisions: ["B"],
            }),
        ).toBe(true);
    });

    test("a problem-number range matches the 1-based displayed number", () => {
        const late = candidate({
            placement: { ...candidate().placement, problemNumber: 20 },
        });
        expect(
            matchesLocalProblemFilters(late, {
                seriesId: 3,
                problemNumbers: [21, 25],
            }),
        ).toBe(true);
        expect(
            matchesLocalProblemFilters(late, {
                seriesId: 3,
                problemNumbers: [1, 10],
            }),
        ).toBe(false);
        expect(
            matchesLocalProblemFilters(late, { problemNumbers: [1, 10] }),
        ).toBe(true);
    });

    test("a year range matches the placement test year", () => {
        const amc = candidate({
            placement: {
                ...candidate().placement,
                test: {
                    name: "2024 AMC 10A",
                    seriesId: 3,
                    division: "A",
                    format: "A",
                    year: 2024,
                    aopsCategoryId: null,
                },
            },
        });
        expect(
            matchesLocalProblemFilters(amc, { seriesId: 3, year: [2020, 2024] }),
        ).toBe(true);
        expect(
            matchesLocalProblemFilters(amc, { seriesId: 3, year: [2010, 2015] }),
        ).toBe(false);
        expect(matchesLocalProblemFilters(amc, { year: [2010, 2015] })).toBe(true);
    });
});
