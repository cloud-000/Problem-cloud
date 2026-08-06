import { beforeEach, describe, expect, mock, test } from "bun:test";

// Runes aren't compiled here, so `$state` is stubbed as identity (same pattern as
// shell.test.ts / whiteboard.test.ts). The Coach store uses `$state` only — the
// presentation rules under test are plain getters and methods.
const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

mock.module("$app/environment", () => ({
    browser: false,
    dev: false,
    building: false,
    version: "test",
}));

const BOOTSTRAP = {
    enabled: true,
    connections: [],
    models: [],
    defaultModel: "auto",
    historyEnabled: false,
};

/**
 * A BYOK connection the store can select. Empty by default so every test above keeps
 * taking the server-proxied path, exactly as it did before these stubs existed.
 */
let wireConnections: unknown[] = [];
mock.module("./ai-credentials.svelte", () => ({
    aiCredentials: {
        get wireConnections() {
            return wireConnections;
        },
        get connections() {
            return [];
        },
        get hasAny() {
            return wireConnections.length > 0;
        },
    },
}));

/** Emits `message.start`, waits on the gate, then closes — so a test can interleave. */
let streamGate: PromiseWithResolvers<void> | null = null;
mock.module("$lib/ai/providers/client-registry", () => ({
    clientProviderRegistry: () => [],
    clientProviderById: () => ({
        id: "byok",
        label: "BYOK",
        authMethods: ["api_key"],
        stream: async (request: { signal?: AbortSignal }) =>
            new ReadableStream({
                async start(controller) {
                    controller.enqueue({
                        type: "message.start",
                        messageId: "assistant-1",
                        conversationId: "provider-invented-id",
                        model: "byok:model-a",
                    });
                    controller.enqueue({ type: "message.delta", messageId: "assistant-1", delta: "hi" });
                    if (streamGate) await streamGate.promise;
                    // Mirrors OpenAICompatAdapter: a cancel surfaces as a stream error,
                    // which is the path that reaches #persistTurn with "cancelled".
                    if (request.signal?.aborted) {
                        controller.error(new DOMException("The operation was aborted", "AbortError"));
                        return;
                    }
                    controller.enqueue({
                        type: "message.done",
                        messageId: "assistant-1",
                        status: "complete",
                    });
                    controller.close();
                },
            }),
    }),
}));

interface RecordedRequest {
    url: string;
    body: Record<string, unknown>;
}

let bootstrapCalls = 0;
let recorded: RecordedRequest[] = [];
let persistStatus = 200;
/** What the anchor lookup answers with; null is "this sitting has no thread yet". */
let workThread: Record<string, unknown> | null = null;
let workThreadCalls: string[] = [];
/**
 * Arms one work-anchor 409 (§2): the next write that could create a row is told another
 * surface already owns this sitting, and which conversation won.
 */
