import { describe, expect, test } from "bun:test";
import {
    CONVERSATION_PAGE_DEFAULT,
    ConversationCursorError,
    decodeCursor,
    encodeCursor,
    parseLimit,
} from "./conversation-cursor";

describe("conversation cursor", () => {
    test("round-trips the full sort key", () => {
        const cursor = { updatedAt: "2026-07-16T12:34:56.789+00:00", id: crypto.randomUUID() };
        expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    });

    test("is opaque and url-safe", () => {
        const encoded = encodeCursor({ updatedAt: "2026-07-16T12:34:56.789+00:00", id: "a".repeat(36) });
        expect(encoded).not.toContain("|");
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(encodeURIComponent(encoded)).toBe(encoded);
    });

    test("rejects malformed cursors", () => {
        // Not base64, decodes without a separator, empty id, and unparseable timestamp.
        expect(() => decodeCursor("!!!not base64!!!")).toThrow(ConversationCursorError);
        expect(() => decodeCursor(btoa("no-separator"))).toThrow(ConversationCursorError);
        expect(() => decodeCursor(btoa("2026-07-16T12:00:00Z|"))).toThrow(ConversationCursorError);
        expect(() => decodeCursor(btoa("not-a-date|some-id"))).toThrow(ConversationCursorError);
    });
});

describe("conversation list limit", () => {
    test("defaults when absent or empty", () => {
        expect(parseLimit(null)).toBe(CONVERSATION_PAGE_DEFAULT);
        expect(parseLimit("")).toBe(CONVERSATION_PAGE_DEFAULT);
    });

    test("accepts the documented 1-50 range", () => {
        expect(parseLimit("1")).toBe(1);
        expect(parseLimit("20")).toBe(20);
        expect(parseLimit("50")).toBe(50);
    });

    test("rejects out-of-range and non-integer limits", () => {
        for (const value of ["0", "-1", "51", "1.5", "abc", "20abc"]) {
            expect(() => parseLimit(value)).toThrow(ConversationCursorError);
        }
    });
});
