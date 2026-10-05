import {
    createPracticeHistoryEntry,
    practiceHistoryEntryFromSubmission,
    type PracticeHistoryEntry,
    type PracticeAnswerState,
    type PracticeSource,
} from "./practice-state";
import { answersMatch } from "$lib/utils/answer-matcher";
import {
    hasComparableAnswer,
    inputModeFor,
    resolveResponseKind,
} from "$lib/problem-response";
import type { ProblemRow } from "$lib/library";
import type { SessionHistoryEntry } from "$lib/sessions";

export type TestDraftAnswer = {
    problemId: number;
    selectedChoice: number | null;
    answer: string;
    elapsedMs: number;
    flagged: boolean;
};

export type TestDraft = {
    historyIndex: number;
    // Segmented pacing only: the furthest-reached (current) segment. Persisted so
    // a resume can't drop the user back into an already-locked segment. 0 for
    // pooled tests, which have a single implicit segment.
    segmentIndex: number;
    answers: TestDraftAnswer[];
};

/** Where a resumed test should reopen: which problem, and which segment. */
export type TestDraftPlace = { historyIndex: number; segmentIndex: number };

export type TestOutcome = {
    skipped: boolean;
    correct: boolean | null;
};

export type TestResultSummary = {
    correct: number;
    incorrect: number;
    ungraded: number;
    skipped: number;
};

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function testDraftKey(sessionId: number): string {
    return `pc:test-draft:${sessionId}`;
}

export function createTestDraft(
    history: PracticeHistoryEntry[],
    historyIndex: number,
    active: PracticeAnswerState,
    segmentIndex = 0,
): TestDraft {
    return {
        historyIndex,
        segmentIndex,
        answers: history.map((entry, index) => {
            const state = index === historyIndex ? active : entry;
            return {
                problemId: entry.problem.id,
                selectedChoice: state.selectedChoice,
                answer: state.answer,
                elapsedMs: state.elapsedMs,
                flagged: state.flagged,
            };
        }),
    };
}

export function parseTestDraft(raw: string | null): TestDraft | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<TestDraft>;
        if (!Number.isInteger(value.historyIndex) || !Array.isArray(value.answers)) {
            return null;
        }
        const answers: TestDraftAnswer[] = [];
        for (const answer of value.answers) {
            if (!answer || !Number.isInteger(answer.problemId)) return null;
            answers.push({
                problemId: answer.problemId,
                selectedChoice: Number.isInteger(answer.selectedChoice)
                    ? answer.selectedChoice
                    : null,
                answer: typeof answer.answer === "string" ? answer.answer : "",
                elapsedMs:
                    typeof answer.elapsedMs === "number" && answer.elapsedMs >= 0
                        ? answer.elapsedMs
                        : 0,
                flagged: answer.flagged === true,
            });
        }
        const segmentIndex =
            Number.isInteger(value.segmentIndex) && value.segmentIndex! >= 0
                ? value.segmentIndex!
                : 0;
        return { historyIndex: value.historyIndex!, segmentIndex, answers };
    } catch {
        return null;
    }
}

export function loadTestDraft(
    storage: DraftStorage | null | undefined,
    sessionId: number,
): TestDraft | null {
    try {
        return storage ? parseTestDraft(storage.getItem(testDraftKey(sessionId))) : null;
    } catch {
        return null;
    }
}

export function writeTestDraft(
    storage: DraftStorage | null | undefined,
    sessionId: number,
    draft: TestDraft,
): void {
    try {
        storage?.setItem(testDraftKey(sessionId), JSON.stringify(draft));
    } catch {
        // Draft persistence is best-effort.
    }
}

export function clearTestDraft(
    storage: DraftStorage | null | undefined,
    sessionId: number,
): void {
    try {
        storage?.removeItem(testDraftKey(sessionId));
    } catch {
        // Draft persistence is best-effort.
    }
}

export function restoreTestDraft(
    history: PracticeHistoryEntry[],
    draft: TestDraft | null,
): TestDraftPlace {
    if (!draft) return { historyIndex: 0, segmentIndex: 0 };
    const byId = new Map(draft.answers.map((answer) => [answer.problemId, answer]));
    for (const entry of history) {
        const answer = byId.get(entry.problem.id);
        if (!answer) continue;
        entry.selectedChoice = answer.selectedChoice;
        entry.answer = answer.answer;
        entry.elapsedMs = answer.elapsedMs;
        entry.flagged = answer.flagged;
    }
    const historyIndex =
        draft.historyIndex >= 0 && draft.historyIndex < history.length
            ? draft.historyIndex
            : 0;
    const segmentIndex = draft.segmentIndex >= 0 ? draft.segmentIndex : 0;
    return { historyIndex, segmentIndex };
}

