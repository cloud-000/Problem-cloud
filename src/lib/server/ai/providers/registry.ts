import { mockChunkDelayMs, mockConnectionState, mockProviderEnabled, mockScenario } from "../config";
import { MockProviderAdapter } from "./mock";
import type { AIProviderAdapter } from "./types";

export function providerRegistry(): AIProviderAdapter[] {
    if (!mockProviderEnabled()) return [];
    return [
        new MockProviderAdapter({
            connectionState: mockConnectionState(),
            scenario: mockScenario(),
            chunkDelayMs: mockChunkDelayMs(),
        }),
    ];
}

export function providerById(id: string): AIProviderAdapter | undefined {
    return providerRegistry().find((provider) => provider.id === id);
}
