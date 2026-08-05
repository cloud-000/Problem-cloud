import { AI_PRESET_IDS, presetFor } from "./presets";
import { MOCK_PROVIDER_ID } from "./types";
import type {
    AIAgentPermissions,
    AIBootstrap,
    AIChatRequestBody,
    AIConnectionCredential,
    AIConversationFlushRequest,
    AIContextMode,
    AIContextSource,
    AIEphemeralMessage,
    AIMessagePart,
    AIMessageStatus,
    AIModelReference,
    AIPersistTurnRequest,
    AIPresetId,
    AIProviderSummary,
    AITaskType,
    AIUsage,
    AIToolDefinition,
    ConversationDetailResponse,
    ConversationListResponse,
    ConversationSummary,
    CoachContextDescriptor,
    CoachContextLayer,
    NormalizedAIEvent,
    NormalizedAIMessage,
    NormalizedAIModel,
} from "./types";

/** Bounds applied to client-supplied history for history-disabled chats. */
export const EPHEMERAL_HISTORY_MAX_MESSAGES = 20;
export const EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS = 8_000;
export const EPHEMERAL_HISTORY_MAX_TOTAL_CHARS = 24_000;

export class AISchemaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AISchemaError";
    }
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new AISchemaError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maxLength = 10_000): string {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
        throw new AISchemaError(`${label} must be a non-empty string no longer than ${maxLength}`);
    }
    return value;
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    return string(value, label, maxLength);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Conversation and message ids are minted by the browser and land in `uuid` columns,
 * so they are checked here rather than left to fail as an opaque 503 at the database.
 */
function optionalUuid(value: unknown, label: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    const id = string(value, label, 36);
    if (!UUID_PATTERN.test(id)) throw new AISchemaError(`${label} must be a UUID`);
    return id;
}

function oneOf<T extends string>(value: unknown, label: string, values: readonly T[]): T {
    if (typeof value !== "string" || !values.includes(value as T)) {
        throw new AISchemaError(`${label} is invalid`);
    }
    return value as T;
}

function boolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") throw new AISchemaError(`${label} must be a boolean`);
    return value;
}

/**
 * The provider half doubles as a connection id, so it stays narrow. The model half
 * admits "/", ":", "~" and "@" because vendors namespace ids that way (openai/gpt-4o,
 * meta-llama/Llama-3.3-70B-Instruct-Turbo, OpenRouter's ~vendor/model-latest aliases);
 * any-model splits on the first ":" only.
 */
const MODEL_REFERENCE_PATTERN = /^[a-z0-9_-]+:[a-z0-9._\-/:~@]+$/i;

/**
 * Whether a reference is representable, without throwing. Catalog builders use this to
 * skip ids they cannot express — a provider serving one exotic id must not be able to
 * take down the whole catalog.
 */
export function isModelReference(value: string): boolean {
    return value.length <= 200 && MODEL_REFERENCE_PATTERN.test(value);
}

export function parseModelReference(value: unknown): AIModelReference {
    const reference = string(value, "model", 200);
    if (reference === "auto") return reference;
    if (!MODEL_REFERENCE_PATTERN.test(reference)) {
        throw new AISchemaError("model must be auto or provider:model-id");
    }
    return reference as AIModelReference;
}

export function parseContextDescriptor(value: unknown): CoachContextDescriptor {
    const input = record(value, "context descriptor");
    const kind = oneOf(input.kind, "context kind", [
        "route",
        "problem",
        "progress",
        "session",
        "selection",
    ] as const);
    return {
        id: string(input.id, "context id", 120),
        kind,
        authoritativeId: optionalString(input.authoritativeId, "authoritative id", 200),
        label: string(input.label, "context label", 160),
        ephemeralText: optionalString(input.ephemeralText, "ephemeral text", 4_000),
    };
}

export function parseContextLayer(value: unknown): CoachContextLayer {
    const input = record(value, "context layer");
    const descriptors = Array.isArray(input.descriptors)
        ? input.descriptors.map(parseContextDescriptor)
        : (() => {
              throw new AISchemaError("context descriptors must be an array");
          })();
    if (descriptors.length > 12) throw new AISchemaError("too many context descriptors");
    const quickActions = Array.isArray(input.quickActions)
        ? input.quickActions.map((item) => {
              const action = record(item, "quick action");
              return {
                  id: string(action.id, "quick action id", 120),
                  label: string(action.label, "quick action label", 120),
                  prompt: string(action.prompt, "quick action prompt", 1_000),
                  icon: optionalString(action.icon, "quick action icon", 60),
              };
          })
        : [];
    return {
        ownerId: string(input.ownerId, "owner id", 120),
        source: oneOf<AIContextSource>(input.source, "context source", [
            "route",
            "trainer",
            "modal",
            "selection",
        ]),
        priority:
            typeof input.priority === "number" && Number.isFinite(input.priority)
                ? input.priority
                : (() => {
                      throw new AISchemaError("context priority must be a number");
                  })(),
        descriptors,
        quickActions,
        mode: oneOf<AIContextMode>(input.mode, "context mode", [
            "general",
            "problem-help",
            "progress",
            "test-locked",
        ]),
    };
}

