import {
    parseAIEvent,
    parseBootstrap,
    parseConversationDetail,
    parseConversationList,
    parseWorkThreadResponse,
} from "$lib/ai/schemas";
import {
    boundCoachHistory,
    boundEphemeralHistory,
    dedupeById,
    flushableTranscript,
    latestPreview,
    messageText,
    PREVIEW_MAX_CHARS,
} from "$lib/ai/conversations";
import {
    promoteTier,
    threadKindFor,
    tierForPresentation,
    tierPersists,
    type CoachPresentation,
    type CoachTier,
} from "$lib/ai/session/tier";
import { sameAnchor, type WorkAnchor } from "$lib/ai/session/anchor";
import {
    workConcluded,
    workRetirable,
    workResumable,
    type WorkAnchorState,
} from "$lib/ai/session/lifecycle";
import { catalogFor, type AIModelCatalog } from "$lib/ai/catalog";
import { resolveModel } from "$lib/ai/router";
import { clientProviderById, clientProviderRegistry } from "$lib/ai/providers/client-registry";
import {
    activeContextDescriptors,
    activeContextSnapshot,
    activeQuickActions,
    removeContextLayer,
    upsertContextLayer,
} from "$lib/ai/context/registry";
import { compileContextFrames, scopeKey } from "$lib/ai/context/resolve";
import { buildProviderMessages } from "$lib/ai/providers/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import { acknowledgeCoachSend } from "$lib/onboarding/acknowledge";
import { aiCredentials } from "./ai-credentials.svelte";
import { settings } from "./settings.svelte";
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
    AIThreadIdentity,
    AIUsage,
    AIRequestSnapshot,
    CoachContextLayer,
    CoachResumeOffer,
    ConversationSummary,
    NormalizedAIEvent,
    NormalizedAIMessage,
    ScopeRef,
    WorkThreadSummary,
    ContextSnapshot,
} from "$lib/ai/types";

const CONVERSATION_PAGE_SIZE = 20;

/**
 * How long a thread has been idle, for §5's staleness cutoff. An unreadable timestamp
 * counts as infinitely idle: a thread whose age cannot be established is not one to
 * offer back to the student.
 */
function idleSince(lastActiveAt: string): number {
    const parsed = Date.parse(lastActiveAt);
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : Number.POSITIVE_INFINITY;
}

interface InlineCoachTarget {
    isActive: () => boolean;
    open: () => void;
    focusComposer: () => void;
    /**
     * The tier this target's surface owns. Defaults to the trainer's `inline`; the
     * `/coach` route registers itself as `page` so continuing a quick-ask there
     * promotes to an assist thread rather than an anchorless work one.
     */
    presentation?: CoachPresentation;
}

class CoachStore {
    enabled = $state(false);
    initialized = $state(false);
    loading = $state(false);
    bootstrap = $state<AIBootstrap | null>(null);
    messages = $state<NormalizedAIMessage[]>([]);
    conversationId = $state<string | undefined>(undefined);
    /**
     * Which family the active thread belongs to (§1). A session starts as a one-shot —
     * the quick-ask is the cheapest way in — and is promoted the moment it is escalated
     * into a presentation that owns a thread. Nothing here is a user-facing toggle.
     */
    tier = $state<CoachTier>("one-shot");
    /**
     * Which sitting a work thread is about (§4): the canonical problem plus the practice
     * session it is being worked in. Null for every other tier, which is what keeps an
     * assist thread out of the work-anchor index.
     */
    workAnchor = $state<WorkAnchor | null>(null);
    /**
     * A live work thread found at the anchor the trainer just opened, waiting on
     * "continue or start new chat?". Non-null only between the lookup and the answer —
     * everything else about the Coach stays usable while it is up, because the prompt is
     * about which thread to attach to, not a modal over the surface.
     */
    resumePrompt = $state<CoachResumeOffer | null>(null);
    draft = $state("");
    #selectedModel = $state<AIModelReference>("auto");
    streaming = $state(false);
    error = $state<AIErrorPart | null>(null);
    contextLayers = $state<CoachContextLayer[]>([]);
    detachedContextIds = $state<string[]>([]);
    liveAnnouncement = $state("");
    /** Finalized model input for the most recent debug-enabled send; never persisted. */
    lastRequestSnapshot = $state.raw<AIRequestSnapshot | null>(null);
    /** Whether the inspector is showing an exact runtime capture or a reload reconstruction. */
    lastRequestSnapshotSource = $state<"captured" | "reconstructed" | null>(null);
    conversations = $state<ConversationSummary[]>([]);
    conversationsLoaded = $state(false);
    conversationsCursor = $state<string | undefined>(undefined);
    conversationListLoading = $state(false);
    conversationListError = $state<AIErrorPart | null>(null);
    loadingConversationId = $state<string | undefined>(undefined);
    historyViewOpen = $state(false);
    quickAskOpen = $state(false);
    #quickAskInvoker: HTMLElement | null = null;
    #inlineTarget: InlineCoachTarget | null = null;
    #abortController: AbortController | null = null;
    /** The bootstrap request in flight, so concurrent callers join it instead of racing it. */
    #initializing: Promise<void> | null = null;
    #lastPrompt = "";
    #contextClient: SupabaseClient<Database> | null = null;
    #reconstructingRequest: { generation: number; promise: Promise<void> } | null = null;
    /**
     * A promotion that arrived mid-stream. The flush waits for the turn to finish so it
     * writes the whole answer rather than the half of it that had arrived — the in-flight
     * turn captured no conversation id, so this flush is the only thing that will save it.
     */
    #pendingFlush = false;
    /**
     * The scope the active thread's most recent turn was sent under — what the thread is
     * currently *about*. Empty for a thread with no turns. Recorded for every tier, but
     * read for two different purposes: a one-shot ends when it changes (§1), while a
     * persisted thread only reacts to `startSubject`. Reactive because `oneShotStale` is
     * read during render.
     */
    #threadScope = $state.raw<ScopeRef[]>([]);
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

