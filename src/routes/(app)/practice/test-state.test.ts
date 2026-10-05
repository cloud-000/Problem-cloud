import { describe, expect, test } from "bun:test";
import type { ProblemRow } from "$lib/library";
import { createPracticeAnswerState, createPracticeHistoryEntry } from "./practice-state";
import {
    clearTestDraft,
    createTestDraft,
    loadTestDraft,
    parseTestDraft,
    restoreTestDraft,
    reconcileTestHistory,
    summarizeTestResults,
    testOutcome,
    writeTestDraft,
    type DraftStorage,
} from "./test-state";

function problem(id: number, choices: string[], answerIndex: number): ProblemRow {
    return {
        id,
        choices,
        answer_index: answerIndex,
        response_kind: choices.length > 1 ? "mcq" : "short_answer",
        answer_status:
            answerIndex >= 0 && answerIndex < choices.length
                ? "known"
                : "source_missing",
    } as ProblemRow;
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
            ungraded: 0,
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
            ungraded: 0,
            skipped: 0,
        });
    });

    test("handles a mixed MCQ, short-answer, proof, and unsupported test", () => {
        const mcq = entry(1, ["A", "B"], 1);
        mcq.selectedChoice = 1;

        const short = entry(2, ["42"], 0);
        short.answer = "42";

        const proof = entry(3, [], -1);
        proof.problem.response_kind = "proof";
        proof.problem.answer_status = "not_applicable";
        proof.answer = "Assume the contrary and derive a contradiction.";

        const construction = entry(4, [], -1);
        construction.problem.response_kind = "construction";
        construction.problem.answer_status = "not_applicable";

        for (const item of [mcq, short, proof, construction]) {
            const outcome = testOutcome(item);
            item.submitted = !outcome.skipped;
            item.correct = outcome.correct;
        }

        expect(testOutcome(proof)).toEqual({ skipped: false, correct: null });
        expect(testOutcome(construction)).toEqual({ skipped: true, correct: null });
        expect(summarizeTestResults([mcq, short, proof, construction])).toEqual({
            correct: 2,
            incorrect: 0,
            ungraded: 1,
            skipped: 1,
        });
    });
});

describe("reconcileTestHistory", () => {
    test("reconciles aliased problems to the test's problem placement and order", () => {
        // Mock AMC 10 test problems where Problem 5 (id 105) is an alias of AMC 12 Problem 4 (canonical_id 204)
        const testProblems: ProblemRow[] = [
            { id: 101, n: 0, test_id: 10, tests: { name: "AMC 10" } } as unknown as ProblemRow,
            { id: 102, n: 1, test_id: 10, tests: { name: "AMC 10" } } as unknown as ProblemRow,
            { id: 105, n: 4, canonical_id: 204, test_id: 10, tests: { name: "AMC 10" } } as unknown as ProblemRow,
        ];

        // Submissions stored in the database:
        // Problem 1 was not aliased -> problem.id = 101
        // Problem 2 was not aliased -> problem.id = 102
        // Problem 5 was aliased -> canonicalized to AMC 12 problem (id = 204, n = 3)
        const submissions = [
            {
                problem: { id: 204, n: 3, test_id: 12, tests: { name: "AMC 12" } } as unknown as ProblemRow,
                progress: null,
                source: "test",
                selectedChoice: 2,
                answer: "",
                isCorrect: true,
                skipped: false,
                flagged: true,
                elapsedMs: 45000,
            },
            {
                problem: { id: 101, n: 0, test_id: 10, tests: { name: "AMC 10" } } as unknown as ProblemRow,
                progress: null,
                source: "test",
                selectedChoice: 0,
                answer: "",
                isCorrect: true,
                skipped: false,
                flagged: false,
                elapsedMs: 30000,
            },
            {
                problem: { id: 102, n: 1, test_id: 10, tests: { name: "AMC 10" } } as unknown as ProblemRow,
                progress: null,
                source: "test",
                selectedChoice: null,
                answer: "",
                isCorrect: null,
                skipped: true,
                flagged: false,
                elapsedMs: 5000,
            },
        ];

        const history = reconcileTestHistory(testProblems, submissions);

        expect(history).toHaveLength(3);
        // Correct test problem order: n = 0, n = 1, n = 4
        expect(history[0].problem.id).toBe(101);
        expect(history[0].problem.n).toBe(0);
        expect(history[0].problem.tests?.name).toBe("AMC 10");
        expect(history[0].selectedChoice).toBe(0);
        expect(history[0].correct).toBe(true);

        expect(history[1].problem.id).toBe(102);
        expect(history[1].problem.n).toBe(1);
        expect(history[1].skipped).toBe(true);

        // Problem 5 is correctly restored as AMC 10 Problem #5 (n = 4) instead of AMC 12 #4 (n = 3)
        expect(history[2].problem.id).toBe(105);
        expect(history[2].problem.n).toBe(4);
        expect(history[2].problem.tests?.name).toBe("AMC 10");
        expect(history[2].selectedChoice).toBe(2);
        expect(history[2].correct).toBe(true);
        expect(history[2].flagged).toBe(true);
        expect(history[2].elapsedMs).toBe(45000);
    });

    test("handles unattempted test problems and falls back gracefully when testProblems is empty", () => {
        const testProblems: ProblemRow[] = [
            { id: 1, n: 0, test_id: 1 } as unknown as ProblemRow,
            { id: 2, n: 1, test_id: 1 } as unknown as ProblemRow,
        ];
        const submissions = [
            {
                problem: { id: 1, n: 0, test_id: 1 } as unknown as ProblemRow,
                progress: null,
                source: "test",
                selectedChoice: 1,
                answer: "",
                isCorrect: true,
                skipped: false,
                flagged: false,
                elapsedMs: 10000,
            },
        ];

        const history = reconcileTestHistory(testProblems, submissions);
        expect(history).toHaveLength(2);
        expect(history[0].problem.id).toBe(1);
        expect(history[0].correct).toBe(true);
        expect(history[1].problem.id).toBe(2);
        expect(history[1].skipped).toBe(true);
        expect(history[1].submitted).toBe(false);

        // Empty testProblems fallback
        const fallback = reconcileTestHistory([], submissions);
        expect(fallback).toHaveLength(1);
        expect(fallback[0].problem.id).toBe(1);
    });
});
