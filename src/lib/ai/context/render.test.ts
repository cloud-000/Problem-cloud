import { describe, expect, test } from "bun:test";
import type { ProblemFact } from "./facts";
import { renderProblem } from "./render";
import { ELISION, FIELD, TAG } from "../prompt";

const problem: ProblemFact = {
    kind: "problem",
    id: 42,
    statement: "What is $6\\cdot 7$?",
    choices: ["40", "41", "42", "43"],
    answerIndex: 2,
    warnings: [],
};

const freeResponse: ProblemFact = {
    ...problem,
    statement: "Compute the remainder when $7^{100}$ is divided by 13.",
    choices: ["9"],
    answerIndex: 0,
};

describe("typed context rendering", () => {
    test("problem scope contains the statement, choices and answer", () => {
        const rendered = renderProblem(problem);
        expect(rendered).toContain("What is $6\\cdot 7$?");
        expect(rendered).toContain("C. 42");
        expect(rendered.startsWith(`[${TAG.problem}]`)).toBe(true);
        expect(rendered).not.toContain("Problem 42");
    });

    test("a multiple-choice answer is named by its letter, as the student sees it", () => {
        expect(renderProblem(problem)).toContain(`${FIELD.answer}: C`);
        // The letter, not the option text restated.
        expect(renderProblem(problem)).not.toContain(`${FIELD.answer}: 42`);
    });

    test("a free-response answer is the value, and never a choice", () => {
        // A single-entry `choices` array is a computational problem whose lone element
        // IS the answer. It belongs on the answer field, not lettered as an option the
        // student never saw.
        const rendered = renderProblem(freeResponse);

        expect(rendered).toContain("Compute the remainder");
        expect(rendered).toContain(`${FIELD.answer}: 9`);
        expect(rendered).not.toContain("A. 9");
    });

    test("an active test is never sent the answer key at all", () => {
        // Withheld structurally, not by asking the model nicely — a BYOK model may be
        // small, local, or uncensored, so absent data is the only real control.
        for (const fact of [problem, freeResponse]) {
            const rendered = renderProblem(fact, "test-locked");
            expect(rendered).not.toContain(FIELD.answer);
        }
        // The free-response value has nowhere else to hide, so nothing but the statement.
        expect(renderProblem(freeResponse, "test-locked")).toBe(
            `[${TAG.problem}]\n${freeResponse.statement}`,
        );
        // Choices stay visible under lock — the options are on the student's screen.
        expect(renderProblem(problem, "test-locked")).toContain("C. 42");
    });

    test("an unknown answer renders no answer field", () => {
        for (const answerIndex of [null, -1, 99]) {
            expect(renderProblem({ ...problem, answerIndex })).not.toContain(FIELD.answer);
        }
    });

    test("an answerless stub renders no options either", () => {
        for (const choices of [[], null]) {
            const rendered = renderProblem({ ...problem, choices, answerIndex: null });
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
