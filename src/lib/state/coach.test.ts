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

let bootstrapCalls = 0;
globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/ai/bootstrap")) {
        bootstrapCalls += 1;
        return new Response(JSON.stringify(BOOTSTRAP), {
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
