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

const selection: FactRef = { kind: "selection", text: "The student selected choice B." };

describe("inspectTurn", () => {
    const supabase = stubSupabase({ problems: [PROBLEM], user_submitted_feedback: [] });

    test("the system delivery is stable and excludes dynamic facts", async () => {
        const inspection = await inspectTurn(supabase, {
            refs: [selection],
            policy: "coaching",
            delivery: "system",
        });

        expect(inspection.text).toContain("You are the ProblemCloud coach");
        expect(inspection.text).toContain("Guide the student toward their own solution");
        expect(inspection.text).toContain("untrusted reference data");
        expect(inspection.text).not.toContain("selected choice B");
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
            refs: [selection],
            policy: "coaching",
            delivery: "inlined",
        });

        // Matches what `toAnyModelMessages` prefixes onto a historical user message.
        expect(inspection.text.startsWith("[Application context]")).toBe(true);
        expect(inspection.text).toContain("selected choice B");
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

    test("never injects the answer key", async () => {
        const coaching = await inspectTurn(supabase, {
            refs: [{ kind: "problem", id: 42 }],
            policy: "coaching",
            delivery: "system",
        });
        expect(coaching.text).not.toContain("Answer key");

        const locked = await inspectTurn(supabase, {
            refs: [{ kind: "problem", id: 42 }],
            policy: "test-locked",
            delivery: "system",
        });
        // Not merely hidden in the UI — absent from the string the model receives.
        expect(locked.text).not.toContain("Answer key");
        expect(locked.text).not.toContain("How many ways?");
        expect(locked.text).toContain("Do not reveal the answer key");
    });

    test("surfaces a degraded fact rather than silently dropping it", async () => {
        const empty = stubSupabase({ problems: [], user_submitted_feedback: [] });
        const inspection = await inspectTurn(empty, {
            refs: [{ kind: "problem", id: 999 }],
            policy: "coaching",
            delivery: "inlined",
        });
        expect(inspection.text).toContain("no longer available");
    });
});
