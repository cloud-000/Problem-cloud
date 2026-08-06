import type { WorkAnchor } from "./session/anchor";
import type { CoachThreadKind } from "./session/tier";
import type { CoachContextDescriptor, ContextSnapshot, FactRef } from "./context/facts";
import type { Policy } from "./context/policy";

export type {
    AttachmentRef,
    CoachContextDescriptor,
    ContextSnapshot,
    FactRef,
    ScopeRef,
} from "./context/facts";
export type { Policy } from "./context/policy";

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
    /** Durable, versioned context captured with a user turn; absent on assistant messages. */
    contextSnapshot?: ContextSnapshot;
    /** Runtime-only context frame compiled for this position. Never stored. */
    renderedContext?: string;
}

export interface CoachQuickAction {
    id: string;
    label: string;
    prompt: string;
    /** Material Symbols name, shown by the quick-ask's stacked action pills. */
    icon?: string;
}

export interface CoachContextLayer {
    ownerId: string;
    source: AIContextSource;
    priority: number;
    descriptors: CoachContextDescriptor[];
    quickActions: CoachQuickAction[];
    policy: Policy;
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
    policy: Policy;
    /** Resolved and policy-filtered context for the new user turn. */
    renderedContext: string;
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

/**
 * Which thread a request is writing into (§2/§4), sent on every path that can create a
 * conversation row. Absent means an assist thread with no anchor — the default a panel
 * or an escalated quick-ask takes.
 *
 * The anchor travels on the wire rather than being derived server-side because only the
 * browser knows where the Coach was summoned; the server's job is to store it and let
 * the unique index enforce one live work thread per sitting.
 */
export interface AIThreadIdentity {
    kind: CoachThreadKind;
    /** Set only for `work`. Carries the canonical problem id. */
    anchor?: WorkAnchor;
}

/** A live work thread found by anchor, offered back as "continue or start new chat?". */
export interface WorkThreadSummary {
    id: string;
    title: string;
    preview: string;
    messageCount: number;
    /** Drives §5's staleness cutoff; the client turns it into `idleMs`. */
    lastActiveAt: string;
}

export interface WorkThreadResponse {
    conversation: WorkThreadSummary | null;
}

/**
 * A found thread being offered back to the student (§5), plus the one thing the server
 * cannot know: whether the problem it is about has since been finished. That decides the
 * offer's framing — reviewing a sitting you finished, or picking one back up.
 */
export interface CoachResumeOffer extends WorkThreadSummary {
    concluded: boolean;
}

export interface AIChatRequestBody {
    /** Minted by the browser before the first token; the server creates the row if absent. */
    conversationId?: string;
    /** The browser's id for this prompt, which makes the save idempotent. */
    userMessageId?: string;
    model: AIModelReference;
    message: string;
    contextSnapshot: ContextSnapshot;
    task: AITaskType;
    /**
     * Whether this turn may be written to history at all. Defaults to true; a one-shot
     * (§1) sends false so the server streams without ever creating a conversation row.
     * Saving preferences still override it — false never becomes true.
     */
    persist?: boolean;
    /**
     * Client-supplied prior turns, accepted only when the turn is not persisted and
     * never stored. Ignored for persisted conversations, whose history is server-loaded.
     */
    ephemeralHistory?: AIEphemeralMessage[];
    /** Which thread this turn belongs to; applied only when the row is first created. */
    thread?: AIThreadIdentity;
}

/**
 * A one-shot's in-memory transcript, handed over when it is escalated (§1).
 *
 * Promotion is a flush, not an id negotiation: the browser already minted the
 * conversation id, so this creates the conversation with the turns it already has.
 * Every message carries the id the transcript uses, which makes the flush idempotent.
 */
export interface AIConversationFlushRequest {
    conversationId?: string;
    messages: NormalizedAIMessage[];
    thread?: AIThreadIdentity;
}

/** A finished BYOK turn, handed to the server purely to be saved. */
export interface AIPersistTurnRequest {
    conversationId?: string;
    userMessageId?: string;
    contextSnapshot: ContextSnapshot;
    message: string;
    thread?: AIThreadIdentity;
    assistant: {
        /** The id the transcript already uses, so memory and storage agree. */
        id?: string;
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
        /** Which family the stored thread belongs to, so reopening it restores its tier. */
        kind: CoachThreadKind;
        anchor?: WorkAnchor;
        createdAt: string;
        updatedAt: string;
        messages: NormalizedAIMessage[];
    };
}

/**
 * No `conversation` field, deliberately: assist threads do not auto-resume (§1).
 * Opening the Coach starts a fresh thread and history is one click away, so bootstrap
 * has no transcript to carry. Work threads resume by anchor, not by recency (§2).
 */
export interface AIBootstrap {
    enabled: boolean;
    /** Every connection the caller supplied, each with its own probed state. */
    connections: AIProviderSummary[];
    models: NormalizedAIModel[];
    defaultModel: AIModelReference;
    historyEnabled: boolean;
}
