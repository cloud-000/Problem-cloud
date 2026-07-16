/**
 * Opaque keyset cursor for the conversation list.
 *
 * The list sorts by `updated_at desc, id desc`, so a cursor carries both fields to
 * stay stable when several conversations share an `updated_at`. The encoding is
 * base64url of `<updatedAt>|<id>` — opaque to clients, who must round-trip it as-is.
 */

export class ConversationCursorError extends Error {
    readonly code = "invalid_cursor";

    constructor(message = "The conversation cursor is malformed") {
        super(message);
        this.name = "ConversationCursorError";
    }
}

export interface ConversationCursor {
    updatedAt: string;
    id: string;
}

export const CONVERSATION_PAGE_DEFAULT = 20;
export const CONVERSATION_PAGE_MAX = 50;

export function encodeCursor(cursor: ConversationCursor): string {
    // Timestamps and UUIDs are ASCII, so btoa is safe here and avoids a Node dependency.
    return btoa(`${cursor.updatedAt}|${cursor.id}`)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

export function decodeCursor(value: string): ConversationCursor {
    let decoded: string;
    try {
        decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
        throw new ConversationCursorError();
    }
    const separator = decoded.indexOf("|");
    if (separator <= 0) throw new ConversationCursorError();
    const updatedAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (!id || Number.isNaN(Date.parse(updatedAt))) throw new ConversationCursorError();
    return { updatedAt, id };
}

/** Clamps a client-supplied `limit`, rejecting values outside 1–50. */
export function parseLimit(value: string | null): number {
    if (value === null || value === "") return CONVERSATION_PAGE_DEFAULT;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > CONVERSATION_PAGE_MAX) {
        throw new ConversationCursorError(`limit must be an integer from 1 to ${CONVERSATION_PAGE_MAX}`);
    }
    return limit;
}
