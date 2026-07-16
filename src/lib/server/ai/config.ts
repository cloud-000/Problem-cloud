import { env } from "$env/dynamic/private";
import type { AICoachConnectionState, AIMockScenario } from "$lib/ai/types";

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
];

export function aiCoachEnabled(): boolean {
    return env.AI_COACH_ENABLED === "true";
}

export function mockProviderEnabled(): boolean {
    return aiCoachEnabled() && env.AI_COACH_MOCK_ENABLED === "true";
}

export function mockConnectionState(): AICoachConnectionState {
    const value = env.AI_COACH_MOCK_CONNECTION_STATE as AICoachConnectionState | undefined;
    return value && connectionStates.includes(value) ? value : "connected";
}

export function mockScenario(): AIMockScenario {
    const value = env.AI_COACH_MOCK_SCENARIO as AIMockScenario | undefined;
    return value && scenarios.includes(value) ? value : "success";
}

export function mockChunkDelayMs(): number {
    const value = Number(env.AI_COACH_MOCK_CHUNK_DELAY_MS ?? 24);
    return Number.isFinite(value) && value >= 0 && value <= 5_000 ? value : 24;
}
