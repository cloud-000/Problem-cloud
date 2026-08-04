import {
    parseAIEvent,
    parseBootstrap,
    parseConversationDetail,
    parseConversationList,
} from "$lib/ai/schemas";
import {
    boundCoachHistory,
    boundEphemeralHistory,
    dedupeById,
    latestPreview,
    PREVIEW_MAX_CHARS,
} from "$lib/ai/conversations";
import { catalogFor, type AIModelCatalog } from "$lib/ai/catalog";
import { resolveModel } from "$lib/ai/router";
import { clientProviderById, clientProviderRegistry } from "$lib/ai/providers/client-registry";
import {
    activeContextDescriptors,
    activeQuickActions,
    removeContextLayer,
    upsertContextLayer,
} from "$lib/ai/context-stack";
import { aiCredentials } from "./ai-credentials.svelte";
import { utilityPanel } from "./utility-panel.svelte";
import { MOCK_PROVIDER_ID } from "$lib/ai/types";
import type {
    AIBootstrap,
    AIChatRequestBody,
    AIConnectionCredential,
    AIEphemeralMessage,
    AIErrorPart,
    AIMessageStatus,
    AIModelReference,
    AIUsage,
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
    quickAskOpen = $state(false);
    #quickAskInvoker: HTMLElement | null = null;
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

    /** Any one healthy connection is enough to send. */
    get connectionBlocked(): boolean {
        return !this.bootstrap?.connections.some(
            (connection) => connection.connectionState === "connected",
        );
    }

    /** Why sending is blocked: the first unhealthy connection explains itself. */
    get blockingMessage(): string | undefined {
        return this.bootstrap?.connections.find(
            (connection) => connection.connectionState !== "connected",
        )?.blockingMessage;
    }

    /** Saved history is unavailable when the user has turned conversation saving off. */
    get historyEnabled(): boolean {
        return this.bootstrap?.historyEnabled ?? false;
    }

    configure(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * §6.4 — every presentation binds this same `messages` array, so two visible
     * at once renders a streaming reply twice. At most one may show the
     * transcript, and the panel is a real flex sibling at ≥1280px rather than an
     * overlay, so nothing hides the quick-ask implicitly.
     */
    get quickAskVisible(): boolean {
        return this.quickAskOpen && utilityPanel.activeView === null;
    }

    /**
     * Bootstrapping is lazy and owned by whoever is summoned first: `initialize()`
     * costs a fetch plus a /models probe against every BYOK connection, so the
     * layout must not pay it for users who never open the Coach. It no-ops once
     * initialized and while in flight, so multiple entry points calling it is safe.
     */
    openQuickAsk(invoker?: HTMLElement | null): void {
        if (!this.enabled) return;
        this.#quickAskInvoker =
            invoker ??
            (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null));
        this.quickAskOpen = true;
        void this.initialize();
    }

    closeQuickAsk(restoreFocus = true): void {
        if (!this.quickAskOpen) return;
        this.quickAskOpen = false;
        const target = this.#quickAskInvoker;
        this.#quickAskInvoker = null;
        if (restoreFocus && target) queueMicrotask(() => target.focus());
    }

    /**
     * The one chord (Ctrl/Cmd+J), resolving to whichever surface is appropriate
     * rather than to a fixed destination. It always means "talk to the Coach":
     * it toggles the quick-ask, toggles the panel off when the panel is the
     * Coach surface on screen, and displaces any other utility view — which
     * would otherwise hide the quick-ask (§6.4) and leave the chord doing
     * nothing visible.
     */
    toggleQuickAsk(invoker?: HTMLElement | null): void {
        if (this.quickAskOpen) {
            this.closeQuickAsk();
            return;
        }
        if (utilityPanel.activeView === "coach") {
            utilityPanel.close();
            return;
        }
        if (utilityPanel.activeView) utilityPanel.close(false);
        this.openQuickAsk(invoker);
    }

    /**
     * Escalation. There is nothing to migrate: same store, same `conversationId`,
     * same `messages`, and `draft` is store state so a half-typed question
     * survives too. Returns false when no panel is registered, in which case the
     * quick-ask stays put rather than dismissing into nothing.
     */
    escalateToPanel(): boolean {
        const opened = utilityPanel.open("coach", this.#quickAskInvoker);
        if (opened) {
            this.quickAskOpen = false;
            this.#quickAskInvoker = null;
        }
        return opened;
    }

    /**
     * Reaching an older thread would otherwise cost three gestures (summon,
     * escalate, open history), because history lives inside the panel.
     */
    async escalateToHistory(): Promise<void> {
        if (!this.escalateToPanel()) return;
        await this.openConversationList();
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

    /**
     * The user's own connections, probed here in the browser. Their keys never reach our
     * server, so their catalog cannot come from bootstrap — it is built client-side and
     * merged with whatever connections the server owns.
     */
    async #clientCatalog(): Promise<AIModelCatalog> {
        const credentials = aiCredentials.wireConnections;
        if (credentials.length === 0) return { providers: [], models: [] };
        return catalogFor(clientProviderRegistry(credentials));
    }

    async initialize(force = false): Promise<void> {
        if (!this.enabled || (this.initialized && !force) || this.loading) return;
        this.loading = true;
        this.error = null;
        try {
            const [serverResponse, clientCatalog] = await Promise.all([
                fetch("/api/ai/bootstrap", { headers: { accept: "application/json" } }),
                this.#clientCatalog(),
            ]);
            if (!serverResponse.ok) throw await this.responseError(serverResponse);
            const server = parseBootstrap(await serverResponse.json());
            // The dev mock exists so the Coach works with zero configuration, and it
            // advertises tool support no real model has. Left in the catalog alongside a
            // real connection, `auto` routing would always prefer it — so it stands down
            // as soon as the user has a connection of their own.
            const standDownMock = clientCatalog.providers.length > 0;
            const serverConnections = standDownMock
                ? server.connections.filter((connection) => connection.id !== MOCK_PROVIDER_ID)
                : server.connections;
            const serverModels = standDownMock
                ? server.models.filter((model) => model.providerId !== MOCK_PROVIDER_ID)
                : server.models;
            this.bootstrap = {
                ...server,
                connections: [...serverConnections, ...clientCatalog.providers],
                models: [...serverModels, ...clientCatalog.models],
            };
            this.selectedModel = server.defaultModel;
            if (server.conversation) {
                this.conversationId = server.conversation.id;
                this.messages = server.conversation.messages;
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
                    this.blockingMessage ??
                    "No AI connection is configured. Add one in Settings to get started.",
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

        try {
            // A connection the user owns is served straight from this browser; anything
            // the server owns still goes through /api/ai/chat.
            const credential = this.#credentialForSelection();
            if (credential) {
                await this.#sendDirect(message, credential, controller, generation);
            } else {
                const body: AIChatRequestBody = {
                    conversationId: this.conversationId,
                    model: this.selectedModel,
                    message,
                    contexts: this.activeContexts,
                    task: "general",
                    ephemeralHistory,
                };
                const response = await fetch("/api/ai/chat", {
                    method: "POST",
                    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                if (!response.ok || !response.body) throw await this.responseError(response);
                await this.consume(response.body, generation);
            }
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

    /** The user's connection backing the selected model, or undefined if the server owns it. */
    #credentialForSelection(): AIConnectionCredential | undefined {
        const credentials = aiCredentials.wireConnections;
        if (credentials.length === 0) return undefined;
        const providerId =
            this.selectedModel === "auto"
                ? resolveModel("auto", "general", this.models).providerId
                : this.selectedModel.slice(0, this.selectedModel.indexOf(":"));
        return credentials.find((credential) => credential.id === providerId);
    }

    /**
     * Streams from the user's provider without touching our server. `applyEvent` is the
     * same handler the proxied path feeds, so the transcript behaves identically either
     * way; only the transport differs.
     */
    async #sendDirect(
        message: string,
        credential: AIConnectionCredential,
        controller: AbortController,
        generation: number,
    ): Promise<void> {
        const model = resolveModel(this.selectedModel, "general", this.models);
        const adapter = clientProviderById(credential.id, [credential]);
        if (!adapter) throw new Error("The selected AI connection is unavailable");

        // History comes from the transcript already in memory: the server has no copy for
        // BYOK turns, and re-fetching one would reintroduce the round trip we removed.
        const history = boundCoachHistory(this.messages.slice(0, -1));

        const stream = await adapter.stream({
            requestId: crypto.randomUUID(),
            conversationId: this.conversationId,
            model: model.reference,
            task: "general",
            message,
            contexts: this.activeContexts,
            history,
            signal: controller.signal,
        });

        let assistantText = "";
        let status: AIMessageStatus = "streaming";
        let usage: AIUsage | undefined;
        let streamError: { code: string; message: string; retryable: boolean } | undefined;

        // Read through a reader rather than `for await`: Safari does not implement
        // Symbol.asyncIterator on ReadableStream, so iterating one throws outright.
        const reader = stream.getReader();
        try {
            for (;;) {
                const { done, value: event } = await reader.read();
                if (done) break;
                if (generation !== this.#generation) {
                    await reader.cancel();
                    return;
                }
                if (event.type === "message.delta") assistantText += event.delta;
                else if (event.type === "usage") usage = event.usage;
                else if (event.type === "error") {
                    streamError = { code: event.code, message: event.message, retryable: event.retryable };
                } else if (event.type === "message.done") status = event.status;
                this.applyEvent(event, generation, false);
            }
        } catch (error) {
            // The turn still happened: record what streamed before persisting upward.
            if (error instanceof DOMException && error.name === "AbortError") {
                await this.#persistTurn(message, {
                    text: assistantText,
                    model: model.reference,
                    providerId: credential.id,
                    status: "cancelled",
                    usage,
                });
            }
            throw error;
        } finally {
            reader.releaseLock();
        }

        await this.#persistTurn(message, {
            text: assistantText,
            model: model.reference,
            providerId: credential.id,
            status: status === "streaming" ? "cancelled" : status,
            usage,
            error: streamError,
        });
    }

    /**
     * Saves a finished BYOK turn. Deliberately after streaming rather than during it:
     * the answer is already on screen, so a slow or failed write costs the user nothing.
     * Writes go through the server because ai_messages is service-role-only, which is
     * what keeps role, model, and status unspoofable.
     */
    async #persistTurn(
        message: string,
        assistant: {
            text: string;
            model: string;
            providerId: string;
            status: Exclude<AIMessageStatus, "streaming">;
            usage?: AIUsage;
            error?: { code: string; message: string; retryable: boolean };
        },
    ): Promise<void> {
        if (!this.historyEnabled) return;
        try {
            const response = await fetch("/api/ai/messages", {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({
                    conversationId: this.conversationId,
                    contexts: this.activeContexts,
                    message,
                    assistant,
                }),
            });
            if (!response.ok) return;
            const payload = await response.json();
            if (typeof payload?.conversationId === "string") {
                this.conversationId = payload.conversationId;
            }
        } catch {
            // History is best-effort; a failed write must never surface as a failed answer.
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

    /**
     * @param adoptConversationId Only the server mints conversation rows. A proxied reply
     * carries the real id; a BYOK reply carries one the adapter invented locally, and the
     * persisted id arrives later from /api/ai/messages — adopting the invented one would
     * make the next send reference a row that does not exist.
     */
    private applyEvent(
        event: NormalizedAIEvent,
        generation: number,
        adoptConversationId = true,
    ): void {
        if (generation !== this.#generation) return;
        if (event.type === "message.start") {
            // History-disabled replies carry a throwaway id that was never persisted;
            // adopting it would make the next send reference a non-existent row.
            if (this.historyEnabled && adoptConversationId) this.conversationId = event.conversationId;
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
