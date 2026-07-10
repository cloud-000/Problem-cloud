import { describe, expect, test } from "bun:test";
import type { ProblemRow } from "$lib/library";
import { createPracticeAnswerState, createPracticeHistoryEntry } from "./practice-state";
import {
    clearTestDraft,
    createTestDraft,
    loadTestDraft,
    parseTestDraft,
    restoreTestDraft,
    summarizeTestResults,
    testOutcome,
    writeTestDraft,
    type DraftStorage,
} from "./test-state";

function problem(id: number, choices: string[], answerIndex: number): ProblemRow {
    return { id, choices, answer_index: answerIndex } as ProblemRow;
}

function entry(id: number, choices: string[], answerIndex: number) {
    return createPracticeHistoryEntry({
        problem: problem(id, choices, answerIndex),
        source: "practice",
        progress: null,
    });
}

describe("test drafts", () => {
    test("uses the active answer override and restores by problem id", () => {
        const history = [entry(1, ["A", "B"], 1), entry(2, ["4"], 0)];
        history[0].selectedChoice = 0;
        history[1].answer = "old";
        const draft = createTestDraft(
            history,
            1,
            createPracticeAnswerState({ answer: "4", elapsedMs: 123, flagged: true }),
        );

        expect(draft.answers[1]).toMatchObject({ answer: "4", elapsedMs: 123, flagged: true });

        const restored = [entry(1, ["A", "B"], 1), entry(2, ["4"], 0)];
        expect(restoreTestDraft(restored, draft)).toBe(1);
        expect(restored[0].selectedChoice).toBe(0);
        expect(restored[1]).toMatchObject({ answer: "4", elapsedMs: 123, flagged: true });
    });

    test("rejects malformed JSON and invalid shapes", () => {
        expect(parseTestDraft("{")).toBeNull();
        expect(parseTestDraft(JSON.stringify({ historyIndex: 0, answers: "no" }))).toBeNull();
        expect(parseTestDraft(JSON.stringify({ historyIndex: 0, answers: [{}] }))).toBeNull();
    });

    test("tolerates unavailable and throwing storage", () => {
        const throwing: DraftStorage = {
            getItem() { throw new Error("blocked"); },
            setItem() { throw new Error("full"); },
            removeItem() { throw new Error("blocked"); },
        };
        const draft = { historyIndex: 0, answers: [] };
        expect(loadTestDraft(null, 1)).toBeNull();
        expect(loadTestDraft(throwing, 1)).toBeNull();
        expect(() => writeTestDraft(throwing, 1, draft)).not.toThrow();
        expect(() => clearTestDraft(throwing, 1)).not.toThrow();
    });
});

describe("test grading", () => {
    test("preserves separate MCQ and exact trimmed free-response rules", () => {
        const mcq = entry(1, ["A", "B"], 1);
        mcq.selectedChoice = 1;
        expect(testOutcome(mcq)).toEqual({ skipped: false, correct: true });

        const free = entry(2, ["x + 1"], 0);
        free.answer = " x + 1 ";
        expect(testOutcome(free)).toEqual({ skipped: false, correct: true });
        free.answer = "x+1";
        expect(testOutcome(free)).toEqual({ skipped: false, correct: false });
    });

    test("detects skipped answers and summarizes all outcomes", () => {
        const correct = entry(1, ["A", "B"], 1);
        correct.selectedChoice = 1;
        correct.submitted = true;
        correct.correct = true;
        const incorrect = entry(2, ["A", "B"], 1);
        incorrect.selectedChoice = 0;
        incorrect.submitted = true;
        incorrect.correct = false;
        const skippedMcq = entry(3, ["A", "B"], 1);
        const skippedFree = entry(4, ["4"], 0);
        skippedFree.answer = "   ";

        expect(summarizeTestResults([correct, incorrect, skippedMcq, skippedFree])).toEqual({
            correct: 1,
            incorrect: 1,
            skipped: 2,
        });
    });

    test("keeps recorded grades when a restored free-response answer is unavailable", () => {
        const restored = entry(5, ["4"], 0);
        restored.submitted = true;
        restored.correct = true;
        expect(summarizeTestResults([restored])).toEqual({
            correct: 1,
            incorrect: 0,
            skipped: 1,
        });
    });
});