export function testOutcome(entry: PracticeHistoryEntry): TestOutcome {
    const choices = entry.problem.choices ?? [];
    const answerIndex = entry.problem.answer_index ?? -1;
    const kind = resolveResponseKind(entry.problem);
    const inputMode = inputModeFor(kind);
    const isChoice = inputMode === "choice";
    const skipped = isChoice
        ? entry.selectedChoice == null
        : !entry.answer.trim();
    if (skipped) return { skipped: true, correct: null };
    // Proof and estimation capture are deliberately ungraded in Phase 3.
    // Unknown legacy rows may still use a valid comparable key; unsupported
    // kinds have no capture and therefore reach the skipped branch above.
    const gradeableKind =
        kind === "mcq" || kind === "short_answer" || kind === "unknown";
    if (!gradeableKind || !hasComparableAnswer(entry.problem)) {
        return { skipped: false, correct: null };
    }
    return {
        skipped: false,
        // Free-response is graded with the same normalizing matcher as live
        // practice (`answersMatch`), NOT raw string equality: stored answers often
        // carry unit labels ("8 pies", "19 cm") or LaTeX/formatting the solver
        // won't retype, so `===` marked genuinely-correct answers wrong.
        correct: isChoice
            ? entry.selectedChoice === answerIndex
            : answersMatch(entry.answer, choices[answerIndex]),
    };
}

export function applyTestOutcome(entry: PracticeHistoryEntry): TestOutcome {
    const outcome = testOutcome(entry);
    entry.submitted = !outcome.skipped;
    entry.correct = outcome.correct;
    // Record the skip explicitly so downstream review (which may run after a
    // reload, where the typed answer is gone) trusts this rather than
    // re-inferring a skip from a now-blank answer.
    entry.skipped = outcome.skipped;
    return outcome;
}

/**
 * Tally a graded test from each entry's *stored* outcome (`submitted`/`correct`),
 * never by re-grading. This holds on a fresh submit (where {@link applyTestOutcome}
 * has just set those) and after a reload (where they come straight from the
 * persisted `submissions` row) — the latter matters because a reloaded
 * free-response entry has no answer text to re-derive from.
 */
export function summarizeTestResults(
    history: PracticeHistoryEntry[],
): TestResultSummary {
    return {
        correct: history.filter((entry) => entry.correct === true).length,
        incorrect: history.filter(
            (entry) => entry.submitted && entry.correct === false,
        ).length,
        ungraded: history.filter(
            (entry) => entry.submitted && entry.correct === null,
        ).length,
        skipped: history.filter((entry) => !entry.submitted).length,
    };
}

/**
 * Reconcile a completed test's session history entries with the test's authoritative problem set.
 * In the database, submissions on alias problems have their `problem_id` canonicalized to a shared
 * canonical problem from another test (e.g. an AMC 10 question rewritten to an AMC 12 question).
 * This reconstructs the test review history so each entry reflects the test's actual problem
 * placement (ordered 1..N, correct test name and problem number) while retaining all recorded
 * submission outcomes (answers, correctness, skip status, elapsed time, mastery/progress).
 */
export function reconcileTestHistory(
    testProblems: ProblemRow[],
    submissions: SessionHistoryEntry[],
): PracticeHistoryEntry[] {
    if (!testProblems.length) {
        return submissions.map(practiceHistoryEntryFromSubmission);
    }

    const remaining = [...submissions];
    const history: PracticeHistoryEntry[] = testProblems.map((p) => {
        let idx = remaining.findIndex((s) => s.problem.id === p.id);
        if (idx === -1 && p.canonical_id != null) {
            idx = remaining.findIndex((s) => s.problem.id === p.canonical_id);
        }

        if (idx !== -1) {
            const [sub] = remaining.splice(idx, 1);
            return createPracticeHistoryEntry({
                problem: p,
                source: (sub.source as PracticeSource) ?? "test",
                progress: sub.progress,
                selectedChoice: sub.selectedChoice,
                answer: sub.answer ?? "",
                submitted: !sub.skipped,
                correct: sub.isCorrect,
                flagged: sub.flagged,
                elapsedMs: sub.elapsedMs,
                submissionId: (sub as { submissionId?: number }).submissionId,
                skipped: sub.skipped,
            });
        }

        return createPracticeHistoryEntry({
            problem: p,
            source: "test",
            progress: null,
            selectedChoice: null,
            answer: "",
            submitted: false,
            correct: null,
            flagged: false,
            elapsedMs: 0,
            skipped: true,
        });
    });

    for (const extra of remaining) {
        history.push(practiceHistoryEntryFromSubmission(extra));
    }

    return history;
}
