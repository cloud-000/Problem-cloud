import { describe, expect, test } from "bun:test";
import type { ProblemFact } from "./facts";
import { renderProblem } from "./render";

const problem: ProblemFact = {
    kind: "problem",
    id: 42,
    statement: "What is $6\\cdot 7$?",
    choices: ["40", "41", "42", "43"],
    warnings: [],
};

describe("typed context rendering", () => {
    test("problem scope contains only the statement and choices", () => {
        const rendered = renderProblem(problem);
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
        );

        expect(rendered).toContain("A. Alpha");
        expect(rendered).toContain("B. Beta");
        expect(rendered).toContain("C. Gamma");
        expect(rendered).toContain("D. Delta");
        expect(rendered).toContain("E. Epsilon");
        expect(rendered).toContain("[truncated]");
    });

    test("degraded warnings are made explicit to the model", () => {
        const rendered = renderProblem(
            {
                ...problem,
                warnings: [
                    {
                        code: "missing",
                        message: "Some problem context is no longer available.",
                    },
                ],
            },
        );
        expect(rendered).toContain("no longer available");
    });
});