export function parseEphemeralHistory(value: unknown): AIEphemeralMessage[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new AISchemaError("ephemeral history must be an array");
    if (value.length > EPHEMERAL_HISTORY_MAX_MESSAGES) {
        throw new AISchemaError(
            `ephemeral history cannot exceed ${EPHEMERAL_HISTORY_MAX_MESSAGES} messages`,
        );
    }
    let total = 0;
    return value.map((item) => {
        const entry = record(item, "ephemeral history message");
        const text = string(
            entry.text,
            "ephemeral history text",
            EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS,
        ).trim();
        if (!text) throw new AISchemaError("ephemeral history text cannot be blank");
        total += text.length;
        if (total > EPHEMERAL_HISTORY_MAX_TOTAL_CHARS) {
            throw new AISchemaError(
                `ephemeral history cannot exceed ${EPHEMERAL_HISTORY_MAX_TOTAL_CHARS} characters`,
            );
        }
        return {
            role: oneOf(entry.role, "ephemeral history role", ["user", "assistant"] as const),
            text,
        };
    });
}

/** Each connection costs at least one outbound fetch per bootstrap, so the list is bounded. */
export const MAX_CONNECTIONS = 8;
const CONNECTION_ID_PATTERN = /^[a-z0-9_-]{1,40}$/;

/**
 * Only http(s) endpoints are addressable. There is deliberately no private-address
 * blocklist: the user's own browser makes these requests, not our server, so a private
 * or loopback URL reaches only the user's own machine — which is what makes a local
 * Ollama or vLLM endpoint work. Nothing here protects the server, because the server
 * never fetches a user-supplied URL.
 */
function assertAddressableEndpoint(url: URL): void {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new AISchemaError("base URL must be http or https");
    }
}

export function parseConnectionCredential(value: unknown): AIConnectionCredential {
    const input = record(value, "connection");
    const id = string(input.id, "connection id", 40);
    if (!CONNECTION_ID_PATTERN.test(id)) {
        throw new AISchemaError("connection id must be lowercase letters, digits, _ or -");
    }
    // Reserved for the server-owned development mock.
    if (id === MOCK_PROVIDER_ID) throw new AISchemaError("connection id is reserved");

    const preset = oneOf<AIPresetId>(input.preset, "connection preset", AI_PRESET_IDS);

    let baseURL: URL;
    try {
        baseURL = new URL(string(input.baseURL, "base URL", 400));
    } catch (cause) {
        if (cause instanceof AISchemaError) throw cause;
        throw new AISchemaError("base URL must be a valid URL");
    }
    assertAddressableEndpoint(baseURL);

    const apiKey = typeof input.apiKey === "string" ? input.apiKey : "";
    if (apiKey.length > 400) throw new AISchemaError("api key is too long");
    if (!apiKey && presetFor(preset).requiresKey) {
        throw new AISchemaError("api key is required for this provider");
    }

    let models: string[] | undefined;
    if (input.models !== undefined && input.models !== null) {
        if (!Array.isArray(input.models)) throw new AISchemaError("models must be an array");
        if (input.models.length > 100) throw new AISchemaError("too many pinned models");
        models = input.models.map((model) => string(model, "model id", 160));
    }

    return {
        id,
        preset,
        label: string(input.label, "connection label", 60),
        baseURL: baseURL.toString().replace(/\/$/, ""),
        apiKey,
        models: models && models.length > 0 ? models : undefined,
    };
}

export function parseCredentialEnvelope(value: unknown): AIConnectionCredential[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new AISchemaError("connections must be an array");
    if (value.length > MAX_CONNECTIONS) throw new AISchemaError("too many connections");
    const connections = value.map(parseConnectionCredential);
    const ids = new Set(connections.map((connection) => connection.id));
    if (ids.size !== connections.length) throw new AISchemaError("connection ids must be unique");
    return connections;
}

