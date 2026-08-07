import { AI_PRESET_IDS, presetFor } from "./presets";
import { MOCK_PROVIDER_ID } from "./types";
import { COACH_THREAD_KINDS, type CoachThreadKind } from "./session/tier";
import type {
    AIAgentPermissions,
    AIBootstrap,
    AIChatRequestBody,
    AIConnectionCredential,
    AIConversationFlushRequest,
    AIEphemeralMessage,
    AIMessagePart,
    AIMessageStatus,
    AIModelReference,
    AIPersistTurnRequest,
    AIPresetId,
    AIProviderSummary,
    AITaskType,
    AIThreadIdentity,
    AIUsage,
    AIToolDefinition,
    ConversationDetailResponse,
    ConversationListResponse,
    ConversationSummary,
    AttachmentRef,
    ContextSnapshot,
    FactRef,
    Policy,
    ScopeRef,
    NormalizedAIEvent,
    NormalizedAIMessage,
    NormalizedAIModel,
    AIProviderMessage,
    WorkThreadResponse,
} from "./types";

/** Bounds applied to client-supplied history for history-disabled chats. */
export const EPHEMERAL_HISTORY_MAX_MESSAGES = 20;
export const EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS = 8_000;
export const EPHEMERAL_HISTORY_MAX_TOTAL_CHARS = 24_000;
const REQUEST_SNAPSHOT_MAX_MESSAGES = EPHEMERAL_HISTORY_MAX_MESSAGES + 2;
const REQUEST_SNAPSHOT_MAX_CHARS = 100_000;

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

function parseFactRef(value: unknown): FactRef {
    const input = record(value, "fact reference");
    const kind = oneOf(input.kind, "fact kind", ["problem", "test", "series", "selection"] as const);
    if (kind === "problem" || kind === "test" || kind === "series") {
        return { kind, id: rowId(input.id, `${kind} id`) };
    }
    return { kind, text: string(input.text, "selection text", 4_000) };
}

function parsePolicy(value: unknown): Policy {
    return oneOf(value ?? "assist", "context policy", ["coaching", "test-locked", "assist"] as const);
}

function parseSnapshotFactList(value: unknown, label: string): FactRef[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new AISchemaError(`${label} must be an array`);
    if (value.length > 12) throw new AISchemaError(`too many ${label} facts`);
    return value.flatMap((item) => {
        const input = record(item, "fact reference");
        // Old snapshots can contain ambient profile or attempt telemetry. They remain
        // readable, but obsolete facts are discarded rather than rendered or rewritten.
        if (input.kind === "attempt" || input.kind === "user-profile") return [];
        return [parseFactRef(input)];
    });
}

const isScopeRef = (ref: FactRef): ref is ScopeRef => ref.kind !== "selection";
const isAttachmentRef = (ref: FactRef): ref is AttachmentRef => ref.kind === "selection";

/** Accepts legacy ref arrays while every newly-written turn uses the V2 envelope. */
export function parseContextSnapshot(value: unknown, fallbackPolicy: Policy = "assist"): ContextSnapshot {
    if (value === undefined || value === null) {
        return { version: 2, policy: fallbackPolicy, scope: [], attachments: [] };
    }
    if (Array.isArray(value)) {
        const refs = parseSnapshotFactList(value, "context snapshot");
        return {
            version: 2,
            policy: fallbackPolicy,
            scope: refs.filter(isScopeRef),
            attachments: refs.filter(isAttachmentRef),
        };
    }
    const input = record(value, "context snapshot");
    if (input.version !== 2) throw new AISchemaError("context snapshot version is invalid");
    const scope = parseSnapshotFactList(input.scope, "context scope");
    const attachments = parseSnapshotFactList(input.attachments, "context attachments");
    if (!scope.every(isScopeRef)) {
        throw new AISchemaError("context scope contains a turn-local fact");
    }
    if (!attachments.every(isAttachmentRef)) {
        throw new AISchemaError("context attachments contain a scope fact");
    }
    return {
        version: 2,
        policy: parsePolicy(input.policy ?? fallbackPolicy),
        scope,
        attachments,
    };
}

/**
 * A row id from the browser. Rejected here rather than left to fail as an opaque 503:
 * these land in `bigint` columns, and a float or a stringified id would either error at
 * the database or — worse for `practice_session_id`, which has no FK — store a value
 * the anchor lookup can never match again.
 */
function rowId(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new AISchemaError(`${label} must be a positive integer`);
    }
    return value;
}

/**
 * Which thread a request writes into (§2). An anchor is accepted only for `work`: a
 * `kind`/anchor mismatch is a client bug, and silently keeping the anchor would file an
 * assist thread into the work-anchor index — the one place a wrong value is not inert.
 */
