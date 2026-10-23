import { describe, expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "#lib/types/database.types.js";
import type { ProblemRow } from "#lib/library.js";
import {
    MAX_HISTORY_COUNT, applyPracticeHistoryFilters, createSession, defaultPracticeSettings,
    defaultReviewSettings, nextPracticeProblem, normalizePracticeHistory,
} from "#lib/trainer.js";

function recordedFilters() {
    const calls: unknown[][] = [];
    const query: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of ["gte", "lte", "eq", "is", "in", "or"]) {
        query[method] = (...args) => { calls.push([method, ...args]); return query; };
    }
    return { query, calls };
}

describe("history filter contract", () => {
    test("review excludes recent submissions, includes null dates, and has no due condition", () => {
        const { query, calls } = recordedFilters();
        applyPracticeHistoryFilters(query, defaultReviewSettings(), Date.parse("2026-10-14T12:00:00Z"));
        expect(calls).toContainEqual(["gte", "times_reviewed", 1]);
        expect(calls).toContainEqual(["lte", "times_reviewed", MAX_HISTORY_COUNT]);
        expect(calls).toContainEqual(["or", "last_submission_at.is.null,last_submission_at.lt.2026-10-07T12:00:00.000Z"]);
        expect(JSON.stringify(calls)).not.toContain("next_review_at");
        expect(JSON.stringify(calls)).not.toContain("last_reviewed_at");
    });

    test("within a period uses the same submission timestamp and supports exact attempt ranges", () => {
        const { query, calls } = recordedFilters();
        applyPracticeHistoryFilters(query, {
            ...defaultPracticeSettings(), timesReviewed: [2, 4],
            lastSubmissionDays: 7, lastSubmissionWindow: "within",
            mastery: ["unassessed", "needs_work"], historyEngagement: "revisit", lastOutcome: "incorrect",
        }, Date.parse("2026-10-14T12:00:00Z"));
        expect(calls).toContainEqual(["gte", "last_submission_at", "2026-10-07T12:00:00.000Z"]);
        expect(calls).toContainEqual(["gte", "times_reviewed", 2]);
        expect(calls).toContainEqual(["lte", "times_reviewed", 4]);
        expect(calls).toContainEqual(["or", "mastery.is.null,mastery.in.(needs_work)"]);
        expect(calls).toContainEqual(["eq", "engagement", "revisit"]);
        expect(calls).toContainEqual(["eq", "last_correct", false]);
    });

    test("neutral defaults have no attempt or time restriction and ignore Ignored", () => {
        const { query, calls } = recordedFilters();
        applyPracticeHistoryFilters(query, defaultPracticeSettings());
        expect(calls).toEqual([["eq", "is_ignored", false]]);
        const ignored = recordedFilters();
        applyPracticeHistoryFilters(ignored.query, { ...defaultPracticeSettings(), historyEngagement: "ignored" });
        expect(ignored.calls).toEqual([["eq", "engagement", "ignored"]]);
    });

    test("saved legacy modes become explicit filters, with old recency kept as within", () => {
        expect(normalizePracticeHistory({ mode: "new" }).timesReviewed).toEqual([0, 0]);
        const review = normalizePracticeHistory({ mode: "review" });
        expect(review.timesReviewed).toEqual([1, MAX_HISTORY_COUNT]);
        expect(review.lastSubmissionWindow).toBe("outside");
        expect(review.lastSubmissionDays).toBe(7);
        expect(normalizePracticeHistory({ mode: "review", lastSubmissionDays: 30 }).lastSubmissionWindow).toBe("within");
        const skipped = normalizePracticeHistory({ mode: "skipped" });
        expect(skipped.timesSkipped).toEqual([1, MAX_HISTORY_COUNT]);
        expect(skipped.timesCorrect).toEqual([0, 0]);
        expect(normalizePracticeHistory({ mode: "list", listEngagement: "revisit" }).historyEngagement).toBe("revisit");
        expect(normalizePracticeHistory({ mode: "mixed" }).timesReviewed).toBeNull();
        expect(normalizePracticeHistory(defaultPracticeSettings()).timesReviewed).toBeNull();
    });
});

