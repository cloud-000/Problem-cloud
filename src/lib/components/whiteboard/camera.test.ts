import { describe, expect, test } from "bun:test";

const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

const { Camera } = await import("./camera.svelte");
type CameraHost = import("./camera.svelte").CameraHost;

function createHost(overrides: Partial<CameraHost> = {}): { host: CameraHost; state: { scale: number; panX: number; panY: number; baseScale?: number } } {
    const state = {
        scale: overrides.scale ?? 40,
        panX: overrides.panX ?? 0,
        panY: overrides.panY ?? 0,
        baseScale: overrides.baseScale,
    };
    const host: CameraHost = {
        get scale() {
            return state.scale;
        },
        set scale(v: number) {
            state.scale = v;
        },
        get panX() {
            return state.panX;
        },
        set panX(v: number) {
            state.panX = v;
        },
        get panY() {
            return state.panY;
        },
        set panY(v: number) {
            state.panY = v;
        },
        baseScale: state.baseScale,
        get minimumZoom() {
            return overrides.minimumZoom ?? 20;
        },
        get surface() {
            return null;
        },
    };
    return { host, state };
}

describe("Camera with default baseScale", () => {
    test("defaults to 40 px per scene unit at 100% zoom", () => {
        const { host } = createHost({ scale: 40 });
        const camera = new Camera(host);
        camera.width = 800;
        camera.height = 600;

        expect(camera.baseScale).toBe(40);
        expect(camera.zoomPercentage).toBe(100);
    });

    test("resets viewport to baseScale (40) and zero pan", () => {
        const { host, state } = createHost({ scale: 120, panX: 50, panY: -30 });
        const camera = new Camera(host);
        camera.width = 800;
        camera.height = 600;

        camera.resetViewport();
        expect(state.scale).toBe(40);
        expect(state.panX).toBe(0);
        expect(state.panY).toBe(0);
        expect(camera.zoomPercentage).toBe(100);
    });

    test("zooms to specific percentages relative to baseScale", () => {
        const { host, state } = createHost({ scale: 40 });
        const camera = new Camera(host);
        camera.width = 800;
        camera.height = 600;

        camera.zoomTo(200);
        expect(state.scale).toBe(80);
        expect(camera.zoomPercentage).toBe(200);

        camera.zoomTo(50);
        expect(state.scale).toBe(20);
        expect(camera.zoomPercentage).toBe(50);
    });
});

describe("Camera with custom baseScale for diagram normalization", () => {
    test("reports zoom percentage relative to custom baseScale", () => {
        // e.g. An image scaled down by 50% in a thumbnail has baseScale = 20
        const { host } = createHost({ scale: 20, baseScale: 20 });
        const camera = new Camera(host);
        camera.width = 400;
        camera.height = 300;

        expect(camera.baseScale).toBe(20);
        expect(camera.zoomPercentage).toBe(100);
    });

    test("resets viewport to custom baseScale", () => {
        const { host, state } = createHost({ scale: 80, panX: 100, panY: 50, baseScale: 20 });
        const camera = new Camera(host);
        camera.width = 400;
        camera.height = 300;

        camera.resetViewport();
        expect(state.scale).toBe(20);
        expect(state.panX).toBe(0);
        expect(state.panY).toBe(0);
        expect(camera.zoomPercentage).toBe(100);
    });

    test("scales zoomTo relative to custom baseScale", () => {
        const { host, state } = createHost({ scale: 20, baseScale: 20 });
        const camera = new Camera(host);
        camera.width = 400;
        camera.height = 300;

        camera.zoomTo(200);
        expect(state.scale).toBe(40); // 200% of 20 = 40
        expect(camera.zoomPercentage).toBe(200);

        camera.zoomTo(100);
        expect(state.scale).toBe(20);
        expect(camera.zoomPercentage).toBe(100);
    });

    test("maps intrinsic coordinates identically to thumbnail screen pixels", () => {
        // Lightbox canvas (natural image size 800x600, baseScale = 40)
        const lightbox = createHost({ scale: 40, baseScale: 40 });
        const lightboxCam = new Camera(lightbox.host);
        lightboxCam.width = 800;
        lightboxCam.height = 600;

        // User marks point at +200px from center (x = 600px on 800px width)
        // origin is [400, 300]
        const asyPoint: [number, number] = [
            (600 - lightboxCam.origin[0]) / lightboxCam.scale, // (600 - 400) / 40 = +5.0
            (lightboxCam.origin[1] - 300) / lightboxCam.scale, // 0
        ];
        expect(asyPoint[0]).toBe(5);
        expect(asyPoint[1]).toBe(0);

        // Thumbnail canvas (rendered at 400x300, thumbScale = 40 * (400/800) = 20)
        const thumbnail = createHost({ scale: 20, baseScale: 20 });
        const thumbCam = new Camera(thumbnail.host);
        thumbCam.width = 400;
        thumbCam.height = 300;

        // Origin of thumbnail is [200, 150]
        const projectedThumb = thumbCam.project(asyPoint);

        // On the thumbnail image, the feature is at 50% width = 200 + 0.5 * 200 = 300px
        expect(projectedThumb[0]).toBe(300);
        expect(projectedThumb[1]).toBe(150);

        // Distance from center on thumbnail is exactly 100px (half of 200px)
        expect(projectedThumb[0] - thumbCam.origin[0]).toBe(100);
    });
});
