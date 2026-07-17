import { describe, expect, test } from "bun:test";
import { MOCK_PROVIDER_ID } from "./types";
import type { NormalizedAIModel } from "./types";
import { resolveModel } from "./router";

/**
 * Guards the merge rule in `coach.initialize()`: the development mock must step aside
 * once the user has a connection of their own.
 */

function model(providerId: string, id: string, tools: boolean): NormalizedAIModel {
    return {
        reference: `${providerId}:${id}`,
        providerId,
        id,
        label: id,
        capabilities: { chat: true, streaming: true, tools, vision: false, structuredOutput: false },
        tags: [],
        available: true,
    };
}

// The mock claims tool support; no real Phase 1 model does.
const mockModel = model(MOCK_PROVIDER_ID, "coach-tools", true);
const realModel = model("openai", "gpt-4o", false);

describe("mock stand-down", () => {
    test("auto would prefer the mock if it stayed in the catalog", () => {
        // Demonstrates why the rule exists: tools sort first in `auto` routing.
        expect(resolveModel("auto", "general", [mockModel, realModel]).providerId).toBe(
            MOCK_PROVIDER_ID,
        );
    });

    test("auto picks the user's own model once the mock is filtered out", () => {
        const merged = [mockModel, realModel].filter(
            (candidate) => candidate.providerId !== MOCK_PROVIDER_ID,
        );
        expect(resolveModel("auto", "general", merged).providerId).toBe("openai");
    });

    test("the mock still serves when the user has no connection", () => {
        expect(resolveModel("auto", "general", [mockModel]).providerId).toBe(MOCK_PROVIDER_ID);
    });
});