/** Exercise real PostgREST serialization, without requiring a running database. */
function catalog(problems: ProblemRow[], respond?: (url: URL, request: Request) => Response | undefined) {
    const requests: URL[] = [];
    const httpRequests: Request[] = [];
    const supabase = createClient<Database>("http://practice.test", "test-key", {
        auth: { persistSession: false },
        global: {
            fetch: async (input, init) => {
                const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
                requests.push(url);
                const request = new Request(input, init);
                httpRequests.push(request);
                const response = respond?.(url, request);
                if (response) return response;
                if (url.pathname.endsWith("user_problem_index")) {
                    const offset = Number(url.searchParams.get("offset") ?? 0);
                    const limit = Number(url.searchParams.get("limit") ?? problems.length);
                    if (request.method === "HEAD") {
                        return new Response(null, { headers: { "Content-Range": `0-${Math.max(0, problems.length - 1)}/${problems.length}` } });
                    }
                    return Response.json(problems.slice(offset, offset + limit).map((row) => ({ problem_id: row.id, canonical_id: row.canonical_id ?? null })));
                }
                const ids = url.searchParams.get("id")?.slice(4, -1).split(",").map(Number) ?? [];
                return Response.json(problems.filter((row) => ids.includes(row.id)));
            },
        },
    });
    return { supabase, requests, httpRequests };
}

function candidate(id: number, attempts: number, answerIndex = 0): ProblemRow {
    return {
        id, canonical_id: null, statement: `Problem ${id}`, answer_status: "known",
        choices: ["42"], answer_index: answerIndex, tests: null,
        problem_progress: [{
            times_seen: attempts, times_reviewed: attempts, times_correct: 0, times_skipped: 0,
            last_correct: attempts ? false : null, last_submission_at: "2026-01-01T00:00:00Z",
            last_reviewed_at: null, next_review_at: "2099-01-01T00:00:00Z",
            solved: false, mastery: "needs_work", engagement: null,
        }],
    } as unknown as ProblemRow;
}

