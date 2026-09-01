import { isModelReference } from "$lib/ai/schemas";
import { HOSTED_PROVIDER_ID, type NormalizedAIEvent, type NormalizedAIModel } from "$lib/ai/types";
import { isChatModelId, type FetchFunction } from "$lib/ai/providers/openai-models";
import { OpenAICompatAdapter } from "$lib/ai/providers/openai-compat";
import type { AIProviderAdapter } from "$lib/ai/providers/types";
import { hostedFallbackOptions, type HostedConnectionConfig, type HostedOffer } from "../hosted-plan";
import { presetFor } from "$lib/ai/presets";

/**
 * Server-owned OpenAI-compatible connection. The catalog is the one public offer
 * in `$lib/server/ai/hosted-plan`, not upstream discovery and not the OpenRouter
 * fallback list: we pay for every token, so the client picks "Auto", not a slug.
 *
 * The inner adapter is the same any-model class BYOK uses. Fallbacks ride on
 * `providerOptions.models` (OpenRouter extra-body), which openai-compat
 * spreads into the chat body. Attribution headers are added here — OpenRouter
 * asks for them, and some `:free` endpoints refuse requests without them.
 */
export class HostedProviderAdapter implements AIProviderAdapter {
    readonly id = HOSTED_PROVIDER_ID;
    readonly authMethods = ["hosted"] as const;
    readonly label: string;
    readonly #offer: HostedOffer;
    readonly #route: string[];
    readonly #preset: HostedConnectionConfig["preset"];
    readonly #inner: OpenAICompatAdapter;

    constructor(config: HostedConnectionConfig & { fetchImpl?: FetchFunction }) {
        const primary = config.route[0];
        if (!primary) throw new TypeError("hosted route must include a primary model");
        this.label = config.label;
        this.#offer = config.offer;
        this.#route = config.route;
        this.#preset = config.preset;
        this.#inner = new OpenAICompatAdapter({
            credential: {
                id: HOSTED_PROVIDER_ID,
                preset: config.preset,
                label: config.label,
                baseURL: config.baseURL,
                apiKey: config.apiKey,
            },
            fetchImpl: withOpenRouterAttribution(config.fetchImpl ?? fetch, config.label),
        });
    }

    async validateConnection() {
        return "connected" as const;
    }

    async connectionSummary() {
        const preset = presetFor(this.#preset);
        return {
            id: this.id,
            label: this.label,
            authMethods: this.authMethods,
            capabilities: preset.defaultCapabilities,
            connectionState: "connected" as const,
            displayLabel: this.label,
        };
    }

    async listModels(): Promise<NormalizedAIModel[]> {
        const preset = presetFor(this.#preset);
        const id = this.#offer.id;
        if (!isModelReference(`${this.id}:${id}`) || !isChatModelId(id)) return [];
        return [
            {
                reference: `${this.id}:${id}` as const,
                providerId: this.id,
                providerLabel: this.label,
                id,
                label: this.#offer.label,
                description: this.#offer.description,
                capabilities: preset.defaultCapabilities,
                tags: [],
                available: true,
            },
        ];
    }

    async stream(request: Parameters<AIProviderAdapter["stream"]>[0]) {
        const primary = this.#route[0];
        if (!primary) throw new TypeError("hosted route must include a primary model");
        const offerRef = `${this.id}:${this.#offer.id}` as const;
        const extras = hostedFallbackOptions(this.#route);
        const inner = await this.#inner.stream({
            ...request,
            model: `${this.id}:${primary}` as const,
            ...(extras ? { providerOptions: { [this.id]: extras } } : {}),
        });
        return remapOfferEvents(inner, offerRef);
    }
}

/**
 * OpenRouter ranks apps by Referer / title and some `:free` providers drop
 * requests that omit them. Applied only on the hosted hop — BYOK stays untouched.
 */
export function withOpenRouterAttribution(
    fetchImpl: FetchFunction,
    title: string,
): FetchFunction {
    return (input, init) => {
        const headers = new Headers(init?.headers);
        if (!headers.has("HTTP-Referer") && !headers.has("http-referer")) {
            headers.set("HTTP-Referer", "https://problemcloud.app");
        }
        if (!headers.has("X-Title") && !headers.has("x-title")) {
            headers.set("X-Title", title);
        }
        return fetchImpl(input, { ...init, headers });
    };
}

/** The browser only ever sees the public offer, never the OpenRouter slug that served. */
function remapOfferEvents(
    stream: ReadableStream<NormalizedAIEvent>,
    offerRef: string,
): ReadableStream<NormalizedAIEvent> {
    return stream.pipeThrough(
        new TransformStream<NormalizedAIEvent, NormalizedAIEvent>({
            transform(event, controller) {
                if (event.type === "message.start" || event.type === "request.snapshot") {
                    controller.enqueue({ ...event, model: offerRef });
                    return;
                }
                controller.enqueue(event);
            },
        }),
    );
}
