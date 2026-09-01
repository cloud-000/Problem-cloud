import { describe, expect, test } from "bun:test";
import { HOSTED_PROVIDER_ID } from "$lib/ai/types";
import { HostedProviderAdapter } from "./hosted";
import type { FetchFunction } from "$lib/ai/providers/openai-models";
import type { HostedConnectionConfig } from "../hosted-plan";

function sseResponse(...chunks: unknown[]): Response {
    const body =
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function hostedFetch(completion: (init?: RequestInit) => Promise<Response>): FetchFunction {
    return async (input, init) => {
        if (String(input).endsWith("/models")) {
            return new Response(
                JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
                { status: 200 },
            );
        }
        return completion(init);
    };
}

const offer = {
    id: "auto",
    label: "Auto",
    description: "Picks a model and falls back if one is unavailable.",
};

const hosted = (
    fetchImpl?: FetchFunction,
    route: string[] = ["gpt-4o-mini", "gpt-4.1-mini"],
) =>
    new HostedProviderAdapter({
        preset: "openai",
        label: "ProblemCloud",
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-hosted",
        offer,
        route,
        fetchImpl,
    } satisfies HostedConnectionConfig & { fetchImpl?: FetchFunction });

describe("hosted provider", () => {
    test("advertises a hosted connection and only the public offer", async () => {
        const provider = hosted(async (input) => {
            throw new Error(`listModels must not fetch ${String(input)}`);
        });
        expect(provider.id).toBe(HOSTED_PROVIDER_ID);
        expect(provider.authMethods).toEqual(["hosted"]);
        expect(await provider.validateConnection()).toBe("connected");
        const models = await provider.listModels();
        expect(models.map((model) => model.reference)).toEqual(["hosted:auto"]);
        expect(models[0]).toMatchObject({
            id: "auto",
            label: "Auto",
            available: true,
        });
    });

    test("streams the OpenRouter fallback list through any-model and shows the offer", async () => {
        let body: Record<string, unknown> | undefined;
        let headers: Headers | undefined;
        const provider = hosted(
            hostedFetch(async (init) => {
                body = JSON.parse(String(init?.body));
                headers = new Headers(init?.headers);
                return sseResponse(
                    { choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
                    {
                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                        usage: { prompt_tokens: 4, completion_tokens: 2 },
                    },
                );
            }),
        );
        const events: unknown[] = [];
        const stream = await provider.stream({
            requestId: "request-1",
            conversationId: "conversation-1",
            model: "hosted:auto",
            task: "general",
            message: "Hi",
            policy: "assist",
            renderedContext: "",
            history: [],
            debug: true,
        });
        for await (const event of stream) events.push(event);
        expect(body).toMatchObject({
            model: "gpt-4o-mini",
            models: ["gpt-4.1-mini"],
        });
        expect(body).not.toHaveProperty("route");
        expect(headers?.get("X-Title")).toBe("ProblemCloud");
        expect(headers?.get("HTTP-Referer")).toBe("https://problemcloud.app");
        expect(events[0]).toMatchObject({ type: "request.snapshot", model: "hosted:auto" });
        expect(events[1]).toMatchObject({ type: "message.start", model: "hosted:auto" });
        expect(events.some((event) => event && typeof event === "object" && "delta" in event)).toBe(
            true,
        );
        expect(events.at(-1)).toMatchObject({ type: "message.done", status: "complete" });
    });

    test("omits the fallback array when the route is a single model", async () => {
        let body: Record<string, unknown> | undefined;
        const provider = hosted(
            hostedFetch(async (init) => {
                body = JSON.parse(String(init?.body));
                return sseResponse(
                    { choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }] },
                );
            }),
            ["gpt-4o-mini"],
        );
        const events: unknown[] = [];
        for await (const event of await provider.stream({
            requestId: "request-1",
            conversationId: "conversation-1",
            model: "hosted:auto",
            task: "general",
            message: "Hi",
            policy: "assist",
            renderedContext: "",
            history: [],
        })) {
            events.push(event);
        }
        expect(body?.model).toBe("gpt-4o-mini");
        expect(body).not.toHaveProperty("models");
        expect(body).not.toHaveProperty("route");
        expect(events[0]).toMatchObject({ type: "message.start", model: "hosted:auto" });
    });

    test("caps the OpenRouter models array at three fallbacks", async () => {
        let body: Record<string, unknown> | undefined;
        const provider = hosted(
            hostedFetch(async (init) => {
                body = JSON.parse(String(init?.body));
                return sseResponse(
                    { choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }] },
                );
            }),
            ["a/one", "b/two", "c/three", "d/four", "e/five", "f/six"],
        );
        for await (const _event of await provider.stream({
            requestId: "request-1",
            conversationId: "conversation-1",
            model: "hosted:auto",
            task: "general",
            message: "Hi",
            policy: "assist",
            renderedContext: "",
            history: [],
        })) {
            /* drain */
        }
        expect(body?.model).toBe("a/one");
        expect(body?.models).toEqual(["b/two", "c/three", "d/four"]);
    });
});
