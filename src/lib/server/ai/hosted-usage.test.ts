import { describe, expect, test } from "bun:test";
import { HOSTED_PROVIDER_ID } from "$lib/ai/types";
import type { AIModelCatalog } from "$lib/ai/catalog";
import {
    creditsFromUsage,
    hostedPeriodStart,
    hostedQuotaExhausted,
    overlayHostedQuota,
} from "./hosted-quota";

const catalog: AIModelCatalog = {
    providers: [
        {
            id: HOSTED_PROVIDER_ID,
            label: "ProblemCloud",
            authMethods: ["hosted"],
            capabilities: {
                chat: true,
                streaming: true,
                tools: false,
                vision: false,
                structuredOutput: false,
            },
            connectionState: "connected",
        },
        {
            id: "mock",
            label: "Mock",
            authMethods: ["hosted"],
            capabilities: {
                chat: true,
                streaming: true,
                tools: true,
                vision: false,
                structuredOutput: true,
            },
            connectionState: "connected",
        },
    ],
    models: [
        {
            reference: "hosted:auto",
            providerId: HOSTED_PROVIDER_ID,
            id: "auto",
            label: "Auto",
            capabilities: {
                chat: true,
                streaming: true,
                tools: false,
                vision: false,
                structuredOutput: false,
            },
            tags: [],
            available: true,
        },
        {
            reference: "mock:coach-standard",
            providerId: "mock",
            id: "coach-standard",
            label: "Coach Standard",
            capabilities: {
                chat: true,
                streaming: true,
                tools: false,
                vision: false,
                structuredOutput: true,
            },
            tags: [],
            available: true,
        },
    ],
};

describe("hosted usage units", () => {
    test("credits are a weighted ceil of input and output tokens", () => {
        expect(
            creditsFromUsage({ inputTokens: 10, outputTokens: 3 }, { inputWeight: 1, outputWeight: 4 }),
        ).toBe(22);
        expect(
            creditsFromUsage({ inputTokens: 1, outputTokens: 1 }, { inputWeight: 0.5, outputWeight: 0.5 }),
        ).toBe(1);
        expect(
            creditsFromUsage({ inputTokens: 0, outputTokens: 0 }, { inputWeight: 1, outputWeight: 4 }),
        ).toBe(0);
    });

    test("a UTC month period starts on the first", () => {
        expect(hostedPeriodStart("month", new Date("2026-09-18T23:00:00Z"))).toBe("2026-09-01");
        expect(hostedPeriodStart("day", new Date("2026-09-18T23:00:00Z"))).toBe("2026-09-18");
    });

    test("either cap exhausts the allowance", () => {
        expect(hostedQuotaExhausted({ credits: 99, turns: 3 }, { creditLimit: 100, turnLimit: 10 })).toBe(
            false,
        );
        expect(hostedQuotaExhausted({ credits: 100, turns: 3 }, { creditLimit: 100, turnLimit: 10 })).toBe(
            true,
        );
        expect(hostedQuotaExhausted({ credits: 0, turns: 10 }, { creditLimit: 100, turnLimit: 10 })).toBe(
            true,
        );
    });
});

describe("hosted quota overlay", () => {
    test("leaves a catalog with remaining allowance alone", () => {
        expect(overlayHostedQuota(catalog, false)).toEqual(catalog);
    });

    test("marks only the hosted connection exhausted", () => {
        const overlaid = overlayHostedQuota(catalog, true, "used up");
        expect(overlaid.providers.find((provider) => provider.id === HOSTED_PROVIDER_ID)).toMatchObject({
            connectionState: "quota_exhausted",
            blockingMessage: "used up",
        });
        expect(overlaid.providers.find((provider) => provider.id === "mock")?.connectionState).toBe(
            "connected",
        );
        expect(overlaid.models.find((model) => model.providerId === HOSTED_PROVIDER_ID)).toMatchObject({
            available: false,
            unavailableReason: "used up",
        });
        expect(overlaid.models.find((model) => model.providerId === "mock")?.available).toBe(true);
    });
});