    get activeContextSnapshot(): ContextSnapshot {
        return activeContextSnapshot(this.contextLayers, new Set(this.detachedContextIds));
    }

    configureContextResolver(client: SupabaseClient<Database>): void {
        this.#contextClient = client;
    }

    get selectedModel(): AIModelReference {
        return this.#selectedModel;
    }

    /**
     * Picking a model is a preference, not a per-session choice: the picker used to
     * reset to the bootstrap default on every reload because nothing ever wrote
     * `default_model` back. Persisting is best-effort — a failed write costs the user
     * the memory of the choice, never the choice itself.
     */
    set selectedModel(reference: AIModelReference) {
        if (reference === this.#selectedModel) return;
        this.#selectedModel = reference;
        void this.#persistDefaultModel(reference);
    }

    async #persistDefaultModel(defaultModel: AIModelReference): Promise<void> {
        try {
            await fetch("/api/ai/preferences", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ defaultModel }),
            });
        } catch {
            // Remembering the picker is a convenience; never surface a failure.
        }
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

    /**
     * Whether this thread is written down at all. A one-shot never is, however the
     * user's saving preference is set: the tier decides that no row exists, and the
     * preference decides whether a thread that has one may be written to.
     */
    get persisted(): boolean {
        return this.historyEnabled && tierPersists(this.tier);
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
        if (this.#inlineTarget?.isActive()) {
            this.closeQuickAsk(false);
            queueMicrotask(() => this.#inlineTarget?.focusComposer());
            return;
        }
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
     * A route may provide an inline presentation for this one global
     * conversation. While that presentation is active, the global Coach chord
     * focuses its composer instead of rendering the same transcript again in
     * the quick-ask.
     */
    registerInlineTarget(target: InlineCoachTarget): () => void {
        this.#inlineTarget = target;
        return () => {
            if (this.#inlineTarget === target) this.#inlineTarget = null;
        };
    }

    /** Continue a quick ask in the route's inline presentation, when it has one. */
    continueInInline(): boolean {
        const target = this.#inlineTarget;
        if (!target) return false;
        this.closeQuickAsk(false);
        if (utilityPanel.activeView === "coach") utilityPanel.close(false);
        target.open();
        this.present(target.presentation ?? "inline");
        queueMicrotask(() => target.focusComposer());
        return true;
    }

    get inlineTargetAvailable(): boolean {
        return this.#inlineTarget !== null;
    }

    /**
     * Escalation. Nothing about the conversation migrates: same store, same
     * `conversationId`, same `messages`, and `draft` is store state so a half-typed
     * question survives too. What does change is the tier — the thread stops being a
     * one-shot and the turns it already has are flushed to the server. Returns false
     * when no panel is registered, in which case the quick-ask stays put rather than
     * dismissing into nothing.
     */
    escalateToPanel(): boolean {
        const opened = utilityPanel.open("coach", this.#quickAskInvoker);
        if (opened) {
            this.quickAskOpen = false;
            this.#quickAskInvoker = null;
            this.present("panel");
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

    /**
     * Loads the bootstrap once, and lets concurrent callers *await* the one in flight.
     *
     * The in-flight guard used to return immediately, which is fine for the fire-and-
     * forget callers (`void coach.initialize()`) and wrong for anyone who awaits it to
     * know the bootstrap has landed — `openWorkThread` reads `historyEnabled` off it,
     * and a null bootstrap reads as "saving is off".
     */
    async initialize(force = false): Promise<void> {
        if (!this.enabled) return;
        if (this.#initializing) {
            await this.#initializing;
            if (!force) return;
        }
        if (this.initialized && !force) return;
        this.#initializing = this.#loadBootstrap();
        try {
            await this.#initializing;
        } finally {
            this.#initializing = null;
        }
    }

    async #loadBootstrap(): Promise<void> {
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
            // Assigned to the field, not the setter: this is the stored preference
            // arriving, so echoing it straight back would be a pointless write.
            this.#selectedModel = server.defaultModel;
            // No transcript is adopted here: assist threads do not auto-resume (§1).
            // Bootstrapping used to drop the newest thread on whoever opened the Coach
            // next, so an unrelated question inherited a week-old conversation.
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

        // Decided before any of the turn's own state is set, because discarding a
        // one-shot also invalidates the request in flight — and `streaming` is about to
        // be true, which is precisely what that discard would clear back to false.
        const contextSnapshot = this.activeContextSnapshot;
        this.#bindTurnScope(contextSnapshot);

        this.#lastPrompt = message;
        this.draft = "";
        this.error = null;
        this.streaming = true;
        this.liveAnnouncement = "Coach started responding";
        acknowledgeCoachSend();

        // Built before the new prompt joins the transcript so it carries prior turns only.
        const ephemeralHistory = this.ephemeralHistory();
        const userMessageId = crypto.randomUUID();
        this.messages.push({
            id: userMessageId,
            role: "user",
            parts: [{ type: "text", text: message }],
            status: "complete",
            createdAt: new Date().toISOString(),
            contextSnapshot,
        });

        // Everything the turn will need is captured here, before the first await.
        // Persistence must never re-read `this.conversationId` after an await: a
        // conversation cleared or switched mid-stream would otherwise receive the turn.
        const generation = this.#generation;
        const conversationId = this.#ensureConversationId();
        const thread = this.#threadIdentity();
        const controller = new AbortController();
        this.#abortController = controller;

        try {
            // A connection the user owns is served straight from this browser; anything
            // the server owns still goes through /api/ai/chat.
            const credential = this.#credentialForSelection();
            if (credential) {
                await this.#sendDirect({
                    message,
                    userMessageId,
                    conversationId,
                    contextSnapshot,
                    thread,
                    credential,
                    controller,
                    generation,
                });
            } else {
                const body: AIChatRequestBody = {
                    conversationId,
                    userMessageId,
                    model: this.selectedModel,
                    message,
                    contextSnapshot,
                    thread,
                    task: "general",
                    ...(settings.debugMode && settings.showModelRequest ? { debug: true } : {}),
                    // A one-shot streams without leaving a row behind. The server would
                    // otherwise mint a conversation of its own for an unidentified turn.
                    persist: conversationId !== undefined,
                    ephemeralHistory,
                };
                const post = (payload: AIChatRequestBody) =>
                    fetch("/api/ai/chat", {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            accept: "application/x-ndjson",
                        },
                        body: JSON.stringify(payload),
                        signal: controller.signal,
                    });
                let response = await post(body);
                // Lost the race for this sitting's thread: attach to the winner and send
                // the same turn again rather than failing an answer over bookkeeping.
                const winner = response.ok
                    ? undefined
                    : await this.#adoptAnchorWinner(response, generation);
                if (winner) response = await post({ ...body, conversationId: winner });
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
            if (generation === this.#generation) {
                this.streaming = false;
                // Escalated while this turn was streaming: now that the answer is whole,
                // the promoted thread can be written down in one piece.
                if (this.#pendingFlush) {
                    this.#pendingFlush = false;
                    if (this.conversationId) {
                        void this.#flushTranscript(this.conversationId, generation);
                    }
                }
            }
            if (this.#abortController === controller) this.#abortController = null;
        }
    }

    /**
     * Binds an in-memory one-shot to the scope it was asked under, and starts a fresh one
     * when the student asks about something else (§1).
     *
     * A one-shot has no row and no surface that owns it, so nothing else ends it: the
     * quick-ask transcript used to outlive the question entirely, for the life of the
     * page. Asking about a second problem then appended to the first, and that is not
     * merely a stale answer on screen — `compileContextFrames` pins each scope epoch to
     * the turn that opened it, so the request carried *both* problems in full with the
     * earlier Q&A between them, and escalating flushed the whole lot into one saved
     * conversation.
     *
     * Sameness is the compiler's own `scopeKey`, so "a different context" means here
     * exactly what it means where the epochs are cut. Persisted tiers are left alone:
     * they have rows, a surface, and a "New chat" button.
     */
    #bindTurnScope(snapshot: ContextSnapshot): void {
        const changed = scopeKey(snapshot.scope) !== scopeKey(this.#threadScope);
        // Only a one-shot ends by itself. A persisted thread must survive ambient drift —
        // walking from the library to progress mid-conversation changes the active scope
        // and is emphatically not a new subject — so it waits for `startSubject`.
        if (!tierPersists(this.tier) && changed && this.messages.length > 0) {
            this.newConversation();
        }
        this.#threadScope = snapshot.scope;
    }

    /**
     * Whether the in-memory one-shot is about something the student has since left.
     *
     * The discard itself happens at the next send, which is the only moment the turn's
     * scope is finally settled — but a stale transcript must not be *shown* in the
     * meantime, because that is the whole bug as the student experiences it: the
     * quick-ask reopening on a different problem while still displaying the previous
     * problem's answer. Clearing only on send fixed what the model read and changed
     * nothing about what the student saw.
     *
     * A getter rather than a `$derived` so the surfaces that read it stay reactive
     * without the store owning an effect; it is read during render, by which time every
     * surface's context layer has registered — which is exactly what a check at summon
     * time cannot rely on (a surface sets its selection and opens the Coach in one
     * gesture, and the layer registers on the effect after both).
     */
    get oneShotStale(): boolean {
        if (tierPersists(this.tier) || this.messages.length === 0) return false;
        return scopeKey(this.activeContextSnapshot.scope) !== scopeKey(this.#threadScope);
    }

    /** Whether the in-memory one-shot is about this problem, and so belongs to its sitting. */
    #threadCovers(problemId: number): boolean {
        return this.#threadScope.some((ref) => ref.kind === "problem" && ref.id === problemId);
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
     * The conversation's identity, decided in the browser before the first token.
     *
     * Minting it here rather than learning it from a later response is what keeps a
     * thread whole. The BYOK path used to adopt the id returned by the best-effort
     * save, so a save that failed (offline, 503, rate limit) left the next turn
     * creating a *second* conversation and silently splitting the thread.
     *
     * A one-shot has no identity to mint: returning undefined is what keeps it out of
     * the database entirely, on both the BYOK and the proxied path.
     */
    #ensureConversationId(): string | undefined {
        if (!this.persisted) return undefined;
        this.conversationId ??= crypto.randomUUID();
        return this.conversationId;
    }

    /**
     * Announces where the Coach is now being shown. Every surface that owns a thread —
     * the panel, a route's inline presentation — calls this when it takes over, which is
     * how a tier is decided: by the presentation, never by a user-facing toggle. The
     * quick-ask does not call it, because a quick-ask that is never escalated is
     * precisely the thread that stays in memory.
     */
    present(presentation: CoachPresentation): void {
        this.#promote(tierForPresentation(presentation));
    }

    /**
     * Promotion (§1). Escalating a one-shot is the moment a thread starts existing:
     * it takes the escalated presentation's tier, mints its id, and hands over the
     * transcript it already has in a single request.
     *
     * Only a one-shot is ever promoted. A thread that already has rows keeps its tier
     * — there is no assist → work promotion, and demoting one back into memory would
     * orphan what it has already written.
     */
    #promote(target: CoachTier): boolean {
        const wasEphemeral = !tierPersists(this.tier);
        // Escalating what is in front of the student must not also escalate a one-shot
        // they have already walked away from: it would be flushed into the new thread as
        // if it belonged to it. Checked before the tier is assigned, since promoting is
        // itself what makes `oneShotStale` stop answering. A streaming one-shot is left
        // alone, as everywhere else — its answer is on screen and still arriving.
        if (wasEphemeral && !this.streaming && this.oneShotStale) this.newConversation();
        this.tier = promoteTier(this.tier, target);
        if (!wasEphemeral || !this.persisted) return false;
        // An empty thread has nothing to flush; its first send creates the row.
        if (this.messages.length === 0) return false;
        const conversationId = this.#ensureConversationId();
        if (!conversationId) return false;
        if (this.streaming) {
            this.#pendingFlush = true;
            return true;
        }
        void this.#flushTranscript(conversationId, this.#generation);
        return true;
    }

    /**
     * The trainer taking over a problem (§2, §4).
     *
     * This is the only entry point that can attach the Coach to a *sitting*, and it does
     * four things in order that cannot be reordered: adopt the anchor (so a promotion
     * flushes into the right thread), promote whatever the quick-ask was holding, leave
     * behind any thread that is not this sitting's, and only then ask the server whether
     * that sitting already has a thread.
     *
     * `state` is the trainer's view of the work itself — it is what turns a found row
     * into "continue or start new chat?" rather than an unconditional resume.
     */
    async openWorkThread(
        anchor: WorkAnchor,
        state: Pick<WorkAnchorState, "submitted" | "skipped">,
    ): Promise<void> {
        // Re-entering Coach mode on the problem already attached: the thread on screen
        // *is* this sitting's, so there is nothing to look up and nothing to offer.
        // This is also what keeps a concluded thread live and writable while the student
        // stays on the problem — the moment they most want to ask "why?".
        const rejoining = sameAnchor(this.workAnchor, anchor);
        this.workAnchor = anchor;
        this.resumePrompt = null;
        // A quick-ask is carried into this sitting only when it was asked *about* this
        // problem — the "Continue in Coach mode" seam, where the student is escalating
        // the very question they are looking at. A one-shot about anything else (another
        // problem, or no problem at all) is not this sitting's work, and promoting it did
        // two wrong things at once: it filed those turns into a brand-new thread for this
        // problem, and — because a flush reports "handled" — skipped the resume lookup
        // below entirely, which is why the trainer stopped offering back the thread the
        // student had just been in. A streaming one-shot is left alone: cutting off an
        // answer they are watching is the worse trade, exactly as it is below.
        if (
            !tierPersists(this.tier) &&
            this.messages.length > 0 &&
            !this.streaming &&
            !this.#threadCovers(anchor.problemId)
        ) {
            this.newConversation();
        }
        // Carries the quick-ask's turns into this sitting's thread, if there were any.
        // Synchronous, before any await: the tier decides what the next send writes.
        const flushed = this.#promote("work");
        if (rejoining || flushed) return;
        // Whatever else is on screen belongs to another thread — a panel assist thread,
        // or the problem the student just left — and it already has its own rows. Left
        // up, the trainer would show that transcript, file this sitting's turns into it,
        // and never offer the prompt at all, since the lookup below stands down when the
        // chat is non-empty. A one-shot is not cleared: it has no rows to go back to.
        // Nor is a streaming one — clearing aborts the turn, and cutting off an answer
        // the user is watching to make room for a prompt is the worse trade; the offer
        // simply lapses, exactly as it does when they out-type the lookup.
        if (this.conversationId && !this.streaming) this.newConversation();
        // The thread on screen is now this sitting's, and it is empty: adopting `work`
        // is a choice about what the *next* send writes, not a promotion of anything
        // already written — which is all the assist→work rule protects. §1 prescribes
        // exactly this ("starting work from an assist thread opens a *new* work thread
        // and leaves the assist thread alone"), but nothing performed the second half:
        // the new thread was still written `kind: "assist"` with no anchor, so the row
        // could never be found by the anchor it claimed to have, and a return visit had
        // nothing to offer back.
        if (this.messages.length === 0 && !this.conversationId) this.tier = "work";

        // Captured after that clear, which bumps the generation itself.
        const generation = this.#generation;
        try {
            // The lookup only means anything once the user's saving preference has
            // arrived. Entering Coach mode is usually the first thing that touches the
            // store on a freshly loaded trainer, and `historyEnabled` off a null
            // bootstrap reads as "saving is off" — which silently skipped the lookup on
            // the first open after every page load, exactly when a thread from the
            // previous sitting is most likely to be waiting.
            if (!this.initialized) await this.initialize();
            if (generation !== this.#generation || !sameAnchor(this.workAnchor, anchor)) return;
            if (!this.persisted) return;
            const existing = await this.#fetchWorkThread(anchor);
            // The trainer moved on, or another thread was selected, while this was in
            // flight: offering the old anchor's thread now would be an ambush.
            if (generation !== this.#generation || !sameAnchor(this.workAnchor, anchor)) return;
            // The student out-typed the lookup. Offering to swap in an older thread now
            // would mean discarding the question they just asked, so the offer lapses —
            // the fresh thread they started is the one they meant. It only *is* a fresh
            // thread if the old one lets go of the anchor first: left live, it keeps the
            // unique-index slot, so the turns they just typed lose the race and are
            // silently filed into it by §2's 409 adoption, under a transcript that shows
            // none of them.
            if (this.messages.length > 0 || this.streaming) {
                if (existing) await this.#retireThread(existing.id);
                return;
            }
            if (!existing) return;
            const lifecycle = {
                ...state,
                leftAnchor: false,
                idleMs: idleSince(existing.lastActiveAt),
            };
            if (workResumable(lifecycle)) {
                // A finished sitting is offered too, and says so: the chat about a problem
                // the student just got wrong is the one they most want back.
                this.resumePrompt = { ...existing, concluded: workConcluded(lifecycle) };
                return;
            }
            // Concluded or gone stale, so it is no longer offerable — and it still holds
            // this anchor's unique-index slot. Retiring it here is what lets the fresh
            // thread be created at all; §5 routes both cases through the same
            // `retired_at = now()` as an explicit "new chat". It stays in history: this
            // is the thread the student comes back for after getting the problem wrong.
            await this.#retireThread(existing.id);
        } catch {
            // The lookup is an offer, not a requirement: a failure opens a blank Coach
            // rather than blocking the student out of the Coach entirely.
        }
    }

    async #fetchWorkThread(anchor: WorkAnchor): Promise<WorkThreadSummary | null> {
        const params = new URLSearchParams({ problemId: String(anchor.problemId) });
        if (anchor.practiceSessionId !== null) {
            params.set("practiceSessionId", String(anchor.practiceSessionId));
        }
        const response = await fetch(`/api/ai/work-thread?${params}`, {
            headers: { accept: "application/json" },
        });
        if (!response.ok) throw await this.responseError(response);
        return parseWorkThreadResponse(await response.json()).conversation;
    }

    /** Continue the offered thread: attach to it and load what was already said. */
    async resumeWorkThread(): Promise<void> {
        const offered = this.resumePrompt;
        if (!offered) return;
        this.resumePrompt = null;
        await this.selectConversation(offered.id);
    }

    /**
     * Decline the offer. The old thread is retired rather than left alone, because it
     * holds the anchor's index slot — and retiring is not deleting, so it stays in
     * history exactly as it was.
     */
    async startNewWorkThread(): Promise<void> {
        const offered = this.resumePrompt;
        this.resumePrompt = null;
        this.newConversation();
        if (offered) await this.#retireThread(offered.id);
    }

    /**
     * The student has moved off the anchor (another problem, or out of the trainer).
     *
     * Concluded ≠ retired (§5): the row releases its anchor only now, once both halves
     * are true, which is what leaves a submitted thread live and writable for as long as
     * the student stays on the problem. Retiring it does not remove it from history —
     * the chat about a problem they just got wrong is one they may well come back for.
     */
    async releaseWorkAnchor(
        state: Pick<WorkAnchorState, "submitted" | "skipped">,
    ): Promise<void> {
        if (!this.workAnchor) return;
        const conversationId = this.conversationId;
        const retirable = workRetirable({ ...state, leftAnchor: true, idleMs: 0 });
        this.workAnchor = null;
        this.resumePrompt = null;
        this.newConversation();
        // The work presentation is over, so the next summons decides the tier again.
        // Leaving it at "work" would make an unanchored quick-ask write a work row.
        this.tier = utilityPanel.activeView === "coach" ? "assist" : "one-shot";
        if (retirable && conversationId && this.historyEnabled) {
            await this.#retireThread(conversationId);
        }
    }

    /**
     * Captures the active work conversation before awaiting the submission insert, then
     * links the completed row back to it. Last write wins for repeated conclusions at
     * one anchor, and a failed link never affects grading or the visible conversation.
     */
    recordWorkConclusion(submission: Promise<number | null>, problemId: number): void {
        if (this.workAnchor?.problemId !== problemId || !this.conversationId) return;
        const conversationId = this.conversationId;
        void submission.then(async (submissionId) => {
            if (submissionId == null) return;
            try {
                await fetch(`/api/ai/conversations/${conversationId}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json", accept: "application/json" },
                    body: JSON.stringify({ concludedSubmissionId: submissionId }),
                });
            } catch {
                // Reverse lookup is best-effort and must never surface as a failed grade.
            }
        });
    }

    /**
     * Which thread a request is writing into (§2). Captured before a turn's first await,
     * exactly like the conversation id: an anchor re-read afterwards could belong to a
     * problem the student has already moved on to.
     */
    #threadIdentity(): AIThreadIdentity | undefined {
        const kind = threadKindFor(this.tier);
        if (!kind) return undefined;
        return kind === "work" && this.workAnchor ? { kind, anchor: this.workAnchor } : { kind };
    }

    /**
     * Two surfaces opened the same sitting and both minted an id (§2). The server refuses
     * to fork the thread and names the row that won, so the loser attaches to it — the
     * "continue" branch of the resume prompt, reached from a lost race rather than a
     * choice. Consumes the response body, so callers must not also read it.
     */
    async #adoptAnchorWinner(response: Response, generation: number): Promise<string | undefined> {
        if (response.status !== 409) return undefined;
        const payload = await response.json().catch(() => null);
        if (payload?.error?.code !== "work_anchor_conflict") return undefined;
        const winner = payload.conversationId;
        if (typeof winner !== "string" || generation !== this.#generation) return undefined;
        this.conversationId = winner;
        return winner;
    }

    /** Releases a thread's anchor slot (§5), without touching the active chat. */
    async #retireThread(conversationId: string): Promise<void> {
        try {
            await fetch(`/api/ai/conversations/${conversationId}`, {
                method: "PATCH",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({ retired: true }),
            });
            // Deliberately not dropped from `conversations`: retiring releases the anchor
            // slot, it does not delete the thread. The server still lists it, and the
            // student who submitted and moved on can still open what they were told.
        } catch {
            // Best-effort: a thread that outlives its anchor is offered once more and
            // retired then, which is better than failing the gesture that left it.
        }
    }

    /**
     * Writes an escalated one-shot's transcript. Best-effort, exactly like `#persistTurn`:
     * the turns are already on screen, so a failed flush costs the user their history of
     * this thread and never the thread itself — the next send still writes into the same
     * conversation, because its id was minted at promotion.
     */
    async #flushTranscript(conversationId: string, generation: number): Promise<void> {
        if (generation !== this.#generation) return;
        const messages = flushableTranscript(this.messages);
        if (messages.length === 0) return;
        const thread = this.#threadIdentity();
        const flush = (id: string) =>
            fetch("/api/ai/conversations", {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({
                    conversationId: id,
                    thread,
                    messages,
                }),
            });
        try {
            const response = await flush(conversationId);
            if (response.ok) return;
            const winner = await this.#adoptAnchorWinner(response, generation);
            if (winner) await flush(winner);
        } catch {
            // History is best-effort; a failed flush must never surface to the user.
        }
    }

    /**
     * Streams from the user's provider without touching our server. `applyEvent` is the
     * same handler the proxied path feeds, so the transcript behaves identically either
     * way; only the transport differs.
     */
    async #sendDirect(turn: {
        message: string;
        userMessageId: string;
        conversationId: string | undefined;
        contextSnapshot: ContextSnapshot;
        thread: AIThreadIdentity | undefined;
        credential: AIConnectionCredential;
        controller: AbortController;
        generation: number;
    }): Promise<void> {
        const { message, credential, controller, generation } = turn;
        const model = resolveModel(this.selectedModel, "general", this.models);
        const adapter = clientProviderById(credential.id, [credential]);
        if (!adapter) throw new Error("The selected AI connection is unavailable");

        // History comes from the transcript already in memory: the server has no copy for
        // BYOK turns, and re-fetching one would reintroduce the round trip we removed.
        const rawHistory = boundCoachHistory(this.messages.slice(0, -1));
        const client = this.#contextClient;
        if (
            !client &&
            (turn.contextSnapshot.scope.length > 0 ||
                turn.contextSnapshot.attachments.length > 0 ||
                rawHistory.some(
                    (item) =>
                        item.contextSnapshot &&
                        (item.contextSnapshot.scope.length > 0 ||
                            item.contextSnapshot.attachments.length > 0),
                ))
        ) {
            throw new Error("Coach context resolver is unavailable");
        }
        // The app shell configures the browser resolver before any real send. Keeping
        // the empty-fact path independent also makes one-shots and isolated store tests
        // work without inventing a database dependency they do not use.
        const compiled = client
            ? await compileContextFrames(client, rawHistory, turn.contextSnapshot)
            : { history: rawHistory, renderedContext: "" };

        const stream = await adapter.stream({
            requestId: crypto.randomUUID(),
            conversationId: turn.conversationId,
            model: model.reference,
            task: "general",
            message,
            policy: turn.contextSnapshot.policy,
            renderedContext: compiled.renderedContext,
            history: compiled.history,
            debug: settings.debugMode && settings.showModelRequest,
            signal: controller.signal,
        });

        let assistantMessageId = "";
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
                if (event.type === "message.start") assistantMessageId = event.messageId;
                else if (event.type === "message.delta") assistantText += event.delta;
                else if (event.type === "usage") usage = event.usage;
                else if (event.type === "error") {
                    streamError = { code: event.code, message: event.message, retryable: event.retryable };
                } else if (event.type === "message.done") status = event.status;
                this.applyEvent(event, generation);
            }
        } catch (error) {
            // The turn still happened: record what streamed before persisting upward.
            if (error instanceof DOMException && error.name === "AbortError") {
                await this.#persistTurn(turn, {
                    id: assistantMessageId,
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

        await this.#persistTurn(turn, {
            id: assistantMessageId,
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
        turn: {
            message: string;
            userMessageId: string;
            conversationId: string | undefined;
            contextSnapshot: ContextSnapshot;
            thread: AIThreadIdentity | undefined;
            generation: number;
        },
        assistant: {
            id: string;
            text: string;
            model: string;
            providerId: string;
            status: Exclude<AIMessageStatus, "streaming">;
            usage?: AIUsage;
            error?: { code: string; message: string; retryable: boolean };
        },
    ): Promise<void> {
        if (!this.historyEnabled || !turn.conversationId) return;
        // The active conversation moved on while this turn was in flight — cleared by
        // `newConversation()` or replaced by `selectConversation()`. Writing now would
        // either resurrect the thread the user just left or file the turn under the
        // wrong one, so the turn is dropped exactly as its stream events were.
        if (turn.generation !== this.#generation) return;
        const save = (conversationId: string) =>
            fetch("/api/ai/messages", {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({
                    conversationId,
                    userMessageId: turn.userMessageId,
                    contextSnapshot: turn.contextSnapshot,
                    thread: turn.thread,
                    message: turn.message,
                    assistant,
                }),
            });
        try {
            const response = await save(turn.conversationId);
            if (response.ok) return;
            // Another surface owns this sitting's thread: file the turn there instead of
            // dropping it. One retry only — the winner is a real row, so a second
            // conflict is not something a third attempt would resolve.
            const winner = await this.#adoptAnchorWinner(response, turn.generation);
            if (winner) await save(winner);
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
     * Prior turns for a chat the server keeps no copy of — a one-shot, or any chat
     * while saving is off. Persisted conversations use server-loaded history instead.
     */
    private ephemeralHistory(): AIEphemeralMessage[] | undefined {
        if (this.persisted) return undefined;
        const history = boundEphemeralHistory(this.messages);
        return history.length > 0 ? history : undefined;
    }

    async retry(): Promise<void> {
        if (this.#lastPrompt) await this.send(this.#lastPrompt);
    }

    /**
     * Clears the active chat. Creation stays lazy — the first send of a persisted
     * thread inserts the row, and a one-shot never inserts one at all.
     *
     * The tier is kept, and so is the work anchor: a new chat started from the panel is
     * another assist thread, and one started from the trainer is another thread about
     * the same sitting. Only a fresh summons decides a tier, and nothing here changes
     * where the Coach is being shown.
     */
    newConversation(): void {
        this.#invalidateActiveRequest();
        this.conversationId = undefined;
        this.messages = [];
        this.lastRequestSnapshot = null;
        this.lastRequestSnapshotSource = null;
        this.error = null;
        this.detachedContextIds = [];
        this.historyViewOpen = false;
        this.resumePrompt = null;
        this.#pendingFlush = false;
        this.#threadScope = [];
    }

    /**
     * Loads the first page of history without opening the history *view* — for a
     * surface that shows the list permanently beside the transcript (the `/coach`
     * page's rail) rather than in place of it. Idempotent, like the open below.
     */
    async ensureConversations(): Promise<void> {
        if (!this.historyEnabled) return;
        // Only the first caller pays for a fetch; bootstrap stays as small as it was.
        if (this.conversationsLoaded || this.conversationListLoading) return;
        await this.fetchConversations();
    }

    async openConversationList(): Promise<void> {
        this.historyViewOpen = true;
        await this.ensureConversations();
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
            this.lastRequestSnapshot = null;
            this.lastRequestSnapshotSource = null;
            this.error = null;
            this.detachedContextIds = [];
            this.historyViewOpen = false;
            // Whatever it was opened from, a thread pulled out of history already has
            // rows: it can never be treated as a one-shot again. `kind` is what tells an
            // assist thread from a work one, so reopening a work thread re-adopts its
            // anchor rather than quietly relabelling it as assist.
            this.tier = conversation.kind;
            this.workAnchor = conversation.anchor ?? null;
            this.resumePrompt = null;
            this.#pendingFlush = false;
            await this.reconstructLatestRequest();
        } catch (error) {
            if (generation !== this.#generation) return;
            this.conversationListError = this.normalizeError(error, "conversation_not_found");
        } finally {
            if (this.loadingConversationId === id) this.loadingConversationId = undefined;
        }
    }

    /**
     * Rebuilds the latest provider request after a persisted conversation is loaded.
     *
     * Rendered prompt prose is intentionally never stored. The durable transcript and
     * each user turn's typed context snapshot are enough to run the same context and
     * provider-message compilers again. Because referenced facts may have changed since
     * the original send, the inspector labels this result as reconstructed rather than
     * presenting it as a byte-exact capture.
     */
    async reconstructLatestRequest(): Promise<void> {
        if (this.lastRequestSnapshot || this.messages.length === 0) return;
        const generation = this.#generation;
        if (this.#reconstructingRequest?.generation === generation) {
            return this.#reconstructingRequest.promise;
        }

        const reconstruct = async () => {
            const transcript = [...this.messages];
            let userIndex = -1;
            for (let index = transcript.length - 1; index >= 0; index -= 1) {
                if (transcript[index].role === "user" && messageText(transcript[index])) {
                    userIndex = index;
                    break;
                }
            }
            if (userIndex < 0) return;

            const user = transcript[userIndex];
            const prompt = messageText(user);
            const snapshot = user.contextSnapshot ?? {
                version: 2 as const,
                policy: "assist" as const,
                scope: [],
                attachments: [],
            };
            const rawHistory = boundCoachHistory(transcript.slice(0, userIndex));
            const needsResolver =
                snapshot.scope.length > 0 ||
                snapshot.attachments.length > 0 ||
                rawHistory.some(
                    (item) =>
                        item.contextSnapshot &&
                        (item.contextSnapshot.scope.length > 0 ||
                            item.contextSnapshot.attachments.length > 0),
                );
            const client = this.#contextClient;
            if (!client && needsResolver) return;

            try {
                const compiled = client
                    ? await compileContextFrames(client, rawHistory, snapshot)
                    : { history: rawHistory, renderedContext: "" };
                if (generation !== this.#generation || this.lastRequestSnapshot) return;

                const assistant = transcript
                    .slice(userIndex + 1)
                    .find((message) => message.role === "assistant");
                const requestId = `reconstructed:${user.id}`;
                this.lastRequestSnapshot = {
                    requestId,
                    model: assistant?.resolvedModel ?? this.selectedModel,
                    messages: buildProviderMessages({
                        requestId,
                        conversationId: this.conversationId,
                        model: this.selectedModel,
                        task: "general",
                        message: prompt,
                        policy: snapshot.policy,
                        renderedContext: compiled.renderedContext,
                        history: compiled.history,
                    }),
                };
                this.lastRequestSnapshotSource = "reconstructed";
            } catch {
                // Debug reconstruction is best-effort and must not make history unreadable.
            }
        };

        const pending = reconstruct();
        this.#reconstructingRequest = { generation, promise: pending };
        try {
            await pending;
        } finally {
            if (this.#reconstructingRequest?.promise === pending) {
                this.#reconstructingRequest = null;
            }
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
        if (event.type === "request.snapshot") {
            this.lastRequestSnapshot = {
                requestId: event.requestId,
                model: event.model,
                messages: event.messages,
            };
            this.lastRequestSnapshotSource = "captured";
            return;
        }
        if (event.type === "message.start") {
            // `event.conversationId` is deliberately ignored: identity is minted by
            // `#ensureConversationId()` before the request, so a value echoed back by a
            // stream is never authoritative. A history-disabled reply carries a throwaway
            // id that was never persisted, and adopting it would make the next send
            // reference a row that does not exist.
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
            // The answer starting is what ends a trace: models emit reasoning first,
            // and a trace left open would sit "thinking" under a finished answer.
            if (message.reasoning && !message.reasoning.endedAt) {
                message.reasoning.endedAt = new Date().toISOString();
            }
            const last = message.parts.at(-1);
            if (last?.type === "text") last.text += event.delta;
            else message.parts.push({ type: "text", text: event.delta });
        } else if (event.type === "reasoning.delta" && message) {
            if (message.reasoning) {
                message.reasoning.text += event.delta;
            } else {
                message.reasoning = { text: event.delta, startedAt: new Date().toISOString() };
                // Announced once, when the trace opens — not per delta.
                this.liveAnnouncement = "Coach is thinking";
            }
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
            // A turn that reasoned and then failed (or was cancelled) never reaches
            // the answer, so this is the only place its trace can be closed.
            if (message.reasoning && !message.reasoning.endedAt) {
                message.reasoning.endedAt = new Date().toISOString();
            }
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
