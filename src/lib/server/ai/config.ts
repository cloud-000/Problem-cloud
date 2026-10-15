import {
    AI_COACH_ENABLED,
    AI_COACH_MOCK_ENABLED,
    AI_COACH_MOCK_CONNECTION_STATE,
    AI_COACH_MOCK_SCENARIO,
    AI_COACH_MOCK_CHUNK_DELAY_MS,
    AI_COACH_HOSTED_API_KEY
} from "$app/env/private";

import type { AICoachConnectionState, AIMockScenario } from "#lib/ai/types.js";
import { presetFor } from "#lib/ai/presets.js";
import { HOSTED_PLAN, type HostedConnectionConfig } from "./hosted-plan";

const connectionStates: AICoachConnectionState[] = [
    "connected",
    "disconnected",
    "needs_reauth",
    "quota_exhausted",
    "error",
];

const scenarios: AIMockScenario[] = [
    "success",
    "slow",
    "mid_stream_error",
    "refusal",
    "auth_error",
    "rate_limit",
    "tool_proposal",
    "tool_result",
    "reasoning",
];

export function aiCoachEnabled(): boolean {
    return AI_COACH_ENABLED === "true";
}

/**
 * Offers the deterministic mock as a server-owned connection. Users' own connections
 * need no server flag — their keys stay in the browser and the requests never reach us.
 */
export function mockProviderEnabled(): boolean {
    return aiCoachEnabled() && AI_COACH_MOCK_ENABLED === "true";
}

export function mockConnectionState(): AICoachConnectionState {
    const value = AI_COACH_MOCK_CONNECTION_STATE as AICoachConnectionState | undefined;
    return value && connectionStates.includes(value) ? value : "connected";
}

export function mockScenario(): AIMockScenario {
    const value = AI_COACH_MOCK_SCENARIO as AIMockScenario | undefined;
    return value && scenarios.includes(value) ? value : "success";
}

export function mockChunkDelayMs(): number {
    const value = Number(AI_COACH_MOCK_CHUNK_DELAY_MS ?? 24);
    return Number.isFinite(value) && value >= 0 && value <= 5_000 ? value : 24;
}

/**
 * Offers the first-party hosted connection when Coach is on and the OpenRouter
 * key is present. Offer, OpenRouter fallback list, and allowance are `#lib/server/ai/hosted-plan.js`.
 */
export function hostedProviderEnabled(): boolean {
    return aiCoachEnabled() && hostedConfig() !== null;
}

export function hostedConfig(): HostedConnectionConfig | null {
    const apiKey = (AI_COACH_HOSTED_API_KEY ?? "").trim();
    if (!apiKey) return null;
    return {
        preset: HOSTED_PLAN.preset,
        label: HOSTED_PLAN.label,
        baseURL: presetFor(HOSTED_PLAN.preset).baseURL,
        apiKey,
        offer: { ...HOSTED_PLAN.offer },
        route: [...HOSTED_PLAN.route],
    };
}
