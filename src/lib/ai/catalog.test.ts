import { describe, expect, test } from "bun:test";
import type { NormalizedAIModel } from "./types";
import { catalogFor } from "./catalog";
import type { AIProviderAdapter } from "./providers/types";

const capabilities = {
    chat: true,
    streaming: true,
    tools: false,
    vision: false,
    structuredOutput: false,
};

function stubProvider(id: string, models: Partial<NormalizedAIModel>[]): AIProviderAdapter {
    return {
        id,
        label: id,
        authMethods: ["api_key"],
        validateConnection: async () => "connected",
        connectionSummary: async () => ({
            id,
            label: id,
            authMethods: ["api_key"],
            capabilities,
            connectionState: "connected",
        }),
        listModels: async () =>
            models.map((model) => ({
                reference: `${id}:${model.id}`,
                providerId: id,
                id: model.id,
                label: model.id,
                capabilities,
                tags: [],
                available: true,
                ...model,
            })) as NormalizedAIModel[],
        stream: async () => new ReadableStream(),
    };
}

describe("model catalog", () => {
    test("merges every connection's models", async () => {
        const catalog = await catalogFor([
            stubProvider("openai", [{ id: "gpt-4o" }]),
            stubProvider("groq", [{ id: "llama-3.3-70b-versatile" }]),
        ]);
        expect(catalog.providers).toHaveLength(2);
        expect(catalog.models.map((model) => model.reference)).toEqual([
            "openai:gpt-4o",
            "groq:llama-3.3-70b-versatile",
        ]);
    });

    test("isolates a provider that returns unreadable models", async () => {
        // Previously one malformed model reference threw out of the catalog build and
        // surfaced as a blanket 503 on /api/ai/bootstrap, taking every connection with it.
        const broken = stubProvider("broken", [{ id: "bad id!" }]);
        const catalog = await catalogFor([broken, stubProvider("openai", [{ id: "gpt-4o" }])]);

        expect(catalog.models.map((model) => model.reference)).toEqual(["openai:gpt-4o"]);
        expect(catalog.providers.find((provider) => provider.id === "broken")).toMatchObject({
            connectionState: "error",
        });
        expect(catalog.providers.find((provider) => provider.id === "openai")).toMatchObject({
            connectionState: "connected",
        });
    });

    test("isolates a provider that throws outright", async () => {
        const exploding: AIProviderAdapter = {
            ...stubProvider("exploding", []),
            listModels: async () => {
                throw new Error("network down");
            },
        };
        const catalog = await catalogFor([exploding, stubProvider("openai", [{ id: "gpt-4o" }])]);

        expect(catalog.models).toHaveLength(1);
        expect(catalog.providers.find((provider) => provider.id === "exploding")).toMatchObject({
            connectionState: "error",
        });
    });
});