let anchorConflictWinner: string | null = null;
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.body) {
        recorded.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    }
    if (url.includes("/api/ai/bootstrap")) {
        bootstrapCalls += 1;
        return json(BOOTSTRAP);
    }
    if (url.includes("/api/ai/work-thread")) {
        workThreadCalls.push(url);
        return json({ conversation: workThread });
    }
    if (
        anchorConflictWinner &&
        (url.includes("/api/ai/messages") ||
            url.endsWith("/api/ai/conversations") ||
            url.includes("/api/ai/chat"))
    ) {
        const winner = anchorConflictWinner;
        anchorConflictWinner = null;
        return json(
            {
                conversationId: winner,
                error: { code: "work_anchor_conflict", message: "already owned" },
            },
            409,
        );
    }
    if (url.includes("/api/ai/messages")) {
        return new Response(JSON.stringify({ conversationId: "server-invented-id" }), {
            status: persistStatus,
            headers: { "content-type": "application/json" },
        });
    }
    // A conversation detail read: /api/ai/conversations/<id>
    const detail = /\/api\/ai\/conversations\/([^?]+)$/.exec(url);
    if (detail && (!init?.method || init.method === "GET")) {
        return json({
            conversation: {
                id: detail[1],
                title: "Earlier chat",
                kind: "work",
                anchor: { problemId: 42, practiceSessionId: 7 },
                createdAt: "2026-08-05T00:00:00.000Z",
                updatedAt: "2026-08-05T00:00:00.000Z",
                messages: [
                    {
                        id: "11111111-1111-4111-8111-111111111111",
                        role: "user",
                        parts: [{ type: "text", text: "where do I start?" }],
                        status: "complete",
                        createdAt: "2026-08-05T00:00:00.000Z",
                    },
                ],
            },
        });
    }
    return new Response("{}", { headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;

const { coach } = await import("./coach.svelte");
const { utilityPanel } = await import("./utility-panel.svelte");

// The layout registers the real one; the store only cares that a "coach" view exists.
utilityPanel.register({
    view: "coach",
    ownerId: "test:coach",
    label: "Coach",
    content: (() => {}) as never,
});

beforeEach(() => {
    coach.configure(true);
    coach.closeQuickAsk(false);
    utilityPanel.close(false);
    coach.draft = "";
    coach.messages = [];
    coach.conversationId = undefined;
    coach.tier = "one-shot";
});

describe("coach quick-ask presentation", () => {
    test("summoning bootstraps lazily and shows the surface", () => {
        coach.openQuickAsk(null);
        expect(coach.quickAskOpen).toBe(true);
        expect(coach.quickAskVisible).toBe(true);
    });

    test("a disabled Coach cannot be summoned", () => {
        coach.configure(false);
        coach.openQuickAsk(null);
        expect(coach.quickAskOpen).toBe(false);
        coach.configure(true);
    });

    test("§6.4: the quick-ask hides whenever a utility view is open", () => {
        // Both bind the same `messages`, so two visible at once renders a
        // streaming reply twice. The panel is a flex sibling at ≥1280px, so
        // nothing hides the quick-ask implicitly — this rule has to be explicit.
        coach.openQuickAsk(null);
        utilityPanel.open("coach");
        expect(coach.quickAskOpen).toBe(true);
        expect(coach.quickAskVisible).toBe(false);
    });
});

describe("coach escalation", () => {
    test("overlay → panel preserves the conversation, transcript, and draft", () => {
        coach.conversationId = "conversation-1";
        coach.messages = [
            {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "how do I start?" }],
                status: "complete",
                createdAt: "2026-08-04T00:00:00.000Z",
            },
        ];
        coach.openQuickAsk(null);
        coach.draft = "and what about part b";

        expect(coach.escalateToPanel()).toBe(true);
        expect(utilityPanel.activeView).toBe("coach");
        expect(coach.quickAskOpen).toBe(false);
        expect(coach.conversationId).toBe("conversation-1");
        expect(coach.messages).toHaveLength(1);
        // Nothing migrates — it is one store behind three presentations.
        expect(coach.draft).toBe("and what about part b");
    });

    test("escalation with no panel registered leaves the quick-ask up", () => {
        utilityPanel.unregister("coach", "test:coach");
        coach.openQuickAsk(null);
        expect(coach.escalateToPanel()).toBe(false);
        expect(coach.quickAskOpen).toBe(true);
        utilityPanel.register({
            view: "coach",
            ownerId: "test:coach",
            label: "Coach",
            content: (() => {}) as never,
        });
    });

    test("history escalation opens the panel on the conversation list", async () => {
        coach.openQuickAsk(null);
        await coach.escalateToHistory();
        expect(utilityPanel.activeView).toBe("coach");
        expect(coach.historyViewOpen).toBe(true);
        coach.closeConversationList();
    });
});

describe("coach chord", () => {
    test("toggles the quick-ask", () => {
        coach.toggleQuickAsk(null);
        expect(coach.quickAskOpen).toBe(true);
        coach.toggleQuickAsk(null);
        expect(coach.quickAskOpen).toBe(false);
    });

    test("closes the panel instead of summoning behind it", () => {
        utilityPanel.open("coach");
        coach.toggleQuickAsk(null);
        expect(utilityPanel.activeView).toBe(null);
        expect(coach.quickAskOpen).toBe(false);
    });

    test("displaces another utility view rather than opening invisibly", () => {
        utilityPanel.register({
            view: "whiteboard",
            ownerId: "test:whiteboard",
            label: "Scratch paper",
            content: (() => {}) as never,
        });
        utilityPanel.open("whiteboard");
        coach.toggleQuickAsk(null);
        expect(utilityPanel.activeView).toBe(null);
        expect(coach.quickAskVisible).toBe(true);
        utilityPanel.unregister("whiteboard", "test:whiteboard");
    });

    test("§6.4: focuses the active inline composer instead of summoning", async () => {
        let focusCalls = 0;
        const unregister = coach.registerInlineTarget({
            isActive: () => true,
            open: () => {},
            focusComposer: () => {
                focusCalls += 1;
            },
        });

        coach.toggleQuickAsk(null);
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

        expect(coach.quickAskOpen).toBe(false);
        expect(focusCalls).toBe(1);
        unregister();
    });
});

