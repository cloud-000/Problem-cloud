export type AICoachConnectionState =
    | "connected"
    | "disconnected"
    | "needs_reauth"
    | "quota_exhausted"
    | "error";

export type AIAuthMethod = "hosted" | "oauth" | "api_key" | "custom_endpoint";
export type AIMessageRole = "user" | "assistant" | "system" | "tool";
export type AIMessageStatus = "streaming" | "complete" | "failed" | "cancelled";
export type AITaskType = "general" | "problem_help" | "agentic" | "vision";
export type AIModelReference = "auto" | `${string}:${string}`;
export type AIContextMode = "general" | "problem-help" | "progress" | "test-locked";
export type AIContextSource = "route" | "trainer" | "modal" | "selection";

export interface AIProviderCapabilities {
    chat: boolean;
    streaming: boolean;
    tools: boolean;
    vision: boolean;
    structuredOutput: boolean;
}

export type AIPresetId = "openai" | "groq" | "deepseek" | "together" | "openrouter" | "custom";

/**
 * The development mock's provider id. Reserved: a user connection may never claim it,
 * and the client uses it to stand the mock down once real connections exist.
 */
export const MOCK_PROVIDER_ID = "mock";

/**
 * A user-supplied connection, sent from the browser on every AI request and used
 * in memory for the lifetime of that request only. Keys are held in the browser
 * (see `$lib/state/ai-credentials.svelte`); the server never persists, logs, or
 * echoes one back.
 */
export interface AIConnectionCredential {
    /** Provider half of `provider:model`. Matches /^[a-z0-9_-]{1,40}$/ and is never "mock". */
    id: string;
    preset: AIPresetId;
    label: string;
    baseURL: string;
    apiKey: string;
    /** Model ids pinned by the user beyond the preset's curated set. */
    models?: string[];
}

/** The browser-local record. Identical to the wire shape plus local bookkeeping. */
export interface StoredAIConnection extends AIConnectionCredential {
    createdAt: string;
}

export interface AIProviderSummary {
    id: string;
    label: string;
    authMethods: readonly AIAuthMethod[];
    capabilities: AIProviderCapabilities;
    connectionState: AICoachConnectionState;
    displayLabel?: string;
    blockingMessage?: string;
}

export interface NormalizedAIModel {
    reference: `${string}:${string}`;
    providerId: string;
    /** The connection's display name, used to group models by provider in pickers. */
    providerLabel?: string;
    id: string;
    label: string;
    description?: string;
    capabilities: AIProviderCapabilities;
    tags: string[];
    available: boolean;
    unavailableReason?: string;
}

export interface AITextPart {
    type: "text";
    text: string;
}

export interface AIStatusPart {
    type: "status";
    label: string;
}

export interface AIErrorPart {
    type: "error";
    code: string;
    message: string;
    retryable: boolean;
}

export interface AIToolPart {
    type: "tool";
    runId: string;
    tool: string;
    status: AIToolRunStatus;
    summary: string;
}

export type AIMessagePart = AITextPart | AIStatusPart | AIErrorPart | AIToolPart;

export interface NormalizedAIMessage {
    id: string;
    role: AIMessageRole;
    parts: AIMessagePart[];
    status: AIMessageStatus;
    createdAt: string;
    resolvedModel?: string;
}

export interface CoachContextDescriptor {
    id: string;
    kind: "route" | "problem" | "progress" | "session" | "selection";
    authoritativeId?: string;
    label: string;
    ephemeralText?: string;
}

export interface CoachQuickAction {
    id: string;
    label: string;
    prompt: string;
}

export interface CoachContextLayer {
    ownerId: string;
    source: AIContextSource;
    priority: number;
    descriptors: CoachContextDescriptor[];
    quickActions: CoachQuickAction[];
    mode: AIContextMode;
}

export type AIToolConsequence = "read" | "navigate" | "write" | "destructive";
export type AIToolConfirmation = "automatic" | "confirm" | "always_confirm";
export type AIToolRunStatus =
    | "proposed"
    | "confirmed"
    | "running"
    | "succeeded"
    | "cancelled"
    | "failed";

export interface AIToolDefinition {
    name: string;
    version: number;
    consequence: AIToolConsequence;
    requiredPermission: string;
    confirmation: AIToolConfirmation;
}

export interface AIAgentPermissions {
    read: "allow" | "ask";
    navigate: "allow" | "ask";
    write: "confirm";
    destructive: "always_confirm";
}

export interface AIUsage {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
}

export type AIMockScenario =
    | "success"
    | "slow"
    | "mid_stream_error"
    | "refusal"
    | "auth_error"
    | "rate_limit"
    | "tool_proposal"
    | "tool_result";

export interface NormalizedAIRequest {
    requestId: string;
    conversationId?: string;
    model: AIModelReference;
    task: AITaskType;
    message: string;
    contexts: CoachContextDescriptor[];
    /** Prior turns supplied to the provider, oldest first, excluding the new prompt. */
    history: NormalizedAIMessage[];
    signal?: AbortSignal;
    scenario?: AIMockScenario;
}

export type NormalizedAIEvent =
    | {
          type: "message.start";
          messageId: string;
          conversationId: string;
          model: string;
      }
    | { type: "message.delta"; messageId: string; delta: string }
    | { type: "status"; messageId: string; label: string }
    | {
          type: "tool.proposed";
          messageId: string;
          runId: string;
          tool: string;
          summary: string;
      }
    | { type: "tool.started"; messageId: string; runId: string }
    | {
          type: "tool.result";
          messageId: string;
          runId: string;
          summary: string;
      }
    | { type: "usage"; messageId: string; usage: AIUsage }
    | {
          type: "error";
          messageId?: string;
          code: string;
          message: string;
          retryable: boolean;
      }
    | {
          type: "message.done";
          messageId: string;
          status: Exclude<AIMessageStatus, "streaming">;
      };

export interface AIEphemeralMessage {
    role: "user" | "assistant";
    text: string;
}

export interface AIChatRequestBody {
    conversationId?: string;
    model: AIModelReference;
    message: string;
    contexts: CoachContextDescriptor[];
    task: AITaskType;
    /**
     * Client-supplied prior turns, accepted only when history is disabled and never
     * persisted. Ignored for persisted conversations, whose history is server-loaded.
     */
    ephemeralHistory?: AIEphemeralMessage[];
}

/** A finished BYOK turn, handed to the server purely to be saved. */
export interface AIPersistTurnRequest {
    conversationId?: string;
    contexts: CoachContextDescriptor[];
    message: string;
    assistant: {
        text: string;
        model: string;
        providerId: string;
        status: Exclude<AIMessageStatus, "streaming">;
        usage?: AIUsage;
        error?: { code: string; message: string; retryable: boolean };
    };
}

export interface ConversationSummary {
    id: string;
    title: string;
    preview: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface ConversationListResponse {
    conversations: ConversationSummary[];
    nextCursor?: string;
}

export interface ConversationDetailResponse {
    conversation: {
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messages: NormalizedAIMessage[];
    };
}

export interface AIBootstrap {
    enabled: boolean;
    /** Every connection the caller supplied, each with its own probed state. */
    connections: AIProviderSummary[];
    models: NormalizedAIModel[];
    defaultModel: AIModelReference;
    historyEnabled: boolean;
    conversation?: {
        id: string;
        messages: NormalizedAIMessage[];
    };
}
