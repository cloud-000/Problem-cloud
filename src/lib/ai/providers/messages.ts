import type { AIProviderMessage, NormalizedAIMessage, NormalizedAIRequest } from "../types";
import { applicationContextFrame, buildSystemMessage } from "../prompt";

/**
 * Flattens normalized history into the application-level messages handed to a model.
 *
 * Failed and cancelled assistant turns are dropped so a broken turn is never replayed
 * as context — which can leave two user turns adjacent. Most chat templates (DeepSeek,
 * vLLM) reject that with a 400, so same-role runs are merged afterwards.
 */
export function toProviderMessages(
    history: NormalizedAIMessage[],
    message: string,
    system: string,
    currentContext = "",
): AIProviderMessage[] {
    const turns: AIProviderMessage[] = [];

    for (const entry of history) {
        if (entry.role !== "user" && entry.role !== "assistant") continue;
        if (entry.role === "assistant" && entry.status !== "complete") continue;
        let text = entry.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
            .trim();
        if (!text) continue;
        if (entry.role === "user" && entry.renderedContext) {
            text = `${applicationContextFrame(entry.renderedContext)}\n\n[Student]\n${text}`;
        }

        const previous = turns.at(-1);
        if (previous?.role === entry.role) previous.content += `\n\n${text}`;
        else turns.push({ role: entry.role, content: text });
    }

    const current = currentContext
        ? `${applicationContextFrame(currentContext)}\n\n[Student]\n${message}`
        : message;
    const last = turns.at(-1);
    if (last?.role === "user") last.content += `\n\n${current}`;
    else turns.push({ role: "user", content: current });

    return [{ role: "system", content: system }, ...turns];
}

/** The final normalized message list shared by provider serialization and diagnostics. */
export function buildProviderMessages(request: NormalizedAIRequest): AIProviderMessage[] {
    return toProviderMessages(
        request.history,
        request.message,
        buildSystemMessage(request.policy),
        request.renderedContext,
    );
}
