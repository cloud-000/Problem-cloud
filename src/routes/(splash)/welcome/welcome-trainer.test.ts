import { describe, expect, test } from "bun:test";
import {
    WELCOME_STATEMENT_MAX,
    WELCOME_TRAINER_LIMIT,
    isWelcomeTrainerProblem,
    pickWelcomeProblems,
    welcomeProblemSource,
    type WelcomeProblem,
} from "./welcome-trainer";

function problem(overrides: Partial<WelcomeProblem> & Pick<WelcomeProblem, "id" | "n">): WelcomeProblem {
    return {
        statement: "What is $1+1$?",
        choices: ["1", "2", "3", "4", "5"],
        answer_index: 1,
        answer_status: "known",
        response_kind: "mcq",
        tests: { name: "2024 AMC 10A", year: 2024 },
        ...overrides,
    };
}

describe("isWelcomeTrainerProblem", () => {
    test("keeps a short known MCQ", () => {
        expect(isWelcomeTrainerProblem(problem({ id: 1, n: 0 }))).toBe(true);
    });

    test("rejects a free-response row whose lone choice is the key", () => {
        expect(
            isWelcomeTrainerProblem(
                problem({
                    id: 2,
                    n: 0,
                    choices: ["13"],
                    answer_index: 0,
                    response_kind: "short_answer",
                }),
            ),
        ).toBe(false);
    });

    test("rejects diagrams, overlong statements, and missing keys", () => {
        expect(
            isWelcomeTrainerProblem(
                problem({ id: 3, n: 0, statement: "See the figure.\n[asy]draw((0,0)--(1,0));[/asy]" }),
            ),
        ).toBe(false);
        expect(
            isWelcomeTrainerProblem(
                problem({ id: 4, n: 0, statement: "A photo [img src=x]. What is $1$?" }),
            ),
        ).toBe(false);
        expect(
            isWelcomeTrainerProblem(
                problem({ id: 5, n: 0, statement: "x".repeat(WELCOME_STATEMENT_MAX + 1) }),
            ),
        ).toBe(false);
        expect(
            isWelcomeTrainerProblem(
                problem({ id: 6, n: 0, answer_status: "source_missing", answer_index: -1 }),
            ),
        ).toBe(false);
    });
});

describe("pickWelcomeProblems", () => {
    test("takes the newest paper's opening problem, one per test", () => {
        const picked = pickWelcomeProblems([
            problem({ id: 10, n: 2, tests: { name: "2022 AMC 10A", year: 2022 } }),
            problem({ id: 11, n: 0, tests: { name: "2024 AMC 10A", year: 2024 } }),
            problem({ id: 12, n: 1, tests: { name: "2024 AMC 10A", year: 2024 } }),
            problem({ id: 13, n: 0, tests: { name: "2025 AMC 10B", year: 2025 } }),
            problem({ id: 14, n: 0, tests: { name: "2024 AMC 10B", year: 2024 } }),
        ]);
        expect(picked.map((row) => row.id)).toEqual([13, 11, 14, 10]);
    });

    test("caps the sit and skips rows that would not fit the hero", () => {
        const rows = Array.from({ length: WELCOME_TRAINER_LIMIT + 3 }, (_, i) =>
            problem({
                id: 20 + i,
                n: 0,
                tests: { name: `202${i} AMC 10A`, year: 2020 + i },
            }),
        );
        rows.push(
            problem({
                id: 99,
                n: 0,
                statement: "[asy]circle((0,0),1);[/asy]",
                tests: { name: "2029 AMC 10A", year: 2029 },
            }),
        );
        const picked = pickWelcomeProblems(rows);
        expect(picked).toHaveLength(WELCOME_TRAINER_LIMIT);
        expect(picked.some((row) => row.id === 99)).toBe(false);
        expect(picked[0]?.tests?.year).toBe(2027);
    });
});

describe("welcomeProblemSource", () => {
    test("names the test the way the trainer chrome does", () => {
        expect(welcomeProblemSource(problem({ id: 1, n: 0 }))).toBe("2024 AMC 10A · Problem 1");
        expect(welcomeProblemSource(problem({ id: 2, n: 4, tests: null }))).toBe("Problem 5");
    });
});