describe("trainer inline escalation", () => {
    test("continues a quick ask in Coach mode without opening the panel", async () => {
        let opened = false;
        let focused = false;
        const unregister = coach.registerInlineTarget({
            isActive: () => opened,
            open: () => {
                opened = true;
            },
            focusComposer: () => {
                focused = true;
            },
        });
        coach.openQuickAsk(null);

        expect(coach.inlineTargetAvailable).toBe(true);
        expect(coach.continueInInline()).toBe(true);
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

        expect(opened).toBe(true);
        expect(focused).toBe(true);
        expect(coach.quickAskOpen).toBe(false);
        expect(utilityPanel.activeView).toBe(null);
        unregister();
        expect(coach.inlineTargetAvailable).toBe(false);
    });
});

describe("coach bootstrap ownership", () => {
    test("§6.5: initialize() runs once no matter how many entry points call it", async () => {
        // Every `openQuickAsk` above already called it, concurrently and
        // unawaited. Overlapping calls are held off by the in-flight guard and
        // later ones by `initialized`, so the whole file pays for one probe.
        await Promise.all([coach.initialize(), coach.initialize(), coach.initialize()]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await coach.initialize();
        expect(bootstrapCalls).toBe(1);
        expect(coach.initialized).toBe(true);
    });
});

const CONNECTED_BYOK = {
    enabled: true,
    connections: [
        {
            id: "byok",
            label: "BYOK",
            authMethods: ["api_key"] as const,
            capabilities: {
                chat: true,
                streaming: true,
                tools: false,
                vision: false,
                structuredOutput: false,
            },
            connectionState: "connected" as const,
        },
    ],
    models: [
        {
            reference: "byok:model-a" as const,
            providerId: "byok",
            id: "model-a",
            label: "Model A",
            capabilities: {
                chat: true,
                streaming: true,
                tools: false,
                vision: false,
                structuredOutput: false,
            },
            tags: [],
            available: true,
        },
    ],
    defaultModel: "auto" as const,
    historyEnabled: true,
};

const persistCalls = () => recorded.filter((entry) => entry.url.includes("/api/ai/messages"));
const flushCalls = () => recorded.filter((entry) => entry.url.endsWith("/api/ai/conversations"));
const archiveCalls = () =>
    recorded.filter(
        (entry) => entry.url.includes("/api/ai/conversations/") && entry.body.archived === true,
    );
const chatCalls = () => recorded.filter((entry) => entry.url.includes("/api/ai/chat"));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("coach conversation identity", () => {
    beforeEach(async () => {
        await coach.initialize();
        wireConnections = [
            { id: "byok", preset: "openai", label: "BYOK", baseURL: "https://x", apiKey: "k" },
        ];
        coach.bootstrap = structuredClone(CONNECTED_BYOK) as never;
        coach.newConversation();
        // These are the behaviors of a thread that has rows; a one-shot has none.
        coach.present("panel");
        recorded = [];
        persistStatus = 200;
        streamGate = null;
    });

    test("a failed save cannot split the thread", async () => {
        // The id used to arrive from this response, so a 503 left the next turn
        // creating a second conversation and silently splitting the thread.
        persistStatus = 503;

        await coach.send("first");
        const conversationId = coach.conversationId;
        expect(conversationId).toMatch(/^[0-9a-f-]{36}$/i);

        await coach.send("second");

        expect(coach.conversationId).toBe(conversationId);
        const saves = persistCalls();
        expect(saves).toHaveLength(2);
        expect(saves[0].body.conversationId).toBe(conversationId);
        expect(saves[1].body.conversationId).toBe(conversationId);
    });

    test("the id the provider echoes back is never adopted", async () => {
        await coach.send("hello");
        expect(coach.conversationId).not.toBe("provider-invented-id");
        expect(coach.conversationId).not.toBe("server-invented-id");
    });

    test("the transcript and the saved turn share message ids", async () => {
        await coach.send("hello");
        const [save] = persistCalls();
        const user = coach.messages.find((message) => message.role === "user");
        expect(save.body.userMessageId).toBe(user?.id);
        expect((save.body.assistant as Record<string, unknown>).id).toBe("assistant-1");
    });

    test("a turn abandoned mid-stream is not written to the cleared thread", async () => {
        streamGate = Promise.withResolvers<void>();
        const sending = coach.send("hello");
        await tick();

        // Starting a new conversation used to let the abandoned turn's save run with a
        // freshly-read conversationId — minting a conversation from the partial turn and
        // adopting it, clobbering the empty thread the user just asked for.
        coach.newConversation();
        streamGate.resolve();
        await sending;

        expect(persistCalls()).toHaveLength(0);
        expect(coach.conversationId).toBeUndefined();
        expect(coach.messages).toHaveLength(0);
    });
});

describe("coach tiers", () => {
    beforeEach(async () => {
        await coach.initialize();
        wireConnections = [
            { id: "byok", preset: "openai", label: "BYOK", baseURL: "https://x", apiKey: "k" },
        ];
        coach.bootstrap = structuredClone(CONNECTED_BYOK) as never;
        coach.newConversation();
        coach.tier = "one-shot";
        recorded = [];
        persistStatus = 200;
        streamGate = null;
    });

    test("§1: a quick-ask that is never escalated leaves nothing behind", () => {
        // Saving is *on*: the tier is what decides no row exists, not the preference.
        expect(coach.historyEnabled).toBe(true);
        coach.openQuickAsk(null);
        expect(coach.tier).toBe("one-shot");
        expect(coach.persisted).toBe(false);
    });

    test("a one-shot turn mints no conversation and saves nothing", async () => {
        coach.openQuickAsk(null);
        await coach.send("just a quick one");
        expect(coach.conversationId).toBeUndefined();
        expect(persistCalls()).toHaveLength(0);
        expect(flushCalls()).toHaveLength(0);
        expect(coach.messages).toHaveLength(2);
    });

    test("the proxied path is told not to record a one-shot", async () => {
        // No credential of the user's own, so this turn goes through /api/ai/chat —
        // which would otherwise mint a conversation of its own for an unidentified turn.
        wireConnections = [];
        await coach.send("just a quick one");
        expect(chatCalls()[0]?.body.persist).toBe(false);
        wireConnections = [
            { id: "byok", preset: "openai", label: "BYOK", baseURL: "https://x", apiKey: "k" },
        ];
    });

    test("escalating flushes the turns the thread already has", async () => {
        coach.openQuickAsk(null);
        await coach.send("quick question");
        expect(flushCalls()).toHaveLength(0);

        expect(coach.escalateToPanel()).toBe(true);
        expect(coach.tier).toBe("assist");
        await tick();

        const [flush] = flushCalls();
        const flushed = flush.body.messages as { role: string; status: string }[];
        expect(flush.body.conversationId).toBe(coach.conversationId);
        expect(flushed.map((message) => message.role)).toEqual(["user", "assistant"]);

        // And the thread keeps writing into the conversation the flush created.
        await coach.send("follow-up");
        expect(persistCalls()[0].body.conversationId).toBe(coach.conversationId);
    });

    test("escalating mid-stream flushes the whole answer, not half of it", async () => {
        // The in-flight turn captured no conversation id, so this flush is the only
        // thing that will ever save it — flushing early would store a half-written reply.
        streamGate = Promise.withResolvers<void>();
        const sending = coach.send("hello");
        await tick();

        coach.escalateToPanel();
        expect(coach.conversationId).toBeDefined();
        expect(flushCalls()).toHaveLength(0);

        streamGate.resolve();
        await sending;
        await tick();

        const [flush] = flushCalls();
        const flushed = flush.body.messages as { status: string }[];
        expect(flushed).toHaveLength(2);
        expect(flushed[1].status).toBe("complete");
    });

    test("continuing inline opens a work thread", () => {
        const unregister = coach.registerInlineTarget({
            isActive: () => false,
            open: () => {},
            focusComposer: () => {},
        });
        coach.openQuickAsk(null);
        expect(coach.continueInInline()).toBe(true);
        expect(coach.tier).toBe("work");
        unregister();
    });

    test("a persisted thread is never demoted back into memory", async () => {
        coach.present("panel");
        // A new chat started from the panel is another assist thread, not a one-shot.
        coach.newConversation();
        expect(coach.tier).toBe("assist");
        coach.openQuickAsk(null);
        expect(coach.tier).toBe("assist");
        // No assist → work promotion either.
        coach.present("inline");
        expect(coach.tier).toBe("assist");
    });

    test("saving turned off keeps an escalated thread in memory too", async () => {
        coach.bootstrap = { ...structuredClone(CONNECTED_BYOK), historyEnabled: false } as never;
        await coach.send("first");
        coach.escalateToPanel();
        await tick();
        await coach.send("second");

        expect(coach.tier).toBe("assist");
        expect(coach.persisted).toBe(false);
        expect(coach.conversationId).toBeUndefined();
        expect([...flushCalls(), ...persistCalls()]).toHaveLength(0);
    });

    test("§1: bootstrapping resumes nothing", async () => {
        await coach.initialize(true);
        expect(coach.conversationId).toBeUndefined();
        expect(coach.messages).toHaveLength(0);
    });
});

describe("coach work threads", () => {
    const ANCHOR = { problemId: 42, practiceSessionId: 7 };
    const OPEN = { submitted: false, skipped: false };
    const offeredThread = (idleMs: number) => ({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Earlier chat",
        preview: "where do I start?",
        messageCount: 2,
        lastActiveAt: new Date(Date.now() - idleMs).toISOString(),
    });

    beforeEach(async () => {
        await coach.initialize();
        wireConnections = [
            { id: "byok", preset: "openai", label: "BYOK", baseURL: "https://x", apiKey: "k" },
        ];
        coach.bootstrap = structuredClone(CONNECTED_BYOK) as never;
        coach.newConversation();
        coach.tier = "one-shot";
        coach.workAnchor = null;
        coach.resumePrompt = null;
        workThread = null;
        workThreadCalls = [];
        anchorConflictWinner = null;
        recorded = [];
        streamGate = null;
    });

    test("a sitting with no thread opens blank, with no prompt", async () => {
        await coach.openWorkThread(ANCHOR, OPEN);
        expect(coach.tier).toBe("work");
        expect(coach.workAnchor).toEqual(ANCHOR);
        expect(coach.resumePrompt).toBeNull();
        expect(workThreadCalls).toHaveLength(1);
    });

    test("§5: an unconcluded thread is offered back", async () => {
        workThread = offeredThread(60_000);
        await coach.openWorkThread(ANCHOR, OPEN);
        expect(coach.resumePrompt?.id).toBe(workThread.id as string);
        // Offering it is not attaching to it: nothing is adopted until the user answers.
        expect(coach.conversationId).toBeUndefined();
        expect(coach.messages).toHaveLength(0);
    });

    test("§5: a concluded thread is not offered, and releases its anchor slot", async () => {
        workThread = offeredThread(60_000);
        await coach.openWorkThread(ANCHOR, { submitted: true, skipped: false });
        expect(coach.resumePrompt).toBeNull();
        // It still held the unique-index slot, so the fresh thread could not be
        // created until it was retired.
        expect(archiveCalls()).toHaveLength(1);
    });

    test("§5: a stale thread is retired rather than offered", async () => {
        workThread = offeredThread(13 * 60 * 60 * 1000);
        await coach.openWorkThread(ANCHOR, OPEN);
        expect(coach.resumePrompt).toBeNull();
        expect(archiveCalls()).toHaveLength(1);
    });

    test("re-entering Coach mode on the same sitting rejoins without asking", async () => {
        await coach.openWorkThread(ANCHOR, OPEN);
        workThreadCalls = [];
        // This is also what keeps a thread live and writable after submitting — the
        // moment the student most wants to ask "why?".
        await coach.openWorkThread({ ...ANCHOR }, { submitted: true, skipped: false });
        expect(workThreadCalls).toHaveLength(0);
        expect(coach.resumePrompt).toBeNull();
    });

    test("continuing attaches to the offered thread and its transcript", async () => {
        workThread = offeredThread(60_000);
        await coach.openWorkThread(ANCHOR, OPEN);
        await coach.resumeWorkThread();
        expect(coach.conversationId).toBe(workThread.id as string);
        expect(coach.messages).toHaveLength(1);
        // Reopened by anchor, so it comes back as the work thread it was stored as.
        expect(coach.tier).toBe("work");
        expect(coach.workAnchor).toEqual(ANCHOR);
        expect(coach.resumePrompt).toBeNull();
    });

    test("declining archives the old thread but keeps the anchor", async () => {
        workThread = offeredThread(60_000);
        await coach.openWorkThread(ANCHOR, OPEN);
        await coach.startNewWorkThread();
        expect(archiveCalls()).toHaveLength(1);
        expect(coach.conversationId).toBeUndefined();
        expect(coach.messages).toHaveLength(0);
        // A new chat started from the trainer is another thread about the same sitting.
        expect(coach.workAnchor).toEqual(ANCHOR);
        expect(coach.tier).toBe("work");
    });

    test("a work turn tells the server which sitting it belongs to", async () => {
        await coach.openWorkThread(ANCHOR, OPEN);
        await coach.send("hint please");
        expect(persistCalls()[0].body.thread).toEqual({ kind: "work", anchor: ANCHOR });
    });

    test("an assist turn carries no anchor", async () => {
        coach.present("panel");
        await coach.send("what should I review?");
        expect(persistCalls()[0].body.thread).toEqual({ kind: "assist" });
    });

    test("§2: losing the anchor race attaches to the winner instead of forking", async () => {
        await coach.openWorkThread(ANCHOR, OPEN);
        anchorConflictWinner = "33333333-3333-4333-8333-333333333333";
        await coach.send("hint please");

        const saves = persistCalls();
        expect(saves).toHaveLength(2);
        // The retry files the same turn into the thread that actually owns the sitting.
        expect(saves[1].body.conversationId).toBe("33333333-3333-4333-8333-333333333333");
        expect(coach.conversationId).toBe("33333333-3333-4333-8333-333333333333");
    });

    test("leaving a concluded anchor retires the thread", async () => {
        await coach.openWorkThread(ANCHOR, OPEN);
        await coach.send("hint please");
        recorded = [];
        await coach.releaseWorkAnchor({ submitted: true, skipped: false });

        expect(archiveCalls()).toHaveLength(1);
        expect(coach.workAnchor).toBeNull();
        expect(coach.messages).toHaveLength(0);
        // The work presentation is over, so an unanchored quick-ask cannot write a
        // work row afterwards.
        expect(coach.tier).toBe("one-shot");
    });

    test("leaving an unconcluded anchor keeps the thread for a return visit", async () => {
        await coach.openWorkThread(ANCHOR, OPEN);
        await coach.send("hint please");
        recorded = [];
        await coach.releaseWorkAnchor({ submitted: false, skipped: false });
        expect(archiveCalls()).toHaveLength(0);
        expect(coach.workAnchor).toBeNull();
    });

    test("a skip concludes the sitting the same way a submission does", async () => {
        await coach.openWorkThread(ANCHOR, OPEN);
        await coach.send("hint please");
        recorded = [];
        await coach.releaseWorkAnchor({ submitted: false, skipped: true });
        expect(archiveCalls()).toHaveLength(1);
    });

    test("out-typing the lookup keeps the question, not the old thread", async () => {
        // The offer lapses rather than proposing to discard what they just asked.
        workThread = offeredThread(60_000);
        const opening = coach.openWorkThread(ANCHOR, OPEN);
        await coach.send("hint please");
        await opening;
        expect(coach.resumePrompt).toBeNull();
        expect(coach.messages).toHaveLength(2);
    });

    test("an offer for an anchor the student already left is not sprung on them", async () => {
        workThread = offeredThread(60_000);
        const opening = coach.openWorkThread(ANCHOR, OPEN);
        await coach.releaseWorkAnchor(OPEN);
        await opening;
        expect(coach.resumePrompt).toBeNull();
    });
});

describe("coach model preference", () => {
    beforeEach(async () => {
        await coach.initialize();
        recorded = [];
    });

    test("choosing a model persists it", () => {
        coach.selectedModel = "byok:model-a";
        const patch = recorded.find((entry) => entry.url.includes("/api/ai/preferences"));
        expect(patch?.body.defaultModel).toBe("byok:model-a");
    });

    test("re-selecting the same model writes nothing", () => {
        coach.selectedModel = "byok:model-a";
        recorded = [];
        coach.selectedModel = "byok:model-a";
        expect(recorded).toHaveLength(0);
    });
});
