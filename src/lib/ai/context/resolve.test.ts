import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { ContextSnapshot } from "./facts";
import type { NormalizedAIMessage } from "../types";
import { compileContextFrames, HISTORY_CONTEXT_MAX_CHARS } from "./resolve";

function problem(id: number, statement = `Statement ${id}`, choices = [`Choice ${id}`]) {
    return { id, statement, choices };
}

function stubSupabase(
    rows: unknown[],
    calls: string[] = [],
    requestedIds: number[] = [],
): SupabaseClient<Database> {
    return {
        from(table: string) {
            calls.push(table);
            let id: number | undefined;
            const chain = {
                select: () => chain,
                eq: (_column: string, value: number) => {
                    id = value;
                    return chain;
                },
                maybeSingle: () => {
                    if (id !== undefined) requestedIds.push(id);
                    return Promise.resolve({
                        data: rows.find((row) => (row as { id?: number }).id === id) ?? null,
                    });
                },
            };
            return chain;
        },
    } as unknown as SupabaseClient<Database>;
}

const snapshot = (id: number): ContextSnapshot => ({
    version: 2,
    policy: "coaching",
    scope: [{ kind: "problem", id }],
    attachments: [],
});

function withSelection(id: number, text: string): ContextSnapshot {
    return {
        ...snapshot(id),
        attachments: [{ kind: "selection", text }],
    };
}

const user = (id: string, contextSnapshot: ContextSnapshot): NormalizedAIMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
    status: "complete",
    createdAt: "2026-08-06T00:00:00.000Z",
    contextSnapshot,
});

function allContext(result: Awaited<ReturnType<typeof compileContextFrames>>): string[] {
    return [
        ...result.history.map((message) => message.renderedContext ?? ""),
        result.renderedContext,
    ];
}

function occurrences(values: string[], needle: string): number {
    return values.reduce((total, value) => total + value.split(needle).length - 1, 0);
}

describe("context frame compiler", () => {
    test("puts the current effective scope beside the current prompt exactly once", async () => {
        const calls: string[] = [];
        const result = await compileContextFrames(
            stubSupabase([problem(42)], calls),
            [user("one", snapshot(42)), user("two", snapshot(42))],
            snapshot(42),
        );

        expect(result.history[0]?.renderedContext).toBeUndefined();
        expect(result.history[1]?.renderedContext).toBeUndefined();
        expect(result.renderedContext).toContain("Statement 42");
        expect(occurrences(allContext(result), "Statement 42")).toBe(1);
        expect(calls).toEqual(["problems"]);
    });

    test("compares scope epochs by refs even when two problems render identically", async () => {
        const identical = "The visible statement is identical.";
        const result = await compileContextFrames(
            stubSupabase([
                problem(7, identical, ["Same choice"]),
                problem(42, identical, ["Same choice"]),
            ]),
            [user("older", snapshot(7)), user("current-epoch", snapshot(42))],
            snapshot(42),
        );

        expect(result.history[0]?.renderedContext).toContain(identical);
        expect(result.history[1]?.renderedContext).toBeUndefined();
        expect(result.renderedContext).toContain(identical);
        expect(occurrences(allContext(result), identical)).toBe(2);
    });

    test("keeps historical attachments beside their owning turns", async () => {
        const withAttempt: ContextSnapshot = {
            ...snapshot(42),
            attachments: [
                {
                    kind: "attempt",
                    problemId: 42,
                    answer: "B",
                    triesUsed: 1,
                    submitted: false,
                    revealed: false,
                    elapsedMs: 5_000,
                },
            ],
        };
        const result = await compileContextFrames(
            stubSupabase([problem(42)]),
            [user("plain", snapshot(42)), user("attached", withAttempt)],
            snapshot(42),
        );

        expect(result.history[0]?.renderedContext).toBeUndefined();
        expect(result.history[1]?.renderedContext).toContain("Current answer: B");
        expect(result.history[1]?.renderedContext).not.toContain("Statement 42");
        expect(result.renderedContext).toContain("Statement 42");
    });

    test("never budgets away a current-turn attachment", async () => {
        const longStatement = "A clause outside math. $x^2+y^2=z^2$. ".repeat(400);
        const current = withSelection(42, "CURRENT-SELECTION " + "work ".repeat(1_000));
        const result = await compileContextFrames(
            stubSupabase([problem(42, longStatement, ["Alpha", "Beta", "Gamma"])]),
            [user("earlier", snapshot(42))],
            current,
        );

        expect(result.renderedContext).toContain("Problem currently in view:");
        expect(result.renderedContext).toContain("CURRENT-SELECTION");
        expect(result.renderedContext).toContain("Selected context:");
        expect(result.renderedContext).toContain("[truncated]");
    });

    test("three 3,990-character attachments cannot displace the current problem", async () => {
        const selection = (label: string) => `${label} ${label[0].repeat(3_989 - label.length)}`;
        const result = await compileContextFrames(
            stubSupabase([problem(7), problem(42)]),
            [
                user("old-scope", snapshot(7)),
                user("first", withSelection(42, selection("FIRST"))),
                user("second", withSelection(42, selection("SECOND"))),
            ],
            withSelection(42, selection("CURRENT")),
        );
        const contexts = allContext(result);

        expect(result.renderedContext).toContain("Statement 42");
        expect(result.renderedContext).toContain("CURRENT");
        expect(result.history[1]?.renderedContext).toContain("FIRST");
        expect(result.history[2]?.renderedContext).toContain("SECOND");
        expect(occurrences(contexts, "Statement 42")).toBe(1);
        expect(occurrences(contexts, "Statement 7")).toBe(0);
        expect(contexts.some((context) => context.includes("[truncated]"))).toBe(true);
        expect(contexts.reduce((total, context) => total + context.length, 0)).toBeLessThanOrEqual(
            HISTORY_CONTEXT_MAX_CHARS,
        );
    });

    test("long statements truncate visibly without dropping choices or splitting LaTeX", async () => {
        const statement = "A long clause followed by $x^2+y^2=z^2$. ".repeat(500);
        const result = await compileContextFrames(
            stubSupabase([problem(42, statement, ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"])]),
            [],
            snapshot(42),
        );

        expect(result.renderedContext).toContain("[statement truncated]");
        expect(result.renderedContext).toContain("A. Alpha");
        expect(result.renderedContext).toContain("B. Beta");
        expect(result.renderedContext).toContain("C. Gamma");
        expect(result.renderedContext).toContain("D. Delta");
        expect(result.renderedContext).toContain("E. Epsilon");
        expect((result.renderedContext.match(/\$/g)?.length ?? 0) % 2).toBe(0);
    });

    test("bounds history before resolving and rebases the first retained old scope", async () => {
        const requestedIds: number[] = [];
        const history = [
            user("discarded", snapshot(7)),
            ...Array.from({ length: 20 }, (_, index) => user(`retained-${index}`, snapshot(42))),
        ];
        const result = await compileContextFrames(
            stubSupabase([problem(7), problem(42), problem(99)], [], requestedIds),
            history,
            snapshot(99),
        );

        expect(result.history).toHaveLength(20);
        expect(result.history[0]?.id).toBe("retained-0");
        expect(result.history[0]?.renderedContext).toContain("Statement 42");
        expect(result.renderedContext).toContain("Statement 99");
        expect(requestedIds).not.toContain(7);
    });
});
