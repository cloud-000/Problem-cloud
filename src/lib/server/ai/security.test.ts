import { describe, expect, test } from "bun:test";
import { assertSameOrigin } from "./security";

describe("AI endpoint security", () => {
    test("accepts exact same-origin writes", () => {
        const request = new Request("https://problemcloud.test/api/ai/chat", {
            method: "POST",
            headers: { origin: "https://problemcloud.test" },
        });
        expect(() => assertSameOrigin(request, new URL(request.url))).not.toThrow();
    });

    test("rejects missing or cross-origin writes", () => {
        const missing = new Request("https://problemcloud.test/api/ai/chat", { method: "POST" });
        const foreign = new Request("https://problemcloud.test/api/ai/chat", {
            method: "POST",
            headers: { origin: "https://attacker.test" },
        });
        expect(() => assertSameOrigin(missing, new URL(missing.url))).toThrow();
        expect(() => assertSameOrigin(foreign, new URL(foreign.url))).toThrow();
    });
});
