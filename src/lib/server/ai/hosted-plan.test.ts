import { describe, expect, test } from "bun:test";
import { HOSTED_PROVIDER_ID } from "$lib/ai/types";
import { isModelReference } from "$lib/ai/schemas";
import { presetFor } from "$lib/ai/presets";
import {
    HOSTED_PLAN,
    hostedFallbackOptions,
    hostedLimits,
    hostedOfferReference,
} from "./hosted-plan";

describe("hosted plan", () => {
    test("calls OpenRouter with one public offer and a private fallback route", () => {
        expect(HOSTED_PLAN.preset).toBe("openrouter");
        expect(presetFor(HOSTED_PLAN.preset).baseURL).toBe("https://openrouter.ai/api/v1");
        expect(hostedOfferReference()).toBe(`${HOSTED_PROVIDER_ID}:${HOSTED_PLAN.offer.id}`);
        expect(isModelReference(hostedOfferReference())).toBe(true);
        expect(HOSTED_PLAN.route.length).toBeGreaterThan(0);
        expect(HOSTED_PLAN.route[0]).not.toBe(HOSTED_PLAN.offer.id);
        for (const id of HOSTED_PLAN.route) {
            expect(id).toContain("/");
        }
    });

    test("fallback extras are the rest of the route, not the primary", () => {
        expect(hostedFallbackOptions(["a"])).toBeUndefined();
        expect(hostedFallbackOptions(["a", "b", "c"])).toEqual({
            models: ["b", "c"],
        });
        expect(hostedFallbackOptions(["a", "b", "c"])).not.toHaveProperty("route");
    });

    test("OpenRouter only accepts three fallbacks", () => {
        expect(hostedFallbackOptions(["a", "b", "c", "d", "e", "f"])).toEqual({
            models: ["b", "c", "d"],
        });
    });

    test("allowance is a monthly credit and turn cap", () => {
        const limits = hostedLimits();
        expect(limits.period).toBe("month");
        expect(limits.creditLimit).toBeGreaterThan(0);
        expect(limits.turnLimit).toBeGreaterThan(0);
    });
});
