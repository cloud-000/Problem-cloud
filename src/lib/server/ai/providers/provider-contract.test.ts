import { describe, expect, test } from "bun:test";
import type { NormalizedAIEvent, NormalizedAIRequest } from "$lib/ai/types";
import { MockProviderAdapter } from "./mock";
import type { AIProviderAdapter } from "./types";

const request = (overrides: Partial<NormalizedAIRequest> = {}): NormalizedAIRequest => ({
    requestId: "request-1",
    conversationId: "conversation-1",
    model: "mock:coach-standard",
    task: "general",
    message: "Explain factoring",
    contexts: [],
    ...overrides,
});

async function collect(stream: ReadableStream<NormalizedAIEvent>): Promise<NormalizedAIEvent[]> {
    const events: NormalizedAIEvent[] = [];
    for await (const event of stream) events.push(event);
    return events;
}

function providerContract(name: string, create: () => AIProviderAdapter) {
    describe(`${name} provider contract`, () => {
        test("discovers models and reports connection health", async () => {
            const provider = create();
            expect(await provider.validateConnection()).toBe("connected");
            const models = await provider.listModels();
            expect(models.length).toBeGreaterThan(0);
            expect(models.every((model) => model.reference.startsWith(`${provider.id}:`))).toBe(true);
        });

        test("orders normalized streaming and usage events", async () => {
            const events = await collect(await create().stream(request()));
            expect(events[0]?.type).toBe("message.start");
            expect(events.some((event) => event.type === "message.delta")).toBe(true);
            expect(events.at(-2)?.type).toBe("usage");
            expect(events.at(-1)).toMatchObject({ type: "message.done", status: "complete" });
        });

        test("normalizes mid-stream failures", async () => {
            const provider = new MockProviderAdapter({ scenario: "mid_stream_error", chunkDelayMs: 0 });
            const events = await collect(await provider.stream(request()));
            expect(events.some((event) => event.type === "message.delta")).toBe(true);
            expect(events.some((event) => event.type === "error")).toBe(true);
            expect(events.at(-1)).toMatchObject({ type: "message.done", status: "failed" });
        });

        test("propagates abort", async () => {
            const controller = new AbortController();
            const provider = new MockProviderAdapter({ scenario: "slow", chunkDelayMs: 250 });
            const stream = await provider.stream(request({ signal: controller.signal }));
            const reader = stream.getReader();
            await reader.read();
            await reader.read();
            controller.abort();
            await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
        });
    });
}

providerContract("mock", () => new MockProviderAdapter({ chunkDelayMs: 0 }));
