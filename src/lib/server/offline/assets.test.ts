import { describe, expect, test } from "bun:test";
import { fetchOfflineAssetSource, offlineAssetSource } from "./assets";

describe("offline asset server fallback", () => {
    test("allows only known HTTPS problem-image origins", () => {
        expect(
            offlineAssetSource(
                "https://latex.artofproblemsolving.com/a.png#diagram",
            )?.toString(),
        ).toBe("https://latex.artofproblemsolving.com/a.png");
        expect(offlineAssetSource("http://latex.artofproblemsolving.com/a.png")).toBeNull();
        expect(offlineAssetSource("https://127.0.0.1/a.png")).toBeNull();
        expect(offlineAssetSource("https://example.com/a.png")).toBeNull();
    });

    // Every origin the corpus actually references as an image must be here, or
    // one CORS-blocked image fails the whole package it appears in.
    test("covers the image origins problem content references", () => {
        for (const host of [
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
});
