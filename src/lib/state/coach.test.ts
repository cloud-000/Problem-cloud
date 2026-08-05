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
globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.body) {
        recorded.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    }
    if (url.includes("/api/ai/bootstrap")) {
        bootstrapCalls += 1;
        return new Response(JSON.stringify(BOOTSTRAP), {
            headers: { "content-type": "application/json" },
        });
    }
    if (url.includes("/api/ai/messages")) {
        return new Response(JSON.stringify({ conversationId: "server-invented-id" }), {
            status: persistStatus,
            headers: { "content-type": "application/json" },
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
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("coach conversation identity", () => {
    beforeEach(async () => {
        await coach.initialize();
        wireConnections = [
            { id: "byok", preset: "openai", label: "BYOK", baseURL: "https://x", apiKey: "k" },
        ];
        coach.bootstrap = structuredClone(CONNECTED_BYOK) as never;
        coach.newConversation();
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
