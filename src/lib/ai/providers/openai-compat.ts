import {
    AnyModelError,
    AuthError,
    ContentFilterError,
    ContextLengthError,
    createRegistry,
    RateLimitError,
    UnsupportedFeatureError,
    type Message,
} from "@any-model/core";
import { openAICompatible } from "@any-model/openai-compat";
import { humanizeModelId, presetFor } from "../presets";
import { isModelReference } from "../schemas";
import type {
    AIAuthMethod,
    AICoachConnectionState,
    AIConnectionCredential,
    AIProviderCapabilities,
    AIProviderSummary,
    NormalizedAIEvent,
    NormalizedAIMessage,
    NormalizedAIModel,
    NormalizedAIRequest,
} from "../types";
import { isChatModelId, probeModels, type FetchFunction, type ModelProbeResult } from "./openai-models";
import { buildSystemMessage } from "../prompt";
import type { AIProviderAdapter } from "./types";

/**
 * Serves one user-supplied connection through any-model's OpenAI-compatible provider.
 * Every preset and every custom endpoint runs through this single class — they differ
 * only by id, label, and base URL.
 *
 * Nothing in this file may log or return the API key: `blockingMessage`, model
 * metadata, and error text are all rendered to the user, and provider error bodies
 * sometimes echo the request (or a key prefix) back. Error messages are therefore
 * fixed per code and never taken from the provider.
 */

export interface OpenAICompatAdapterOptions {
    credential: AIConnectionCredential;
    /** Injectable transport for tests. */
    fetchImpl?: FetchFunction;
}

interface ErrorMapping {
    code: string;
    message: string;
    retryable: boolean;
}

/** Provider failures, normalized to codes the Coach client already handles. */
function mapError(error: unknown): ErrorMapping {
    if (error instanceof AuthError) {
        return {
            code: "connection_needs_reauth",
            message: "This provider rejected the API key for this connection.",
            retryable: false,
        };
    }
    if (error instanceof RateLimitError) {
        return {
            code: "provider_rate_limited",
            message: "This provider is rate limiting the connection. Try again shortly.",
            retryable: true,
        };
    }
    if (error instanceof ContextLengthError) {
        return {
            code: "context_length_exceeded",
            message: "This conversation is too long for the selected model.",
            retryable: false,
        };
    }
    if (error instanceof ContentFilterError) {
        return {
            code: "content_filtered",
            message: "The provider's safety filter blocked this response.",
            retryable: false,
        };
    }
    if (error instanceof UnsupportedFeatureError) {
        return {
            code: "feature_unsupported",
            message: "The selected model does not support this request.",
            retryable: false,
        };
    }
    if (error instanceof AnyModelError) {
        return {
            code: "provider_error",
            message: "The provider could not complete this request.",
            retryable: error.isRetryable,
        };
    }
    return {
        code: "provider_stream_interrupted",
        message: "The response stream was interrupted.",
        retryable: true,
    };
}

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Flattens normalized history into any-model messages.
 *
 * Failed and cancelled assistant turns are dropped so a broken turn is never replayed
 * as context — which can leave two user turns adjacent. Most chat templates (DeepSeek,
 * vLLM) reject that with a 400, so same-role runs are merged afterwards.
 */
export function toAnyModelMessages(
    history: NormalizedAIMessage[],
    message: string,
    system: string,
): Message[] {
    const turns: { role: "user" | "assistant"; content: string }[] = [];

    for (const entry of history) {
        if (entry.role !== "user" && entry.role !== "assistant") continue;
        if (entry.role === "assistant" && entry.status !== "complete") continue;
        const text = entry.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
            .trim();
        if (!text) continue;

        const previous = turns.at(-1);
        if (previous?.role === entry.role) previous.content += `\n\n${text}`;
        else turns.push({ role: entry.role, content: text });
    }

    const last = turns.at(-1);
    if (last?.role === "user") last.content += `\n\n${message}`;
    else turns.push({ role: "user", content: message });

    return [{ role: "system", content: system }, ...turns];
}

