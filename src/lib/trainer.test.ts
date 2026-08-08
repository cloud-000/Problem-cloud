import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { ProblemRow } from "$lib/library";
import { fetchTestProblems } from "$lib/trainer";

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
