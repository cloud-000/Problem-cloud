import { describe, expect, test } from "bun:test";
import type { AIConnectionCredential, NormalizedAIEvent, NormalizedAIMessage, NormalizedAIRequest } from "../types";
import { OpenAICompatAdapter } from "./openai-compat";
import { toProviderMessages } from "./messages";
import type { FetchFunction } from "./openai-models";

const credential: AIConnectionCredential = {
    id: "openai",
    preset: "openai",
    label: "My OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-test-key",
};

const request = (overrides: Partial<NormalizedAIRequest> = {}): NormalizedAIRequest => ({
    requestId: "request-1",
    conversationId: "conversation-1",
    model: "openai:gpt-4o",
    task: "general",
    message: "Explain factoring",
    policy: "assist",
    renderedContext: "",
    history: [],
    ...overrides,
});

function sse(...chunks: unknown[]): Response {
    const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

function delta(content: string, finish: string | null = null) {
    return { choices: [{ index: 0, delta: { content }, finish_reason: finish }] };
}

/** Routes /models to a catalog response and /chat/completions to a scripted stream. */
function fakeFetch(options: {
    models?: Response | (() => Response);
    completion?: Response | (() => Response);
}): FetchFunction {
    return async (input) => {
        const url = String(input);
        if (url.endsWith("/models")) {
            const value = options.models ?? new Response(JSON.stringify({ data: [] }), { status: 200 });
            return typeof value === "function" ? value() : value;
        }
        const value = options.completion ?? new Response("{}", { status: 500 });
        return typeof value === "function" ? value() : value;
    };
}

async function collect(stream: ReadableStream<NormalizedAIEvent>): Promise<NormalizedAIEvent[]> {
    const events: NormalizedAIEvent[] = [];
    for await (const event of stream) events.push(event);
    return events;
}

function historyMessage(
    role: "user" | "assistant",
    text: string,
    status: NormalizedAIMessage["status"] = "complete",
): NormalizedAIMessage {
    return { id: crypto.randomUUID(), role, parts: [{ type: "text", text }], status, createdAt: "2026-07-16T10:00:00Z" };
}

describe("any-model history mapping", () => {
    test("prepends a system message and appends the new prompt", () => {
        const messages = toProviderMessages([], "What now?", "SYSTEM");
        expect(messages).toEqual([
            { role: "system", content: "SYSTEM" },
            { role: "user", content: "What now?" },
        ]);
    });

    test("drops failed assistant turns and merges the adjacent user turns", () => {
        // Dropping a failed turn leaves two user turns adjacent, which most chat
        // templates reject outright — they must be merged rather than passed through.
        const messages = toProviderMessages(
            [
                historyMessage("user", "First"),
                historyMessage("assistant", "Broken", "failed"),
                historyMessage("user", "Second"),
            ],
            "Third",
            "SYSTEM",
        );
        expect(messages).toEqual([
            { role: "system", content: "SYSTEM" },
            { role: "user", content: "First\n\nSecond\n\nThird" },
        ]);
        expect(messages.filter((m) => m.role === "assistant")).toHaveLength(0);
    });

    test("keeps alternating turns intact and skips empty ones", () => {
        const messages = toProviderMessages(
            [
                historyMessage("user", "Q1"),
                historyMessage("assistant", "A1"),
                historyMessage("user", "   "),
            ],
            "Q2",
            "SYSTEM",
        );
        expect(messages).toEqual([
            { role: "system", content: "SYSTEM" },
            { role: "user", content: "Q1" },
            { role: "assistant", content: "A1" },
            { role: "user", content: "Q2" },
        ]);
    });

    test("places the compiled current scope in the provider payload once", () => {
        const messages = toProviderMessages(
            [historyMessage("user", "Earlier question")],
            "Current question",
            "SYSTEM",
            "Problem the student is working on:\nStatement 42",
        );
        const payload = messages.map((message) => String(message.content)).join("\n");

        expect(payload.split("Statement 42")).toHaveLength(2);
        expect(payload.split("[Application context]")).toHaveLength(2);
        expect(messages.at(-1)?.content).toContain("Current question");
    });
});

describe("any-model provider adapter", () => {
    test("normalizes a successful stream", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                completion: () =>
                    sse(
                        delta("Fact"),
                        delta("oring"),
                        {
                            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                            usage: { prompt_tokens: 12, completion_tokens: 3 },
                        },
                    ),
            }),
        });

        const events = await collect(await adapter.stream(request()));
        expect(events[0]).toMatchObject({ type: "message.start", model: "openai:gpt-4o" });
        expect(
            events.filter((e) => e.type === "message.delta").map((e) => e.delta).join(""),
        ).toBe("Factoring");
        // The contract requires usage immediately before the terminal event.
        expect(events.at(-2)).toMatchObject({
            type: "usage",
            usage: { inputTokens: 12, outputTokens: 3 },
        });
        expect(events.at(-1)).toMatchObject({ type: "message.done", status: "complete" });
    });

    test("captures the exact finalized message list when debugging is requested", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({ completion: () => sse(delta("Done", "stop")) }),
        });

        const events = await collect(
            await adapter.stream(
                request({
                    debug: true,
                    renderedContext: "Problem the student is working on:\nStatement 42",
                }),
            ),
        );
        expect(events[0]).toMatchObject({
            type: "request.snapshot",
            requestId: "request-1",
            model: "openai:gpt-4o",
        });
        const snapshot = events[0];
        expect(snapshot.type).toBe("request.snapshot");
        if (snapshot.type !== "request.snapshot") throw new Error("missing request snapshot");
        expect(snapshot.messages[0]?.role).toBe("system");
        expect(snapshot.messages[0]?.content).toContain("You are the ProblemCloud coach");
        expect(snapshot.messages[1]).toEqual({
            role: "user",
            content:
                "[Application context]\nProblem the student is working on:\nStatement 42\n[End application context]\n\n[Student]\nExplain factoring",
        });
        expect(events[1]?.type).toBe("message.start");
    });

    test("suppresses empty text deltas", async () => {
        // A blank delta fails schema validation downstream and would kill the stream.
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                completion: () =>
                    sse(delta(""), delta("Hi"), delta(""), {
                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                    }),
            }),
        });

        const events = await collect(await adapter.stream(request()));
        const deltas = events.filter((event) => event.type === "message.delta");
        expect(deltas).toHaveLength(1);
        expect(deltas.every((event) => event.delta.length > 0)).toBe(true);
    });

    test("reports reasoning as status rather than answer text", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                completion: () =>
                    sse(
                        { choices: [{ index: 0, delta: { reasoning_content: "hmm" }, finish_reason: null }] },
                        { choices: [{ index: 0, delta: { reasoning_content: "more" }, finish_reason: null }] },
                        delta("Answer"),
                        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
                    ),
            }),
        });

        const events = await collect(await adapter.stream(request()));
        // Reasoning must never reach the persisted answer text.
        expect(events.filter((e) => e.type === "message.delta").map((e) => e.delta).join("")).toBe(
            "Answer",
        );
        expect(events.filter((event) => event.type === "status")).toHaveLength(1);
    });

    test("completes when the endpoint omits a stop reason", async () => {
        // Endpoints that never set finish_reason normalize to an "other" finish. The
        // answer arrived, so it must not be recorded as a failed turn.
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({ completion: () => sse(delta("Answer")) }),
        });

        const events = await collect(await adapter.stream(request()));
        expect(events.filter((e) => e.type === "message.delta").map((e) => e.delta).join("")).toBe(
            "Answer",
        );
        expect(events.at(-2)?.type).toBe("usage");
        expect(events.at(-1)).toMatchObject({ type: "message.done", status: "complete" });
    });

    test("maps a rejected key to a non-retryable reauth error without echoing the provider", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                completion: () =>
                    new Response(JSON.stringify({ error: { message: "Bad key sk-test-key" } }), {
                        status: 401,
                    }),
            }),
        });

        const events = await collect(await adapter.stream(request()));
        const error = events.find((event) => event.type === "error");
        expect(error).toMatchObject({ code: "connection_needs_reauth", retryable: false });
        expect(events.at(-1)).toMatchObject({ type: "message.done", status: "failed" });
        // Provider error bodies can quote the request, and the key with it.
        expect(JSON.stringify(events)).not.toContain("sk-test-key");
    });

    test("maps rate limiting to a retryable error", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                completion: () => new Response(JSON.stringify({ error: {} }), { status: 429 }),
            }),
        });

        const events = await collect(await adapter.stream(request()));
        expect(events.find((event) => event.type === "error")).toMatchObject({
            code: "provider_rate_limited",
            retryable: true,
        });
    });

    test("propagates abort so the caller can record a cancellation", async () => {
        const controller = new AbortController();
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: async () => {
                controller.abort();
                throw new DOMException("The operation was aborted", "AbortError");
            },
        });

        const stream = await adapter.stream(request({ signal: controller.signal }));
        const reader = stream.getReader();
        await reader.read();
        await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
    });
});

