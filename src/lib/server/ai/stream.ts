import { parseAIEvent } from "$lib/ai/schemas";
import type { NormalizedAIEvent } from "$lib/ai/types";

const encoder = new TextEncoder();

export function encodeNDJSON(event: NormalizedAIEvent): Uint8Array {
    return encoder.encode(`${JSON.stringify(parseAIEvent(event))}\n`);
}

export function encodeEventStream(
    source: ReadableStream<NormalizedAIEvent>,
    onEvent?: (event: NormalizedAIEvent) => void | Promise<void>,
    onClose?: (reason?: unknown) => void | Promise<void>,
): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { value, done } = await reader.read();
                if (done) {
                    await onClose?.();
                    controller.close();
                    return;
                }
                const event = parseAIEvent(value);
                await onEvent?.(event);
                controller.enqueue(encodeNDJSON(event));
            } catch (error) {
                await onClose?.(error);
                controller.error(error);
            }
        },
        async cancel(reason) {
            await reader.cancel(reason);
            await onClose?.(reason);
        },
    });
}
