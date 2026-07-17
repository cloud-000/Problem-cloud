import { mockChunkDelayMs, mockConnectionState, mockProviderEnabled, mockScenario } from "../config";
import { MockProviderAdapter } from "./mock";
import type { AIProviderAdapter } from "$lib/ai/providers/types";

/**
 * The connections the server itself owns — today only the deterministic mock, and later
 * a first-party provider whose credentials genuinely belong on the server.
 *
 * A user's own BYOK connections are deliberately absent: their keys stay in the browser
 * and their requests go straight to the provider, so the server never sees them. The
 * browser builds those adapters itself (`$lib/ai/providers/client-registry`) and merges
 * the two catalogs.
 */
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
