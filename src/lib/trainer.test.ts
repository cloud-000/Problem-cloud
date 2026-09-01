import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { ProblemRow } from "$lib/library";
import {
    fetchTestProblems,
    hasProblemNumberScope,
    hasSeriesScope,
    seriesScopeEmbedAlias,
    seriesScopeFilter,
    seriesScopeSelectAliases,
    type PracticeSettings,
} from "$lib/trainer";

function testProblem(
    id: number,
    responseKind: ProblemRow["response_kind"],
    statement = `Problem ${id}`,
): ProblemRow {
    return {
        id,
        n: id - 1,
        statement,
        response_kind: responseKind,
        answer_status:
            responseKind === "mcq" || responseKind === "short_answer"
                ? "known"
                : "not_applicable",
        choices:
            responseKind === "mcq"
                ? ["A", "B"]
                : responseKind === "short_answer"
                  ? ["42"]
                  : [],
        answer_index:
            responseKind === "mcq" ? 1 : responseKind === "short_answer" ? 0 : -1,
    } as ProblemRow;
}

function supabaseReturning(rows: ProblemRow[]): SupabaseClient<Database> {
    const query = {
        select() {
            return query;
        },
        eq() {
            return query;
        },
        order() {
            return query;
        },
        then(resolve: (value: { data: ProblemRow[]; error: null }) => void) {
            resolve({ data: rows, error: null });
        },
    };
    return {
        from() {
            return query;
        },
    } as unknown as SupabaseClient<Database>;
}

describe("fixed test loading", () => {
    test("retains a mixed response test and drops only blank statements", async () => {
        const rows = [
            testProblem(1, "mcq"),
            testProblem(2, "short_answer"),
            testProblem(3, "proof"),
            testProblem(4, "construction"),
            testProblem(5, "interactive"),
            testProblem(6, "proof", "   "),
        ];

        const loaded = await fetchTestProblems(supabaseReturning(rows), 10);

        expect(loaded.map((problem) => problem.id)).toEqual([1, 2, 3, 4, 5]);
    });
});

function settings(
    overrides: Partial<PracticeSettings> & {
        seriesIds: string[];
        seriesScopes: NonNullable<PracticeSettings["seriesScopes"]>;
    },
): PracticeSettings {
    return overrides as PracticeSettings;
}

describe("seriesScopeFilter problem numbers", () => {
    test("division-only filters stay unprefixed for the tests embed", () => {
        expect(
            seriesScopeFilter(
                settings({
                    seriesIds: ["10"],
                    seriesScopes: {
                        "10": { divisions: ["State"], formats: [] },
                    },
                }),
            ),
        ).toBe('and(series_id.eq.10,division.in.("State"))');
        expect(
            hasProblemNumberScope(
                settings({
                    seriesIds: ["10"],
                    seriesScopes: {
                        "10": { divisions: ["State"], formats: [] },
                    },
                }),
            ),
        ).toBe(false);
    });

    test("a shared range uses empty-embed aliases plus parent n", () => {
        const scoped = settings({
            seriesIds: ["10", "12"],
            seriesScopes: {
                "10": {
                    divisions: [],
                    formats: [],
                    problemNumbers: [21, 25],
                },
                "12": {
                    divisions: [],
                    formats: [],
                    problemNumbers: [21, 25],
                },
            },
        });
        expect(hasProblemNumberScope(scoped)).toBe(true);
        expect(seriesScopeEmbedAlias("10")).toBe("s10");
        expect(seriesScopeEmbedAlias("-940001")).toBe("sn940001");
        expect(seriesScopeSelectAliases(scoped)).toBe(
            ", s10:tests(), s12:tests()",
        );
        expect(
            seriesScopeFilter(scoped, { qualifyForProblemNumbers: true }),
        ).toBe(
            "and(n.gte.20,n.lte.24,s10.not.is.null),and(n.gte.20,n.lte.24,s12.not.is.null)",
        );
    });

    test("split ranges keep each series' own n", () => {
        expect(
            seriesScopeFilter(
                settings({
                    seriesIds: ["10", "15"],
                    seriesScopes: {
                        "10": {
                            divisions: [],
                            formats: [],
                            problemNumbers: [21, 25],
                        },
                        "15": {
                            divisions: [],
                            formats: [],
                            problemNumbers: [11, 15],
                        },
                    },
                }),
                { qualifyForProblemNumbers: true },
            ),
        ).toBe(
            "and(n.gte.20,n.lte.24,s10.not.is.null),and(n.gte.10,n.lte.14,s15.not.is.null)",
        );
    });

    test("review draws use the same problems-resource OR body", () => {
        const scoped = settings({
            seriesIds: ["10"],
            seriesScopes: {
                "10": {
                    divisions: ["A"],
                    formats: [],
                    problemNumbers: [1, 10],
                },
            },
        });
        expect(
            seriesScopeFilter(scoped, { qualifyForProblemNumbers: true }),
        ).toBe("and(n.gte.0,n.lte.9,s10.not.is.null)");
        expect(seriesScopeSelectAliases(scoped)).toBe(", s10:tests()");
    });
});

describe("seriesScopeFilter year range", () => {
    test("a year-only narrowing uses the tests-embed OR body", () => {
        const scoped = settings({
            seriesIds: ["10"],
            seriesScopes: {
                "10": {
                    divisions: [],
                    formats: [],
                    yearRange: [2010, 2020],
                },
            },
        });
        expect(hasSeriesScope(scoped)).toBe(true);
        expect(hasProblemNumberScope(scoped)).toBe(false);
        expect(seriesScopeFilter(scoped)).toBe(
            "and(series_id.eq.10,year.gte.2010,year.lte.2020)",
        );
    });

    test("split years stay on their own series", () => {
        expect(
            seriesScopeFilter(
                settings({
                    seriesIds: ["10", "12"],
                    seriesScopes: {
                        "10": {
                            divisions: [],
                            formats: [],
                            yearRange: [2010, 2015],
                        },
                        "12": {
                            divisions: [],
                            formats: [],
                            yearRange: [2020, 2024],
                        },
                    },
                }),
            ),
        ).toBe(
            "and(series_id.eq.10,year.gte.2010,year.lte.2015),and(series_id.eq.12,year.gte.2020,year.lte.2024)",
        );
    });

    test("year plus problem numbers keeps year on the embed alias", () => {
        const scoped = settings({
            seriesIds: ["10"],
            seriesScopes: {
                "10": {
                    divisions: [],
                    formats: [],
                    problemNumbers: [21, 25],
                    yearRange: [2010, 2020],
                },
            },
        });
        expect(hasProblemNumberScope(scoped)).toBe(true);
        expect(
            seriesScopeFilter(scoped, { qualifyForProblemNumbers: true }),
        ).toBe("and(n.gte.20,n.lte.24,s10.not.is.null)");
    });
});
