import { parseAIEvent, parseBootstrap } from "$lib/ai/schemas";
import {
    activeContextDescriptors,
    activeQuickActions,
    removeContextLayer,
    upsertContextLayer,
} from "$lib/ai/context-stack";
import type {
    AIBootstrap,
    AIChatRequestBody,
    AIErrorPart,
    AIModelReference,
    CoachContextLayer,
    NormalizedAIEvent,
    NormalizedAIMessage,
} from "$lib/ai/types";

class CoachStore {
    enabled = $state(false);
    initialized = $state(false);
    loading = $state(false);
    bootstrap = $state<AIBootstrap | null>(null);
    messages = $state<NormalizedAIMessage[]>([]);
    conversationId = $state<string | undefined>(undefined);
    draft = $state("");
    selectedModel = $state<AIModelReference>("auto");
    streaming = $state(false);
    error = $state<AIErrorPart | null>(null);
    contextLayers = $state<CoachContextLayer[]>([]);
    detachedContextIds = $state<string[]>([]);
    liveAnnouncement = $state("");
    #abortController: AbortController | null = null;
    #lastPrompt = "";

    get activeContexts() {
        return activeContextDescriptors(this.contextLayers, new Set(this.detachedContextIds));
    }

    get quickActions() {
        return activeQuickActions(this.contextLayers);
    }

    get models() {
        return this.bootstrap?.models ?? [];
    }

    get connectionBlocked(): boolean {
        return this.bootstrap?.connection?.connectionState !== "connected";
    }

    configure(enabled: boolean): void {
        this.enabled = enabled;
    }

    registerContext(layer: CoachContextLayer): () => void {
        this.contextLayers = upsertContextLayer(this.contextLayers, layer);
        return () => {
            this.contextLayers = removeContextLayer(this.contextLayers, layer.ownerId);
        };
    }

    detachContext(id: string): void {
        if (!this.detachedContextIds.includes(id)) {
            this.detachedContextIds = [...this.detachedContextIds, id];
        }
    }

    async initialize(force = false): Promise<void> {
        if (!this.enabled || (this.initialized && !force) || this.loading) return;
        this.loading = true;
        this.error = null;
        try {
            const response = await fetch("/api/ai/bootstrap", { headers: { accept: "application/json" } });
            if (!response.ok) throw await this.responseError(response);
            const bootstrap = parseBootstrap(await response.json());
            this.bootstrap = bootstrap;
            this.selectedModel = bootstrap.defaultModel;
            if (bootstrap.conversation) {
                this.conversationId = bootstrap.conversation.id;
                this.messages = bootstrap.conversation.messages;
            }
            this.initialized = true;
        } catch (error) {
            this.error = this.normalizeError(error, "bootstrap_unavailable");
        } finally {
            this.loading = false;
        }
    }

