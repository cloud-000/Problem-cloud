import { describe, expect, test } from "bun:test";
import {
    AISchemaError,
    EPHEMERAL_HISTORY_MAX_MESSAGES,
    EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS,
    EPHEMERAL_HISTORY_MAX_TOTAL_CHARS,
    MAX_CONNECTIONS,
    parseAgentPermissions,
    parseAIEvent,
    parseBootstrap,
    parseChatRequest,
    parseContextLayer,
    parseCredentialEnvelope,
    parseConversationDetail,
    parseConversationFlushRequest,
    parseConversationList,
    FLUSH_MAX_MESSAGES,
    FLUSH_MAX_TOTAL_CHARS,
    parseEphemeralHistory,
    parseModelReference,
    parseThreadIdentity,
    parseToolDefinition,
    parseWorkThreadResponse,
} from "./schemas";

describe("AI runtime schemas", () => {
    test("accepts a minimal provider-neutral chat request", () => {
        expect(
            parseChatRequest({ model: "auto", message: "Hello", task: "general" }),
        ).toEqual({
            model: "auto",
            message: "Hello",
            task: "general",
            contextSnapshot: [],
            policy: "assist",
            // Recording a turn is the default; only a one-shot opts out (§1).
            persist: true,
        });
    });

    test("a one-shot turn asks not to be recorded", () => {
        expect(parseChatRequest({ model: "auto", message: "Hello", persist: false }).persist).toBe(
            false,
        );
        expect(() =>
            parseChatRequest({ model: "auto", message: "Hello", persist: "no" }),
        ).toThrow(AISchemaError);
    });

    test("rejects provider-shaped and oversized request data", () => {
        expect(() => parseChatRequest({ model: "not a ref", message: "Hello" })).toThrow(
            AISchemaError,
        );
        expect(() => parseChatRequest({ model: "auto", message: "x".repeat(8_001) })).toThrow(
            AISchemaError,
        );
        expect(() => parseChatRequest({ model: "auto", message: "   " })).toThrow(AISchemaError);
    });

    test("accepts vendor-namespaced model references", () => {
        for (const reference of [
            "openai:gpt-4o",
            "openrouter:openai/gpt-4o",
            "together:meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "custom-lab:ns/model:v2",
        ]) {
            expect(parseModelReference(reference)).toBe(reference);
        }
        expect(parseModelReference("auto")).toBe("auto");
    });

    test("rejects malformed model references", () => {
        for (const reference of ["gpt-4o", "openai:", ":gpt-4o", "open ai:gpt-4o"]) {
            expect(() => parseModelReference(reference)).toThrow(AISchemaError);
        }
    });

    test("accepts a well-formed connection envelope", () => {
        const connections = parseCredentialEnvelope([
            {
                id: "openai",
                preset: "openai",
                label: "My OpenAI",
                baseURL: "https://api.openai.com/v1",
                apiKey: "sk-secret",
            },
        ]);
        expect(connections).toHaveLength(1);
        expect(connections[0]?.baseURL).toBe("https://api.openai.com/v1");
        expect(parseCredentialEnvelope(undefined)).toEqual([]);
    });

    test("allows a keyless custom endpoint but requires keys for presets", () => {
        const base = {
            id: "local",
            preset: "custom",
            label: "Local",
            baseURL: "https://llm.example.com/v1",
        };
        expect(parseCredentialEnvelope([base])[0]?.apiKey).toBe("");
        expect(() =>
            parseCredentialEnvelope([{ ...base, id: "openai", preset: "openai" }]),
        ).toThrow(AISchemaError);
    });

    test("allows local endpoints, which the user's own browser reaches", () => {
        // The browser makes these requests, not the server, so a loopback URL is a
        // supported setup (local Ollama/vLLM) rather than an SSRF risk.
        for (const baseURL of [
            "http://localhost:11434/v1",
            "http://127.0.0.1:8000/v1",
            "https://192.168.1.10/v1",
        ]) {
            expect(
                parseCredentialEnvelope([
                    { id: "local", preset: "custom", label: "Local", baseURL },
                ]),
            ).toHaveLength(1);
        }
    });

    test("rejects unsafe or malformed connections", () => {
        const valid = {
            id: "openai",
            preset: "openai",
            label: "My OpenAI",
            baseURL: "https://api.openai.com/v1",
            apiKey: "sk-secret",
        };
        // "mock" is reserved for the built-in mock adapter.
        expect(() => parseCredentialEnvelope([{ ...valid, id: "mock" }])).toThrow(AISchemaError);
        expect(() => parseCredentialEnvelope([{ ...valid, id: "Not Valid" }])).toThrow(
            AISchemaError,
        );
        for (const baseURL of ["not a url", "ftp://example.com/v1", "file:///etc/passwd"]) {
            expect(() => parseCredentialEnvelope([{ ...valid, baseURL }])).toThrow(AISchemaError);
        }
        // Duplicate ids would collide in the provider registry.
        expect(() => parseCredentialEnvelope([valid, valid])).toThrow(AISchemaError);
        expect(() =>
            parseCredentialEnvelope(
                Array.from({ length: MAX_CONNECTIONS + 1 }, (_, index) => ({
                    ...valid,
                    id: `openai-${index}`,
                })),
            ),
        ).toThrow(AISchemaError);
    });

    test("validates owner-scoped context layers", () => {
        const layer = parseContextLayer({
            ownerId: "route:home",
            source: "route",
            priority: 10,
            policy: "assist",
            descriptors: [
                { id: "route:/", label: "Home", ref: { kind: "selection", text: "Home" } },
            ],
            quickActions: [],
        });
        expect(layer.ownerId).toBe("route:home");
    });

    test("validates per-turn fact snapshots without accepting rendered prose", () => {
        const parsed = parseChatRequest({
            model: "auto",
            message: "Check this",
            policy: "coaching",
            contextSnapshot: [
                { kind: "problem", id: 42 },
                {
                    kind: "attempt",
                    problemId: 42,
                    answer: "B",
                    triesUsed: 1,
                    submitted: false,
                    revealed: false,
                    elapsedMs: 5000,
                },
            ],
        });
        expect(parsed.contextSnapshot).toHaveLength(2);
        expect(parsed.policy).toBe("coaching");
        const stripped = parseChatRequest({
                model: "auto",
                message: "Nope",
                contextSnapshot: [{ kind: "problem", id: 42, rendered: "trust me" }],
            });
        expect(stripped.contextSnapshot[0]).toEqual({ kind: "problem", id: 42 });
        expect(parsed.contextSnapshot[0]).toEqual({ kind: "problem", id: 42 });
    });

    test("validates normalized stream events", () => {
        expect(
            parseAIEvent({ type: "message.delta", messageId: "message-1", delta: "Hi" }),
        ).toEqual({ type: "message.delta", messageId: "message-1", delta: "Hi" });
        expect(() => parseAIEvent({ type: "provider.raw", payload: {} })).toThrow(AISchemaError);
    });

    test("validates provider catalog, tool, and permission boundaries", () => {
        const capabilities = {
            chat: true,
            streaming: true,
            tools: false,
            vision: false,
            structuredOutput: true,
        };
        expect(
            parseBootstrap({
                enabled: true,
                connections: [
                    {
                        id: "preview",
                        label: "Preview",
                        authMethods: ["hosted"],
                        capabilities,
                        connectionState: "connected",
                    },
                ],
                models: [
                    {
                        reference: "preview:model",
                        providerId: "preview",
                        id: "model",
                        label: "Model",
                        capabilities,
                        tags: [],
                        available: true,
                    },
                ],
                defaultModel: "auto",
                historyEnabled: true,
            }).models[0]?.reference,
        ).toBe("preview:model");
        expect(
            parseToolDefinition({
                name: "progress.read",
                version: 1,
                consequence: "read",
                requiredPermission: "progress",
                confirmation: "automatic",
            }).consequence,
        ).toBe("read");
        expect(
            parseAgentPermissions({
                read: "allow",
                navigate: "allow",
                write: "confirm",
                destructive: "always_confirm",
            }).destructive,
        ).toBe("always_confirm");
    });
});

