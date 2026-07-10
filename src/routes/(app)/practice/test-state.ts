import type { PracticeHistoryEntry, PracticeAnswerState } from "./practice-state";

export type TestDraftAnswer = {
    problemId: number;
    selectedChoice: number | null;
    answer: string;
    elapsedMs: number;
    flagged: boolean;
};

export type TestDraft = { historyIndex: number; answers: TestDraftAnswer[] };

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
): TestDraft {
    return {
        historyIndex,
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
        return { historyIndex: value.historyIndex!, answers };
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
): number {
    if (!draft) return 0;
    const byId = new Map(draft.answers.map((answer) => [answer.problemId, answer]));
    for (const entry of history) {
        const answer = byId.get(entry.problem.id);
        if (!answer) continue;
        entry.selectedChoice = answer.selectedChoice;
        entry.answer = answer.answer;
        entry.elapsedMs = answer.elapsedMs;
        entry.flagged = answer.flagged;
    }
    return draft.historyIndex >= 0 && draft.historyIndex < history.length
        ? draft.historyIndex
        : 0;
}

export function testOutcome(entry: PracticeHistoryEntry): TestOutcome {
    const isMcq = (entry.problem.choices?.length ?? 0) > 1;
    const skipped = isMcq
        ? entry.selectedChoice == null
        : !entry.answer.trim();
    if (skipped) return { skipped: true, correct: null };
    return {
        skipped: false,
        correct: isMcq
            ? entry.selectedChoice === entry.problem.answer_index
            : entry.answer.trim() ===
              entry.problem.choices?.[entry.problem.answer_index ?? 0]?.trim(),
    };
}

export function applyTestOutcome(entry: PracticeHistoryEntry): TestOutcome {
    const outcome = testOutcome(entry);
    entry.submitted = !outcome.skipped;
    entry.correct = outcome.correct;
    return outcome;
}

export function summarizeTestResults(
    history: PracticeHistoryEntry[],
): TestResultSummary {
    return {
        correct: history.filter((entry) => entry.correct === true).length,
        incorrect: history.filter(
            (entry) => entry.submitted && entry.correct === false,
        ).length,
        skipped: history.filter((entry) => testOutcome(entry).skipped).length,
    };
}
