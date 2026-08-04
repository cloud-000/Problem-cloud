import type {
    AIErrorPart,
    AIModelReference,
    NormalizedAIMessage,
    NormalizedAIModel,
} from "$lib/ai/types";

export interface AIChatController {
    messages: NormalizedAIMessage[];
    draft: string;
    selectedModel: AIModelReference;
    models: readonly NormalizedAIModel[];
    streaming: boolean;
    error: AIErrorPart | null;
    liveAnnouncement: string;
    send(prompt?: string): void | Promise<void>;
    stop(): void;
    retry(): void | Promise<void>;
}

export interface AIChatQuickAction {
    id: string;
    label: string;
    prompt: string;
    /** Material Symbols name, shown by the `stack` layout. Must be in app.html's subset. */
    icon?: string;
}
