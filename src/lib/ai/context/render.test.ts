import { describe, expect, test } from "bun:test";
import type { ProblemFact, ResolvedFact } from "./facts";
import { renderFacts, renderProblem } from "./render";

const problem: ProblemFact = {
    kind: "problem",
    id: 42,
    statement: "What is $6\\cdot 7$?",
    choices: ["40", "41", "42", "43"],
    answer: "C. 42",
    topic: "Algebra",
    source: "Example Test · Example 1",
    rating: 1234,
    warnings: [],
};

describe("typed context rendering", () => {
    test("test-locked policy omits the answer at the enforcement seam", () => {
        expect(renderProblem(problem, "coaching")).toContain("Answer key: C. 42");
        expect(renderProblem(problem, "test-locked")).not.toContain("Answer key:");
    });

    test("attempt facts preserve ephemeral work that cannot be re-derived", () => {
        const facts: ResolvedFact[] = [
            {
                kind: "attempt",
                problemId: 42,
                answer: "B. 41",
                triesUsed: 1,
                submitted: false,
                revealed: false,
                elapsedMs: 12_400,
            },
        ];
        const rendered = renderFacts(facts, "coaching");
        expect(rendered).toContain("Current answer: B. 41");
        expect(rendered).toContain("Wrong tries used: 1");
        expect(rendered).toContain("Elapsed: 12 seconds");
    });

    test("degraded warnings are made explicit to the model", () => {
        const rendered = renderProblem(
            {
                ...problem,
                warnings: [
                    {
                        code: "answer_unverified",
                        message: "This problem's answer has been reported as incorrect; treat it as unverified.",
                    },
                ],
            },
            "coaching",
        );
        expect(rendered).toContain("reported as incorrect");
    });
});
