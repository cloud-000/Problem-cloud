import type { AIProviderSummary, NormalizedAIModel } from "$lib/ai/types";
import { parseNormalizedModel, parseProviderSummary } from "$lib/ai/schemas";
import { providerRegistry } from "../providers/registry";

export async function buildModelCatalog(): Promise<{
    providers: AIProviderSummary[];
    models: NormalizedAIModel[];
}> {
    const providers = providerRegistry();
    const [summaries, modelGroups] = await Promise.all([
        Promise.all(providers.map((provider) => provider.connectionSummary())),
        Promise.all(providers.map((provider) => provider.listModels())),
    ]);
    return {
        providers: summaries.map(parseProviderSummary),
        models: modelGroups.flat().map(parseNormalizedModel),
    };
}