export class OpenAICompatAdapter implements AIProviderAdapter {
    readonly id: string;
    readonly label: string;
    readonly authMethods: readonly AIAuthMethod[];
    /** Reaches `openAICompatible` and the probe, and nothing else. */
    readonly #credential: AIConnectionCredential;
    readonly #fetchImpl: FetchFunction;
    /** Shared by connectionSummary/listModels/validateConnection: one probe per instance. */
    #probe?: Promise<ModelProbeResult>;

    constructor({ credential, fetchImpl = fetch }: OpenAICompatAdapterOptions) {
        this.#credential = credential;
        this.#fetchImpl = fetchImpl;
        this.id = credential.id;
        this.label = credential.label;
        this.authMethods = credential.preset === "custom" ? ["custom_endpoint"] : ["api_key"];
    }

    #probeOnce(): Promise<ModelProbeResult> {
        this.#probe ??= probeModels(
            this.#credential.baseURL,
            this.#credential.apiKey,
            this.#fetchImpl,
        );
        return this.#probe;
    }

    async validateConnection(): Promise<AICoachConnectionState> {
        return (await this.#probeOnce()).state;
    }

    async connectionSummary(): Promise<AIProviderSummary> {
        const preset = presetFor(this.#credential.preset);
        const { state, blockingMessage } = await this.#probeOnce();
        return {
            id: this.id,
            label: this.label,
            authMethods: this.authMethods,
            capabilities: preset.defaultCapabilities,
            connectionState: state,
            displayLabel: preset.label,
            blockingMessage,
        };
    }

    async listModels(): Promise<NormalizedAIModel[]> {
        const preset = presetFor(this.#credential.preset);
        const { state, modelIds } = await this.#probeOnce();
        const curated = preset.models;
        const pinned = this.#credential.models ?? [];

        // Discovery decides what exists; the curated table only decorates it. Nothing the
        // endpoint serves is hidden — a picker that omits a model the user is entitled to
        // is indistinguishable from a broken one, and curated tables go stale the day a
        // provider ships something new. The picker is searchable, so a long list is fine.
        const curatedIds = Object.keys(curated);
        const known = [...curatedIds, ...pinned];
        // Curated ids keep the table's authored order (best first); everything else falls
        // in alphabetically behind them. Showing everything costs nothing if the models
        // worth reaching for are still at the top.
        const rank = new Map(curatedIds.map((id, index) => [id, index]));
        // Drop ids we cannot turn into a `provider:model` reference rather than letting
        // one exotic id (OpenRouter serves `~vendor/model-latest`) fail the whole catalog,
        // and drop families that cannot chat at all (embeddings, speech, image).
        const usable = modelIds.filter(
            (id) => isModelReference(`${this.id}:${id}`) && isChatModelId(id),
        );
        // An endpoint that could not enumerate (404, or an unparseable body) still leaves
        // the curated ids worth offering — they are the best guess available.
        const ids = usable.length > 0 ? usable : [...new Set(known)];

        const available = state === "connected";
        return ids
            .map((id) => {
                const entry = curated[id];
                return {
                    reference: `${this.id}:${id}` as const,
                    providerId: this.id,
                    providerLabel: this.label,
                    id,
                    label: entry?.label ?? humanizeModelId(id),
                    description: entry?.description,
                    capabilities: entry?.capabilities ?? preset.defaultCapabilities,
                    tags: entry?.tags ?? [],
                    available,
                    unavailableReason: available ? undefined : "Connection unavailable",
                };
            })
            .sort((a, b) => {
                const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                if (rankA !== rankB) return rankA - rankB;
                return a.label.localeCompare(b.label);
            });
    }

    async stream(request: NormalizedAIRequest): Promise<ReadableStream<NormalizedAIEvent>> {
        const messageId = crypto.randomUUID();
        const conversationId = request.conversationId ?? crypto.randomUUID();
        const reference = request.model;
        // resolveModel() runs before this and always hands over a concrete reference.
        const modelId = reference.startsWith(`${this.id}:`)
            ? reference.slice(this.id.length + 1)
            : reference;

        const preset = presetFor(this.#credential.preset);
        const capabilities: AIProviderCapabilities =
            preset.models[modelId]?.capabilities ?? preset.defaultCapabilities;

        const registry = createRegistry().use(
            openAICompatible({
                id: this.id,
                baseURL: this.#credential.baseURL,
                apiKey: this.#credential.apiKey,
                fetch: this.#fetchImpl,
                capabilities: {
                    streaming: true,
                    tools: capabilities.tools,
                    vision: capabilities.vision,
                    jsonSchema: capabilities.structuredOutput,
                },
            }),
        );

        const messages = toAnyModelMessages(
            request.history,
            request.message,
            buildSystemMessage(request.contexts),
        );

        const model = registry.languageModel(`${this.id}:${modelId}`);

        return new ReadableStream<NormalizedAIEvent>({
            start: async (controller) => {
                const send = (event: NormalizedAIEvent) => controller.enqueue(event);
                let finished = false;
                let announcedReasoning = false;

                const finish = (
                    usage: { inputTokens: number; outputTokens: number; cachedTokens?: number },
                    status: "complete" | "failed",
                ) => {
                    send({ type: "usage", messageId, usage });
                    send({ type: "message.done", messageId, status });
                    controller.close();
                };

                try {
                    send({ type: "message.start", messageId, conversationId, model: reference });

                    for await (const part of model.stream({
                        messages,
                        abortSignal: request.signal,
                    })) {
                        if (finished) break;
                        switch (part.type) {
                            case "text-delta":
                                // Every event is schema-validated downstream and a blank
                                // delta is rejected, which would kill the stream.
                                if (part.text) send({ type: "message.delta", messageId, delta: part.text });
                                break;
                            case "reasoning-delta":
                                // Reasoning must never reach the persisted answer text.
                                if (!announcedReasoning) {
                                    announcedReasoning = true;
                                    send({ type: "status", messageId, label: "Thinking" });
                                }
                                break;
                            case "finish": {
                                finished = true;
                                const usage = {
                                    inputTokens: part.usage.inputTokens ?? 0,
                                    outputTokens: part.usage.outputTokens ?? 0,
                                    cachedTokens: part.usage.cachedInputTokens,
                                };
                                if (part.finishReason === "content-filter") {
                                    send({
                                        type: "error",
                                        messageId,
                                        code: "content_filtered",
                                        message: "The provider's safety filter blocked this response.",
                                        retryable: false,
                                    });
                                    finish(usage, "failed");
                                    return;
                                }
                                if (part.finishReason === "error") {
                                    send({
                                        type: "error",
                                        messageId,
                                        code: "provider_error",
                                        message: "The provider could not complete this request.",
                                        retryable: true,
                                    });
                                    finish(usage, "failed");
                                    return;
                                }
                                // "other" is the unknown-stop-reason bucket, not a failure:
                                // endpoints that omit finish_reason land here having sent a
                                // perfectly good answer, and must not be recorded as failed.
                                finish(usage, "complete");
                                return;
                            }
                            case "error": {
                                finished = true;
                                const mapped = mapError(part.error);
                                send({ type: "error", messageId, ...mapped });
                                finish({ inputTokens: 0, outputTokens: 0 }, "failed");
                                return;
                            }
                            // Phase 1 sends no tools, and raw payloads carry no normalized meaning.
                            case "tool-call-start":
                            case "tool-call-delta":
                            case "tool-call-end":
                            case "raw":
                                break;
                        }
                    }

                    // Some endpoints close without a terminal chunk.
                    if (!finished) finish({ inputTokens: 0, outputTokens: 0 }, "complete");
                } catch (error) {
                    // Check the signal before the error shape: an aborted fetch may surface
                    // wrapped in a ProviderError, and treating a user cancel as a failure
                    // would persist the turn as failed instead of cancelled.
                    if (request.signal?.aborted || isAbort(error)) {
                        controller.error(new DOMException("The operation was aborted", "AbortError"));
                        return;
                    }
                    const mapped = mapError(error);
                    send({ type: "error", messageId, ...mapped });
                    finish({ inputTokens: 0, outputTokens: 0 }, "failed");
                }
            },
        });
    }
}
