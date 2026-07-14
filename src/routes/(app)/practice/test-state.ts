import type { PracticeHistoryEntry, PracticeAnswerState } from "./practice-state";
import { answersMatch } from "$lib/utils/answer-matcher";

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
    const isMcq = (entry.problem.choices?.length ?? 0) > 1;
    const skipped = isMcq
        ? entry.selectedChoice == null
        : !entry.answer.trim();
    if (skipped) return { skipped: true, correct: null };
    return {
        skipped: false,
        // Free-response is graded with the same normalizing matcher as live
        // practice (`answersMatch`), NOT raw string equality: stored answers often
        // carry unit labels ("8 pies", "19 cm") or LaTeX/formatting the solver
        // won't retype, so `===` marked genuinely-correct answers wrong.
        correct: isMcq
            ? entry.selectedChoice === entry.problem.answer_index
            : answersMatch(
                  entry.answer,
                  entry.problem.choices?.[entry.problem.answer_index ?? 0] ?? "",
              ),
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
        skipped: history.filter((entry) => !entry.submitted).length,
    };
}
