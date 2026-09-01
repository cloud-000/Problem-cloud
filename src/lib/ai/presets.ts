import type { AIPresetId, AIProviderCapabilities } from "./types";

/**
 * Connection presets for OpenAI-compatible endpoints. Shared by the settings UI and
 * the server adapter, and free of secrets — a preset only describes where an endpoint
 * lives and what its models can do.
 *
 * Model existence is discovered from the endpoint's own `GET /models`; these tables
 * only decorate what discovery finds. An id missing here is still usable once pinned
 * on the connection, it just falls back to `defaultCapabilities` and a humanized label.
 */

export interface AIPresetModel {
    label: string;
    description?: string;
    tags: string[];
    capabilities: AIProviderCapabilities;
}

export interface AIProviderPreset {
    id: AIPresetId;
    label: string;
    /** Empty for `custom`, where the user supplies the endpoint. */
    baseURL: string;
    docsUrl: string;
    keyPlaceholder: string;
    /** Whether a key is required. Local endpoints are often keyless. */
    requiresKey: boolean;
    models: Record<string, AIPresetModel>;
    defaultCapabilities: AIProviderCapabilities;
}

const TEXT_ONLY: AIProviderCapabilities = {
    chat: true,
    streaming: true,
    tools: false,
    vision: false,
    structuredOutput: false,
};

const TEXT_AND_JSON: AIProviderCapabilities = { ...TEXT_ONLY, structuredOutput: true };
const MULTIMODAL: AIProviderCapabilities = { ...TEXT_AND_JSON, vision: true };

