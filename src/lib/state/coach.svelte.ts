import {
    parseAIEvent,
    parseBootstrap,
    parseConversationDetail,
    parseConversationList,
} from "$lib/ai/schemas";
import {
    boundEphemeralHistory,
    dedupeById,
    latestPreview,
    PREVIEW_MAX_CHARS,
} from "$lib/ai/conversations";
import {
    activeContextDescriptors,
    activeQuickActions,
    removeContextLayer,
    upsertContextLayer,
} from "$lib/ai/context-stack";
import type {
    AIBootstrap,
    AIChatRequestBody,
    AIEphemeralMessage,
    AIErrorPart,
    AIModelReference,
    CoachContextLayer,
    ConversationSummary,
    NormalizedAIEvent,
    NormalizedAIMessage,
} from "$lib/ai/types";

const CONVERSATION_PAGE_SIZE = 20;

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
    conversations = $state<ConversationSummary[]>([]);
    conversationsLoaded = $state(false);
    conversationsCursor = $state<string | undefined>(undefined);
    conversationListLoading = $state(false);
    conversationListError = $state<AIErrorPart | null>(null);
    loadingConversationId = $state<string | undefined>(undefined);
    historyViewOpen = $state(false);
    #abortController: AbortController | null = null;
    #lastPrompt = "";
    /**
     * Bumped whenever the active conversation changes identity. Every in-flight
     * request captures the value at start and drops its results if it no longer
     * matches, so an abandoned stream or detail response cannot mutate a newer
     * selection.
     */
    #generation = 0;

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

    /** Saved history is unavailable when the user has turned conversation saving off. */
    get historyEnabled(): boolean {
        return this.bootstrap?.historyEnabled ?? false;
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

        // Built before the new prompt joins the transcript so it carries prior turns only.
        const ephemeralHistory = this.ephemeralHistory();
        this.messages.push({
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text: message }],
            status: "complete",
            createdAt: new Date().toISOString(),
        });

        const generation = this.#generation;
        const controller = new AbortController();
        this.#abortController = controller;
        const body: AIChatRequestBody = {
            conversationId: this.conversationId,
            model: this.selectedModel,
            message,
            contexts: this.activeContexts,
            task: "general",
            ephemeralHistory,
        };

        try {
            const response = await fetch("/api/ai/chat", {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/x-ndjson" },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok || !response.body) throw await this.responseError(response);
            await this.consume(response.body, generation);
            if (generation === this.#generation) this.upsertActiveSummary(message);
        } catch (error) {
            if (generation !== this.#generation) return;
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
            if (generation === this.#generation) this.streaming = false;
            if (this.#abortController === controller) this.#abortController = null;
        }
    }

    stop(): void {
        this.#abortController?.abort();
    }

    /**
     * Aborts any in-flight request and invalidates its results, so callers can
     * safely replace the active conversation's ID and transcript.
     */
    #invalidateActiveRequest(): number {
        this.#abortController?.abort();
        this.#abortController = null;
        this.streaming = false;
        this.#generation += 1;
        return this.#generation;
    }

    /**
     * Prior turns for a history-disabled chat. Only sent when saving is off;
     * persisted conversations use server-loaded history instead.
     */
    private ephemeralHistory(): AIEphemeralMessage[] | undefined {
        if (this.historyEnabled) return undefined;
        const history = boundEphemeralHistory(this.messages);
        return history.length > 0 ? history : undefined;
    }

    async retry(): Promise<void> {
        if (this.#lastPrompt) await this.send(this.#lastPrompt);
    }

    /** Clears the active chat. Creation stays lazy — the first send inserts the row. */
    newConversation(): void {
        this.#invalidateActiveRequest();
        this.conversationId = undefined;
        this.messages = [];
        this.error = null;
        this.detachedContextIds = [];
        this.historyViewOpen = false;
    }

    async openConversationList(): Promise<void> {
        this.historyViewOpen = true;
        if (!this.historyEnabled) return;
        // Only the first open pays for a fetch; bootstrap stays as small as it was.
        if (!this.conversationsLoaded && !this.conversationListLoading) {
            await this.fetchConversations();
        }
    }

    closeConversationList(): void {
        this.historyViewOpen = false;
    }

    async loadMoreConversations(): Promise<void> {
        if (!this.conversationsCursor || this.conversationListLoading) return;
        await this.fetchConversations(this.conversationsCursor);
    }

    async retryConversationList(): Promise<void> {
        if (this.conversationListLoading) return;
        await this.fetchConversations(this.conversationsCursor);
    }

    private async fetchConversations(cursor?: string): Promise<void> {
        this.conversationListLoading = true;
        this.conversationListError = null;
        try {
            const params = new URLSearchParams({ limit: String(CONVERSATION_PAGE_SIZE) });
            if (cursor) params.set("cursor", cursor);
            const response = await fetch(`/api/ai/conversations?${params}`, {
                headers: { accept: "application/json" },
            });
            if (!response.ok) throw await this.responseError(response);
            const payload = parseConversationList(await response.json());
            this.conversations = cursor
                ? dedupeById([...this.conversations, ...payload.conversations])
                : payload.conversations;
            this.conversationsCursor = payload.nextCursor;
            this.conversationsLoaded = true;
        } catch (error) {
            this.conversationListError = this.normalizeError(error, "conversation_unavailable");
        } finally {
            this.conversationListLoading = false;
        }
    }

    /**
     * Loads another conversation's transcript. The active chat is left untouched
     * until the detail request succeeds, and a superseded response is discarded.
     */
    async selectConversation(id: string): Promise<void> {
        if (this.streaming) return;
        if (id === this.conversationId) {
            this.historyViewOpen = false;
            return;
        }
        this.loadingConversationId = id;
        this.conversationListError = null;
        const generation = this.#invalidateActiveRequest();
        try {
            const response = await fetch(`/api/ai/conversations/${id}`, {
                headers: { accept: "application/json" },
            });
            if (!response.ok) throw await this.responseError(response);
            const { conversation } = parseConversationDetail(await response.json());
            if (generation !== this.#generation) return;
            this.conversationId = conversation.id;
            this.messages = conversation.messages;
            this.error = null;
            this.detachedContextIds = [];
            this.historyViewOpen = false;
        } catch (error) {
            if (generation !== this.#generation) return;
            this.conversationListError = this.normalizeError(error, "conversation_not_found");
        } finally {
            if (this.loadingConversationId === id) this.loadingConversationId = undefined;
        }
    }

    async archiveConversation(id: string): Promise<void> {
        if (this.streaming) return;
        this.conversationListError = null;
        try {
            const response = await fetch(`/api/ai/conversations/${id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({ archived: true }),
            });
            if (!response.ok) throw await this.responseError(response);
            this.conversations = this.conversations.filter((item) => item.id !== id);
            if (this.conversationId === id) this.newConversation();
        } catch (error) {
            this.conversationListError = this.normalizeError(error, "archive_failed");
        }
    }

    /** Keeps the list in sync after a send without refetching the page. */
    private upsertActiveSummary(prompt: string): void {
        if (!this.conversationsLoaded || !this.conversationId || !this.historyEnabled) return;
        const id = this.conversationId;
        const now = new Date().toISOString();
        const existing = this.conversations.find((item) => item.id === id);
        const summary: ConversationSummary = {
            id,
            title: existing?.title ?? prompt.slice(0, 80),
            preview: latestPreview(this.messages) || prompt.slice(0, PREVIEW_MAX_CHARS),
            messageCount: this.messages.length,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        this.conversations = [summary, ...this.conversations.filter((item) => item.id !== id)];
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

    private async consume(stream: ReadableStream<Uint8Array>, generation: number): Promise<void> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { value, done } = await reader.read();
            // The conversation was switched or cleared; stop feeding its transcript.
            if (generation !== this.#generation) {
                await reader.cancel().catch(() => {});
                return;
            }
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (line.trim()) this.applyEvent(parseAIEvent(JSON.parse(line)), generation);
            }
            if (done) {
                if (buffer.trim()) this.applyEvent(parseAIEvent(JSON.parse(buffer)), generation);
                break;
            }
        }
    }

    private applyEvent(event: NormalizedAIEvent, generation: number): void {
        if (generation !== this.#generation) return;
        if (event.type === "message.start") {
            // History-disabled replies carry a throwaway id that was never persisted;
            // adopting it would make the next send reference a non-existent row.
            if (this.historyEnabled) this.conversationId = event.conversationId;
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
