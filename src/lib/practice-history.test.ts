import { describe, expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { ProblemRow } from "$lib/library";
import {
    MAX_HISTORY_COUNT, applyPracticeHistoryFilters, createSession, defaultPracticeSettings,
    defaultReviewSettings, nextPracticeProblem, normalizePracticeHistory,
} from "$lib/trainer";

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
function catalog(problems: ProblemRow[]) {
    const requests: URL[] = [];
    const supabase = createClient<Database>("http://practice.test", "test-key", {
        auth: { persistSession: false },
        global: {
            fetch: async (input, init) => {
                const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
                requests.push(url);
                if (url.pathname.endsWith("user_problem_index")) {
                    const offset = Number(url.searchParams.get("offset") ?? 0);
                    const limit = Number(url.searchParams.get("limit") ?? problems.length);
                    const body = init?.method === "HEAD" ? null : JSON.stringify(problems.slice(offset, offset + limit).map((row) => ({ problem_id: row.id, canonical_id: row.canonical_id ?? null })));
                    return new Response(body, { headers: { "Content-Type": "application/json", "Content-Range": `0-${Math.max(0, problems.length - 1)}/${problems.length}` } });
                }
                const ids = url.searchParams.get("id")?.slice(4, -1).split(",").map(Number) ?? [];
                return Response.json(problems.filter((row) => ids.includes(row.id)));
            },
        },
    });
    return { supabase, requests };
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
        const { supabase, requests } = catalog([candidate(1, 3)]);
        const result = await nextPracticeProblem(supabase, { ...defaultReviewSettings(), adaptive: false }, createSession());
        expect(result.problem?.id).toBe(1);
        expect(result.progress?.times_reviewed).toBe(3);
        expect(result.source).toBe("review");
        const indices = requests.filter((url) => url.pathname.endsWith("user_problem_index"));
        expect(indices.length).toBe(2);
        for (const url of indices) {
            expect(url.searchParams.getAll("times_reviewed")).toEqual(["gte.1", `lte.${MAX_HISTORY_COUNT}`]);
            expect(url.searchParams.has("next_review_at")).toBe(false);

        }
        expect(indices[1].searchParams.get("order")).toBe("last_submission_at.asc.nullsfirst,problem_id.asc");
    });

    test("a malformed candidate cannot hide the eligible problem after it", async () => {
        const { supabase } = catalog([candidate(1, 1, 9), candidate(2, 1)]);
        const result = await nextPracticeProblem(supabase, { ...defaultReviewSettings(), adaptive: false }, createSession());
        expect(result.problem?.id).toBe(2);
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

    test("manual difficulty remains a hard filter rather than silently widening", async () => {
        const { supabase, requests } = catalog([]);
        await nextPracticeProblem(supabase, { ...defaultPracticeSettings(), adaptive: false, difficulty: [800, 1000] }, createSession(), 1500);
        expect(requests).toHaveLength(1);
        expect(requests[0].searchParams.getAll("rating")).toEqual(["gte.800", "lte.1000"]);
    });
});