export const AI_PROVIDER_PRESETS: Record<AIPresetId, AIProviderPreset> = {
    openai: {
        id: "openai",
        label: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        docsUrl: "https://platform.openai.com/api-keys",
        keyPlaceholder: "sk-…",
        requiresKey: true,
        defaultCapabilities: TEXT_AND_JSON,
        models: {
            "gpt-4.1": {
                label: "GPT-4.1",
                description: "Strong general reasoning with a large context window.",
                tags: ["general"],
                capabilities: MULTIMODAL,
            },
            "gpt-4.1-mini": {
                label: "GPT-4.1 mini",
                description: "Faster and cheaper; good for routine hints.",
                tags: ["fast"],
                capabilities: MULTIMODAL,
            },
            "gpt-4o": {
                label: "GPT-4o",
                description: "Multimodal, reads diagrams and images.",
                tags: ["general", "vision"],
                capabilities: MULTIMODAL,
            },
            "gpt-4o-mini": {
                label: "GPT-4o mini",
                tags: ["fast", "vision"],
                capabilities: MULTIMODAL,
            },
            o3: {
                label: "o3",
                description: "Deliberate reasoning; strongest on hard math.",
                tags: ["reasoning", "math"],
                capabilities: MULTIMODAL,
            },
            "o4-mini": {
                label: "o4-mini",
                description: "Reasoning model tuned for speed and cost.",
                tags: ["reasoning", "fast"],
                capabilities: MULTIMODAL,
            },
        },
    },
    groq: {
        id: "groq",
        label: "Groq",
        baseURL: "https://api.groq.com/openai/v1",
        docsUrl: "https://console.groq.com/keys",
        keyPlaceholder: "gsk_…",
        requiresKey: true,
        defaultCapabilities: TEXT_ONLY,
        models: {
            "llama-3.3-70b-versatile": {
                label: "Llama 3.3 70B",
                description: "Very fast general chat.",
                tags: ["general", "fast"],
                capabilities: TEXT_AND_JSON,
            },
            "llama-3.1-8b-instant": {
                label: "Llama 3.1 8B",
                tags: ["fast"],
                capabilities: TEXT_AND_JSON,
            },
            "deepseek-r1-distill-llama-70b": {
                label: "DeepSeek R1 Distill 70B",
                description: "Reasoning distillation; good math for the latency.",
                tags: ["reasoning", "math"],
                capabilities: TEXT_ONLY,
            },
        },
    },
    deepseek: {
        id: "deepseek",
        label: "DeepSeek",
        baseURL: "https://api.deepseek.com/v1",
        docsUrl: "https://platform.deepseek.com/api_keys",
        keyPlaceholder: "sk-…",
        requiresKey: true,
        defaultCapabilities: TEXT_ONLY,
        models: {
            "deepseek-chat": {
                label: "DeepSeek Chat",
                tags: ["general"],
                capabilities: TEXT_AND_JSON,
            },
            "deepseek-reasoner": {
                label: "DeepSeek Reasoner",
                description: "Chain-of-thought model; strong on competition math.",
                tags: ["reasoning", "math"],
                capabilities: TEXT_ONLY,
            },
        },
    },
    together: {
        id: "together",
        label: "Together AI",
        baseURL: "https://api.together.xyz/v1",
        docsUrl: "https://api.together.ai/settings/api-keys",
        keyPlaceholder: "…",
        requiresKey: true,
        defaultCapabilities: TEXT_ONLY,
        models: {
            "meta-llama/Llama-3.3-70B-Instruct-Turbo": {
                label: "Llama 3.3 70B Turbo",
                tags: ["general"],
                capabilities: TEXT_AND_JSON,
            },
            "Qwen/Qwen2.5-72B-Instruct-Turbo": {
                label: "Qwen 2.5 72B Turbo",
                tags: ["general"],
                capabilities: TEXT_AND_JSON,
            },
            "deepseek-ai/DeepSeek-R1": {
                label: "DeepSeek R1",
                description: "Reasoning model; strong on competition math.",
                tags: ["reasoning", "math"],
                capabilities: TEXT_ONLY,
            },
        },
    },
    openrouter: {
        id: "openrouter",
        label: "OpenRouter",
        baseURL: "https://openrouter.ai/api/v1",
        docsUrl: "https://openrouter.ai/keys",
        keyPlaceholder: "sk-or-…",
        requiresKey: true,
        defaultCapabilities: TEXT_ONLY,
        models: {
            "anthropic/claude-sonnet-4.5": {
                label: "Claude Sonnet 4.5",
                description: "Strong reasoning and explanation quality.",
                tags: ["general", "math"],
                capabilities: MULTIMODAL,
            },
            "openai/gpt-4.1": {
                label: "GPT-4.1",
                tags: ["general"],
                capabilities: MULTIMODAL,
            },
            "openai/gpt-4o-mini": {
                label: "GPT-4o mini",
                tags: ["fast"],
                capabilities: MULTIMODAL,
            },
            "openai/o3": {
                label: "o3",
                description: "Deliberate reasoning; strongest on hard math.",
                tags: ["reasoning", "math"],
                capabilities: MULTIMODAL,
            },
            "google/gemini-2.5-pro": {
                label: "Gemini 2.5 Pro",
                tags: ["general", "vision"],
                capabilities: MULTIMODAL,
            },
            "deepseek/deepseek-r1": {
                label: "DeepSeek R1",
                tags: ["reasoning", "math"],
                capabilities: TEXT_ONLY,
            },
        },
    },
    custom: {
        id: "custom",
        label: "Custom endpoint",
        baseURL: "",
        docsUrl: "",
        keyPlaceholder: "Optional for local endpoints",
        requiresKey: false,
        defaultCapabilities: TEXT_ONLY,
        // Discovery is the only source of truth here: we cannot know what a user's
        // vLLM/LiteLLM/Ollama deployment serves.
        models: {},
    },
};

export const AI_PRESET_IDS = Object.keys(AI_PROVIDER_PRESETS) as AIPresetId[];

export function presetFor(id: AIPresetId): AIProviderPreset {
    return AI_PROVIDER_PRESETS[id];
}

/** Fallback label for a discovered model absent from the curated table. */
export function humanizeModelId(modelId: string): string {
    const tail = modelId.split("/").at(-1) ?? modelId;
    return tail.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || modelId;
}