describe("ephemeral history validation", () => {
    const turn = (role: string, text: string) => ({ role, text });

    test("accepts bounded text-only user and assistant turns", () => {
        expect(
            parseEphemeralHistory([turn("user", "Hi"), turn("assistant", " There ")]),
        ).toEqual([
            { role: "user", text: "Hi" },
            { role: "assistant", text: "There" },
        ]);
    });

    test("treats absent history as empty", () => {
        expect(parseEphemeralHistory(undefined)).toEqual([]);
        expect(parseEphemeralHistory(null)).toEqual([]);
    });

    test("rejects non-arrays, bad roles, blank text, and non-text content", () => {
        expect(() => parseEphemeralHistory("nope")).toThrow(AISchemaError);
        expect(() => parseEphemeralHistory([turn("system", "hi")])).toThrow(AISchemaError);
        expect(() => parseEphemeralHistory([turn("tool", "hi")])).toThrow(AISchemaError);
        expect(() => parseEphemeralHistory([turn("user", "   ")])).toThrow(AISchemaError);
        expect(() => parseEphemeralHistory([{ role: "user", parts: [{ type: "text" }] }])).toThrow(
            AISchemaError,
        );
    });

    test("rejects too many messages", () => {
        const history = Array.from({ length: EPHEMERAL_HISTORY_MAX_MESSAGES }, () => turn("user", "hi"));
        expect(parseEphemeralHistory(history)).toHaveLength(EPHEMERAL_HISTORY_MAX_MESSAGES);
        expect(() => parseEphemeralHistory([...history, turn("user", "one too many")])).toThrow(
            AISchemaError,
        );
    });

    test("rejects an oversized single message", () => {
        const text = "x".repeat(EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS + 1);
        expect(() => parseEphemeralHistory([turn("user", text)])).toThrow(AISchemaError);
    });

    test("rejects history over the total character budget", () => {
        const chunk = "x".repeat(EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS);
        const count = Math.ceil(EPHEMERAL_HISTORY_MAX_TOTAL_CHARS / EPHEMERAL_HISTORY_MAX_MESSAGE_CHARS) + 1;
        const history = Array.from({ length: count }, () => turn("user", chunk));
        expect(() => parseEphemeralHistory(history)).toThrow(AISchemaError);
    });

    test("carries validated history through a chat request", () => {
        const body = parseChatRequest({
            model: "auto",
            message: "Continue",
            ephemeralHistory: [turn("user", "Earlier")],
        });
        expect(body.ephemeralHistory).toEqual([{ role: "user", text: "Earlier" }]);
        expect(() =>
            parseChatRequest({ model: "auto", message: "Continue", ephemeralHistory: [turn("system", "x")] }),
        ).toThrow(AISchemaError);
    });
});