export function parseChatRequest(value: unknown): AIChatRequestBody {
    const input = record(value, "chat request");
    const contexts = Array.isArray(input.contexts)
        ? input.contexts.map(parseContextDescriptor)
        : [];
    if (contexts.length > 12) throw new AISchemaError("too many context descriptors");
    const message = string(input.message, "message", 8_000).trim();
    if (!message) throw new AISchemaError("message cannot be blank");
    const ephemeralHistory = parseEphemeralHistory(input.ephemeralHistory);
    return {
        conversationId: optionalUuid(input.conversationId, "conversation id"),
        userMessageId: optionalUuid(input.userMessageId, "user message id"),
        model: parseModelReference(input.model ?? "auto"),
        message,
        contexts,
        task: oneOf<AITaskType>(input.task ?? "general", "task", [
            "general",
            "problem_help",
            "agentic",
            "vision",
        ]),
        persist: input.persist === undefined ? true : boolean(input.persist, "persist"),
        ephemeralHistory: ephemeralHistory.length > 0 ? ephemeralHistory : undefined,
    };
}

/** A flush carries a whole transcript, so it is bounded more tightly than a turn. */
export const FLUSH_MAX_MESSAGES = 40;
export const FLUSH_MAX_TOTAL_CHARS = 200_000;

export function parseConversationFlushRequest(value: unknown): AIConversationFlushRequest {
    const input = record(value, "flush request");
    const contexts = Array.isArray(input.contexts) ? input.contexts.map(parseContextDescriptor) : [];
    if (contexts.length > 12) throw new AISchemaError("too many context descriptors");

    const rawMessages = input.messages === undefined || input.messages === null ? [] : input.messages;
    if (!Array.isArray(rawMessages)) throw new AISchemaError("messages must be an array");
    if (rawMessages.length > FLUSH_MAX_MESSAGES) {
        throw new AISchemaError(`a flush cannot exceed ${FLUSH_MAX_MESSAGES} messages`);
    }

    let total = 0;
    const messages = rawMessages.map((item) => {
        const message = parseNormalizedMessage(item);
        // These become uuid primary keys and a timestamptz sort key. Both come from the
        // browser's own transcript, so a malformed one is a client bug worth a 400
        // rather than an opaque 503 from the database.
        if (!UUID_PATTERN.test(message.id)) throw new AISchemaError("message id must be a UUID");
        if (!Number.isFinite(Date.parse(message.createdAt))) {
            throw new AISchemaError("message created at must be a timestamp");
        }
        if (message.role !== "user" && message.role !== "assistant") {
            throw new AISchemaError("flushed messages must be user or assistant turns");
        }
        if (message.status === "streaming") {
            throw new AISchemaError("an unfinished message cannot be flushed");
        }
        for (const part of message.parts) if (part.type === "text") total += part.text.length;
        if (total > FLUSH_MAX_TOTAL_CHARS) {
            throw new AISchemaError(`a flush cannot exceed ${FLUSH_MAX_TOTAL_CHARS} characters`);
        }
        return message;
    });

    return {
        conversationId: optionalUuid(input.conversationId, "conversation id"),
        contexts,
        messages,
    };
}

export function parseUsage(value: unknown): AIUsage {
    const usage = record(value, "usage");
    return {
        inputTokens: number(usage.inputTokens, "input tokens"),
        outputTokens: number(usage.outputTokens, "output tokens"),
        cachedTokens:
            usage.cachedTokens === undefined ? undefined : number(usage.cachedTokens, "cached tokens"),
    };
}

export function parsePersistTurnRequest(value: unknown): AIPersistTurnRequest {
    const input = record(value, "persist request");
    const contexts = Array.isArray(input.contexts)
        ? input.contexts.map(parseContextDescriptor)
        : [];
    if (contexts.length > 12) throw new AISchemaError("too many context descriptors");
    const message = string(input.message, "message", 8_000).trim();
    if (!message) throw new AISchemaError("message cannot be blank");

    const assistant = record(input.assistant, "assistant turn");
    const rawError = assistant.error;
    return {
        conversationId: optionalUuid(input.conversationId, "conversation id"),
        userMessageId: optionalUuid(input.userMessageId, "user message id"),
        contexts,
        message,
        assistant: {
            id: optionalUuid(assistant.id, "assistant message id"),
            // A cancelled turn can legitimately carry no text at all.
            text: typeof assistant.text === "string" ? assistant.text.slice(0, 200_000) : "",
            model: parseModelReference(assistant.model),
            providerId: string(assistant.providerId, "provider id", 100),
            status: oneOf<Exclude<AIMessageStatus, "streaming">>(assistant.status, "status", [
                "complete",
                "failed",
                "cancelled",
            ]),
            usage: assistant.usage === undefined ? undefined : parseUsage(assistant.usage),
            error:
                rawError === undefined || rawError === null
                    ? undefined
                    : {
                          code: string(record(rawError, "error").code, "error code", 80),
                          message: string(record(rawError, "error").message, "error message", 500),
                          retryable: boolean(record(rawError, "error").retryable, "retryable"),
                      },
        },
    };
}

