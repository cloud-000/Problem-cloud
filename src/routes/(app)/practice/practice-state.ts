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
    // Timed practice: the `elapsedMs` value the active per-problem limit started
    // counting down from (see `rebaseCountdownBaseline`, `$lib/countdown`). Zero
    // unless the limit was retuned mid-problem; carried here so back/forward
    // navigation doesn't hand the problem back a countdown it already spent.
    limitBaselineMs: number;
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
    // Explicit persisted skip flag (from `submissions.skipped`). Set when the
    // entry is rebuilt from a stored submission — where the free-text answer is
    // NOT persisted, so a skip can't be inferred from a (now-blank) answer — and
    // when a test is graded. Absent on live entries (their typed answer is present
    // and drives inference in the review UI).
    skipped?: boolean;
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
        limitBaselineMs: overrides.limitBaselineMs ?? 0,
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
    skipped,
    ...answerState
}: {
    problem: ProblemRow;
    source: PracticeSource;
    progress: ProblemProgress | null;
    submissionId?: number;
    skipped?: boolean;
} & Partial<PracticeAnswerState>): PracticeHistoryEntry {
    return {
        problem,
        source,
        progress,
        ...createPracticeAnswerState(answerState),
        ...(submissionId == null ? {} : { submissionId }),
        ...(skipped == null ? {} : { skipped }),
    };
}

export function restorePracticeAnswerState(
    entry: PracticeHistoryEntry,
): PracticeAnswerState {
    return snapshotPracticeAnswerState(entry);
}

export function commitPracticeHistoryEntry(
    entry: PracticeHistoryEntry,
    state: PracticeAnswerState,
    progress: ProblemProgress | null,
): void {
    Object.assign(entry, snapshotPracticeAnswerState(state));
    entry.progress = progress ? { ...progress } : null;
}

export function practiceHistoryEntryFromSubmission(
    submission: SessionHistoryEntry & { submissionId?: number },
): PracticeHistoryEntry {
    return createPracticeHistoryEntry({
        problem: submission.problem,
        source: (submission.source as PracticeSource) ?? "practice",
        progress: submission.progress,
        selectedChoice: submission.selectedChoice,
        answer: submission.answer ?? "",
        submitted: !submission.skipped,
        correct: submission.isCorrect,
        flagged: submission.flagged,
        elapsedMs: submission.elapsedMs,
        submissionId: submission.submissionId,
        // Persisted skip: the free-text answer isn't stored, so the review UI
        // must trust this flag rather than infer a skip from the blank answer.
        skipped: submission.skipped,
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