export function parseThreadIdentity(value: unknown): AIThreadIdentity | undefined {
    if (value === undefined || value === null) return undefined;
    const input = record(value, "thread");
    const kind = oneOf<CoachThreadKind>(input.kind, "thread kind", COACH_THREAD_KINDS);
    if (input.anchor === undefined || input.anchor === null) return { kind };
    if (kind !== "work") throw new AISchemaError("only a work thread may carry an anchor");
    const anchor = record(input.anchor, "anchor");
    return {
        kind,
        anchor: {
            problemId: rowId(anchor.problemId, "anchor problem id"),
            practiceSessionId:
                anchor.practiceSessionId === undefined || anchor.practiceSessionId === null
                    ? null
                    : rowId(anchor.practiceSessionId, "anchor practice session id"),
        },
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
    const message = string(input.message, "message", 8_000).trim();
    if (!message) throw new AISchemaError("message cannot be blank");
    const ephemeralHistory = parseEphemeralHistory(input.ephemeralHistory);
    // V2 snapshots own the turn policy. The top-level field is read only as a
    // compatibility fallback for legacy ref-array or absent snapshots.
    const legacySnapshot =
        input.contextSnapshot === undefined ||
        input.contextSnapshot === null ||
        Array.isArray(input.contextSnapshot);
    const snapshot = parseContextSnapshot(
        input.contextSnapshot,
        legacySnapshot ? parsePolicy(input.policy) : "assist",
    );
    const debug = input.debug === undefined ? undefined : boolean(input.debug, "debug");
    return {
        conversationId: optionalUuid(input.conversationId, "conversation id"),
        userMessageId: optionalUuid(input.userMessageId, "user message id"),
        model: parseModelReference(input.model ?? "auto"),
        message,
        contextSnapshot: snapshot,
        task: oneOf<AITaskType>(input.task ?? "general", "task", [
            "general",
            "problem_help",
            "agentic",
            "vision",
        ]),
        persist: input.persist === undefined ? true : boolean(input.persist, "persist"),
        ...(debug === undefined ? {} : { debug }),
        ephemeralHistory: ephemeralHistory.length > 0 ? ephemeralHistory : undefined,
        thread: parseThreadIdentity(input.thread),
    };
}

function parseProviderMessages(value: unknown): AIProviderMessage[] {
    if (!Array.isArray(value)) throw new AISchemaError("request snapshot messages must be an array");
    if (value.length === 0 || value.length > REQUEST_SNAPSHOT_MAX_MESSAGES) {
        throw new AISchemaError("request snapshot has an invalid message count");
    }
    let total = 0;
    return value.map((message) => {
        const input = record(message, "request snapshot message");
        const content = string(input.content, "request snapshot content", REQUEST_SNAPSHOT_MAX_CHARS);
        total += content.length;
        if (total > REQUEST_SNAPSHOT_MAX_CHARS) {
            throw new AISchemaError("request snapshot is too large");
        }
        return {
            role: oneOf(input.role, "request snapshot role", ["system", "user", "assistant"] as const),
            content,
        };
    });
}

/** A flush carries a whole transcript, so it is bounded more tightly than a turn. */
export const FLUSH_MAX_MESSAGES = 40;
export const FLUSH_MAX_TOTAL_CHARS = 200_000;

export function parseConversationFlushRequest(value: unknown): AIConversationFlushRequest {
    const input = record(value, "flush request");

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
        messages,
        thread: parseThreadIdentity(input.thread),
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
    const message = string(input.message, "message", 8_000).trim();
    if (!message) throw new AISchemaError("message cannot be blank");

    const assistant = record(input.assistant, "assistant turn");
    const rawError = assistant.error;
    return {
        conversationId: optionalUuid(input.conversationId, "conversation id"),
        userMessageId: optionalUuid(input.userMessageId, "user message id"),
        contextSnapshot: parseContextSnapshot(input.contextSnapshot),
        message,
        thread: parseThreadIdentity(input.thread),
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
    const thread = parseThreadIdentity({
        kind: conversation.kind ?? "assist",
        anchor: conversation.anchor,
    });
    return {
        conversation: {
            id: string(conversation.id, "conversation id", 80),
            title: string(conversation.title, "conversation title", 200),
            kind: thread?.kind ?? "assist",
            anchor: thread?.anchor,
            createdAt: string(conversation.createdAt, "created at", 80),
            updatedAt: string(conversation.updatedAt, "updated at", 80),
            messages: conversation.messages.map(parseNormalizedMessage),
        },
    };
}

/**
 * The live work thread for an anchor, or null when there is none (§2). A null answer is
 * the common case — it is what "no prompt, blank Coach" is made of — so it is a normal
 * response rather than a 404.
 */
export function parseWorkThreadResponse(value: unknown): WorkThreadResponse {
    const input = record(value, "work thread");
    if (input.conversation === undefined || input.conversation === null) {
        return { conversation: null };
    }
    const conversation = record(input.conversation, "conversation");
    return {
        conversation: {
            id: string(conversation.id, "conversation id", 80),
            title: string(conversation.title, "conversation title", 200),
            preview: typeof conversation.preview === "string" ? conversation.preview : "",
            messageCount: number(conversation.messageCount, "message count"),
            lastActiveAt: string(conversation.lastActiveAt, "last active at", 80),
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
        contextSnapshot: parseContextSnapshot(input.contextSnapshot),
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
        case "request.snapshot":
            return {
                type,
                requestId: string(input.requestId, "request id", 80),
                model: string(input.model, "model", 200),
                messages: parseProviderMessages(input.messages),
            };
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
