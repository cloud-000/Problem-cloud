import { describe, expect, test } from "bun:test";
import type { ProblemFact, ResolvedFact } from "./facts";
import { renderFacts, renderProblem } from "./render";

const problem: ProblemFact = {
    kind: "problem",
    id: 42,
    statement: "What is $6\\cdot 7$?",
    choices: ["40", "41", "42", "43"],
    warnings: [],
};

describe("typed context rendering", () => {
    test("problem scope contains only the statement and choices", () => {
        const rendered = renderProblem(problem, "coaching");
        expect(rendered).toContain("What is $6\\cdot 7$?");
        expect(rendered).toContain("C. 42");
        expect(rendered).not.toContain("Problem 42");
        expect(rendered).not.toContain("Answer key");
    });

    test("oversized choices stay identifiable and truncate visibly", () => {
        const rendered = renderProblem(
            {
                ...problem,
                choices: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map(
                    (choice) => `${choice} ${"detail ".repeat(300)}`,
                ),
            },
            "coaching",
        );

        expect(rendered).toContain("A. Alpha");
        expect(rendered).toContain("B. Beta");
        expect(rendered).toContain("C. Gamma");
        expect(rendered).toContain("D. Delta");
        expect(rendered).toContain("E. Epsilon");
        expect(rendered).toContain("[truncated]");
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