describe("conversation list and detail responses", () => {
    test("parses a list page with a cursor", () => {
        const payload = parseConversationList({
            conversations: [
                {
                    id: "conversation-1",
                    title: "Factoring",
                    preview: "Try a difference of squares",
                    messageCount: 4,
                    createdAt: "2026-07-16T10:00:00Z",
                    updatedAt: "2026-07-16T11:00:00Z",
                },
            ],
            nextCursor: "abc",
        });
        expect(payload.conversations).toHaveLength(1);
        expect(payload.nextCursor).toBe("abc");
    });

    test("tolerates an empty preview and a missing cursor", () => {
        const payload = parseConversationList({
            conversations: [
                {
                    id: "conversation-1",
                    title: "New conversation",
                    preview: "",
                    messageCount: 0,
                    createdAt: "2026-07-16T10:00:00Z",
                    updatedAt: "2026-07-16T10:00:00Z",
                },
            ],
        });
        expect(payload.conversations[0].preview).toBe("");
        expect(payload.nextCursor).toBeUndefined();
    });

    test("parses detail messages and rejects a malformed shape", () => {
        const payload = parseConversationDetail({
            conversation: {
                id: "conversation-1",
                title: "Factoring",
                createdAt: "2026-07-16T10:00:00Z",
                updatedAt: "2026-07-16T11:00:00Z",
                messages: [
                    {
                        id: "message-1",
                        role: "user",
                        parts: [{ type: "text", text: "Hello" }],
                        status: "complete",
                        createdAt: "2026-07-16T10:00:00Z",
                    },
                ],
            },
        });
        expect(payload.conversation.messages[0].parts[0]).toEqual({ type: "text", text: "Hello" });
        expect(() => parseConversationDetail({ conversation: { id: "x" } })).toThrow(AISchemaError);
    });
});

describe("one-shot flush requests", () => {
    const uuid = (last: string) => `0197b1c0-0000-4000-8000-00000000000${last}`;
    const flushed = (overrides: Record<string, unknown> = {}) => ({
        id: uuid("1"),
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        status: "complete",
        createdAt: "2026-08-05T10:00:00.000Z",
        ...overrides,
    });

    test("accepts a transcript the browser already holds", () => {
        const body = parseConversationFlushRequest({
            conversationId: uuid("0"),
            messages: [flushed(), flushed({ id: uuid("2"), role: "assistant" })],
        });
        expect(body.conversationId).toBe(uuid("0"));
        expect(body.messages).toHaveLength(2);
    });

    test("an empty body still creates a conversation", () => {
        expect(parseConversationFlushRequest({})).toEqual({
            conversationId: undefined,
            messages: [],
        });
    });

    test("rejects what the database could only reject as a 503", () => {
        // Ids land in a uuid primary key and createdAt in a timestamptz sort key.
        expect(() =>
            parseConversationFlushRequest({ messages: [flushed({ id: "message-1" })] }),
        ).toThrow(AISchemaError);
        expect(() =>
            parseConversationFlushRequest({ messages: [flushed({ createdAt: "whenever" })] }),
        ).toThrow(AISchemaError);
        expect(() =>
            parseConversationFlushRequest({ messages: [flushed({ role: "system" })] }),
        ).toThrow(AISchemaError);
    });

    test("an unfinished turn cannot be flushed", () => {
        // Promotion waits for the stream, so a streaming message here is a client bug —
        // and storing one would leave a permanently half-written answer in history.
        expect(() =>
            parseConversationFlushRequest({ messages: [flushed({ status: "streaming" })] }),
        ).toThrow(AISchemaError);
    });

    test("bounds a transcript by turns and by characters", () => {
        const many = Array.from({ length: FLUSH_MAX_MESSAGES + 1 }, (_, index) =>
            flushed({ id: uuid(String(index % 10)) }),
        );
        expect(() => parseConversationFlushRequest({ messages: many })).toThrow(AISchemaError);

        const huge = Array.from({ length: 3 }, (_, index) =>
            flushed({
                id: uuid(String(index)),
                parts: [{ type: "text", text: "x".repeat(FLUSH_MAX_TOTAL_CHARS / 2) }],
            }),
        );
        expect(() => parseConversationFlushRequest({ messages: huge })).toThrow(AISchemaError);
    });
});