export function parseConversationSummary(value: unknown): ConversationSummary {
    const input = record(value, "conversation summary");
    return {
        id: string(input.id, "conversation id", 80),
        title: string(input.title, "conversation title", 200),
        preview: typeof input.preview === "string" ? input.preview : "",
        messageCount: number(input.messageCount, "message count"),
        createdAt: string(input.createdAt, "created at", 80),
        updatedAt: string(input.updatedAt, "updated at", 80),
    };
}

export function parseConversationList(value: unknown): ConversationListResponse {
    const input = record(value, "conversation list");
    if (!Array.isArray(input.conversations)) {
        throw new AISchemaError("conversations must be an array");
    }
    return {
        conversations: input.conversations.map(parseConversationSummary),
        nextCursor: optionalString(input.nextCursor, "next cursor", 400),
    };
}

export function parseConversationDetail(value: unknown): ConversationDetailResponse {
    const input = record(value, "conversation detail");
    const conversation = record(input.conversation, "conversation");
    if (!Array.isArray(conversation.messages)) {
        throw new AISchemaError("conversation messages must be an array");
    }
    return {
        conversation: {
            id: string(conversation.id, "conversation id", 80),
            title: string(conversation.title, "conversation title", 200),
            createdAt: string(conversation.createdAt, "created at", 80),
            updatedAt: string(conversation.updatedAt, "updated at", 80),
            messages: conversation.messages.map(parseNormalizedMessage),
        },
    };
}

function parseCapabilities(value: unknown) {
    const input = record(value, "provider capabilities");
    return {
        chat: boolean(input.chat, "chat capability"),
        streaming: boolean(input.streaming, "streaming capability"),
        tools: boolean(input.tools, "tools capability"),
        vision: boolean(input.vision, "vision capability"),
        structuredOutput: boolean(input.structuredOutput, "structured output capability"),
    };
}

export function parseProviderSummary(value: unknown): AIProviderSummary {
    const input = record(value, "provider summary");
    if (!Array.isArray(input.authMethods)) throw new AISchemaError("auth methods must be an array");
    return {
        id: string(input.id, "provider id", 100),
        label: string(input.label, "provider label", 120),
        authMethods: input.authMethods.map((method) =>
            oneOf(method, "auth method", ["hosted", "oauth", "api_key", "custom_endpoint"] as const),
        ),
        capabilities: parseCapabilities(input.capabilities),
        connectionState: oneOf(input.connectionState, "connection state", [
            "connected",
            "disconnected",
            "needs_reauth",
            "quota_exhausted",
            "error",
        ] as const),
        displayLabel: optionalString(input.displayLabel, "display label", 160),
        blockingMessage: optionalString(input.blockingMessage, "blocking message", 500),
    };
}

export function parseNormalizedModel(value: unknown): NormalizedAIModel {
    const input = record(value, "model");
    const reference = parseModelReference(input.reference);
    if (reference === "auto") throw new AISchemaError("catalog models require provider:model-id");
    if (!Array.isArray(input.tags)) throw new AISchemaError("model tags must be an array");
    return {
        reference,
        providerId: string(input.providerId, "provider id", 100),
        providerLabel: optionalString(input.providerLabel, "provider label", 60),
        id: string(input.id, "model id", 160),
        label: string(input.label, "model label", 160),
        description: optionalString(input.description, "model description", 500),
        capabilities: parseCapabilities(input.capabilities),
        tags: input.tags.map((tag) => string(tag, "model tag", 80)),
        available: boolean(input.available, "model availability"),
        unavailableReason: optionalString(input.unavailableReason, "unavailable reason", 300),
    };
}

export function parseToolDefinition(value: unknown): AIToolDefinition {
    const input = record(value, "tool definition");
    return {
        name: string(input.name, "tool name", 120),
        version: number(input.version, "tool version"),
        consequence: oneOf(input.consequence, "tool consequence", [
            "read",
            "navigate",
            "write",
            "destructive",
        ] as const),
        requiredPermission: string(input.requiredPermission, "required permission", 120),
        confirmation: oneOf(input.confirmation, "tool confirmation", [
            "automatic",
            "confirm",
            "always_confirm",
        ] as const),
    };
}

