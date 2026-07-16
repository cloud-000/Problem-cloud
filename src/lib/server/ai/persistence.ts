import { env } from "$env/dynamic/private";
import { PUBLIC_SUPABASE_URL } from "$env/static/public";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseMessagePart } from "$lib/ai/schemas";
import type {
    AIMessageStatus,
    AIUsage,
    CoachContextDescriptor,
    NormalizedAIMessage,
} from "$lib/ai/types";
import type { Database, Json } from "$lib/types/database.types";

export class AIPersistenceError extends Error {
    constructor(readonly code: "persistence_unavailable" | "conversation_not_found", message: string) {
        super(message);
        this.name = "AIPersistenceError";
    }
}

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

export async function updateHistoryPreference(userId: string, historyEnabled: boolean) {
    await preferencesFor(userId);
    const { error } = await admin()
        .from("ai_preferences")
        .update({ history_enabled: historyEnabled, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
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

export async function latestConversation(userId: string) {
    const client = admin();
    const { data: conversation, error } = await client
        .from("ai_conversations")
        .select("id")
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    if (!conversation) return undefined;
    const { data: messages, error: messageError } = await client
        .from("ai_messages")
        .select("id, role, content_parts, status, created_at, resolved_model")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });
    if (messageError) throw messageError;
    return {
        id: conversation.id,
        messages: (messages ?? []).map(
            (message): NormalizedAIMessage => ({
                id: message.id,
                role: message.role === "user" ? "user" : "assistant",
                parts: normalizedParts(message.content_parts),
                status: normalizedMessageStatus(message.status),
                createdAt: message.created_at,
                resolvedModel: message.resolved_model ?? undefined,
            }),
        ),
    };
}

export async function createConversation(
    userId: string,
    contexts: CoachContextDescriptor[],
    titleSource?: string,
): Promise<string> {
    const id = crypto.randomUUID();
    const title = titleSource?.trim().slice(0, 80) || "New conversation";
    const { error } = await admin().from("ai_conversations").insert({
        id,
        user_id: userId,
        title,
        mode: "general",
        context_summary: contexts.map(({ id: contextId, kind, authoritativeId, label }) => ({
            id: contextId,
            kind,
            authoritativeId,
            label,
        })),
    });
    if (error) throw error;
    return id;
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

export async function saveUserMessage(conversationId: string, message: string): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await admin().from("ai_messages").insert({
        id,
        conversation_id: conversationId,
        role: "user",
        content_parts: [{ type: "text", text: message }],
        status: "complete",
    });
    if (error) throw error;
    await touchConversation(conversationId);
    return id;
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

async function touchConversation(conversationId: string): Promise<void> {
    const { error } = await admin()
        .from("ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    if (error) throw error;
}
