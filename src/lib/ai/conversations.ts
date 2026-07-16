/**
 * Pure conversation-history helpers shared by the Coach store and history view.
 * Kept free of runes so they stay unit-testable under `bun test`.
 */
import {
    EPHEMERAL_HISTORY_MAX_MESSAGES,
    EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS,
    EPHEMERAL_HISTORY_MAX_TOTAL_CHARS,
} from "./schemas";
import type {
    AIEphemeralMessage,
    AIMessagePart,
    ConversationSummary,
    NormalizedAIMessage,
} from "./types";

/** Longest preview stored on a conversation summary, server and client alike. */
export const PREVIEW_MAX_CHARS = 160;

/** Concatenated text of message parts, ignoring status/tool/error parts. */
export function partsText(parts: AIMessagePart[]): string {
    return parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
}

/** Concatenated text of a message, ignoring status/tool/error parts. */
export function messageText(message: NormalizedAIMessage): string {
    return partsText(message.parts);
}

/** Newest non-empty message text, matching the server's preview derivation. */
export function latestPreview(messages: NormalizedAIMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const text = messageText(messages[index]);
        if (text) return text.slice(0, PREVIEW_MAX_CHARS);
    }
    return "";
}

/**
 * Later entries win, but each id keeps the position of its first appearance, so
 * appending a page cannot reorder or duplicate rows already on screen.
 */
export function dedupeById(summaries: ConversationSummary[]): ConversationSummary[] {
    const seen = new Map<string, ConversationSummary>();
    for (const summary of summaries) seen.set(summary.id, summary);
    return [...seen.values()];
}

/**
 * Prior turns for a history-disabled chat, mirroring the server's bounds so a
 * request the client builds is never rejected by the validator.
 */
export function boundEphemeralHistory(messages: NormalizedAIMessage[]): AIEphemeralMessage[] {
    const selected: AIEphemeralMessage[] = [];
    let chars = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "user" && message.role !== "assistant") continue;
        const text = messageText(message).slice(0, EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS);
        if (!text) continue;
        if (selected.length >= EPHEMERAL_HISTORY_MAX_MESSAGES) break;
        if (chars + text.length > EPHEMERAL_HISTORY_MAX_TOTAL_CHARS) break;
        chars += text.length;
        selected.push({ role: message.role, text });
    }
    return selected.reverse();
}

export interface ConversationGroup {
    label: string;
    conversations: ConversationSummary[];
}

/** Buckets by recency of `updatedAt`, dropping groups with nothing in them. */
export function groupConversations(
    conversations: ConversationSummary[],
    now = new Date(),
): ConversationGroup[] {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000;

    const today: ConversationSummary[] = [];
    const week: ConversationSummary[] = [];
    const older: ConversationSummary[] = [];
    for (const conversation of conversations) {
        const updated = new Date(conversation.updatedAt).getTime();
        if (Number.isNaN(updated) || updated >= startOfToday.getTime()) today.push(conversation);
        else if (updated >= weekAgo) week.push(conversation);
        else older.push(conversation);
    }
    return [
        { label: "Today", conversations: today },
        { label: "Previous 7 days", conversations: week },
        { label: "Older", conversations: older },
    ].filter((group) => group.conversations.length > 0);
}
