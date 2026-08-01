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
        expect(restoreTestDraft(restored, draft)).toEqual({
            historyIndex: 1,
            segmentIndex: 0,
        });
        expect(restored[0].selectedChoice).toBe(0);
        expect(restored[1]).toMatchObject({ answer: "4", elapsedMs: 123, flagged: true });
    });

    test("persists and restores the current segment for segmented pacing", () => {
        const history = [entry(1, ["A", "B"], 1), entry(2, ["4"], 0)];
        const draft = createTestDraft(
            history,
            1,
            createPracticeAnswerState({ answer: "4" }),
            2,
        );
        expect(draft.segmentIndex).toBe(2);

        const roundTripped = parseTestDraft(JSON.stringify(draft));
        expect(roundTripped?.segmentIndex).toBe(2);

        const restored = [entry(1, ["A", "B"], 1), entry(2, ["4"], 0)];
        expect(restoreTestDraft(restored, roundTripped)).toEqual({
            historyIndex: 1,
            segmentIndex: 2,
        });
    });

    test("defaults segmentIndex to 0 when absent or invalid", () => {
        expect(parseTestDraft(JSON.stringify({ historyIndex: 0, answers: [] }))?.segmentIndex).toBe(0);
        expect(
            parseTestDraft(JSON.stringify({ historyIndex: 0, segmentIndex: -3, answers: [] }))
                ?.segmentIndex,
        ).toBe(0);
        expect(restoreTestDraft([], null)).toEqual({ historyIndex: 0, segmentIndex: 0 });
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
        const draft = { historyIndex: 0, segmentIndex: 0, answers: [] };
        expect(loadTestDraft(null, 1)).toBeNull();
        expect(loadTestDraft(throwing, 1)).toBeNull();
        expect(() => writeTestDraft(throwing, 1, draft)).not.toThrow();
        expect(() => clearTestDraft(throwing, 1)).not.toThrow();
    });
});

describe("test grading", () => {
    test("grades MCQ by choice index and free-response with answersMatch", () => {
        const mcq = entry(1, ["A", "B"], 1);
        mcq.selectedChoice = 1;
        expect(testOutcome(mcq)).toEqual({ skipped: false, correct: true });

        // Free-response uses the normalizing matcher, matching live practice.
        const free = entry(2, ["x + 1"], 0);
        free.answer = " x + 1 ";
        expect(testOutcome(free)).toEqual({ skipped: false, correct: true });
        // Whitespace differences no longer count as wrong (the old `===` bug).
        free.answer = "x+1";
        expect(testOutcome(free)).toEqual({ skipped: false, correct: true });
        // A genuinely different value is still wrong.
        free.answer = "x+2";
        expect(testOutcome(free)).toEqual({ skipped: false, correct: false });
    });

    test("grades a unit-labeled stored answer against a bare value (regression)", () => {
        // Real data: correct answer stored as "8 pies"; solver types "8".
        const labeled = entry(3, ["8 pies"], 0);
        labeled.answer = "8";
        expect(testOutcome(labeled)).toEqual({ skipped: false, correct: true });

        const cm = entry(4, ["19 cm"], 0);
        cm.answer = "19";
        expect(testOutcome(cm)).toEqual({ skipped: false, correct: true });
    });

    test("leaves submitted answerless problems ungraded", () => {
        const free = entry(5, [], -1);
        free.answer = "anything";
        expect(testOutcome(free)).toEqual({ skipped: false, correct: null });

        const mcq = entry(6, ["A", "B"], -1);
        mcq.selectedChoice = 0;
        expect(testOutcome(mcq)).toEqual({ skipped: false, correct: null });
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

    test("trusts the stored grade when a reloaded free-response answer is blank", () => {
        // A reloaded submission has no answer text, only the stored grade. The
        // summary must trust `submitted`/`correct` rather than re-inferring a
        // skip from the (blank) answer — otherwise a graded-correct problem is
        // miscounted as skipped (the reported reload bug).
        const restored = entry(5, ["4"], 0);
        restored.submitted = true;
        restored.correct = true;
        restored.skipped = false;
        expect(summarizeTestResults([restored])).toEqual({
            correct: 1,
            incorrect: 0,
            skipped: 0,
        });
    });
});
