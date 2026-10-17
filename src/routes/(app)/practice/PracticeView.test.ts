import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { answersMatch } from "#lib/utils/answer-matcher.js";
import {
    createPracticeAnswerState,
    hasTriedPracticeAnswer,
    practiceAnswerKey,
} from "./practice-state";

// Execute the component's actual handler with its surrounding services supplied
// by the test. This covers early-return ordering and try accounting without
// mounting the trainer's unrelated auth, whiteboard, and Coach surfaces.
const component = readFileSync(new URL("./PracticeView.svelte", import.meta.url), "utf8");
const script = component.slice(component.indexOf(">") + 1, component.indexOf("</script>"));
const ast = ts.createSourceFile("PracticeView.ts", script, ts.ScriptTarget.Latest, true);
const handler = ast.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "submitAnswer",
);
if (!handler) throw new Error("PracticeView submitAnswer handler not found");
const handlerJs = ts.transpile(handler.getText(ast), { target: ts.ScriptTarget.ESNext });

function setup(isProblemMcq = false) {
    const answerState = createPracticeAnswerState();
    const recordSubmission = mock(async (_input: {
        isCorrect: boolean;
        triesUsed: number;
        answer: string | null;
    }) => ({ submissionId: 1 }));
    const warning = mock(() => {});
    const trigger = mock(() => {});
    const bindings = {
        answerState,
        isProblemMcq,
        behavior: { gradeImmediately: true },
        problem: { id: 7, choices: isProblemMcq ? ["A", "B"] : ["10"], answer_index: isProblemMcq ? 1 : 0 },
        paused: false,
        practiceAnswerKey,
        hasTriedPracticeAnswer,
        answerFeedback: { trigger },
        toasts: { warning },
        startedAt: Date.now(),
        responseKind: isProblemMcq ? "mcq" : "short_answer",
        hasAnswer: true,
        answersMatch,
        settingsForm: { triesPerProblem: 3 },
        hintsAvailable: false,
        user: { id: "test-user" },
        trainerSource: { kind: "online", recordSubmission },
        currentSource: "practice",
        currentSessionId: null,
        submissionWrites: new Map(),
        attempts: [],
        capabilities: { coach: false },
        ratingDelta: null,
        refreshPlayerRating: () => {},
    };
    const submit = new Function(...Object.keys(bindings), `${handlerJs}; return submitAnswer;`)(...Object.values(bindings)) as () => Promise<void>;
    return { answerState, submit, recordSubmission, warning, trigger };
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
