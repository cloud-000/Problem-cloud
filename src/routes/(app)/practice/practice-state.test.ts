import { describe, expect, test } from "bun:test";
import type { ProblemRow } from "$lib/library";
import type { ProblemProgress } from "$lib/progress";
import {
    commitPracticeHistoryEntry,
    createPracticeAnswerState,
    createPracticeHistoryEntry,
    practiceAttemptFromAnswerState,
    practiceHistoryEntryFromSubmission,
    restorePracticeAnswerState,
} from "./practice-state";

const problem = { id: 7, choices: ["A", "B"], answer_index: 1 } as ProblemRow;
const progress: ProblemProgress = {
    times_seen: 1,
    times_correct: 1,
    times_reviewed: 1,
    times_skipped: 0,
    last_correct: true,
    last_reviewed_at: null,
    last_submission_at: null,
    next_review_at: null,
    solved: true,
    mastery: "confident",
    engagement: null,
};

describe("practice answer history", () => {
    test("creates complete independent defaults", () => {
        const first = createPracticeAnswerState();
        const second = createPracticeAnswerState();
        first.triedAnswers.push("c:0");
        first.eliminatedChoices.push(1);

        expect(second).toEqual({
            selectedChoice: null,
            answer: "",
            submitted: false,
            correct: null,
            flagged: false,
            elapsedMs: 0,
            attemptIndex: null,
            triesUsed: 0,
            triedAnswers: [],
            eliminatedChoices: [],
        });
    });

    test("snapshots and restores every multi-try field defensively", () => {
        const entry = createPracticeHistoryEntry({
            problem,
            source: "review",
            progress: null,
        });
        const live = createPracticeAnswerState({
            selectedChoice: 0,
            answer: "x",
            submitted: true,
            correct: false,
            flagged: true,
            elapsedMs: 321,
            attemptIndex: 4,
            triesUsed: 2,
            triedAnswers: ["c:0", "a:x"],
            eliminatedChoices: [1],
        });

        commitPracticeHistoryEntry(entry, live, progress);
        const restored = restorePracticeAnswerState(entry);
        restored.triedAnswers.push("new");
        restored.eliminatedChoices.push(0);

        expect(entry.triedAnswers).toEqual(["c:0", "a:x"]);
        expect(entry.eliminatedChoices).toEqual([1]);
        expect(entry.progress).toEqual(progress);
        expect(entry).toMatchObject({
            selectedChoice: 0,
            answer: "x",
            submitted: true,
            correct: false,
            flagged: true,
            elapsedMs: 321,
            attemptIndex: 4,
            triesUsed: 2,
        });
    });

    test("converts fetched submissions into historical entries", () => {
        const entry = practiceHistoryEntryFromSubmission({
            problem,
            progress,
            source: null,
            selectedChoice: 1,
            answer: "42",
            isCorrect: true,
            skipped: false,
            flagged: true,
            elapsedMs: 99,
            submissionId: 42,
        });

        expect(entry).toMatchObject({
            source: "practice",
            selectedChoice: 1,
            answer: "42",
            submitted: true,
            correct: true,
            flagged: true,
            elapsedMs: 99,
            submissionId: 42,
        });
        expect(entry.triedAnswers).toEqual([]);
        expect(entry.eliminatedChoices).toEqual([]);
        expect(entry.progress).toEqual(progress);
    });

    test("converts live answer state into an attempt", () => {
        const attempt = practiceAttemptFromAnswerState(
            problem.id,
            createPracticeAnswerState({
                selectedChoice: 1,
                elapsedMs: 50,
                flagged: true,
            }),
            { correct: true, skipped: false },
        );
        expect(attempt).toEqual({
            problemId: 7,
            selectedChoice: 1,
            correct: true,
            elapsedMs: 50,
            skipped: false,
            flagged: true,
        });
    });
});