    async send(prompt = this.draft): Promise<void> {
        const message = prompt.trim();
        if (!message || this.streaming) return;
        if (!this.initialized) await this.initialize();
        if (!this.bootstrap || this.connectionBlocked) {
            this.draft = message;
            this.error = {
                type: "error",
                code: "connection_unavailable",
                message:
                    this.bootstrap?.connection?.blockingMessage ??
                    "Coach is not connected. Retry after the connection is restored.",
                retryable: true,
            };
            return;
        }

        this.#lastPrompt = message;
        this.draft = "";
        this.error = null;
        this.streaming = true;
        this.liveAnnouncement = "Coach started responding";
        this.messages.push({
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text: message }],
            status: "complete",
            createdAt: new Date().toISOString(),
        });

        this.#abortController = new AbortController();
        const body: AIChatRequestBody = {
            conversationId: this.conversationId,
            model: this.selectedModel,
            message,
            contexts: this.activeContexts,
            task: "general",
        };

        try {
            const response = await fetch("/api/ai/chat", {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/x-ndjson" },
                body: JSON.stringify(body),
                signal: this.#abortController.signal,
            });
            if (!response.ok || !response.body) throw await this.responseError(response);
            await this.consume(response.body);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                const current = this.messages.findLast((item) => item.status === "streaming");
                if (current) current.status = "cancelled";
                this.liveAnnouncement = "Coach response stopped";
            } else {
                this.error = this.normalizeError(error, "stream_interrupted");
                const current = this.messages.findLast((item) => item.status === "streaming");
                if (current) {
                    current.status = "failed";
                    current.parts.push(this.error);
                }
                this.liveAnnouncement = "Coach response failed";
            }
        } finally {
            this.streaming = false;
            this.#abortController = null;
        }
    }

    stop(): void {
        this.#abortController?.abort();
    }

    async retry(): Promise<void> {
        if (this.#lastPrompt) await this.send(this.#lastPrompt);
    }

    newConversation(): void {
        if (this.streaming) this.stop();
        this.conversationId = undefined;
        this.messages = [];
        this.error = null;
        this.detachedContextIds = [];
    }

    async setHistoryEnabled(enabled: boolean): Promise<void> {
        const response = await fetch("/api/ai/preferences", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ historyEnabled: enabled }),
        });
        if (!response.ok) throw await this.responseError(response);
        if (this.bootstrap) this.bootstrap.historyEnabled = enabled;
    }

    private async consume(stream: ReadableStream<Uint8Array>): Promise<void> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (line.trim()) this.applyEvent(parseAIEvent(JSON.parse(line)));
            }
            if (done) {
                if (buffer.trim()) this.applyEvent(parseAIEvent(JSON.parse(buffer)));
                break;
            }
        }
    }

    private applyEvent(event: NormalizedAIEvent): void {
        if (event.type === "message.start") {
            this.conversationId = event.conversationId;
            this.messages.push({
                id: event.messageId,
                role: "assistant",
                parts: [],
                status: "streaming",
                createdAt: new Date().toISOString(),
                resolvedModel: event.model,
            });
            return;
        }
        const messageId = "messageId" in event ? event.messageId : undefined;
        const message = messageId ? this.messages.find((item) => item.id === messageId) : undefined;
        if (event.type === "message.delta" && message) {
            const last = message.parts.at(-1);
            if (last?.type === "text") last.text += event.delta;
            else message.parts.push({ type: "text", text: event.delta });
        } else if (event.type === "status" && message) {
            this.liveAnnouncement = event.label;
        } else if (event.type === "tool.proposed" && message) {
            message.parts.push({
                type: "tool",
                runId: event.runId,
                tool: event.tool,
                status: "proposed",
                summary: event.summary,
            });
            this.liveAnnouncement = "Coach activity requires attention";
        } else if (event.type === "tool.started" && message) {
            const tool = message.parts.find(
                (part) => part.type === "tool" && part.runId === event.runId,
            );
            if (tool?.type === "tool") tool.status = "running";
        } else if (event.type === "tool.result" && message) {
            const tool = message.parts.find(
                (part) => part.type === "tool" && part.runId === event.runId,
            );
            if (tool?.type === "tool") {
                tool.status = "succeeded";
                tool.summary = event.summary;
            }
            this.liveAnnouncement = "Coach activity complete";
        } else if (event.type === "error") {
            this.error = { type: "error", code: event.code, message: event.message, retryable: event.retryable };
            if (message) message.parts.push(this.error);
        } else if (event.type === "message.done" && message) {
            message.status = event.status;
            this.liveAnnouncement =
                event.status === "complete" ? "Coach response complete" : "Coach response ended";
        }
    }

    private async responseError(response: Response): Promise<Error> {
        const payload = await response.json().catch(() => null);
        const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
        Object.assign(error, { code: payload?.error?.code });
        return error;
    }

    private normalizeError(error: unknown, fallbackCode: string): AIErrorPart {
        return {
            type: "error",
            code:
                typeof error === "object" && error && "code" in error && typeof error.code === "string"
                    ? error.code
                    : fallbackCode,
            message: error instanceof Error ? error.message : "Coach is temporarily unavailable.",
            retryable: true,
        };
    }
}

export const coach = new CoachStore();
