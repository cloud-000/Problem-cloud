import type {
    AICoachConnectionState,
    AIMockScenario,
    AIProviderCapabilities,
    NormalizedAIEvent,
    NormalizedAIModel,
    NormalizedAIRequest,
} from "$lib/ai/types";
import { MOCK_PROVIDER_ID } from "$lib/ai/types";
import type { AIProviderAdapter } from "$lib/ai/providers/types";

const MOCK_PROVIDER_CAPABILITIES: AIProviderCapabilities = {
    chat: true,
    streaming: true,
    tools: true,
    vision: false,
    structuredOutput: true,
};

export interface MockProviderOptions {
    connectionState?: AICoachConnectionState;
    scenario?: AIMockScenario;
    chunkDelayMs?: number;
}

const encoder = new TextEncoder();

function tokenEstimate(value: string): number {
    return Math.max(1, Math.ceil(encoder.encode(value).length / 4));
}

function abortError(): DOMException {
    return new DOMException("The operation was aborted", "AbortError");
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    if (ms === 0) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(abortError());
            },
            { once: true },
        );
    });
}

function responseFor(request: NormalizedAIRequest, scenario: AIMockScenario): string {
    if (scenario === "refusal") {
        return "I can’t help with that request, but I can help with a safe learning question instead.";
    }
    // Deterministic acknowledgement of prior turns, so multi-turn continuity is
    // observable in the preview and assertable in tests.
    const continuity =
        request.history.length > 0
            ? `Picking up from ${request.history.length} earlier ${request.history.length === 1 ? "message" : "messages"}. `
            : "";
    if (request.contexts.length > 0) {
        return `${continuity}I can use the attached context “${request.contexts[0].label}”. For this deterministic preview, try separating what is given from what must be shown. A useful identity is $a^2-b^2=(a-b)(a+b)$.`;
    }
    return `${continuity}I’m Coach. This deterministic preview is streaming through the same provider-neutral path real models will use. Ask a math or study-planning question to continue.`;
}

/** Flattened text of the prior turns, counted toward the preview's input usage. */
function historyText(request: NormalizedAIRequest): string {
    return request.history
        .flatMap((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text))
        .join("\n");
}

function chunks(text: string): string[] {
    const words = text.split(/(\s+)/).filter(Boolean);
    const result: string[] = [];
    for (let index = 0; index < words.length; index += 4) {
        result.push(words.slice(index, index + 4).join(""));
    }
    return result;
}

export class MockProviderAdapter implements AIProviderAdapter {
    readonly id = MOCK_PROVIDER_ID;
    readonly label = "Mock";
    readonly authMethods = ["hosted"] as const;
    readonly #connectionState: AICoachConnectionState;
    readonly #scenario: AIMockScenario;
    readonly #chunkDelayMs: number;

    constructor(options: MockProviderOptions = {}) {
        this.#connectionState = options.connectionState ?? "connected";
        this.#scenario = options.scenario ?? "success";
        this.#chunkDelayMs = options.chunkDelayMs ?? 24;
    }

    async validateConnection(): Promise<AICoachConnectionState> {
        return this.#connectionState;
    }

    async connectionSummary() {
        const messages: Partial<Record<AICoachConnectionState, string>> = {
            disconnected: "Coach is not connected in this environment.",
            needs_reauth: "The Coach connection needs attention before requests can resume.",
            quota_exhausted: "The configured Coach allowance is exhausted.",
            error: "Coach could not verify the configured connection.",
        };
        return {
            id: this.id,
            label: this.label,
            authMethods: ["hosted"] as const,
            capabilities: MOCK_PROVIDER_CAPABILITIES,
            connectionState: this.#connectionState,
            displayLabel: "Development preview",
            blockingMessage: messages[this.#connectionState],
        };
    }

    async listModels(): Promise<NormalizedAIModel[]> {
        const available = this.#connectionState === "connected";
        return [
            {
                reference: "mock:coach-standard",
                providerId: this.id,
                providerLabel: "Development preview",
                id: "coach-standard",
                label: "Coach Standard",
                description: "Deterministic development model",
                capabilities: { ...MOCK_PROVIDER_CAPABILITIES, tools: false },
                tags: ["Fast", "Best for math"],
                available,
                unavailableReason: available ? undefined : "Connection required",
            },
            {
                reference: "mock:coach-tools",
                providerId: this.id,
                providerLabel: "Development preview",
                id: "coach-tools",
                label: "Coach Tools",
                description: "Deterministic tool-event development model",
                capabilities: MOCK_PROVIDER_CAPABILITIES,
                tags: ["Tool use", "Strong reasoning"],
                available,
                unavailableReason: available ? undefined : "Connection required",
            },
        ];
    }

    async stream(request: NormalizedAIRequest): Promise<ReadableStream<NormalizedAIEvent>> {
        const scenario = request.scenario ?? this.#scenario;
        const messageId = crypto.randomUUID();
        const conversationId = request.conversationId ?? crypto.randomUUID();
        const resolvedModel = request.model === "auto" ? "mock:coach-standard" : request.model;
        const output = responseFor(request, scenario);
        const chunkDelay = scenario === "slow" ? Math.max(this.#chunkDelayMs, 250) : this.#chunkDelayMs;

        return new ReadableStream<NormalizedAIEvent>({
            start: async (controller) => {
                const send = (event: NormalizedAIEvent) => controller.enqueue(event);
                try {
                    send({ type: "message.start", messageId, conversationId, model: resolvedModel });
                    send({ type: "status", messageId, label: "Preparing a response" });

                    if (scenario === "auth_error" || scenario === "rate_limit") {
                        const auth = scenario === "auth_error";
                        send({
                            type: "error",
                            messageId,
                            code: auth ? "connection_needs_reauth" : "provider_rate_limited",
                            message: auth
                                ? "The AI connection needs to be reconnected."
                                : "The provider is temporarily rate limited.",
                            retryable: !auth,
                        });
                        send({ type: "message.done", messageId, status: "failed" });
                        controller.close();
                        return;
                    }

                    if (scenario === "tool_proposal" || scenario === "tool_result") {
                        const runId = crypto.randomUUID();
                        send({
                            type: "tool.proposed",
                            messageId,
                            runId,
                            tool: "preview.read_progress",
                            summary: "Preview a read-only progress lookup",
                        });
                        if (scenario === "tool_result") {
                            send({ type: "tool.started", messageId, runId });
                            send({
                                type: "tool.result",
                                messageId,
                                runId,
                                summary: "Preview result available",
                            });
                        }
                    }

                    const outputChunks = chunks(output);
                    for (let index = 0; index < outputChunks.length; index += 1) {
                        await delay(chunkDelay, request.signal);
                        send({ type: "message.delta", messageId, delta: outputChunks[index] });
                        if (scenario === "mid_stream_error" && index >= 1) {
                            send({
                                type: "error",
                                messageId,
                                code: "provider_stream_interrupted",
                                message: "The preview stream was interrupted.",
                                retryable: true,
                            });
                            send({ type: "message.done", messageId, status: "failed" });
                            controller.close();
                            return;
                        }
                    }

                    send({
                        type: "usage",
                        messageId,
                        usage: {
                            inputTokens: tokenEstimate(historyText(request) + request.message),
                            outputTokens: tokenEstimate(output),
                        },
                    });
                    send({ type: "message.done", messageId, status: "complete" });
                    controller.close();
                } catch (error) {
                    if (error instanceof DOMException && error.name === "AbortError") {
                        controller.error(error);
                        return;
                    }
                    controller.error(error);
                }
            },
        });
    }
}
