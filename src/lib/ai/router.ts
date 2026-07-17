import type { AIModelReference, AITaskType, NormalizedAIModel } from "./types";

export class AIModelRoutingError extends Error {
    constructor(
        readonly code: "no_eligible_model" | "model_unavailable" | "model_capability_missing",
        message: string,
    ) {
        super(message);
        this.name = "AIModelRoutingError";
    }
}

export function resolveModel(
    requested: AIModelReference,
    task: AITaskType,
    models: NormalizedAIModel[],
): NormalizedAIModel {
    const eligible = models.filter((model) => {
        if (!model.available || !model.capabilities.chat || !model.capabilities.streaming) return false;
        if (task === "agentic" && !model.capabilities.tools) return false;
        if (task === "vision" && !model.capabilities.vision) return false;
        return true;
    });
    if (requested === "auto") {
        const preferred = eligible
            .slice()
            .sort((a, b) => Number(b.capabilities.tools) - Number(a.capabilities.tools))[0];
        if (!preferred) throw new AIModelRoutingError("no_eligible_model", "No eligible model is available");
        return preferred;
    }
    const model = models.find((candidate) => candidate.reference === requested);
    if (!model?.available) {
        throw new AIModelRoutingError("model_unavailable", "The selected model is unavailable");
    }
    if (!eligible.includes(model)) {
        throw new AIModelRoutingError(
            "model_capability_missing",
            "The selected model does not support this request",
        );
    }
    return model;
}