describe("unified practice draw", () => {
    test("previously attempted problems remain eligible with a future due date", async () => {
        const { supabase, requests, httpRequests } = catalog([candidate(1, 3), candidate(2, 1)]);
        const result = await nextPracticeProblem(supabase, { ...defaultReviewSettings(), adaptive: false }, createSession());
        expect(result.problem?.id).toBe(1);
        expect(result.progress?.times_reviewed).toBe(3);
        expect(result.source).toBe("review");
        const indices = requests.filter((url) => url.pathname.endsWith("user_problem_index"));
        expect(indices).toHaveLength(1);
        for (const url of indices) {
            expect(url.searchParams.getAll("times_reviewed")).toEqual(["gte.1", `lte.${MAX_HISTORY_COUNT}`]);
            expect(url.searchParams.has("next_review_at")).toBe(false);

        }
        expect(indices[0].searchParams.get("order")).toBe("last_submission_at.asc.nullsfirst,problem_id.asc");
        expect(requests).toHaveLength(2);
        expect(requests[1].searchParams.get("id")).toBe("in.(1)");
        expect(httpRequests.every((request) => request.method === "GET" && !request.headers.get("Prefer")?.includes("count="))).toBe(true);
    });

    test("a malformed candidate cannot hide the eligible problem after it", async () => {
        const { supabase } = catalog([candidate(1, 1, 9), candidate(2, 1)]);
        const result = await nextPracticeProblem(supabase, { ...defaultReviewSettings(), adaptive: false }, createSession());
        expect(result.problem?.id).toBe(2);
    });

    test("oldest scans multiple invalid pages and preserves index order through hydration", async () => {
        const problems = Array.from({ length: 52 }, (_, index): ProblemRow => {
            const row = candidate(index + 1, 2);
            if (index % 3 === 0) return { ...row, statement: " \n\t" };
            if (index % 3 === 1) return { ...row, answer_status: "source_missing" as const };
            return { ...row, answer_index: 9 };
        }).concat(candidate(53, 2), candidate(54, 2));
        const { supabase, requests, httpRequests } = catalog(problems, (url) => {
            if (!url.pathname.endsWith("problems")) return;
            const ids = url.searchParams.get("id")!.slice(4, -1).split(",").map(Number);
            // Simulate a disappeared first row and unordered hydration responses.
            return Response.json(problems.filter((row) => row.id !== 1 && ids.includes(row.id)).reverse());
        });
        const session = createSession(); session.shownIds.add(99);
        const result = await nextPracticeProblem(supabase, {
            ...defaultReviewSettings(), adaptiveRange: 100, topic: ["A"],
            verifiedOnly: true, computational: true, solutionAvailability: "with",
        }, session, 1500);
        expect(result.problem?.id).toBe(53);
        const indices = requests.filter((url) => url.pathname.endsWith("user_problem_index"));
        expect(indices.map((url) => url.searchParams.get("offset"))).toEqual(["0", "25", "50"]);
        for (const url of indices) {
            expect(url.searchParams.get("limit")).toBe("25");
            expect(url.searchParams.get("order")).toBe("last_submission_at.asc.nullsfirst,problem_id.asc");
            expect(url.searchParams.get("canonical_id")).toBe("is.null");
            expect(url.searchParams.get("problem_id")).toBe("not.in.(99)");
            expect(url.searchParams.get("has_statement")).toBe("eq.true");
            expect(url.searchParams.get("has_choices")).toBe("eq.true");
            expect(url.searchParams.get("answer_status")).toBe("eq.known");
            expect(url.searchParams.get("topic")).toBe("in.(A)");
            expect(url.searchParams.get("verified")).toBe("eq.true");
            expect(url.searchParams.get("is_computational")).toBe("eq.true");
            expect(url.searchParams.get("has_solution")).toBe("eq.true");
            expect(url.searchParams.getAll("rating")).toEqual(["gte.1400", "lte.1600"]);
            expect(url.searchParams.getAll("or")).toEqual(indices[0].searchParams.getAll("or"));
            expect(url.searchParams.getAll("times_reviewed")).toEqual(["gte.1", `lte.${MAX_HISTORY_COUNT}`]);
        }
        const hydration = requests.filter((url) => url.pathname.endsWith("problems"));
        expect(hydration).toHaveLength(6);
        expect(hydration.filter((_, index) => index % 2 === 0).map((url) => url.searchParams.get("id"))).toEqual(["in.(1)", "in.(26)", "in.(51)"]);
        expect(httpRequests.every((request) => request.method === "GET" && !request.headers.get("Prefer")?.includes("count="))).toBe(true);
    });

    for (const length of [1, 25, 50, 51]) {
        test(`oldest exhausts ${length} invalid rows without wrapping`, async () => {
            const { supabase, requests } = catalog(Array.from({ length }, (_, index) => candidate(index + 1, 1, 9)));
            const result = await nextPracticeProblem(supabase, { ...defaultReviewSettings(), adaptive: false }, createSession());
            expect(result).toEqual({ problem: null, progress: null, source: "practice" });
            const indices = requests.filter((url) => url.pathname.endsWith("user_problem_index"));
            expect(indices.map((url) => Number(url.searchParams.get("offset")))).toEqual(
                Array.from({ length: Math.floor(length / 25) + 1 }, (_, index) => index * 25),
            );
        });
    }

    for (const kind of ["empty array", "null"]) {
        test(`oldest returns null for an empty index response: ${kind}`, async () => {
            const { supabase, requests, httpRequests } = catalog([], () => Response.json(kind === "null" ? null : []));
            const result = await nextPracticeProblem(supabase, { ...defaultReviewSettings(), adaptive: false }, createSession());
            expect(result).toEqual({ problem: null, progress: null, source: "practice" });
            expect(requests).toHaveLength(1);
            expect(httpRequests[0].method).toBe("GET");
        });
    }

    for (const stage of ["first page", "later page", "first hydration", "rest hydration"]) {
        test(`oldest propagates errors from ${stage} without falling back`, async () => {
            const { supabase, requests } = catalog(
                Array.from({ length: 26 }, (_, index) => candidate(index + 1, 1, 9)),
                (url) => {
                    const isIndex = url.pathname.endsWith("user_problem_index");
                    const fails = stage === "first page" ? isIndex && url.searchParams.get("offset") === "0"
                        : stage === "later page" ? isIndex && url.searchParams.get("offset") === "25"
                        : stage === "first hydration" ? !isIndex && url.searchParams.get("id") === "in.(1)"
                        : !isIndex && url.searchParams.get("id")?.startsWith("in.(2,");
                    if (fails) return Response.json({ message: `${stage} failed`, code: "XX000" }, { status: 400 });
                },
            );
            await expect(nextPracticeProblem(supabase, defaultReviewSettings(), createSession(), 1500)).rejects.toMatchObject({ message: `${stage} failed` });
            const indices = requests.filter((url) => url.pathname.endsWith("user_problem_index"));
            expect(indices).toHaveLength(stage === "later page" ? 2 : 1);
            expect(indices.every((url) => url.searchParams.get("order") === "last_submission_at.asc.nullsfirst,problem_id.asc")).toBe(true);
        });
    }

    for (const randomValue of [0, 0.5, 0.999999]) {
        test(`random keeps exact-count offsets across the full catalog (${randomValue})`, async () => {
            const { supabase, requests, httpRequests } = catalog(Array.from({ length: 60 }, (_, index) => candidate(index + 1, 0)));
            const random = Math.random;
            Math.random = () => randomValue;
            try {
                const result = await nextPracticeProblem(supabase, { ...defaultPracticeSettings(), adaptive: false }, createSession());
                const offset = Math.floor(randomValue * 60);
                expect(result.problem?.id).toBe(offset + 1);
                expect(requests).toHaveLength(3);
                expect(httpRequests[0].method).toBe("HEAD");
                expect(httpRequests[0].headers.get("Prefer")).toContain("count=exact");
                expect(requests[1].searchParams.get("offset")).toBe(String(offset));
                expect(requests[1].searchParams.get("order")).toBe("problem_id.asc");
                expect(requests[2].searchParams.get("id")).toBe(`in.(${offset + 1})`);
            } finally {
                Math.random = random;
            }
        });
    }

    for (const eligible of [true, false]) {
        test(`random wraps past an invalid short tail and stops at its starting offset (eligible=${eligible})`, async () => {
            const problems = Array.from({ length: 60 }, (_, index) => candidate(index + 1, 1, 9));
            if (eligible) problems[52] = candidate(53, 1);
            const { supabase, requests, httpRequests } = catalog(problems);
            const random = Math.random;
            Math.random = () => 0.9;
            try {
                const result = await nextPracticeProblem(supabase, { ...defaultPracticeSettings(), adaptive: false }, createSession());
                expect(result.problem?.id ?? null).toBe(eligible ? 53 : null);
                expect(httpRequests[0].method).toBe("HEAD");
                const pages = requests.filter((url) => url.pathname.endsWith("user_problem_index")).slice(1);
                expect(pages.map((url) => [Number(url.searchParams.get("offset")), Number(url.searchParams.get("limit"))])).toEqual([[54, 6], [0, 25], [25, 25], [50, 4]]);
            } finally {
                Math.random = random;
            }
        });
    }

    test("oldest hydrates an alias with its canonical progress and rating", async () => {
        const alias = Object.assign(candidate(1, 0), {
            canonical_id: 99,
            canonical: {
                problem_progress: [{ times_reviewed: 3 }],
                problem_ratings: [{ scope: "overall", rating: 1450 }],
            },
        });
        const { supabase, requests } = catalog([alias]);
        const result = await nextPracticeProblem(supabase, {
            ...defaultReviewSettings(), adaptive: false, seriesIds: ["10"],
        }, createSession());
        expect(result.problem?.id).toBe(1);
        expect(result.problem?.canonical_id).toBe(99);
        expect(result.problem?.rating?.rating).toBe(1450);
        expect(result.progress?.times_reviewed).toBe(3);
        expect(result.source).toBe("review");
        expect(requests[0].searchParams.has("canonical_id")).toBe(false);
        expect(requests[1].searchParams.get("select")).toContain("canonical:canonical_id(");
    });

    test("oldest retains the nearest-rated fallback after exhausting its band", async () => {
        const problems = [
            Object.assign(candidate(1, 2), { problem_ratings: [{ scope: "overall", rating: 1900 }] }),
            Object.assign(candidate(2, 2), { problem_ratings: [{ scope: "overall", rating: 1250 }] }),
        ];
        const { supabase, requests, httpRequests } = catalog(problems, (url) => {
            if (!url.pathname.endsWith("user_problem_index")) return;
            const rating = url.searchParams.getAll("rating");
            if (rating.length === 2) return Response.json([]);
            return Response.json([{ problem_id: rating[0] === "gte.1500" ? 1 : 2 }]);
        });
        const session = createSession(); session.shownIds.add(99);
        const result = await nextPracticeProblem(supabase, {
            ...defaultReviewSettings(), seriesIds: ["10"],
            seriesScopes: { "10": { divisions: ["A"], formats: [], yearRange: [2010, 2020] } },
        }, session, 1500);
        expect(result.problem?.id).toBe(2);
        const indices = requests.filter((url) => url.pathname.endsWith("user_problem_index"));
        expect(indices).toHaveLength(3);
        expect(indices.map((url) => url.searchParams.getAll("rating"))).toEqual([
            ["gte.1300", "lte.1700"], ["gte.1500"], ["lt.1500"],
        ]);
        expect(indices.map((url) => url.searchParams.get("order"))).toEqual([
            "last_submission_at.asc.nullsfirst,problem_id.asc", "rating.asc,problem_id.asc", "rating.desc,problem_id.asc",
        ]);
        for (const url of indices) {
            expect(url.searchParams.getAll("or")).toEqual(indices[0].searchParams.getAll("or"));
            expect(url.searchParams.getAll("times_reviewed")).toEqual(["gte.1", `lte.${MAX_HISTORY_COUNT}`]);
            expect(url.searchParams.get("problem_id")).toBe("not.in.(99)");
        }
        expect(httpRequests.every((request) => request.method === "GET")).toBe(true);
    });

    test("oldest still draws without a rating band when no rated fallback exists", async () => {
        const { supabase, requests, httpRequests } = catalog([candidate(1, 1)], (url) => {
            if (url.pathname.endsWith("user_problem_index") && url.searchParams.has("rating")) return Response.json([]);
        });
        const result = await nextPracticeProblem(supabase, defaultReviewSettings(), createSession(), 1500);
        expect(result.problem?.id).toBe(1);
        const indices = requests.filter((url) => url.pathname.endsWith("user_problem_index"));
        expect(indices).toHaveLength(4);
        expect(indices[3].searchParams.has("rating")).toBe(false);
        expect(indices[3].searchParams.get("order")).toBe("last_submission_at.asc.nullsfirst,problem_id.asc");
        expect(indices[3].searchParams.getAll("times_reviewed")).toEqual(["gte.1", `lte.${MAX_HISTORY_COUNT}`]);
        expect(httpRequests.every((request) => request.method === "GET" && !request.headers.get("Prefer")?.includes("count="))).toBe(true);
    });

    test("series clauses retain their own years, divisions and problem numbers", async () => {
        const { supabase, requests } = catalog([candidate(1, 0)]);
        const session = createSession(); session.shownIds.add(10);
        await nextPracticeProblem(supabase, {
            ...defaultPracticeSettings(), adaptive: false, historyOrder: "oldest",
            seriesIds: ["10", "12"], seriesScopes: {
                "10": { divisions: ["A"], formats: [], yearRange: [2010, 2015], problemNumbers: [1, 10] },
                "12": { divisions: ["B"], formats: [], yearRange: [2020, 2024] },
            },
        }, session);
        const ors = requests[0].searchParams.getAll("or");
        expect(ors).toContain('(and(series_id.eq.10,division.in.("A"),n.gte.0,n.lte.9,year.gte.2010,year.lte.2015),and(series_id.eq.12,division.in.("B"),year.gte.2020,year.lte.2024))');
        expect(ors).toContain("(canonical_id.is.null,canonical_id.not.in.(10))");
        expect(requests[0].searchParams.get("problem_id")).toBe("not.in.(10)");
    });

    test("shown problems exclusion omits redundant canonical_id or-clause when series is unconstrained", async () => {
        const { supabase, requests } = catalog([candidate(1, 0)]);
        const session = createSession(); session.shownIds.add(10);
        await nextPracticeProblem(supabase, {
            ...defaultPracticeSettings(), adaptive: false,
        }, session);
        const ors = requests[0].searchParams.getAll("or");
        expect(ors).not.toContain("(canonical_id.is.null,canonical_id.not.in.(10))");
        expect(requests[0].searchParams.get("canonical_id")).toBe("is.null");
        expect(requests[0].searchParams.get("problem_id")).toBe("not.in.(10)");
    });

    for (const historyOrder of ["random", "oldest"] as const) {
        test(`manual difficulty remains a hard filter rather than silently widening (${historyOrder})`, async () => {
            const { supabase, requests } = catalog([]);
            await nextPracticeProblem(supabase, { ...defaultPracticeSettings(), adaptive: false, historyOrder, difficulty: [800, 1000] }, createSession(), 1500);
            expect(requests).toHaveLength(1);
            expect(requests[0].searchParams.getAll("rating")).toEqual(["gte.800", "lte.1000"]);
        });
    }
});
