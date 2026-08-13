import { describe, expect, test } from "bun:test";
import { assetKeysAgree, problemAssetKeys, problemImageUrls } from "./assets";
import { assetKey } from "./checksum";
import { resolveImageSrc } from "$lib/utils/math-parser";

describe("problem image extraction", () => {
    test("finds asy, img, and markdown references across every rendered field", () => {
        const urls = problemImageUrls({
            statement:
                "Look at [asy=https://cdn.test/diagram.png]draw((0,0)--(1,1));[/asy] and ![fig](hmmt/2024/fig1.png).",
            choices: ["[img]https://cdn.test/choice.png[/img]", "plain"],
            officialSolutions: ["![sol](hmmt/2024/sol1.png)"],
        });
        expect(urls).toEqual([
            "https://cdn.test/diagram.png",
            resolveImageSrc("hmmt/2024/fig1.png"),
            "https://cdn.test/choice.png",
            resolveImageSrc("hmmt/2024/sol1.png"),
        ]);
    });

    test("resolves a repo-relative markdown target the way the renderer does", () => {
        // A private regex here would key the asset to the unresolved path, and
        // the service worker would never match the request the page makes.
        const [url] = problemImageUrls({ statement: "![](amc/2024/p3.png)" });
        expect(url).toBe(resolveImageSrc("amc/2024/p3.png"));
        expect(url.startsWith("https://")).toBe(true);
    });

    test("ignores a code-only asy block, which renders as source not an image", () => {
        expect(problemImageUrls({ statement: "[asy]unitsize(1cm);[/asy]" })).toEqual([]);
    });

    test("deduplicates one image referenced twice", () => {
        const urls = problemImageUrls({
            statement: "[img]https://cdn.test/a.png[/img]",
            officialSolutions: ["[img]https://cdn.test/a.png#again[/img]"],
        });
        expect(urls).toEqual(["https://cdn.test/a.png"]);
    });

    test("keys are the digest of the normalized URL", async () => {
        const keys = await problemAssetKeys({
            statement: "[img]https://cdn.test/a.png[/img]",
        });
        expect(keys).toEqual([await assetKey("https://cdn.test/a.png")]);
    });
});

describe("declared vs. derived assets", () => {
    const problem = {
        canonicalId: 1,
        contentRevision: "c",
        statement: "[img]https://cdn.test/a.png[/img]",
        topic: "G",
        choices: null,
        answerIndex: null,
        answerStatus: null,
        officialSolutions: null,
        verified: true,
        isComputational: true,
        responseKind: null,
        aopsId: null,
        tags: null,
        difficulty: null,
        quality: null,
        notes: null,
        builtAt: "2026-01-01T00:00:00.000Z",
        assetKeys: [] as string[],
    };

    test("agree when the server's list matches the content", async () => {
        const assetKeys = await problemAssetKeys(problem);
        expect(await assetKeysAgree({ ...problem, assetKeys })).toBe(true);
    });

    test("disagree when the declared list is short — package corruption", async () => {
        expect(await assetKeysAgree(problem)).toBe(false);
    });
});
