import type { AIConnectionCredential } from "../types";
import { OpenAICompatAdapter } from "./openai-compat";
import type { AIProviderAdapter } from "./types";

/**
 * Adapters for the user's own connections, running in their browser.
 *
 * BYOK requests go straight from the browser to the provider: the key never leaves the
 * device, there is no proxy hop before the first token, and a connection to the user's
 * own machine (local Ollama, vLLM) just works. The server is only involved for
 * connections it owns (see `$lib/server/ai/providers/registry`) and for persistence.
 */
export function clientProviderRegistry(
    credentials: readonly AIConnectionCredential[],
): AIProviderAdapter[] {
    return credentials.map((credential) => new OpenAICompatAdapter({ credential }));
}

export function clientProviderById(
    id: string,
    credentials: readonly AIConnectionCredential[],
): AIProviderAdapter | undefined {
    const credential = credentials.find((entry) => entry.id === id);
    return credential ? new OpenAICompatAdapter({ credential }) : undefined;
}
