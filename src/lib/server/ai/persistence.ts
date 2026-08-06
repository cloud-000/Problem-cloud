import { env } from "$env/dynamic/private";
import { PUBLIC_SUPABASE_URL } from "$env/static/public";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseContextSnapshot, parseMessagePart } from "$lib/ai/schemas";
import type {
    AIMessageStatus,
    AIThreadIdentity,
    AIUsage,
    ContextSnapshot,
    ConversationSummary,
    NormalizedAIMessage,
    WorkThreadSummary,
} from "$lib/ai/types";
import type { WorkAnchor } from "$lib/ai/session/anchor";
import type { CoachThreadKind } from "$lib/ai/session/tier";
import type { Database, Json } from "$lib/types/database.types";
import { messageText, partsText, PREVIEW_MAX_CHARS } from "$lib/ai/conversations";
import { compileContextFrames } from "$lib/ai/context/resolve";
import {
    encodeCursor,
    type ConversationCursor,
    CONVERSATION_PAGE_DEFAULT,
} from "./conversation-cursor";

/**
 * Default bound on history handed to a provider: the most recent messages, oldest
 * first, capped by both turn count and total characters. Applied from the newest
 * message backwards so the most relevant turns always survive truncation.
 */
export const HISTORY_MAX_MESSAGES = 20;
export const HISTORY_MAX_CHARS = 24_000;

export interface HistoryBudget {
    maxMessages?: number;
    maxChars?: number;
}

export class AIPersistenceError extends Error {
    constructor(readonly code: "persistence_unavailable" | "conversation_not_found", message: string) {
        super(message);
        this.name = "AIPersistenceError";
    }
}

/**
 * Two surfaces opened the same problem in the same sitting and both minted an id (§2).
 *
 * The work-anchor index raises rather than letting the insert fork the thread, so the
 * loser is told which conversation actually owns the anchor. That is the same "continue"
 * branch the resume prompt takes, reached from a lost race instead of a choice.
 */
export class AIWorkAnchorConflict extends Error {
    readonly code = "work_anchor_conflict";
    constructor(readonly conversationId: string) {
        super("Another Coach thread already owns this problem in this session");
        this.name = "AIWorkAnchorConflict";
    }
}

/** Postgres unique-violation. The insert lost a race; the row it collided with is live. */
const UNIQUE_VIOLATION = "23505";

let adminClient: SupabaseClient<Database> | null = null;

function admin(): SupabaseClient<Database> {
    if (adminClient) return adminClient;
    const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_DEV_SECRET_KEY;
    if (!secret) {
        throw new AIPersistenceError(
            "persistence_unavailable",
            "Server-owned AI persistence is not configured",
        );
    }
    adminClient = createClient<Database>(PUBLIC_SUPABASE_URL, secret, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return adminClient;
}

export async function preferencesFor(userId: string) {
    const client = admin();
    const { data, error } = await client
        .from("ai_preferences")
        .select("default_model, history_enabled, retention_days")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) throw error;
    if (data) return data;
    const defaults = {
        user_id: userId,
        default_model: "auto",
        history_enabled: true,
        retention_days: 30,
    };
    const { error: insertError } = await client.from("ai_preferences").insert(defaults);
    if (insertError) throw insertError;
    return defaults;
}

/** Patches only the preferences supplied; absent fields are left as they are. */
export async function updatePreferences(
    userId: string,
    patch: { historyEnabled?: boolean; defaultModel?: string },
) {
    await preferencesFor(userId);
    const update: Database["public"]["Tables"]["ai_preferences"]["Update"] = {
        updated_at: new Date().toISOString(),
    };
    if (patch.historyEnabled !== undefined) update.history_enabled = patch.historyEnabled;
    if (patch.defaultModel !== undefined) update.default_model = patch.defaultModel;
    const { error } = await admin().from("ai_preferences").update(update).eq("user_id", userId);
    if (error) throw error;
}

function normalizedParts(value: unknown): NormalizedAIMessage["parts"] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((part) => {
        try {
            return [parseMessagePart(part)];
        } catch {
            return [];
        }
    });
}

function normalizedMessageStatus(value: string): AIMessageStatus {
    return value === "streaming" || value === "failed" || value === "cancelled"
        ? value
        : "complete";
}

interface MessageRow {
    id: string;
    role: string;
    content_parts: Json;
    status: string;
    created_at: string;
    resolved_model: string | null;
    context_snapshot: Json;
}

const MESSAGE_COLUMNS = "id, role, content_parts, status, created_at, resolved_model, context_snapshot";