describe("thread identity", () => {
    test("an assist thread has no anchor", () => {
        expect(parseThreadIdentity({ kind: "assist" })).toEqual({ kind: "assist" });
    });

    test("a work anchor carries the problem and the sitting", () => {
        expect(
            parseThreadIdentity({
                kind: "work",
                anchor: { problemId: 42, practiceSessionId: 7 },
            }),
        ).toEqual({ kind: "work", anchor: { problemId: 42, practiceSessionId: 7 } });
    });

    test("library work has a null sitting rather than a missing one", () => {
        // Null is a single index slot (`nulls not distinct`), so it has to survive
        // the round trip as null rather than as undefined.
        expect(parseThreadIdentity({ kind: "work", anchor: { problemId: 42 } })?.anchor)
            .toEqual({ problemId: 42, practiceSessionId: null });
    });

    test("an assist thread may not smuggle an anchor into the work index", () => {
        expect(() =>
            parseThreadIdentity({ kind: "assist", anchor: { problemId: 42 } }),
        ).toThrow(AISchemaError);
    });

    test("a one-shot is not a storable kind", () => {
        expect(() => parseThreadIdentity({ kind: "one-shot" })).toThrow(AISchemaError);
    });

    test("rejects ids that would land in a bigint column wrong", () => {
        // A stringified id is the dangerous one: `practice_session_id` has no FK, so a
        // bad value would store fine and never match the anchor lookup again.
        expect(() =>
            parseThreadIdentity({ kind: "work", anchor: { problemId: "42" } }),
        ).toThrow(AISchemaError);
        expect(() =>
            parseThreadIdentity({ kind: "work", anchor: { problemId: 4.2 } }),
        ).toThrow(AISchemaError);
    });

    test("a chat request carries the thread it writes into", () => {
        const request = parseChatRequest({
            message: "hint please",
            thread: { kind: "work", anchor: { problemId: 42, practiceSessionId: 7 } },
        });
        expect(request.thread?.anchor?.problemId).toBe(42);
    });
});

describe("work thread lookups", () => {
    test("no thread for this sitting is an ordinary answer", () => {
        expect(parseWorkThreadResponse({ conversation: null }).conversation).toBeNull();
    });

    test("parses the offered thread", () => {
        const payload = parseWorkThreadResponse({
            conversation: {
                id: "conversation-1",
                title: "AMC 10A #18",
                preview: "where do I start?",
                messageCount: 4,
                lastActiveAt: "2026-08-05T10:00:00Z",
            },
        });
        expect(payload.conversation?.lastActiveAt).toBe("2026-08-05T10:00:00Z");
    });
});

describe("stored thread kind", () => {
    test("a reopened work thread comes back with its anchor", () => {
        const payload = parseConversationDetail({
            conversation: {
                id: "conversation-1",
                title: "AMC 10A #18",
                kind: "work",
                anchor: { problemId: 42, practiceSessionId: 7 },
                createdAt: "2026-08-05T10:00:00Z",
                updatedAt: "2026-08-05T11:00:00Z",
                messages: [],
            },
        });
        expect(payload.conversation.kind).toBe("work");
        expect(payload.conversation.anchor).toEqual({ problemId: 42, practiceSessionId: 7 });
    });

    test("a conversation with no kind reads as assist", () => {
        const payload = parseConversationDetail({
            conversation: {
                id: "conversation-1",
                title: "Factoring",
                createdAt: "2026-08-05T10:00:00Z",
                updatedAt: "2026-08-05T11:00:00Z",
                messages: [],
            },
        });
        expect(payload.conversation.kind).toBe("assist");
        expect(payload.conversation.anchor).toBeUndefined();
    });
});
