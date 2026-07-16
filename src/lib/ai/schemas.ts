import type {
    AIAgentPermissions,
    AIBootstrap,
    AIChatRequestBody,
    AIContextMode,
    AIContextSource,
    AIMessagePart,
    AIModelReference,
    AIProviderSummary,
    AITaskType,
    AIToolDefinition,
    CoachContextDescriptor,
    CoachContextLayer,
    NormalizedAIEvent,
    NormalizedAIMessage,
    NormalizedAIModel,
} from "./types";

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

export function parseModelReference(value: unknown): AIModelReference {
    const reference = string(value, "model", 200);
    if (reference === "auto") return reference;
    if (!/^[a-z0-9_-]+:[a-z0-9._-]+$/i.test(reference)) {
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

export function parseChatRequest(value: unknown): AIChatRequestBody {
    const input = record(value, "chat request");
    const contexts = Array.isArray(input.contexts)
        ? input.contexts.map(parseContextDescriptor)
        : [];
    if (contexts.length > 12) throw new AISchemaError("too many context descriptors");
    const message = string(input.message, "message", 8_000).trim();
    if (!message) throw new AISchemaError("message cannot be blank");
    return {
        conversationId: optionalString(input.conversationId, "conversation id", 80),
        model: parseModelReference(input.model ?? "auto"),
        message,
        contexts,
        task: oneOf<AITaskType>(input.task ?? "general", "task", [
            "general",
            "problem_help",
            "agentic",
            "vision",
        ]),
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
    let conversation: AIBootstrap["conversation"];
    if (input.conversation !== undefined && input.conversation !== null) {
        const rawConversation = record(input.conversation, "conversation");
        if (!Array.isArray(rawConversation.messages)) {
            throw new AISchemaError("conversation messages must be an array");
        }
        conversation = {
            id: string(rawConversation.id, "conversation id", 80),
            messages: rawConversation.messages.map(parseNormalizedMessage),
        };
    }
    return {
        enabled: boolean(input.enabled, "feature enabled"),
        connection: input.connection === null ? null : parseProviderSummary(input.connection),
        models: input.models.map(parseNormalizedModel),
        defaultModel: parseModelReference(input.defaultModel),
        historyEnabled: boolean(input.historyEnabled, "history enabled"),
        conversation,
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
        case "usage": {
            const usage = record(input.usage, "usage");
            return {
                type,
                messageId: string(input.messageId, "message id", 80),
                usage: {
                    inputTokens: number(usage.inputTokens, "input tokens"),
                    outputTokens: number(usage.outputTokens, "output tokens"),
                    cachedTokens:
                        usage.cachedTokens === undefined
                            ? undefined
                            : number(usage.cachedTokens, "cached tokens"),
                },
            };
        }
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