describe("any-model model discovery", () => {
    test("lists every chat model served, curated or not", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                models: () =>
                    new Response(
                        JSON.stringify({
                            data: [
                                { id: "gpt-4o" },
                                { id: "some-unreleased-model" },
                                { id: "text-embedding-3-small" },
                                { id: "whisper-1" },
                            ],
                        }),
                        { status: 200 },
                    ),
            }),
        });

        const models = await adapter.listModels();
        // An id we have never heard of must still be selectable — an allowlist would hide
        // every model shipped after the curated table was last touched.
        expect(models.map((model) => model.id)).toContain("some-unreleased-model");
        // ...but families that cannot chat stay out of a chat picker.
        expect(models.map((model) => model.id)).not.toContain("text-embedding-3-small");
        expect(models.map((model) => model.id)).not.toContain("whisper-1");
        // Curated ids sort first and keep their table metadata; the rest are humanized.
        expect(models[0]).toMatchObject({ reference: "openai:gpt-4o", label: "GPT-4o", available: true });
        expect(models.at(-1)).toMatchObject({ label: "some unreleased model" });
    });

    test("finds curated models that sort past the discovery page", async () => {
        // OpenRouter serves 300+ ids; truncating the read would drop whatever sorts late.
        const filler = Array.from({ length: 250 }, (_, index) => ({ id: `filler/model-${index}` }));
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                models: () =>
                    new Response(JSON.stringify({ data: [...filler, { id: "gpt-4o" }] }), {
                        status: 200,
                    }),
            }),
        });

        const models = await adapter.listModels();
        expect(models).toHaveLength(251);
        // Curated first regardless of where the endpoint listed it.
        expect(models[0].id).toBe("gpt-4o");
    });

    test("every model carries the connection label so pickers can group by provider", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                models: () => new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 }),
            }),
        });

        expect((await adapter.listModels())[0].providerLabel).toBe(credential.label);
    });

    test("skips ids that cannot form a reference instead of failing the catalog", async () => {
        // A single exotic id (OpenRouter's ~vendor/model-latest aliases) must not be able
        // to take down every model the user has.
        const adapter = new OpenAICompatAdapter({
            credential: { ...credential, id: "local", preset: "custom", baseURL: "https://llm.example.com/v1" },
            fetchImpl: fakeFetch({
                models: () =>
                    new Response(
                        JSON.stringify({ data: [{ id: "~x-ai/grok-latest" }, { id: "good/model" }, { id: "bad id!" }] }),
                        { status: 200 },
                    ),
            }),
        });

        const ids = (await adapter.listModels()).map((model) => model.id);
        expect(ids).toContain("good/model");
        expect(ids).toContain("~x-ai/grok-latest"); // "~" is a legitimate namespace marker
        expect(ids).not.toContain("bad id!");
    });

    test("serves everything a custom endpoint reports", async () => {
        const adapter = new OpenAICompatAdapter({
            credential: { ...credential, id: "local", preset: "custom", baseURL: "https://llm.example.com/v1" },
            fetchImpl: fakeFetch({
                models: () =>
                    new Response(JSON.stringify({ data: [{ id: "my-own/model-v2" }] }), { status: 200 }),
            }),
        });

        const models = await adapter.listModels();
        expect(models[0]).toMatchObject({ reference: "local:my-own/model-v2", label: "model v2" });
    });

    test("stays usable when the endpoint has no /models route", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({ models: () => new Response("", { status: 404 }) }),
        });

        // A 404 means the endpoint doesn't implement /models, not that it is broken.
        expect(await adapter.validateConnection()).toBe("connected");
        expect((await adapter.listModels()).length).toBeGreaterThan(0);
    });

    test("surfaces a rejected key as needs_reauth without leaking it", async () => {
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: fakeFetch({
                models: () =>
                    new Response(JSON.stringify({ error: { message: "Bad key sk-test-key" } }), {
                        status: 401,
                    }),
            }),
        });

        const summary = await adapter.connectionSummary();
        expect(summary.connectionState).toBe("needs_reauth");
        expect(JSON.stringify(summary)).not.toContain("sk-test-key");
    });

    test("probes once per instance no matter how many callers ask", async () => {
        let calls = 0;
        const adapter = new OpenAICompatAdapter({
            credential,
            fetchImpl: async () => {
                calls += 1;
                return new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 });
            },
        });

        // catalogFor() asks for the summary and the models in parallel.
        await Promise.all([adapter.connectionSummary(), adapter.listModels(), adapter.validateConnection()]);
        expect(calls).toBe(1);
    });
});
