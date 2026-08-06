import { describe, expect, test } from "bun:test";
import {
    boundEphemeralHistory,
    dedupeById,
    flushableTranscript,
    groupConversations,
    latestPreview,
} from "./conversations";
import {
    EPHEMERAL_HISTORY_MAX_MESSAGES,
    EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS,
    EPHEMERAL_HISTORY_MAX_TOTAL_CHARS,
    FLUSH_MAX_MESSAGES,
    parseConversationFlushRequest,
    parseEphemeralHistory,
} from "./schemas";
import type { ConversationSummary, NormalizedAIMessage } from "./types";

function message(
    role: NormalizedAIMessage["role"],
    text: string,
    id = crypto.randomUUID(),
): NormalizedAIMessage {
    return {
        id,
        role,
        parts: text ? [{ type: "text", text }] : [],
        status: "complete",
        createdAt: "2026-07-16T10:00:00Z",
    };
}

function summary(id: string, updatedAt: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
    return {
        id,
        title: `Conversation ${id}`,
        preview: "",
        messageCount: 2,
        createdAt: updatedAt,
        updatedAt,
        ...overrides,
    };
}

describe("conversation summary deduplication", () => {
    test("collapses repeated ids and keeps first-seen order", () => {
        const page = [summary("a", "2026-07-16T10:00:00Z"), summary("b", "2026-07-16T09:00:00Z")];
        const overlapping = [summary("b", "2026-07-16T09:00:00Z"), summary("c", "2026-07-16T08:00:00Z")];
        expect(dedupeById([...page, ...overlapping]).map((item) => item.id)).toEqual(["a", "b", "c"]);
    });

    test("a later page refreshes a row without moving it", () => {
        const first = [summary("a", "2026-07-16T10:00:00Z"), summary("b", "2026-07-16T09:00:00Z")];
        const second = [summary("a", "2026-07-16T10:00:00Z", { title: "Renamed" })];
        const merged = dedupeById([...first, ...second]);
        expect(merged.map((item) => item.id)).toEqual(["a", "b"]);
        expect(merged[0].title).toBe("Renamed");
    });
});

describe("conversation grouping", () => {
    const now = new Date("2026-07-16T12:00:00Z");

    test("splits into today, previous 7 days, and older", () => {
        const groups = groupConversations(
            [
                summary("today", "2026-07-16T09:00:00Z"),
                summary("week", "2026-07-13T09:00:00Z"),
                summary("old", "2026-05-01T09:00:00Z"),
            ],
            now,
        );
        expect(groups.map((group) => group.label)).toEqual(["Today", "Previous 7 days", "Older"]);
        expect(groups[0].conversations[0].id).toBe("today");
        expect(groups[1].conversations[0].id).toBe("week");
        expect(groups[2].conversations[0].id).toBe("old");
    });

    test("omits empty groups", () => {
        const groups = groupConversations([summary("old", "2026-01-01T09:00:00Z")], now);
        expect(groups.map((group) => group.label)).toEqual(["Older"]);
    });

    test("returns nothing for an empty list", () => {
        expect(groupConversations([], now)).toEqual([]);
    });
});

describe("preview derivation", () => {
    test("uses the newest non-empty text and caps its length", () => {
        expect(latestPreview([message("user", "first"), message("assistant", "second")])).toBe("second");
        expect(latestPreview([message("user", "x".repeat(500))])).toHaveLength(160);
    });

    test("skips messages with no text and tolerates an empty transcript", () => {
        expect(latestPreview([message("user", "kept"), message("assistant", "")])).toBe("kept");
        expect(latestPreview([])).toBe("");
    });
});

describe("client ephemeral history bounds", () => {
    test("keeps chronological order and drops empty messages", () => {
        const history = boundEphemeralHistory([
            message("user", "one"),
            message("assistant", ""),
            message("assistant", "two"),
        ]);
        expect(history).toEqual([
            { role: "user", text: "one" },
            { role: "assistant", text: "two" },
        ]);
    });

    test("keeps the most recent turns when over the message bound", () => {
        const messages = Array.from({ length: EPHEMERAL_HISTORY_MAX_MESSAGES + 5 }, (_, index) =>
            message("user", `turn-${index}`),
        );
        const history = boundEphemeralHistory(messages);
        expect(history).toHaveLength(EPHEMERAL_HISTORY_MAX_MESSAGES);
        expect(history.at(-1)?.text).toBe(`turn-${messages.length - 1}`);
        expect(history[0].text).toBe(`turn-${messages.length - EPHEMERAL_HISTORY_MAX_MESSAGES}`);
    });

    test("stays within the total character budget", () => {
        const chunk = "x".repeat(EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS);
        const messages = Array.from({ length: 6 }, () => message("user", chunk));
        const total = boundEphemeralHistory(messages).reduce((sum, item) => sum + item.text.length, 0);
        expect(total).toBeLessThanOrEqual(EPHEMERAL_HISTORY_MAX_TOTAL_CHARS);
    });

    test("produces history the server validator accepts", () => {
        const messages = Array.from({ length: EPHEMERAL_HISTORY_MAX_MESSAGES + 5 }, (_, index) =>
            message(index % 2 === 0 ? "user" : "assistant", "x".repeat(2_000)),
        );
        const history = boundEphemeralHistory(messages);
        expect(() => parseEphemeralHistory(history)).not.toThrow();
    });

    test("excludes roles the provider contract does not carry", () => {
        expect(boundEphemeralHistory([message("system", "hidden"), message("tool", "hidden")])).toEqual([]);
    });
});

describe("flushableTranscript", () => {
    test("keeps the turns an escalated one-shot should write down", () => {
        const messages = [message("user", "how do I start?"), message("assistant", "try factoring")];
        expect(flushableTranscript(messages)).toEqual(messages);
    });

    test("drops what the flush validator would reject", () => {
        const streaming: NormalizedAIMessage = { ...message("assistant", "half"), status: "streaming" };
        const kept = message("user", "kept");
        expect(
            flushableTranscript([message("system", "hidden"), streaming, message("user", ""), kept]),
        ).toEqual([kept]);
    });

    test("truncation drops the oldest turns and stays within the validator's bounds", () => {
        const messages = Array.from({ length: FLUSH_MAX_MESSAGES + 3 }, (_, index) =>
            message(index % 2 === 0 ? "user" : "assistant", `turn ${index}`),
        );
        const flushed = flushableTranscript(messages);
        expect(flushed).toHaveLength(FLUSH_MAX_MESSAGES);
        expect(flushed.at(-1)).toEqual(messages.at(-1)!);
        expect(() =>
            parseConversationFlushRequest({ messages: flushed }),
        ).not.toThrow();
    });
});
