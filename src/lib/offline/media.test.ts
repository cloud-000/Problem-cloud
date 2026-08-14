import { describe, expect, test } from "bun:test";
import {
    fetchRequiredAsset,
    offlineMediaUrl,
    rewriteProblemMedia,
} from "./media";
import type { OfflineProblemV1 } from "./types";

describe("revision-addressed media", () => {
    test("routes a declared image through exactly one revision", () => {
        const original = "https://cdn.example.test/diagram.png#figure";
        expect(offlineMediaUrl("revision-a", original)).toBe(
            "/_offline/media?revision=revision-a&url=https%3A%2F%2Fcdn.example.test%2Fdiagram.png",
        );
    });

    test("rewrites only declared problem media", () => {
        const problem = {
            canonicalId: 1,
            contentRevision: "content-a",
            statement: "[img]https://cdn.example.test/a.png[/img] https://other.test/b.png",
            topic: "G",
            choices: null,
            answerIndex: null,
            answerStatus: "known",
            officialSolutions: ["![diagram](https://cdn.example.test/a.png)"],
            verified: true,
            isComputational: false,
            responseKind: "mcq",
            aopsId: null,
            tags: null,
            difficulty: null,
            quality: null,
            notes: null,
            builtAt: "2026-08-13T00:00:00.000Z",
            assetKeys: ["a"],
        } satisfies OfflineProblemV1;
        const rewritten = rewriteProblemMedia(problem, "revision-a", [{
            key: "a",
            url: "https://cdn.example.test/a.png",
            kind: "problem-image",
            required: true,
        }]);
        expect(rewritten.statement).toContain("/_offline/media?revision=revision-a");
        expect(rewritten.statement).toContain("https://other.test/b.png");
        expect(problem.statement).not.toContain("/_offline/media");
    });

    test("rewrites a repo-relative markdown target using renderer resolution", () => {
        const problem = {
            canonicalId: 2,
            contentRevision: "content-a",
            statement: "![diagram](hmmt/example.png)",
            topic: "G",
            choices: null,
            answerIndex: null,
            answerStatus: "known",
            officialSolutions: null,
            verified: true,
            isComputational: false,
            responseKind: "mcq",
            aopsId: null,
            tags: null,
            difficulty: null,
            quality: null,
            notes: null,
            builtAt: "2026-08-13T00:00:00.000Z",
            assetKeys: ["a"],
        } satisfies OfflineProblemV1;
        const rewritten = rewriteProblemMedia(problem, "revision-a", [{
            key: "a",
            url: "https://cdn.jsdelivr.net/gh/cloud-000/Math-Images@main/hmmt/example.png",
            kind: "problem-image",
            required: true,
        }]);
        expect(rewritten.statement).toContain("/_offline/media?revision=revision-a");
        expect(rewritten.statement).not.toContain("hmmt/example.png)");
    });

    test("falls back to the authenticated checkout endpoint when a CDN blocks CORS", async () => {
        const calls: string[] = [];
        const response = await fetchRequiredAsset(
            {
                key: "asset-key",
                url: "https://latex.artofproblemsolving.com/example.png",
                kind: "problem-image",
                required: true,
            },
            "checkout-id",
            (async (input: RequestInfo | URL) => {
                calls.push(String(input));
                if (calls.length === 1) throw new TypeError("Load failed");
                return new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: { "content-type": "image/png" },
                });
            }) as typeof fetch,
        );

        expect(response.ok).toBe(true);
        expect(calls).toEqual([
            "https://latex.artofproblemsolving.com/example.png",
            "/api/offline/packages/checkout-id/assets/asset-key",
        ]);
    });
});
