import type { AIProviderMessage, NormalizedAIMessage, NormalizedAIRequest } from "../types";
import { BLOCK_SEPARATOR, buildSystemMessage, contextFrame, CONTEXT_ACK } from "../prompt";

/**
 * Flattens normalized history into the application-level messages handed to a model.
 *
 * A student turn is handed over verbatim. Application context is a message of its own,
 * pinned to the turn where it became true — so what the model reads as the student's
 * words is only ever the student's words, and the shape of a user message does not
 * change depending on whether the app had something to say at that point.
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

    const push = (role: "user" | "assistant", content: string) => {
        const previous = turns.at(-1);
        if (previous?.role === role) previous.content += `${BLOCK_SEPARATOR}${content}`;
        else turns.push({ role, content });
    };

    /**
     * A frame must not merge with a student turn on either side — merging them is the
     * shape this design exists to remove — so it is bracketed by acknowledgements the app
     * writes instead. The leading one is reached only when the assistant turn that
     * belonged between them failed and was dropped, where there is genuinely no answer
     * for it to displace.
     */
    const pushFrame = (renderedContext: string) => {
        const frame = contextFrame(renderedContext);
        if (!frame) return;
        if (turns.at(-1)?.role === "user") turns.push({ role: "assistant", content: CONTEXT_ACK });
        turns.push({ role: "user", content: frame });
        turns.push({ role: "assistant", content: CONTEXT_ACK });
    };

    for (const entry of history) {
        if (entry.role !== "user" && entry.role !== "assistant") continue;
        if (entry.role === "assistant" && entry.status !== "complete") continue;
        const text = entry.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
            .trim();
        // Checked before the frame is emitted: a turn with nothing to say carries no
        // context either, or the frame would be left acknowledging a message that never
        // reaches the provider.
        if (!text) continue;
        if (entry.role === "user") pushFrame(entry.renderedContext ?? "");
        push(entry.role, text);
    }

    pushFrame(currentContext);
    push("user", message);

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
