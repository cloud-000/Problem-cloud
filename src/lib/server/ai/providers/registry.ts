import { mockChunkDelayMs, mockConnectionState, mockProviderEnabled, mockScenario, hostedConfig, hostedProviderEnabled } from "../config";
import { HostedProviderAdapter } from "./hosted";
import { MockProviderAdapter } from "./mock";
import type { AIProviderAdapter } from "$lib/ai/providers/types";

/**
 * The connections the server itself owns — the deterministic mock (development)
 * and the first-party hosted provider whose credentials genuinely belong here.
 *
 * A user's own BYOK connections are deliberately absent: their keys stay in the
 * browser and their requests go straight to the provider, so the server never
 * sees them. The browser builds those adapters itself
 * (`$lib/ai/providers/client-registry`) and merges the two catalogs.
 */
export function providerRegistry(): AIProviderAdapter[] {
    const providers: AIProviderAdapter[] = [];
    if (mockProviderEnabled()) {
        providers.push(
            new MockProviderAdapter({
                connectionState: mockConnectionState(),
                scenario: mockScenario(),
                chunkDelayMs: mockChunkDelayMs(),
            }),
        );
    }
    if (hostedProviderEnabled()) {
        const config = hostedConfig();
        if (config) providers.push(new HostedProviderAdapter(config));
    }
    return providers;
}

export function providerById(id: string): AIProviderAdapter | undefined {
    return providerRegistry().find((provider) => provider.id === id);
}
