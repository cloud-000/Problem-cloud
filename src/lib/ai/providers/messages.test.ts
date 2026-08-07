import { describe, expect, test } from "bun:test";
import type { AIProviderMessage, NormalizedAIMessage } from "../types";
import { CONTEXT_ACK, TAG } from "../prompt";
import { toProviderMessages } from "./messages";

const user = (
    text: string,
    renderedContext?: string,
): NormalizedAIMessage => ({
    id: text,
    role: "user",
    parts: [{ type: "text", text }],
    status: "complete",
    createdAt: "2026-08-07T00:00:00.000Z",
    renderedContext,
});

const assistant = (text: string, status: "complete" | "failed" = "complete"): NormalizedAIMessage => ({
    id: text,
    role: "assistant",
    parts: [{ type: "text", text }],
    status,
    createdAt: "2026-08-07T00:00:00.000Z",
});

const shape = (messages: AIProviderMessage[]) =>
    messages.map((message) => `${message.role}: ${message.content}`);

const FRAME = `[${TAG.problem}]\nStatement`;

describe("provider message assembly", () => {
    test("hands the student's words over verbatim", () => {
        // The whole point: a student turn is never wrapped, tagged, or joined to
        // anything. Previously the first turn of every thread carried the frame and a
        // [Student] tag while the rest were bare, so no two user messages had one shape.
        const messages = toProviderMessages(
            [
                user("How do I start?", FRAME),
                assistant("What have you tried?"),
                user("stuck"),
                assistant("Try splitting it up."),
            ],
            "what now?",
            "SYSTEM",
        );
        const students = messages.filter(
            (message) => message.role === "user" && !message.content.startsWith(`[${TAG.context}]`),
        );
        expect(students.map((message) => message.content)).toEqual([
            "How do I start?",
            "stuck",
            "what now?",
        ]);
    });

    test("puts context in its own message, bracketed by acknowledgements", () => {
        expect(
            shape(toProviderMessages([], "How do I start?", "SYSTEM", FRAME)),
        ).toEqual([
            "system: SYSTEM",
            `user: [${TAG.context}]\n${FRAME}`,
            `assistant: ${CONTEXT_ACK}`,
            "user: How do I start?",
        ]);
    });

    test("emits no frame and no acknowledgement when there is no context", () => {
        const messages = toProviderMessages(
            [user("hello"), assistant("hi")],
            "what should I study?",
            "SYSTEM",
        );
        expect(shape(messages)).toEqual([
            "system: SYSTEM",
            "user: hello",
            "assistant: hi",
            "user: what should I study?",
        ]);
    });

    test("never emits two messages of the same role in a row", () => {
        // Chat templates (DeepSeek, vLLM) 400 on an adjacent same-role pair. A frame
        // lands between two student turns whenever the assistant turn that belonged
        // there failed and was dropped, which is exactly where a naive push would.
        const messages = toProviderMessages(
            [
                user("first", FRAME),
                assistant("broken", "failed"),
                user("second", `[${TAG.selection}]\nchosen text`),
            ],
            "third",
            "SYSTEM",
        );
        const adjacent = messages.filter(
            (message, index) => index > 0 && messages[index - 1].role === message.role,
        );
        expect(adjacent).toEqual([]);
        expect(shape(messages)).toEqual([
            "system: SYSTEM",
            `user: [${TAG.context}]\n${FRAME}`,
            `assistant: ${CONTEXT_ACK}`,
            "user: first",
            `assistant: ${CONTEXT_ACK}`,
            `user: [${TAG.context}]\n[${TAG.selection}]\nchosen text`,
            `assistant: ${CONTEXT_ACK}`,
            // The live turn has no context of its own, so it merges into the student's
            // previous words rather than opening a second user message.
            "user: second\n\nthird",
        ]);
    });

    test("drops the frame of a turn whose text never reaches the provider", () => {
        // Otherwise the frame is left acknowledging a message that was filtered out,
        // and the model reads context attached to nothing.
        const messages = toProviderMessages(
            [user("", FRAME), assistant("hi")],
            "go on",
            "SYSTEM",
        );
        expect(shape(messages)).toEqual(["system: SYSTEM", "assistant: hi", "user: go on"]);
    });
});