export function parseAgentPermissions(value: unknown): AIAgentPermissions {
    const input = record(value, "agent permissions");
    return {
        read: oneOf(input.read, "read permission", ["allow", "ask"] as const),
        navigate: oneOf(input.navigate, "navigate permission", ["allow", "ask"] as const),
        write: oneOf(input.write, "write permission", ["confirm"] as const),
        destructive: oneOf(input.destructive, "destructive permission", ["always_confirm"] as const),
    };
}

export function parseMessagePart(value: unknown): AIMessagePart {
    const input = record(value, "message part");
    const type = string(input.type, "message part type", 40);
    if (type === "text") return { type, text: string(input.text, "text", 100_000) };
    if (type === "status") return { type, label: string(input.label, "status label", 200) };
    if (type === "error") {
        return {
            type,
            code: string(input.code, "error code", 100),
            message: string(input.message, "error message", 1_000),
            retryable: boolean(input.retryable, "retryable"),
        };
    }
    if (type === "tool") {
        return {
            type,
            runId: string(input.runId, "run id", 120),
            tool: string(input.tool, "tool", 120),
            status: oneOf(input.status, "tool status", [
                "proposed",
                "confirmed",
                "running",
                "succeeded",
                "cancelled",
                "failed",
            ] as const),
            summary: string(input.summary, "tool summary", 1_000),
        };
    }
    throw new AISchemaError("message part type is invalid");
}

export function parseNormalizedMessage(value: unknown): NormalizedAIMessage {
    const input = record(value, "message");
    if (!Array.isArray(input.parts)) throw new AISchemaError("message parts must be an array");
    return {
        id: string(input.id, "message id", 80),
        role: oneOf(input.role, "message role", ["user", "assistant", "system", "tool"] as const),
        parts: input.parts.map(parseMessagePart),
        status: oneOf(input.status, "message status", [
            "streaming",
            "complete",
            "failed",
            "cancelled",
        ] as const),
        createdAt: string(input.createdAt, "created at", 80),
        resolvedModel: optionalString(input.resolvedModel, "resolved model", 200),
    };
}

export function parseBootstrap(value: unknown): AIBootstrap {
    const input = record(value, "bootstrap");
    if (!Array.isArray(input.models)) throw new AISchemaError("models must be an array");
    if (!Array.isArray(input.connections)) throw new AISchemaError("connections must be an array");
    if (input.connections.length > MAX_CONNECTIONS) {
        throw new AISchemaError("too many connections");
    }
    return {
        enabled: boolean(input.enabled, "feature enabled"),
        connections: input.connections.map(parseProviderSummary),
        models: input.models.map(parseNormalizedModel),
        defaultModel: parseModelReference(input.defaultModel),
        historyEnabled: boolean(input.historyEnabled, "history enabled"),
    };
}

export function parseAIEvent(value: unknown): NormalizedAIEvent {
    const input = record(value, "stream event");
    const type = string(input.type, "stream event type", 60);
    switch (type) {
        case "message.start":
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                conversationId: string(input.conversationId, "conversation id", 80),
                model: string(input.model, "model", 200),
            };
        case "message.delta":
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                delta: string(input.delta, "delta", 20_000),
            };
        case "status":
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                label: string(input.label, "status label", 200),
            };
        case "tool.proposed":
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                runId: string(input.runId, "run id", 80),
                tool: string(input.tool, "tool", 120),
                summary: string(input.summary, "tool summary", 1_000),
            };
        case "tool.started":
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                runId: string(input.runId, "run id", 80),
            };
        case "tool.result":
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                runId: string(input.runId, "run id", 80),
                summary: string(input.summary, "tool result", 1_000),
            };
        case "usage":
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                usage: parseUsage(input.usage),
            };
        case "error":
            return {
                type,
                messageId: optionalString(input.messageId, "message id", 80),
                code: string(input.code, "error code", 100),
                message: string(input.message, "error message", 1_000),
                retryable: boolean(input.retryable, "retryable"),
            };
        case "message.done":
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                status: oneOf(input.status, "message status", [
                    "complete",
                    "failed",
                    "cancelled",
                ] as const),
            };
        default:
            throw new AISchemaError("stream event type is invalid");
    }
}

function number(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new AISchemaError(`${label} must be a non-negative number`);
    }
    return value;
}
