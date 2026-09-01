import { HOSTED_PROVIDER_ID, type AIPresetId } from "$lib/ai/types";

/**
 * What the first-party hosted Coach actually serves. Edit this file to change
 * the offer, OpenRouter fallback order, allowance, and credit weights. The
 * OpenRouter key is the only secret, and the only thing that stays in env.
 *
 * `offer` is the one catalog entry the picker shows. `route` is the OpenRouter
 * model list, tried in order via any-model `providerOptions` (`models`).
 * OpenRouter accepts at most three entries in `models`, so only the primary
 * plus the next three slugs are sent. Slugs never appear in the catalog.
 */
export const HOSTED_PLAN = {
    preset: "openrouter" as const satisfies AIPresetId,
    label: "ProblemCloud",
    offer: {
        id: "auto",
        label: "problem-cloud",
        description: "Picks a model and falls back if one is unavailable.",
    },
    route: [
        "inclusionai/ling-3.0-flash-fin:free",
        "poolside/laguna-s-2.1:free",
        "poolside/laguna-xs-2.1:free",
        "thinkingmachines/inkling:free",
        "thinkingmachines/inkling-small:free",
        "z-ai/glm-5.2:free",
    ],
    creditLimit: 230_000,
    turnLimit: 1000,
    period: "month" as const,
    inputWeight: 1,
    outputWeight: 4,
};

export type HostedLimits = Pick<
    typeof HOSTED_PLAN,
    "creditLimit" | "turnLimit" | "period" | "inputWeight" | "outputWeight"
>;

export interface HostedOffer {
    id: string;
    label: string;
    description?: string;
}

export interface HostedConnectionConfig {
    preset: AIPresetId;
    label: string;
    baseURL: string;
    apiKey: string;
    offer: HostedOffer;
    /** OpenRouter model ids, primary first. Not catalogued. Only the first four are sent. */
    route: string[];
}

export function hostedOfferReference(): `${typeof HOSTED_PROVIDER_ID}:${string}` {
    return `${HOSTED_PROVIDER_ID}:${HOSTED_PLAN.offer.id}`;
}

export function hostedLimits(): HostedLimits {
    return {
        creditLimit: HOSTED_PLAN.creditLimit,
        turnLimit: HOSTED_PLAN.turnLimit,
        period: HOSTED_PLAN.period,
        inputWeight: HOSTED_PLAN.inputWeight,
        outputWeight: HOSTED_PLAN.outputWeight,
    };
}

/**
 * any-model `providerOptions` extras for OpenRouter's fallback array. `model` is
 * the primary (first of `route`); these are the rest, capped at three — OpenRouter
 * 400s a longer `models` array. Omitted when there is nothing to fall back to.
 */
export const OPENROUTER_MAX_FALLBACKS = 3;

export function hostedFallbackOptions(route: string[]): Record<string, unknown> | undefined {
    const fallbacks = route.slice(1, 1 + OPENROUTER_MAX_FALLBACKS);
    if (fallbacks.length === 0) return undefined;
    return { models: fallbacks };
}
