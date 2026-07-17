import { describe, expect, test } from "bun:test";
import type { NormalizedAIModel } from "./types";
import { AIModelRoutingError, resolveModel } from "./router";

const model = (reference: `mock:${string}`, tools: boolean): NormalizedAIModel => ({
    reference,
    providerId: "mock",
    id: reference.split(":")[1],
    label: reference,
    capabilities: {
        chat: true,
        streaming: true,
        tools,
        vision: false,
        structuredOutput: true,
    },
    tags: [],
    available: true,
});

describe("AI model routing", () => {
    const models = [model("mock:standard", false), model("mock:tools", true)];

    test("Auto deterministically selects an eligible model", () => {
        expect(resolveModel("auto", "general", models).reference).toBe("mock:tools");
        expect(resolveModel("auto", "agentic", models).reference).toBe("mock:tools");
    });

    test("explicit selection never silently changes model", () => {
        expect(resolveModel("mock:standard", "general", models).reference).toBe("mock:standard");
        expect(() => resolveModel("mock:standard", "agentic", models)).toThrow(AIModelRoutingError);
    });
});
