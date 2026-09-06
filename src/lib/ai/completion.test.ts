import { describe, expect, test } from "bun:test";
import { completionNotice } from "./completion";
import { parseAIEvent, parseMessagePart, parsePersistTurnRequest } from "./schemas";
import { toProviderMessages } from "./providers/messages";

describe("completion outcomes", () => {
    for (const reason of ["length", "other"] as const) test(`round-trips ${reason} through stream, save and stored parts`, () => {
        const done = parseAIEvent({ type: "message.done", messageId: "m", status: "complete", finishReason: reason });
        expect(done).toHaveProperty("finishReason", reason);
        const saved = parsePersistTurnRequest({ message: "Explain", assistant: {
            text: "Partial", model: "byok:model", providerId: "byok", status: "complete", finishReason: reason,
        } });
        const part = parseMessagePart({ type: "completion", reason: saved.assistant.finishReason });
        expect(part).toEqual({ type: "completion", reason });
        expect(completionNotice(reason)).toContain(reason === "length" ? "token limit" : "Completion unconfirmed");
        const messages = toProviderMessages([{
            id: "m", role: "assistant", parts: [{ type: "text", text: "Partial" }, part],
            status: "complete", createdAt: new Date().toISOString(),
        }], "Continue", "SYSTEM");
        expect(JSON.stringify(messages)).toContain("Partial");
        expect(JSON.stringify(messages)).not.toContain("completion");
    });
    test("old messages and normal stops need no warning", () => {
        expect(completionNotice()).toBeUndefined();
        expect(completionNotice("stop")).toBeUndefined();
        expect(() => parseMessagePart({ type: "completion", reason: "invented" })).toThrow();
    });
});
