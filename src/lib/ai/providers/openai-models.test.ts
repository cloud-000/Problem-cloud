import { describe, expect, test } from "bun:test";
import { isChatModelId } from "./openai-models";

describe("isChatModelId", () => {
    test("keeps chat models, including ones no curated table knows", () => {
        for (const id of [
            "gpt-4o",
            "o3-mini",
            "openai/gpt-5-something-unreleased",
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "deepseek-reasoner",
            "qwen2.5-coder:7b",
            "~x-ai/grok-latest",
        ]) {
            expect(isChatModelId(id)).toBe(true);
        }
    });

    test("drops families that cannot hold a conversation", () => {
        for (const id of [
            "text-embedding-3-small",
            "nomic-embed-text",
            "whisper-1",
            "openai/whisper-large-v3",
            "tts-1-hd",
            "dall-e-3",
            "omni-moderation-latest",
            "BAAI/bge-reranker-v2-m3",
            "stability/stable-diffusion-xl",
            "black-forest-labs/flux-1.1-pro",
        ]) {
            expect(isChatModelId(id)).toBe(false);
        }
    });

    test("only the last path segment decides, so a vendor name cannot disqualify a chat model", () => {
        // A false positive here silently hides a model the user is entitled to — the exact
        // failure that removing the curated allowlist was meant to end.
        expect(isChatModelId("embed-labs/chat-model-v1")).toBe(true);
        expect(isChatModelId("whisper-ai/conversational-7b")).toBe(true);
    });
});
