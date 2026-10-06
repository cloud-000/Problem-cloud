import { describe, expect, test } from "bun:test";
import { assetResponse, fetchOfflineAssetSource, offlineAssetSource } from "./assets";

describe("offline asset server fallback", () => {
    test("allows only known HTTPS problem-image origins", () => {
        expect(
            offlineAssetSource(
                "https://latex.artofproblemsolving.com/a.png#diagram",
            )?.toString(),
        ).toBe("https://latex.artofproblemsolving.com/a.png");
        expect(
            offlineAssetSource(
                "https://artofproblemsolving.com/wiki/images/d/de/Mathh.PNG",
            )?.toString(),
        ).toBe("https://artofproblemsolving.com/wiki/images/d/de/Mathh.PNG");
        expect(offlineAssetSource("http://latex.artofproblemsolving.com/a.png")).toBeNull();
        expect(offlineAssetSource("https://127.0.0.1/a.png")).toBeNull();
        expect(offlineAssetSource("https://example.com/a.png")).toBeNull();
    });

    // Every origin the corpus actually references as an image must be here, or
    // one CORS-blocked image fails the whole package it appears in.
    test("covers the image origins problem content references", () => {
        for (const host of [
            "artofproblemsolving.com",
            "latex.artofproblemsolving.com",
            "cdn.artofproblemsolving.com",
            "services.artofproblemsolving.com",
            "cdn.jsdelivr.net",
            "i.imgur.com",
            "cdn.discordapp.com",
        ]) {
            expect(offlineAssetSource(`https://${host}/a.png`)?.hostname).toBe(host);
        }
    });

    test("accepts image bytes and rejects a non-image response", async () => {
        const url = new URL("https://latex.artofproblemsolving.com/a.png");
        const image = await fetchOfflineAssetSource(
            url,
            (async () =>
                new Response(new Uint8Array([1, 2, 3]), {
                    headers: { "content-type": "image/png" },
                })) as typeof fetch,
        );
        expect(image.body.byteLength).toBe(3);
        expect(image.contentType).toBe("image/png");

        await expect(
            fetchOfflineAssetSource(
                url,
                (async () =>
                    new Response("not an image", {
                        headers: { "content-type": "text/plain" },
                    })) as typeof fetch,
            ),
        ).rejects.toThrow("asset is not an image");
    });

    test("falls back to archive for challenged artofproblemsolving.com requests", async () => {
        const url = new URL("https://artofproblemsolving.com/wiki/images/test.png");
        const mockFetcher = (async (input: RequestInfo | URL) => {
            const reqUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (reqUrl.includes("web.archive.org")) {
                return new Response(new Uint8Array([9, 8, 7]), {
                    status: 200,
                    headers: { "content-type": "image/png" },
                });
            }
            return new Response("<html>challenge</html>", {
                status: 403,
                headers: { "content-type": "text/html" },
            });
        }) as typeof fetch;

        const image = await fetchOfflineAssetSource(url, mockFetcher);
        expect(image.body.byteLength).toBe(3);
        expect(image.contentType).toBe("image/png");
    });

    test("assetResponse sets security and cache headers correctly", async () => {
        const url = new URL("https://latex.artofproblemsolving.com/a.png");
        const response = await assetResponse(
            url,
            "public, max-age=3600",
            (async () =>
                new Response(new Uint8Array([4, 5]), {
                    headers: { "content-type": "image/png" },
                })) as typeof fetch,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });
});
