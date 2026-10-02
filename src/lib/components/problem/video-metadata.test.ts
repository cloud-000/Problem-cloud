import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
    clearVideoMetadataCache,
    fetchVideoMetadata,
    formatVideoSubtitle,
    formatVideoTitle,
    getOEmbedUrl,
    isYouTubeUrl,
} from "./video-metadata";

describe("video-metadata", () => {
    beforeEach(() => {
        clearVideoMetadataCache();
    });

    test("isYouTubeUrl detects valid YouTube domains and subdomains", () => {
        expect(isYouTubeUrl("https://www.youtube.com/watch?v=orrw4VydBTk")).toBe(true);
        expect(isYouTubeUrl("https://youtu.be/orrw4VydBTk?t=10")).toBe(true);
        expect(isYouTubeUrl("https://m.youtube.com/watch?v=abc")).toBe(true);
        expect(isYouTubeUrl("https://youtube-nocookie.com/embed/abc")).toBe(true);
        expect(isYouTubeUrl("https://example.com/watch?v=123")).toBe(false);
        expect(isYouTubeUrl("invalid-url")).toBe(false);
    });

    test("getOEmbedUrl formats YouTube endpoints correctly", () => {
        const url = "https://youtu.be/orrw4VydBTk";
        expect(getOEmbedUrl(url)).toBe(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        );
        expect(getOEmbedUrl("https://example.com")).toBeNull();
    });

    test("formatVideoTitle displays video title when available, fallback otherwise", () => {
        expect(
            formatVideoTitle("https://youtu.be/123", 0, 1, {
                title: "2010 AIME I Problem 1 Solution",
            }),
        ).toBe("2010 AIME I Problem 1 Solution");

        expect(formatVideoTitle("https://youtu.be/123", 0, 1, null)).toBe(
            "Video solution",
        );

        expect(formatVideoTitle("https://youtu.be/123", 0, 2, null)).toBe(
            "Video solution 1",
        );

        expect(formatVideoTitle("https://youtu.be/123", 1, 2, null)).toBe(
            "Video solution 2",
        );
    });

    test("formatVideoSubtitle formats author and provider info", () => {
        expect(
            formatVideoSubtitle("https://youtu.be/123", {
                title: "Solution",
                authorName: "Sohil Rathi",
                providerName: "YouTube",
            }),
        ).toBe("Sohil Rathi • YouTube");

        expect(
            formatVideoSubtitle("https://youtu.be/123", {
                title: "Solution",
                authorName: "Sohil Rathi",
            }),
        ).toBe("Sohil Rathi");

        expect(
            formatVideoSubtitle("https://youtu.be/123", {
                title: "Solution",
                providerName: "YouTube",
            }),
        ).toBe("YouTube");

        expect(formatVideoSubtitle("https://youtu.be/123", null)).toBe(
            "https://youtu.be/123",
        );
    });

    test("fetchVideoMetadata parses oembed JSON response correctly", async () => {
        const fakeFetch = mock(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        title: "Modular Arithmetic AMC 10",
                        author_name: "Sohil Rathi",
                        provider_name: "YouTube",
                        thumbnail_url: "https://i.ytimg.com/vi/123/hqdefault.jpg",
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                ),
            ),
        ) as unknown as typeof fetch;

        const result = await fetchVideoMetadata(
            "https://www.youtube.com/watch?v=123",
            fakeFetch,
        );

        expect(result).toEqual({
            title: "Modular Arithmetic AMC 10",
            authorName: "Sohil Rathi",
            providerName: "YouTube",
            thumbnailUrl: "https://i.ytimg.com/vi/123/hqdefault.jpg",
        });
        expect(fakeFetch).toHaveBeenCalledTimes(1);
    });

    test("fetchVideoMetadata uses in-memory cache and avoids duplicate network requests", async () => {
        const fakeFetch = mock(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        title: "Cached Video Title",
                        author_name: "Test Author",
                        provider_name: "YouTube",
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                ),
            ),
        ) as unknown as typeof fetch;

        const url = "https://youtu.be/cached123";
        const first = await fetchVideoMetadata(url, fakeFetch);
        const second = await fetchVideoMetadata(url, fakeFetch);

        expect(first).toEqual(second);
        expect(fakeFetch).toHaveBeenCalledTimes(1);
    });

    test("fetchVideoMetadata returns null for unsupported or failing URLs", async () => {
        const failingFetch = mock(() =>
            Promise.resolve(new Response("Not Found", { status: 404 })),
        ) as unknown as typeof fetch;

        const result = await fetchVideoMetadata(
            "https://www.youtube.com/watch?v=missing",
            failingFetch,
        );
        expect(result).toBeNull();

        const nonVideo = await fetchVideoMetadata("https://example.com/not-video");
        expect(nonVideo).toBeNull();
    });
});
