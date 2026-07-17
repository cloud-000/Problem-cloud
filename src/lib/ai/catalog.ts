import type { AIProviderSummary, NormalizedAIModel } from "./types";
import { parseNormalizedModel, parseProviderSummary } from "./schemas";
import type { AIProviderAdapter } from "./providers/types";

export interface AIModelCatalog {
    providers: AIProviderSummary[];
    models: NormalizedAIModel[];
}

/**
 * Builds the catalog from adapters the caller already holds — callers pair this with
 * `providerRegistry(credentials)`. Adapters memoize their connection probe, so a caller
 * that also needs to stream should reuse one set rather than rebuild it; otherwise each
 * call site pays its own round trip per provider.
 */
export async function catalogFor(providers: AIProviderAdapter[]): Promise<AIModelCatalog> {
    // Each provider is isolated: one that throws or reports an unrepresentable model is
    // reported as a broken connection, and the user's other connections still work.
    const entries = await Promise.all(
        providers.map(async (provider): Promise<AIModelCatalog> => {
            try {
                const [summary, models] = await Promise.all([
                    provider.connectionSummary(),
                    provider.listModels(),
                ]);
                return {
                    providers: [parseProviderSummary(summary)],
                    models: models.map(parseNormalizedModel),
                };
            } catch {
                return {
                    providers: [
                        {
                            id: provider.id,
                            label: provider.label,
                            authMethods: provider.authMethods,
                            capabilities: {
                                chat: false,
                                streaming: false,
                                tools: false,
                                vision: false,
                                structuredOutput: false,
                            },
                            connectionState: "error",
                            blockingMessage: "This connection returned a response we could not read.",
                        },
                    ],
                    models: [],
                };
            }
        }),
    );
    return {
        providers: entries.flatMap((entry) => entry.providers),
        models: entries.flatMap((entry) => entry.models),
    };
}
