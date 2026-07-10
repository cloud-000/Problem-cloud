import type { ProblemRow } from "$lib/library";
import type {
    PracticeAttempt,
    PracticeSource,
    ProblemProgress,
} from "$lib/trainer";
import type { SessionHistoryEntry } from "$lib/sessions";

export type PracticeAnswerState = {
    selectedChoice: number | null;
    answer: string;
    submitted: boolean;
    correct: boolean | null;
    flagged: boolean;
    elapsedMs: number;
    attemptIndex: number | null;
    triesUsed: number;
    triedAnswers: string[];
    eliminatedChoices: number[];
};

export type PracticeHistoryEntry = PracticeAnswerState & {
    problem: ProblemRow;
    source: PracticeSource;
    progress: ProblemProgress | null;
    submissionId?: number;
};

export function createPracticeAnswerState(
    overrides: Partial<PracticeAnswerState> = {},
): PracticeAnswerState {
    return {
        selectedChoice: overrides.selectedChoice ?? null,
        answer: overrides.answer ?? "",
        submitted: overrides.submitted ?? false,
        correct: overrides.correct ?? null,
        flagged: overrides.flagged ?? false,
        elapsedMs: overrides.elapsedMs ?? 0,
        attemptIndex: overrides.attemptIndex ?? null,
        triesUsed: overrides.triesUsed ?? 0,
        triedAnswers: [...(overrides.triedAnswers ?? [])],
        eliminatedChoices: [...(overrides.eliminatedChoices ?? [])],
    };
}

export function snapshotPracticeAnswerState(
    state: PracticeAnswerState,
): PracticeAnswerState {
    return createPracticeAnswerState(state);
}

export function createPracticeHistoryEntry({
    problem,
    source,
    progress,
    submissionId,
    ...answerState
}: {
    problem: ProblemRow;
    source: PracticeSource;
    progress: ProblemProgress | null;
    submissionId?: number;
} & Partial<PracticeAnswerState>): PracticeHistoryEntry {
    return {
        problem,
        source,
        progress,
        ...createPracticeAnswerState(answerState),
        ...(submissionId == null ? {} : { submissionId }),
    };
}

export function restorePracticeAnswerState(
    entry: PracticeHistoryEntry,
): PracticeAnswerState {
    return snapshotPracticeAnswerState(entry);
}

export function commitPracticeAnswerState(
    entry: PracticeHistoryEntry,
    state: PracticeAnswerState,
): void {
    Object.assign(entry, snapshotPracticeAnswerState(state));
}

export function practiceHistoryEntryFromSubmission(
    submission: SessionHistoryEntry & { submissionId?: number },
): PracticeHistoryEntry {
    return createPracticeHistoryEntry({
        problem: submission.problem,
        source: (submission.source as PracticeSource) ?? "practice",
        progress: null,
        selectedChoice: submission.selectedChoice,
        submitted: !submission.skipped,
        correct: submission.isCorrect,
        flagged: submission.flagged,
        elapsedMs: submission.elapsedMs,
        submissionId: submission.submissionId,
    });
}

export function practiceAttemptFromAnswerState(
    problemId: number,
    state: PracticeAnswerState,
    outcome: { correct: boolean | null; skipped: boolean },
): PracticeAttempt {
    return {
        problemId,
        selectedChoice: state.selectedChoice,
        correct: outcome.correct,
        elapsedMs: state.elapsedMs,
        skipped: outcome.skipped,
        flagged: state.flagged,
    };
}
