import { describe, expect, test } from "bun:test";
import type { ProblemFact } from "./facts";
import { renderProblem } from "./render";
import { ELISION, TAG } from "../prompt";

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
        expect(rendered.startsWith(`[${TAG.problem}]`)).toBe(true);
        expect(rendered).not.toContain("Problem 42");
        expect(rendered).not.toContain("Answer key");
    });

    test("a free-response answer is never rendered as a choice", () => {
        // A single-entry `choices` array is a computational problem whose lone element
        // IS the answer key. Lettering it both invents an option the student never saw
        // and hands the model the solution — under test-locked policy especially.
        const rendered = renderProblem({
            ...problem,
            statement: "Compute the remainder when $7^{100}$ is divided by 13.",
            choices: ["9"],
        });

        expect(rendered).toContain("Compute the remainder");
        expect(rendered).not.toContain("9");
        expect(rendered).not.toContain("A.");
    });

    test("an answerless stub renders no options either", () => {
        for (const choices of [[], null]) {
            const rendered = renderProblem({ ...problem, choices });
            expect(rendered).toBe(`[${TAG.problem}]\n${problem.statement}`);
        }
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
        expect(rendered).toContain(ELISION.text);
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
