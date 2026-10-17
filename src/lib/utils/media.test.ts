import { describe, expect, test } from "bun:test";
import {
    ALLOWED_ASSET_HOSTS,
    extractImageDimensions,
    getKnownImageDimensions,
    toProxyMediaUrl,
} from "./media";

describe("media proxying and dimensions", () => {
    test("ALLOWED_ASSET_HOSTS covers known diagram origins", () => {
        expect(ALLOWED_ASSET_HOSTS.has("latex.artofproblemsolving.com")).toBe(true);
        expect(ALLOWED_ASSET_HOSTS.has("artofproblemsolving.com")).toBe(true);
        expect(ALLOWED_ASSET_HOSTS.has("cdn.jsdelivr.net")).toBe(true);
        expect(ALLOWED_ASSET_HOSTS.has("evil.com")).toBe(false);
    });

    test("toProxyMediaUrl rewrites allowlisted origins to /api/media", () => {
        const raw = "https://latex.artofproblemsolving.com/5/6/6/56638188764158bdffa266bc933d11b6acd2fb76.png";
        expect(toProxyMediaUrl(raw)).toBe(
            `/api/media?url=${encodeURIComponent(raw)}`,
        );
    });

    test("toProxyMediaUrl ignores relative, data, and untrusted URLs", () => {
        expect(toProxyMediaUrl("/_offline/media?url=foo")).toBe("/_offline/media?url=foo");
        expect(toProxyMediaUrl("data:image/png;base64,...")).toBe("data:image/png;base64,...");
        expect(toProxyMediaUrl("https://untrusted-host.org/pic.png")).toBe("https://untrusted-host.org/pic.png");
    });

    test("getKnownImageDimensions identifies known problem images", () => {
        const url = "https://latex.artofproblemsolving.com/5/6/6/56638188764158bdffa266bc933d11b6acd2fb76.png";
        expect(getKnownImageDimensions(url)).toEqual({ width: 504, height: 504 });

        const secondary = "https://latex.artofproblemsolving.com/f/d/9/fd9026b556ba0538a3fa5fcbceab37f93ade3d4c.png";
        expect(getKnownImageDimensions(secondary)).toEqual({ width: 477, height: 477 });
    });

    test("getKnownImageDimensions extracts dimensions from hash or query parameters", () => {
        expect(getKnownImageDimensions("https://example.com/diagram.png#300x200")).toEqual({
            width: 300,
            height: 200,
        });
        expect(getKnownImageDimensions("https://example.com/diagram.png?w=400&h=250")).toEqual({
            width: 400,
            height: 250,
        });
        expect(getKnownImageDimensions("https://example.com/diagram.png#width=150&height=100")).toEqual({
            width: 150,
            height: 100,
        });
    });

    test("extractImageDimensions parses PNG IHDR chunk", () => {
        // Construct a minimal 24-byte PNG header with width 504 and height 504
        const buffer = new ArrayBuffer(24);
        const bytes = new Uint8Array(buffer);
        // Signature
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
        // IHDR length 13
        bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
        // IHDR tag
        bytes.set([0x49, 0x48, 0x44, 0x52], 12);
        // Dimensions: 504 (0x01f8), 504 (0x01f8)
        const view = new DataView(buffer);
        view.setUint32(16, 504, false);
        view.setUint32(20, 504, false);

        expect(extractImageDimensions(buffer)).toEqual({ width: 504, height: 504 });
    });

    test("extractImageDimensions parses GIF89a header", () => {
        const buffer = new ArrayBuffer(10);
        const bytes = new Uint8Array(buffer);
        // "GIF89a"
        bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
        const view = new DataView(buffer);
        view.setUint16(6, 320, true);
        view.setUint16(8, 240, true);

        expect(extractImageDimensions(buffer)).toEqual({ width: 320, height: 240 });
    });

    test("extractImageDimensions returns null on invalid or short buffer", () => {
        expect(extractImageDimensions(new ArrayBuffer(8))).toBeNull();
        expect(extractImageDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).buffer)).toBeNull();
    });
});
