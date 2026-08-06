import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { FactRef } from "./facts";
import { inspectTurn } from "./inspect";

/**
 * Minimal PostgREST-shaped stub: the builder is chainable *and* awaitable, so both
 * `.eq(…).maybeSingle()` and `await …limit(1)` resolve without knowing which one a
 * resolver reached for.
 */
function stubSupabase(tables: Record<string, unknown[]>): SupabaseClient<Database> {
    const from = (table: string) => {
        const rows = tables[table] ?? [];
        const chain: Record<string, unknown> = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: () => chain,
            maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }),
            then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data: rows }),
        };
        return chain;
    };
    return { from } as unknown as SupabaseClient<Database>;
}

const PROBLEM = {
    id: 42,
    statement: "How many ways?",
    choices: ["10", "20", "30", "40", "50"],
    answer_index: 2,
    answer_status: "verified",
    topic: "combinatorics",
    problem_ratings: [{ scope: "overall", rating: 1500 }],
    tests: { name: "AMC 10A", series: { name: "AMC" } },
};

const attempt: FactRef = {
    kind: "attempt",
    problemId: 42,
    answer: "B",
    triesUsed: 1,
    submitted: false,
    revealed: false,
    elapsedMs: 65_000,
};

describe("inspectTurn", () => {
    const supabase = stubSupabase({ problems: [PROBLEM], user_submitted_feedback: [] });

    test("the system delivery is the whole system message, prompt and facts together", async () => {
        const inspection = await inspectTurn(supabase, {
            refs: [attempt],
            policy: "coaching",
            delivery: "system",
        });

        expect(inspection.text).toContain("You are the ProblemCloud coach");
        expect(inspection.text).toContain("Guide the student toward their own solution");
        // The whole point of AttemptFact: values that exist nowhere else once the
        // trainer's memory is gone have to survive into the prompt.
        expect(inspection.text).toContain("Current answer: B");
        expect(inspection.text).toContain("Wrong tries used: 1");
        expect(inspection.text).toContain("Elapsed: 65 seconds");
        expect(inspection.factCount).toBe(1);
    });

    test("the system message carries the prompt even with no facts at all", async () => {
        const inspection = await inspectTurn(supabase, {
            refs: [],
            policy: "coaching",
            delivery: "system",
        });
        expect(inspection.text).toContain("You are the ProblemCloud coach");
        expect(inspection.factCount).toBe(0);
    });

    test("the inlined delivery is the history prefix, never a second system message", async () => {
        const inspection = await inspectTurn(supabase, {
            refs: [attempt],
            policy: "coaching",
            delivery: "inlined",
        });

        // Matches what `toAnyModelMessages` prefixes onto a historical user message.
        expect(inspection.text.startsWith("[Facts active for this historical turn]")).toBe(true);
        expect(inspection.text).toContain("Current answer: B");
        expect(inspection.text).not.toContain("You are the ProblemCloud coach");
    });

    test("an inlined turn that carried nothing contributes nothing", async () => {
        const inspection = await inspectTurn(supabase, {
            refs: [],
            policy: "coaching",
            delivery: "inlined",
        });
        expect(inspection.text).toBe("");
        expect(inspection.factCount).toBe(0);
    });

    test("shows the answer key under coaching and its absence under test-locked", async () => {
        const coaching = await inspectTurn(supabase, {
            refs: [{ kind: "problem", id: 42 }],
            policy: "coaching",
            delivery: "system",
        });
        expect(coaching.text).toContain("Answer key: C. 30");

        const locked = await inspectTurn(supabase, {
            refs: [{ kind: "problem", id: 42 }],
            policy: "test-locked",
            delivery: "system",
        });
        // Not merely hidden in the UI — absent from the string the model receives.
        expect(locked.text).not.toContain("Answer key");
        expect(locked.text).toContain("How many ways?");
        expect(locked.text).toContain("Do not reveal the answer key");
    });

    test("surfaces a degraded fact rather than silently dropping it", async () => {
        const empty = stubSupabase({ problems: [], user_submitted_feedback: [] });
        const inspection = await inspectTurn(empty, {
            refs: [{ kind: "problem", id: 999 }],
            policy: "coaching",
            delivery: "system",
        });
        expect(inspection.text).toContain("no longer available");
    });
});
