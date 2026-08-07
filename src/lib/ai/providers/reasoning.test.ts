import { describe, expect, test } from "bun:test";
import { createReasoningDemux, reasoningFromRawChunk } from "./reasoning";

/** Feed chunks through the demux and collect each lane's full text. */
function run(chunks: string[]): { answer: string; reasoning: string } {
    const demux = createReasoningDemux();
    const out = [...chunks.flatMap((chunk) => demux.answer(chunk)), ...demux.end()];
    return {
        answer: out
            .filter((part) => part.lane === "answer")
            .map((part) => part.text)
            .join(""),
        reasoning: out
            .filter((part) => part.lane === "reasoning")
            .map((part) => part.text)
            .join(""),
    };
}

describe("createReasoningDemux", () => {
    test("passes ordinary content straight through", () => {
        expect(run(["Try ", "$x = 2$", " first."])).toEqual({
            answer: "Try $x = 2$ first.",
            reasoning: "",
        });
    });

    test("splits a <think> block off the front of the answer", () => {
        expect(run(["<think>The discriminant is negative.</think>No real roots."])).toEqual({
            answer: "No real roots.",
            reasoning: "The discriminant is negative.",
        });
    });

    test("survives a tag split across chunk boundaries", () => {
        expect(run(["<th", "ink>", "why", "</thi", "nk>", "answer"])).toEqual({
            answer: "answer",
            reasoning: "why",
        });
    });

    test("never leaks a partial tag into the answer lane", () => {
        // The persisted transcript is built from the answer lane, so a half tag
        // reaching it is stored forever.
        const demux = createReasoningDemux();
        const emitted = [...demux.answer("<thi"), ...demux.answer("nk>hidden</think>shown")];
        expect(emitted.filter((part) => part.lane === "answer").map((part) => part.text)).toEqual([
            "shown",
        ]);
    });

    test("accepts the <thinking> spelling and closes with its own tag", () => {
        expect(run(["<thinking>a</thinking>b"])).toEqual({ answer: "b", reasoning: "a" });
    });

    test("tolerates whitespace before the opener", () => {
        expect(run(["\n\n", "<think>a</think>b"])).toEqual({ answer: "b", reasoning: "a" });
    });

    test("treats a mid-answer <think> as prose, not an opener", () => {
        expect(run(["Now <think> about it."])).toEqual({
            answer: "Now <think> about it.",
            reasoning: "",
        });
    });

    test("flushes an unterminated trace to the reasoning lane", () => {
        expect(run(["<think>cut off"])).toEqual({ answer: "", reasoning: "cut off" });
    });

    test("holds nothing back once the stream is over", () => {
        expect(run(["\n \n"])).toEqual({ answer: "\n \n", reasoning: "" });
    });

    test("reports whether reasoning was seen", () => {
        const plain = createReasoningDemux();
        plain.answer("hello");
        expect(plain.sawReasoning).toBe(false);

        const native = createReasoningDemux();
        native.reasoning("step one");
        expect(native.sawReasoning).toBe(true);
    });

    test("passes provider-labelled reasoning through untouched", () => {
        const demux = createReasoningDemux();
        expect(demux.reasoning("step one")).toEqual([{ lane: "reasoning", text: "step one" }]);
        expect(demux.reasoning("")).toEqual([]);
    });
});

describe("reasoningFromRawChunk", () => {
    test("reads OpenRouter's delta.reasoning", () => {
        expect(reasoningFromRawChunk({ choices: [{ delta: { reasoning: "hmm" } }] })).toBe("hmm");
    });

    test("skips a delta any-model already maps, so a trace is not doubled", () => {
        expect(
            reasoningFromRawChunk({
                choices: [{ delta: { reasoning: "hmm", reasoning_content: "hmm" } }],
            }),
        ).toBe("");
    });

    test("degrades to empty for any other shape", () => {
        expect(reasoningFromRawChunk(null)).toBe("");
        expect(reasoningFromRawChunk({})).toBe("");
        expect(reasoningFromRawChunk({ choices: "no" })).toBe("");
        expect(reasoningFromRawChunk({ choices: [{ delta: { content: "hi" } }] })).toBe("");
    });
});