function normalizedMessage(message: MessageRow): NormalizedAIMessage {
    return {
        id: message.id,
        role: message.role === "user" ? "user" : "assistant",
        parts: normalizedParts(message.content_parts),
        status: normalizedMessageStatus(message.status),
        createdAt: message.created_at,
        resolvedModel: message.resolved_model ?? undefined,
        contextSnapshot: parseContextSnapshot(message.context_snapshot),
    };
}

/** A conversation's messages, oldest first. */
async function messagesFor(conversationId: string): Promise<NormalizedAIMessage[]> {
    const { data, error } = await admin()
        .from("ai_messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(normalizedMessage);
}

/**
 * One page of the user's non-archived conversations, newest first. Fetches one row
 * beyond `limit` to decide whether a `nextCursor` exists without a second count query.
 */
export async function listConversations(
    userId: string,
    cursor: ConversationCursor | undefined,
    limit = CONVERSATION_PAGE_DEFAULT,
): Promise<{ conversations: ConversationSummary[]; nextCursor?: string }> {
    let query = admin()
        .from("ai_conversations")
        .select("id, title, created_at, updated_at")
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);

    if (cursor) {
        // Keyset on the full (updated_at, id) sort key so ties page deterministically.
        query = query.or(
            `updated_at.lt."${cursor.updatedAt}",and(updated_at.eq."${cursor.updatedAt}",id.lt."${cursor.id}")`,
        );
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
        rows.length > limit && last
            ? encodeCursor({ updatedAt: last.updated_at, id: last.id })
            : undefined;

    const previews = await previewsFor(page.map((row) => row.id));
    return {
        conversations: page.map((row) => ({
            id: row.id,
            title: row.title,
            preview: previews.get(row.id)?.preview ?? "",
            messageCount: previews.get(row.id)?.messageCount ?? 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })),
        nextCursor,
    };
}

/** Message count and newest non-empty text preview for each conversation in a page. */
async function previewsFor(
    conversationIds: string[],
): Promise<Map<string, { preview: string; messageCount: number }>> {
    const result = new Map<string, { preview: string; messageCount: number }>();
    if (conversationIds.length === 0) return result;

    const { data, error } = await admin()
        .from("ai_messages")
        .select("conversation_id, content_parts, created_at")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false });
    if (error) throw error;

    for (const row of data ?? []) {
        const entry = result.get(row.conversation_id) ?? { preview: "", messageCount: 0 };
        entry.messageCount += 1;
        if (!entry.preview) {
            const text = partsText(normalizedParts(row.content_parts));
            if (text) entry.preview = text.slice(0, PREVIEW_MAX_CHARS);
        }
        result.set(row.conversation_id, entry);
    }
    return result;
}

/** A single owned, non-archived conversation with its full transcript. */
export async function conversationById(userId: string, conversationId: string) {
    const { data, error } = await admin()
        .from("ai_conversations")
        .select("id, title, kind, problem_id, practice_session_id, created_at, updated_at")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .is("archived_at", null)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new AIPersistenceError("conversation_not_found", "Conversation not found");
    const kind: CoachThreadKind = data.kind === "work" ? "work" : "assist";
    return {
        id: data.id,
        title: data.title,
        kind,
        // A work thread whose problem was deleted comes back anchorless rather than
        // half-anchored: `on delete set null` nulls the column, and the thread is still
        // the user's to read.
        anchor:
            kind === "work" && data.problem_id !== null
                ? {
                      problemId: data.problem_id,
                      practiceSessionId: data.practice_session_id,
                  }
                : undefined,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        messages: await messagesFor(data.id),
    };
}

/**
 * Bounded prior turns for a persisted conversation, oldest first. Ownership is
 * verified here rather than trusted from the caller.
 */
export async function conversationHistory(
    userId: string,
    conversationId: string,
    budget: HistoryBudget = {},
): Promise<NormalizedAIMessage[]> {
    await ensureOwnedConversation(userId, conversationId);
    const maxMessages = budget.maxMessages ?? HISTORY_MAX_MESSAGES;
    const maxChars = budget.maxChars ?? HISTORY_MAX_CHARS;
    const messages = await messagesFor(conversationId);

    const selected: NormalizedAIMessage[] = [];
    let chars = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const text = messageText(message);
        if (!text) continue;
        if (selected.length >= maxMessages) break;
        if (chars + text.length > maxChars && selected.length > 0) break;
        chars += text.length;
        selected.push(message);
    }
    return selected.reverse();
}

export async function resolveTurnContext(
    userId: string,
    contextSnapshot: ContextSnapshot,
    history: NormalizedAIMessage[],
): Promise<{ renderedContext: string; history: NormalizedAIMessage[] }> {
    const client = admin();
    return compileContextFrames(client, history, contextSnapshot, userId);
}

