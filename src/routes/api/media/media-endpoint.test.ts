import { describe, expect, test } from "bun:test";
import { GET } from "./+server";

function createMockEvent(urlStr: string, mockFetcher: typeof fetch = fetch) {
    const url = new URL(urlStr);
    return {
        url,
        fetch: mockFetcher,
        params: {},
        request: new Request(urlStr),
        route: { id: "/api/media" },
        cookies: {} as any,
        locals: {} as any,
        platform: {} as any,
        setHeaders: () => {},
        getClientAddress: () => "127.0.0.1",
        isDataRequest: false,
        isSubRequest: false,
    } as any;
}

describe("GET /api/media proxy endpoint", () => {
    test("rejects missing url parameter with 400", async () => {
        const event = createMockEvent("http://localhost:5173/api/media");
        expect(GET(event)).rejects.toMatchObject({ status: 400 });
    });

    test("rejects untrusted domains with 403", async () => {
        const event = createMockEvent("http://localhost:5173/api/media?url=https://evil.com/pic.png");
        expect(GET(event)).rejects.toMatchObject({ status: 403 });
    });

    test("proxies allowlisted media and passes headers", async () => {
        const target = "https://latex.artofproblemsolving.com/test.png";
        const mockPngBuffer = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG sig
            0x00, 0x00, 0x00, 0x0d, // IHDR length
            0x49, 0x48, 0x44, 0x52, // "IHDR"
            0x00, 0x00, 0x01, 0x00, // width 256
            0x00, 0x00, 0x00, 0x80, // height 128
        ]);

        const mockFetcher = (async () => {
            return new Response(mockPngBuffer, {
                status: 200,
                headers: {
                    "content-type": "image/png",
                    "content-length": String(mockPngBuffer.length),
                },
            });
        }) as typeof fetch;

        const event = createMockEvent(
            `http://localhost:5173/api/media?url=${encodeURIComponent(target)}`,
            mockFetcher,
        );

        const response = await GET(event);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("cache-control")).toContain("max-age=86400");
        expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(response.headers.get("x-image-width")).toBe("256");
        expect(response.headers.get("x-image-height")).toBe("128");
    });
});
