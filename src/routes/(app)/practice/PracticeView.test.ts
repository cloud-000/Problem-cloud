import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import type { ProblemRating, ProblemRow } from "#lib/library.js";
import type { SessionHistoryEntry } from "#lib/sessions.js";
import type { TrainerSubmissionResult } from "#lib/trainer-data-source.js";
import { answersMatch } from "#lib/utils/answer-matcher.js";
import {
    createPracticeAnswerState,
    createPracticeHistoryEntry,
    hasTriedPracticeAnswer,
    practiceAnswerKey,
    type PracticeHistoryEntry,
} from "./practice-state";
import { applyTestOutcome, loadTestDraft, reconcileTestHistory, restoreTestDraft } from "./test-state";

// Execute the component's actual handler with its surrounding services supplied
// by the test. This covers early-return ordering and try accounting without
// mounting the trainer's unrelated auth, whiteboard, and Coach surfaces.
const component = readFileSync(new URL("./PracticeView.svelte", import.meta.url), "utf8");
const script = component.slice(component.indexOf(">") + 1, component.indexOf("</script>"));
const ast = ts.createSourceFile("PracticeView.ts", script, ts.ScriptTarget.Latest, true);
function componentFunction(name: string) {
    const handler = ast.statements.find((node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === name,
    );
    if (!handler) throw new Error(`PracticeView ${name} handler not found`);
    return ts.transpile(handler.getText(ast), { target: ts.ScriptTarget.ESNext });
}
const handlerJs = componentFunction("submitAnswer");

function setup(isProblemMcq = false, options: {
    rating?: ProblemRating | null;
    kind?: "online" | "offline" | "guest";
    hasAnswer?: boolean;
    persistence?: Promise<TrainerSubmissionResult>;
} = {}) {
    const answerState = createPracticeAnswerState();
    const recordSubmission = mock(async (_input: {
        isCorrect: boolean | null;
        triesUsed: number;
        answer: string | null;
    }) => options.persistence ?? { submissionId: 1, operationId: null });
    const warning = mock(() => {});
    const trigger = mock(() => {});
    const problem = {
        id: 7, choices: isProblemMcq ? ["A", "B"] : ["10"],
        answer_index: isProblemMcq ? 1 : 0, rating: options.rating ?? null,
    } as ProblemRow;
    const history = [createPracticeHistoryEntry({ problem, source: "practice", progress: null })];
    const submissionWrites = new Map<number, Promise<TrainerSubmissionResult>>();
    const bindings = {
        answerState,
        isProblemMcq,
        behavior: { gradeImmediately: true },
        problem,
        history,
        paused: false,
        practiceAnswerKey,
        hasTriedPracticeAnswer,
        answerFeedback: { trigger },
        toasts: { warning },
        startedAt: Date.now(),
        responseKind: isProblemMcq ? "mcq" : "short_answer",
        hasAnswer: options.hasAnswer ?? true,
        answersMatch,
        settingsForm: { triesPerProblem: 3 },
        hintsAvailable: false,
        user: { id: "test-user" },
        trainerSource: { kind: options.kind ?? "online", recordSubmission },
        currentSource: "practice",
        currentSessionId: null,
        submissionWrites,
        submissionPending: false,
        error: null,
        attempts: [],
        capabilities: { coach: false },
        ratingDelta: null,
        ratingCenter: null,
        refreshPlayerRating: () => {},
        console: { error: mock(() => {}) },
    };
    const view = new Function(...Object.keys(bindings), `
        ${componentFunction("invalidateProblemRatings")}
        ${handlerJs}
        return { submit: submitAnswer, show: (next) => { problem = next; } };
    `)(...Object.values(bindings)) as { submit(force?: boolean): Promise<void>; show(problem: ProblemRow): void };
    return { answerState, ...view, problem, history, submissionWrites, recordSubmission, warning, trigger };
}

describe("PracticeView submission retries", () => {
    test("equivalent wrong answers do not burn tries or save; distinct answers do", async () => {
        const { answerState, submit, recordSubmission, warning, trigger } = setup();
        answerState.answer = "1/2";
        await submit();
        expect(answerState.triesUsed).toBe(1);

        for (const answer of ["0.5", "2/4", "\\frac{1}{2}"]) {
            answerState.answer = answer;
            await submit();
            expect(answerState.triesUsed).toBe(1);
            expect(answerState.submitted).toBe(false);
        }
        expect(warning).toHaveBeenCalledTimes(3);
        expect(trigger).toHaveBeenCalledTimes(4);
        expect(answerState.triedAnswers).toEqual(["a:1/2"]);
        expect(recordSubmission).not.toHaveBeenCalled();

        answerState.answer = "3/4";
        await submit();
        expect(answerState.triesUsed).toBe(2);
        expect(recordSubmission).not.toHaveBeenCalled();

        answerState.answer = "10";
        await submit();
        expect(answerState.submitted).toBe(true);
        expect(recordSubmission).toHaveBeenCalledTimes(1);
        expect(recordSubmission.mock.calls[0][0]).toMatchObject({
            isCorrect: true,
            triesUsed: 2,
            answer: "10",
        });
    });

    test("MCQ repeats are rejected by choice index", async () => {
        const { answerState, submit, warning, recordSubmission } = setup(true);
        answerState.selectedChoice = 0;
        await submit();
        await submit();
        expect(answerState.triesUsed).toBe(1);
        expect(warning).toHaveBeenCalledTimes(1);
        expect(recordSubmission).not.toHaveBeenCalled();
        answerState.selectedChoice = 1;
        await submit();
        expect(answerState.correct).toBe(true);
        expect(recordSubmission).toHaveBeenCalledTimes(1);
    });
});

const ratingEffect = ast.statements.find((node) =>
    ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === "$effect"
    && node.getText(ast).includes("problemRating ="),
);
if (!ratingEffect) throw new Error("PracticeView problem rating effect not found");
const ratingEffectJs = ts.transpile(ratingEffect.getText(ast), { target: ts.ScriptTarget.ESNext });

type RatedProblem = { id: number; rating?: ProblemRating | null };
type RatingResult = { rating: ProblemRating | null } | null;

function setupProblemRating(getProblem: (id: number) => Promise<RatingResult>, kind = "online") {
    // Invoke the actual effect and its cleanup as the shown problem changes.
    return new Function("trainerSource", `
        let problem = null, problemRating = null, run, cleanup;
        const $effect = (callback) => { run = callback; };
        ${ratingEffectJs}
        return {
            show(next) { cleanup?.(); problem = next; cleanup = run(); },
            get rating() { return problemRating; },
        };
    `)({ kind, getProblem }) as {
        show(problem: RatedProblem | null): void;
        readonly rating: ProblemRating | null;
    };
}

const embeddedRating = Object.freeze({ rating: 1325, rd: 70, attempts: 12 });

describe("PracticeView problem rating requests", () => {
    for (const kind of ["online", "offline", "guest"]) {
        test(`${kind} reuses loaded ratings, including known unrated problems`, () => {
            const getProblem = mock(async (_id: number) => null);
            const view = setupProblemRating(getProblem, kind);
            view.show(Object.freeze({ id: 7, rating: embeddedRating }));
            expect(view.rating).toBe(embeddedRating);
            view.show(Object.freeze({ id: 8, rating: null }));
            expect(view.rating).toBeNull();
            expect(getProblem).not.toHaveBeenCalled();
        });

        test(`${kind} uses its data source for rows lacking embedded ratings`, async () => {
            const pending = Promise.withResolvers<RatingResult>();
            const getProblem = mock((_id: number) => pending.promise);
            const view = setupProblemRating(getProblem, kind);
            view.show({ id: 6, rating: embeddedRating });
            view.show({ id: 7 });
            expect(view.rating).toBeNull();
            expect(getProblem).toHaveBeenCalledTimes(1);
            expect(getProblem).toHaveBeenCalledWith(7);
            pending.resolve({ rating: embeddedRating });
            await pending.promise;
            expect(view.rating).toEqual(embeddedRating);
            expect(getProblem).toHaveBeenCalledTimes(1);
        });
    }

    for (const next of [{ id: 8, rating: embeddedRating }, { id: 8, rating: null }, null]) {
        test(`a stale fallback cannot overwrite ${JSON.stringify(next)}`, async () => {
            const pending = Promise.withResolvers<RatingResult>();
            const view = setupProblemRating(() => pending.promise);
            view.show({ id: 7 });
            view.show(next);
            pending.resolve({ rating: { rating: 2000, rd: 80, attempts: 20 } });
            await pending.promise;
            expect(view.rating).toEqual(next?.rating ?? null);
        });
    }

    test("out-of-order fallback requests keep the current rating", async () => {
        const first = Promise.withResolvers<RatingResult>();
        const second = Promise.withResolvers<RatingResult>();
        const view = setupProblemRating((id) => id === 7 ? first.promise : second.promise);
        view.show({ id: 7 });
        view.show({ id: 8 });
        second.resolve({ rating: embeddedRating });
        await second.promise;
        first.resolve(null);
        await first.promise;
        expect(view.rating).toEqual(embeddedRating);
    });
});

describe("PracticeView ratings after grading", () => {
    for (const initialRating of [null, embeddedRating]) {
        for (const correct of [true, false]) {
            test(`revisiting a saved ${correct ? "correct" : "incorrect"} answer refreshes ${initialRating ? "an existing rating" : "an unrated problem"}`, async () => {
                const persistence = Promise.withResolvers<TrainerSubmissionResult>();
                const view = setup(false, { rating: initialRating, persistence: persistence.promise });
                const alias = { ...view.problem, id: 17, canonical_id: 7 };
                view.history.push(createPracticeHistoryEntry({ problem: alias, source: "practice", progress: null }));
                view.answerState.answer = correct ? "10" : "11";
                await view.submit(true);
                expect(view.problem.rating).toBe(initialRating);
                // Next before persistence finishes must not invalidate the new problem.
                const next = { ...view.problem, id: 8, rating: embeddedRating };
                view.show(next);
                persistence.resolve({ submissionId: 1, operationId: null });
                await view.submissionWrites.get(7);
                expect(view.problem.rating).toBeUndefined();
                expect(alias.rating).toBeUndefined();
                expect(next.rating).toBe(embeddedRating);

                const freshRating = { rating: 1420, rd: 60, attempts: 13 };
                const read = Promise.resolve({ rating: freshRating });
                const getProblem = mock((_id: number) => read);
                const ratings = setupProblemRating(getProblem);
                ratings.show(next);
                expect(getProblem).not.toHaveBeenCalled();
                ratings.show(view.history[0].problem); // Back
                await read;
                expect(getProblem).toHaveBeenCalledWith(7);
                expect(ratings.rating).toEqual(freshRating);
            });
        }
    }

    test("a failed graded save retains the embedded rating", async () => {
        const persistence = Promise.withResolvers<TrainerSubmissionResult>();
        const view = setup(false, { rating: embeddedRating, persistence: persistence.promise });
        view.answerState.answer = "10";
        await view.submit();
        persistence.reject(new Error("database unavailable"));
        await view.submissionWrites.get(7)?.catch(() => {});
        expect(view.problem.rating).toBe(embeddedRating);
    });

    test("an online write resolving without a submission id retains the embedded rating", async () => {
        const view = setup(false, {
            rating: embeddedRating,
            persistence: Promise.resolve({ submissionId: null, operationId: null }),
        });
        view.answerState.answer = "10";
        await view.submit();
        await view.submissionWrites.get(7);
        expect(view.problem.rating).toBe(embeddedRating);
    });

    test("wrong retries and persisted ungraded answers retain the embedded rating", async () => {
        const retry = setup(false, { rating: embeddedRating });
        retry.answerState.answer = "11";
        await retry.submit();
        expect(retry.recordSubmission).not.toHaveBeenCalled();
        expect(retry.problem.rating).toBe(embeddedRating);
        const ungraded = setup(false, { rating: embeddedRating, hasAnswer: false });
        ungraded.answerState.answer = "10";
        await ungraded.submit();
        await ungraded.submissionWrites.get(7);
        expect(ungraded.problem.rating).toBe(embeddedRating);
    });

    for (const kind of ["offline", "guest"] as const) {
        test(`${kind} successful saves keep their local rating snapshot`, async () => {
            const view = setup(false, { kind, rating: embeddedRating });
            view.answerState.answer = "10";
            await view.submit();
            expect(view.recordSubmission).toHaveBeenCalledTimes(1);
            expect(view.problem.rating).toBe(embeddedRating);
        });
    }
});

describe("PracticeView test initialization", () => {
    for (const submitted of [false, true]) {
        test(`starts both reads together and preserves history mapping (submitted: ${submitted})`, async () => {
            const submissions = Promise.withResolvers<SessionHistoryEntry[]>();
            const problems = Promise.withResolvers<ProblemRow[]>();
            const trainerSource = {
                kind: "online",
                getSessionHistory: mock(() => submissions.promise),
                getTestProblems: mock((_id: number) => problems.promise),
                finishSession: mock(async () => {}),
            };
            const bindings = {
                trainerSource,
                createPracticeHistoryEntry,
                reconcileTestHistory,
                loadStoredTestDraft: loadTestDraft,
                restoreTestDraft,
                localStorage: { getItem: () => null },
            };
            const view = new Function(...Object.keys(bindings), `
                let loading, problem, error, history = [], historyIndex = -1, testFinished = false;
                const settingsForm = { testId: 11 }, isSegmented = false;
                const restore = (index) => { historyIndex = index; };
                ${componentFunction("invalidateProblemRatings")}
                ${componentFunction("initTest")}
                return {
                    init: () => initTest({ id: 3, status: "active" }),
                    state: () => ({ loading, error, history, historyIndex, testFinished }),
                };
            `)(...Object.values(bindings)) as {
                init(): Promise<void>;
                state(): { loading: boolean; error?: string; history: PracticeHistoryEntry[]; historyIndex: number; testFinished: boolean };
            };
            const initialization = view.init();
            expect(trainerSource.getSessionHistory).toHaveBeenCalledTimes(1);
            expect(trainerSource.getTestProblems).toHaveBeenCalledWith(11);
            const rows = [{ id: 7, canonical_id: 70, rating: embeddedRating }, { id: 8, canonical_id: null, rating: embeddedRating }] as ProblemRow[];
            problems.resolve(rows);
            await problems.promise;
            expect(view.state().history).toEqual([]);
            const graded: SessionHistoryEntry[] = submitted ? [{
                problem: { id: 70 } as ProblemRow, progress: null,
                isCorrect: true, skipped: false, flagged: false, elapsedMs: 123,
                selectedChoice: 0, answer: "", source: "practice",
            }] : [];
            submissions.resolve(graded);
            await initialization;
            expect(view.state()).toMatchObject({ loading: false, testFinished: submitted });
            expect(view.state().error).toBeUndefined();
            expect(view.state().history).toMatchObject([
                { problem: { id: 7, canonical_id: 70 }, submitted, correct: submitted ? true : null, source: "practice" },
                { problem: { id: 8 }, submitted: false, correct: null, source: submitted ? "test" : "practice" },
            ]);
            expect(view.state().historyIndex).toBe(submitted ? 1 : 0);
            expect(view.state().history.map((entry) => entry.problem.id)).toEqual([7, 8]);
            if (submitted) {
                expect(view.state().history[0]).toMatchObject({ correct: true, selectedChoice: 0, elapsedMs: 123 });
                expect(view.state().history[1].skipped).toBe(true);
            }
            expect(view.state().history[0].problem.rating).toBe(submitted ? undefined : embeddedRating);
            expect(view.state().history[1].problem.rating).toBe(embeddedRating);
            expect(trainerSource.finishSession).toHaveBeenCalledTimes(submitted ? 1 : 0);
        });
    }
});

describe("PracticeView test submission ratings", () => {
    for (const outcome of ["saved", "save-failed", "session-end-failed"]) {
        const succeeds = outcome !== "save-failed";
        test(`invalidates graded test ratings only after persistence (${outcome})`, async () => {
            const pending = Promise.withResolvers<void>();
            const history = ["10", "11", "", "proof"].map((answer, index) => createPracticeHistoryEntry({
                problem: {
                    id: index + 1, rating: embeddedRating, choices: ["10"], answer_index: 0,
                    response_kind: index === 3 ? "proof" : "short_answer", answer_status: "known",
                } as ProblemRow,
                source: "practice", progress: null, answer,
            }));
            const bindings = {
                history,
                trainerSource: {
                    kind: "online",
                    recordTestSubmissions: () => pending.promise,
                    setMastery: async () => {},
                    finishSession: async () => {
                        if (outcome === "session-end-failed") throw new Error("session end unavailable");
                    },
                },
                applyTestOutcome,
                clearStoredTestDraft: () => {},
                localStorage: {},
                commitCurrent: () => {},
                console: { error: mock(() => {}) },
            };
            const submit = new Function(...Object.keys(bindings), `
                const behavior = { gradeImmediately: false }, user = {}, currentSessionId = 3;
                let testFinished = false, submittingTest = false, error, problem = history[0].problem;
                ${componentFunction("invalidateProblemRatings")}
                ${componentFunction("submitTest")}
                return submitTest;
            `)(...Object.values(bindings)) as () => Promise<void>;
            const saving = submit();
            expect(history.map((entry) => entry.problem.rating)).toEqual(Array(4).fill(embeddedRating));
            if (succeeds) pending.resolve();
            else pending.reject(new Error("database unavailable"));
            await saving;
            expect(history.map((entry) => entry.problem.rating)).toEqual([
                succeeds ? undefined : embeddedRating,
                succeeds ? undefined : embeddedRating,
                embeddedRating,
                embeddedRating,
            ]);
        });
    }
});
