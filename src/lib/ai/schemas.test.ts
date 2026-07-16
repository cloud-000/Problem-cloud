import { describe, expect, test } from "bun:test";
import {
    AISchemaError,
    parseAgentPermissions,
    parseAIEvent,
    parseBootstrap,
    parseChatRequest,
    parseContextLayer,
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
                connection: {
                    id: "preview",
                    label: "Preview",
                    authMethods: ["hosted"],
                    capabilities,
                    connectionState: "connected",
                },
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