/**
 * Retires a work thread from its anchor (§5), freeing the unique-index slot.
 *
 * Deliberately not `archiveConversation`. Retiring is not deleting: the thread stays in
 * the user's history, stays readable, and is still offered back on a return visit — it
 * only stops being the *live* thread for the anchor, so the next sitting can start its
 * own. Archiving it here — one column doing both jobs — is what made every concluded
 * sitting's chat disappear from history, which §2 and §5 both promise it does not.
 */
export async function retireConversation(userId: string, conversationId: string): Promise<void> {
    // Idempotent on purpose: a thread resumed after it was retired is retired again when
    // the student leaves, and re-stamping the timestamp would falsify when it first came
    // off the anchor. An already-retired row is a no-op success; only an id that is not
    // the user's own is still an error.
    const { data, error } = await admin()
        .from("ai_conversations")
        .update({ retired_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("user_id", userId)
        .is("retired_at", null)
        .select("id")
        .maybeSingle();
    if (error) throw error;
    if (data) return;
    await ensureOwnedConversation(userId, conversationId);
}

/** Soft-archives an owned conversation; messages are retained for a future restore. */
export async function archiveConversation(userId: string, conversationId: string): Promise<void> {
    const { data, error } = await admin()
        .from("ai_conversations")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("user_id", userId)
        .is("archived_at", null)
        .select("id")
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new AIPersistenceError("conversation_not_found", "Conversation not found");
}

/**
 * Returns the caller's conversation, creating it if this is its first turn.
 *
 * The id is normally minted by the browser before the first token, so a conversation
 * has a stable identity from the outset instead of learning one from a later response.
 * Insert-if-absent then verify ownership: an id that collides with another user's row
 * inserts nothing and fails the ownership check, so a guessed id can never reach
 * someone else's conversation.
 */
export async function ensureConversation(input: {
    userId: string;
    conversationId?: string;
    titleSource?: string;
    /** Which family the row is created as (§2). Ignored for a conversation that exists. */
    thread?: AIThreadIdentity;
}): Promise<string> {
    const { userId, thread } = input;
    const id = input.conversationId ?? crypto.randomUUID();
    const title = input.titleSource?.trim().slice(0, 80) || "New conversation";
    const anchor = thread?.kind === "work" ? thread.anchor : undefined;
    const { error } = await admin()
        .from("ai_conversations")
        .upsert(
            {
                id,
                user_id: userId,
                title,
                kind: thread?.kind ?? "assist",
                problem_id: anchor?.problemId ?? null,
                practice_session_id: anchor?.practiceSessionId ?? null,
            },
            { onConflict: "id", ignoreDuplicates: true },
        );
    if (error) {
        // `ignoreDuplicates` speaks only for the primary key, so the work-anchor index
        // still raises — deliberately, since the alternative is two live threads for one
        // sitting. Resolve it to whichever row won and hand that id back.
        if (error.code === UNIQUE_VIOLATION && anchor) {
            const existing = await workConversationForAnchor(userId, anchor);
            if (existing && existing.id !== id) throw new AIWorkAnchorConflict(existing.id);
        }
        throw error;
    }
    await ensureOwnedConversation(userId, id);
    return id;
}

/**
 * The most recent work thread for an anchor, if the user has one.
 *
 * **Retired threads are deliberately included (revised 2026-08-06).** Only *live* rows
 * are bounded to one per anchor, so this orders and takes the newest rather than reading
 * the single live row — and it has to, because the sitting the student most wants back is
 * a finished one ("what was I struggling with here?"), and finishing is exactly what
 * retires the row. Attaching to a retired thread is safe: writes go by conversation id,
 * and a retired row is not competing for the anchor slot, so nothing can collide.
 *
 * Archived threads stay excluded — that is the user's own delete.
 *
 * Staleness is deliberately not applied here: §5's `workResumable` runs client-side, so
 * the row (with `last_active_at`) is returned and the one pure rule decides in one place.
 */
export async function workConversationForAnchor(
    userId: string,
    anchor: WorkAnchor,
): Promise<WorkThreadSummary | null> {
    const query = admin()
        .from("ai_conversations")
        .select("id, title, last_active_at")
        .eq("user_id", userId)
        .eq("kind", "work")
        .eq("problem_id", anchor.problemId)
        .is("archived_at", null)
        .order("last_active_at", { ascending: false })
        .limit(1);
    // Library work has no session. `is` rather than `eq`, because `= null` matches
    // nothing in SQL — the index's `nulls not distinct` makes that slot a real one.
    const { data, error } = await (anchor.practiceSessionId === null
        ? query.is("practice_session_id", null)
        : query.eq("practice_session_id", anchor.practiceSessionId)
    ).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const preview = (await previewsFor([data.id])).get(data.id);
    return {
        id: data.id,
        title: data.title,
        preview: preview?.preview ?? "",
        messageCount: preview?.messageCount ?? 0,
        lastActiveAt: data.last_active_at,
    };
}

export async function ensureOwnedConversation(userId: string, conversationId: string): Promise<void> {
    const { data, error } = await admin()
        .from("ai_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        throw new AIPersistenceError("conversation_not_found", "Conversation not found");
    }
}

/**
 * @param id The browser's id for this turn. Supplying it makes the write idempotent —
 * a retried save (the client may re-POST a turn whose first attempt failed) resolves to
 * the same row instead of duplicating the prompt — and keeps the in-memory transcript
 * and the stored one addressable by the same id.
 */
export async function saveUserMessage(
    conversationId: string,
    message: string,
    id: string = crypto.randomUUID(),
    contextSnapshot: ContextSnapshot = {
        version: 2,
        policy: "assist",
        scope: [],
        attachments: [],
    },
): Promise<string> {
    const { error } = await admin()
        .from("ai_messages")
        .upsert(
            {
                id,
                conversation_id: conversationId,
                role: "user",
                content_parts: [{ type: "text", text: message }],
                context_snapshot: contextSnapshot as unknown as Json,
                status: "complete",
            },
            { onConflict: "id", ignoreDuplicates: true },
        );
    if (error) throw error;
    await touchConversation(conversationId);
    return id;
}

/**
 * Writes a one-shot's in-memory transcript when it is escalated (§1).
 *
 * The whole thread lands in one statement, keyed on the ids the browser's transcript
 * already uses, so a re-flush resolves to the same rows instead of duplicating turns.
 * `created_at` is taken from the transcript rather than left to default: every row
 * would otherwise share this instant and the thread would come back in an arbitrary
 * order. The values describe the caller's own conversation, so a skewed clock can
 * only reorder their own turns.
 */
export async function saveTranscript(
    conversationId: string,
    messages: NormalizedAIMessage[],
): Promise<void> {
    if (messages.length === 0) return;
    const { error } = await admin()
        .from("ai_messages")
        .upsert(
            messages.map((message) => ({
                id: message.id,
                conversation_id: conversationId,
                role: message.role,
                content_parts: message.parts as unknown as Json,
                status: message.status,
                resolved_model: message.resolvedModel ?? null,
                context_snapshot: (message.contextSnapshot ?? []) as unknown as Json,
                created_at: new Date(message.createdAt).toISOString(),
            })),
            { onConflict: "id", ignoreDuplicates: true },
        );
    if (error) throw error;
    await touchConversation(conversationId);
}

/** Last-write-wins review back-pointer for a concluded work sitting (§4). */
export async function concludeConversation(
    userId: string,
    conversationId: string,
    submissionId: number,
): Promise<void> {
    const { data, error } = await admin()
        .from("ai_conversations")
        .update({ concluded_submission_id: submissionId })
        .eq("id", conversationId)
        .eq("user_id", userId)
        .eq("kind", "work")
        .select("id")
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new AIPersistenceError("conversation_not_found", "Conversation not found");
}

export async function saveAssistantMessage(input: {
    id: string;
    conversationId: string;
    text: string;
    status: AIMessageStatus;
    providerId: string;
    model: string;
    usage?: AIUsage;
    error?: { code: string; message: string; retryable: boolean };
}): Promise<void> {
    const contentParts: Json[] = [];
    if (input.text) contentParts.push({ type: "text", text: input.text });
    if (input.error) contentParts.push({ type: "error", ...input.error });
    const { error } = await admin().from("ai_messages").upsert({
        id: input.id,
        conversation_id: input.conversationId,
        role: "assistant",
        content_parts: contentParts,
        resolved_provider: input.providerId,
        resolved_model: input.model,
        status: input.status,
        usage_summary: input.usage ? { ...input.usage } : null,
    });
    if (error) throw error;
    await touchConversation(input.conversationId);
}

/**
 * Marks a thread as having just been worked in.
 *
 * `last_active_at` is bumped here and nowhere else, which is the whole point of it being
 * separate from `updated_at`: §5 measures a thread's *idleness*, so a value written only
 * at creation would make a thread the student used all afternoon read as stale.
 */
async function touchConversation(conversationId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await admin()
        .from("ai_conversations")
        .update({ updated_at: now, last_active_at: now })
        .eq("id", conversationId);
    if (error) throw error;
}
