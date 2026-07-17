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
    parseConversationList,
    parseEphemeralHistory,
    parseModelReference,
    parseToolDefinition,
} from "./schemas";

describe("AI runtime schemas", () => {
    test("accepts a minimal provider-neutral chat request", () => {
        expect(
            parseChatRequest({ model: "auto", message: "Hello", task: "general", contexts: [] }),
        ).toEqual({ model: "auto", message: "Hello", task: "general", contexts: [] });
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
            mode: "general",
            descriptors: [{ id: "route:/", kind: "route", label: "Home" }],
            quickActions: [],
        });
        expect(layer.ownerId).toBe("route:home");
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
            contexts: [],
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
