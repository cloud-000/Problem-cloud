import { describe, expect, test } from "bun:test";
import type {
    AIConnectionCredential,
    NormalizedAIEvent,
    NormalizedAIMessage,
    NormalizedAIRequest,
} from "$lib/ai/types";
import { OpenAICompatAdapter } from "$lib/ai/providers/openai-compat";
import { MockProviderAdapter } from "./mock";
import type { FetchFunction } from "$lib/ai/providers/openai-models";
import type { AIProviderAdapter } from "$lib/ai/providers/types";

const request = (overrides: Partial<NormalizedAIRequest> = {}): NormalizedAIRequest => ({
    requestId: "request-1",
    conversationId: "conversation-1",
    model: "mock:coach-standard",
    task: "general",
    message: "Explain factoring",
    policy: "assist",
    renderedContext: "",
    history: [],
    ...overrides,
});

async function collect(stream: ReadableStream<NormalizedAIEvent>): Promise<NormalizedAIEvent[]> {
    const events: NormalizedAIEvent[] = [];
    for await (const event of stream) events.push(event);
    return events;
}

interface ContractFactories {
    /** A healthy provider that streams a complete response. */
    create: (overrides?: Partial<NormalizedAIRequest>) => AIProviderAdapter;
    /** A provider that emits deltas and then fails partway through. */
    createMidStreamError: () => AIProviderAdapter;
    /** A provider slow enough that a stream can be aborted mid-flight. */
    createSlow: () => AIProviderAdapter;
    /** The model reference `create()`'s provider serves. */
    modelReference: `${string}:${string}`;
}

/**
 * The behaviour every adapter owes the Coach, independent of provider. Parameterized so
 * a real provider is held to the same contract as the mock.
 */
function providerContract(name: string, factories: ContractFactories) {
    const { create, createMidStreamError, createSlow, modelReference } = factories;
    describe(`${name} provider contract`, () => {
        test("discovers models and reports connection health", async () => {
            const provider = create();
            expect(await provider.validateConnection()).toBe("connected");
            const models = await provider.listModels();
            expect(models.length).toBeGreaterThan(0);
            expect(models.every((model) => model.reference.startsWith(`${provider.id}:`))).toBe(true);
        });

        test("orders normalized streaming and usage events", async () => {
            const events = await collect(await create().stream(request({ model: modelReference })));
            expect(events[0]?.type).toBe("message.start");
            expect(events.some((event) => event.type === "message.delta")).toBe(true);
            expect(events.at(-2)?.type).toBe("usage");
            expect(events.at(-1)).toMatchObject({ type: "message.done", status: "complete" });
        });

        test("normalizes mid-stream failures", async () => {
            const provider = createMidStreamError();
            const events = await collect(await provider.stream(request({ model: modelReference })));
            expect(events.some((event) => event.type === "error")).toBe(true);
            expect(events.at(-1)).toMatchObject({ type: "message.done", status: "failed" });
        });

        test("propagates abort", async () => {
            const controller = new AbortController();
            const provider = createSlow();
            const stream = await provider.stream(
                request({ model: modelReference, signal: controller.signal }),
            );
            const reader = stream.getReader();
            await reader.read();
            controller.abort();
            // How many events a provider has already buffered when the abort lands is its
            // own business; the contract is only that reading eventually rejects.
            const drain = async () => {
                for (let attempt = 0; attempt < 20; attempt += 1) {
                    const { done } = await reader.read();
                    if (done) throw new Error("stream closed cleanly instead of aborting");
                }
                throw new Error("stream never aborted");
            };
            await expect(drain()).rejects.toMatchObject({ name: "AbortError" });
        });
    });
}

providerContract("mock", {
    create: () => new MockProviderAdapter({ chunkDelayMs: 0 }),
    createMidStreamError: () =>
        new MockProviderAdapter({ scenario: "mid_stream_error", chunkDelayMs: 0 }),
    createSlow: () => new MockProviderAdapter({ scenario: "slow", chunkDelayMs: 250 }),
    modelReference: "mock:coach-standard",
});

const anyModelCredential: AIConnectionCredential = {
    id: "openai",
    preset: "openai",
    label: "Contract OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-contract",
};

function sseResponse(...chunks: unknown[]): Response {
    const body =
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Scripts the two endpoints the adapter talks to: /models and /chat/completions. */
function anyModelFetch(completion: (init?: RequestInit) => Promise<Response>): FetchFunction {
    return async (input, init) => {
        if (String(input).endsWith("/models")) {
            return new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 });
        }
        return completion(init);
    };
}

/** A request that only ever ends by being aborted, the way a real fetch behaves. */
function pendingUntilAborted(init?: RequestInit): Promise<Response> {
    return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort, { once: true });
    });
}

providerContract("any-model", {
    create: () =>
        new OpenAICompatAdapter({
            credential: anyModelCredential,
            fetchImpl: anyModelFetch(async () =>
                sseResponse(
                    { choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
                    {
                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                        usage: { prompt_tokens: 4, completion_tokens: 2 },
                    },
                ),
            ),
        }),
    createMidStreamError: () =>
        new OpenAICompatAdapter({
            credential: anyModelCredential,
            fetchImpl: anyModelFetch(async () =>
                new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }),
            ),
        }),
    createSlow: () =>
        new OpenAICompatAdapter({
            credential: anyModelCredential,
            fetchImpl: anyModelFetch(pendingUntilAborted),
        }),
    modelReference: "openai:gpt-4o",
});

function historyMessage(role: "user" | "assistant", text: string): NormalizedAIMessage {
    return {
        id: crypto.randomUUID(),
        role,
        parts: [{ type: "text", text }],
        status: "complete",
        createdAt: "2026-07-16T10:00:00Z",
    };
}

function streamedText(events: NormalizedAIEvent[]): string {
    return events
        .filter((event) => event.type === "message.delta")
        .map((event) => event.delta)
        .join("");
}

describe("mock provider history contract", () => {
    const provider = () => new MockProviderAdapter({ chunkDelayMs: 0 });

    test("receives prior turns and reflects them deterministically", async () => {
        const history = [
            historyMessage("user", "We were factoring"),
            historyMessage("assistant", "Right, difference of squares"),
        ];
        const first = streamedText(await collect(await provider().stream(request({ history }))));
        const second = streamedText(await collect(await provider().stream(request({ history }))));
        expect(first).toContain("Picking up from 2 earlier messages.");
        expect(second).toBe(first);
    });

    test("says nothing about history on the first turn", async () => {
        const text = streamedText(await collect(await provider().stream(request({ history: [] }))));
        expect(text).not.toContain("Picking up from");
    });

    test("counts history toward reported input usage", async () => {
        const withoutHistory = await collect(await provider().stream(request({ history: [] })));
        const withHistory = await collect(
            await provider().stream(request({ history: [historyMessage("user", "x".repeat(400))] })),
        );
        const inputTokens = (events: NormalizedAIEvent[]) =>
            events.find((event) => event.type === "usage")?.usage.inputTokens ?? 0;
        expect(inputTokens(withHistory)).toBeGreaterThan(inputTokens(withoutHistory));
    });
});
