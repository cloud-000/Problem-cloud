import type {
    AIAuthMethod,
    AICoachConnectionState,
    AIProviderSummary,
    NormalizedAIEvent,
    NormalizedAIModel,
    NormalizedAIRequest,
} from "../types";

export interface AIProviderAdapter {
    readonly id: string;
    readonly label: string;
    readonly authMethods: readonly AIAuthMethod[];
    validateConnection(): Promise<AICoachConnectionState>;
    connectionSummary(): Promise<AIProviderSummary>;
    listModels(): Promise<NormalizedAIModel[]>;
    stream(request: NormalizedAIRequest): Promise<ReadableStream<NormalizedAIEvent>>;
}
