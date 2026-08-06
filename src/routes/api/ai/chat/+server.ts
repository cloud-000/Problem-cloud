import type { RequestHandler } from "./$types";
import { AISchemaError, parseChatRequest } from "$lib/ai/schemas";
import type { AIEphemeralMessage, AIUsage, NormalizedAIEvent, NormalizedAIMessage } from "$lib/ai/types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { catalogFor } from "$lib/ai/catalog";
import { AIModelRoutingError, resolveModel } from "$lib/ai/router";
import {
    AIWorkAnchorConflict,
    conversationHistory,
    ensureConversation,
    preferencesFor,
    resolveTurnContext,
    saveAssistantMessage,
    saveUserMessage,
} from "$lib/server/ai/persistence";
import { AIContextResolutionError } from "$lib/ai/context/resolve";
import { providerRegistry } from "$lib/server/ai/providers/registry";
import { anchorConflictResponse, assertRateLimit, assertSameOrigin, requireAIUser, stableError } from "$lib/server/ai/security";
import { encodeEventStream } from "$lib/server/ai/stream";

/** Converts already-validated ephemeral turns into the normalized provider shape. */
function ephemeralMessages(history: AIEphemeralMessage[] = []): NormalizedAIMessage[] {
    return history.map((entry) => ({
        id: crypto.randomUUID(),
        role: entry.role,
        parts: [{ type: "text", text: entry.text }],
        status: "complete",
        createdAt: new Date(0).toISOString(),
    }));
}

export const POST: RequestHandler = async ({ locals, request, url }) => {
    const user = await requireAIUser(locals);
    assertSameOrigin(request, url);
    assertRateLimit(user.id, "ai.chat", 20);
    if (!aiCoachEnabled()) return stableError("feature_disabled", "Coach is not enabled", 404);

    let body;
    try {
        body = parseChatRequest(await request.json());
    } catch (error) {
        const message = error instanceof AISchemaError ? error.message : "Invalid JSON request";
        return stableError("invalid_request", message, 400);
    }

    try {
        // Server-owned connections only. BYOK models are streamed by the browser straight
        // from the provider and never reach this endpoint.
        const providers = providerRegistry();
        const [{ models }, preferences] = await Promise.all([
            catalogFor(providers),
            preferencesFor(user.id),
        ]);
        const model = resolveModel(body.model, body.task, models);
        const provider = providers.find((candidate) => candidate.id === model.providerId);
        if (!provider || (await provider.validateConnection()) !== "connected") {
            return stableError("connection_unavailable", "The selected AI connection is unavailable", 409);
        }

        // A one-shot asks not to be recorded (§1) and there is no row to write into;
        // saving preferences still veto it, so `persist: false` never becomes true.
        const shouldPersist = preferences.history_enabled && body.persist !== false;
        let conversationId = body.conversationId;
        let history: NormalizedAIMessage[] = [];
        if (shouldPersist) {
            // The browser owns the id; this creates the row on its first turn and
            // verifies ownership on every later one.
            conversationId = await ensureConversation({
                userId: user.id,
                conversationId,
                titleSource: body.message,
                thread: body.thread,
            });
            // Load before saving the new prompt so history holds only prior turns.
            history = await conversationHistory(user.id, conversationId);
            await saveUserMessage(
                conversationId,
                body.message,
                body.userMessageId,
                body.contextSnapshot,
            );
        } else {
            conversationId = crypto.randomUUID();
            // Persisted conversations never trust a client transcript; an unrecorded
            // chat has no server copy, so bounded validated turns are the only source.
            history = ephemeralMessages(body.ephemeralHistory);
        }

        const resolved = await resolveTurnContext(
            body.contextSnapshot,
            history,
        );
        const providerStream = await provider.stream({
            requestId: crypto.randomUUID(),
            conversationId,
            model: model.reference,
            task: body.task,
            message: body.message,
            policy: body.contextSnapshot.policy,
            renderedContext: resolved.renderedContext,
            history: resolved.history,
            signal: request.signal,
        });

        let messageId = "";
        let resolvedModel: string = model.reference;
        let text = "";
        let status: "streaming" | "complete" | "failed" | "cancelled" = "streaming";
        let usage: AIUsage | undefined;
        let streamError: { code: string; message: string; retryable: boolean } | undefined;
        let saved = false;

        const persist = async () => {
            if (!shouldPersist || saved || !messageId || !conversationId) return;
            saved = true;
            await saveAssistantMessage({
                id: messageId,
                conversationId,
                text,
                status: status === "streaming" ? "cancelled" : status,
                providerId: provider.id,
                model: resolvedModel,
                usage,
                error: streamError,
            });
        };

        const stream = encodeEventStream(
            providerStream,
            (event: NormalizedAIEvent) => {
                if (event.type === "message.start") {
                    messageId = event.messageId;
                    resolvedModel = event.model;
                } else if (event.type === "message.delta") text += event.delta;
                else if (event.type === "usage") usage = event.usage;
                else if (event.type === "error") {
                    streamError = {
                        code: event.code,
                        message: event.message,
                        retryable: event.retryable,
                    };
                    status = "failed";
                } else if (event.type === "message.done") {
                    status = event.status;
                }
            },
            persist,
        );

        return new Response(stream, {
            headers: {
                "content-type": "application/x-ndjson; charset=utf-8",
                "cache-control": "no-store, no-transform",
                "x-content-type-options": "nosniff",
            },
        });
    } catch (error) {
        if (error instanceof AIWorkAnchorConflict) return anchorConflictResponse(error);
        if (error instanceof AIModelRoutingError) return stableError(error.code, error.message, 409);
        if (error instanceof AIContextResolutionError) {
            return stableError(error.code, error.message, 503);
        }
        return stableError("chat_unavailable", "Coach could not start the request", 503);
    }
};
