import { OpenAICompatAdapter } from "$lib/ai/providers/openai-compat";
import { toasts } from "$lib/state/toast.svelte";
import type { AIConnectionCredential } from "$lib/ai/types";

/**
 * Probes a connection from the browser and reports the result as a toast.
 *
 * This is the same code path a real request takes — same adapter, same origin, same
 * network — so a green result here means the Coach will actually work, which a
 * server-side probe could never promise once BYOK calls stopped going through us.
 */
export async function testConnection(credential: AIConnectionCredential): Promise<boolean> {
    try {
        const adapter = new OpenAICompatAdapter({ credential });
        const summary = await adapter.connectionSummary();
        if (summary.connectionState !== "connected") {
            toasts.error(summary.blockingMessage ?? "This connection is not usable.");
            return false;
        }
        const count = (await adapter.listModels()).length;
        toasts.success(`Connected — ${count} model${count === 1 ? "" : "s"} available.`);
        return true;
    } catch {
        toasts.error("Could not reach this provider.");
        return false;
    }
}
