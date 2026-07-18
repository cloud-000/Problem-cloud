import { describe, expect, test } from "bun:test";
import { registerCanvasSnapshot, type WhiteboardRenderSnapshot } from "./render";
import { toPngBlob, toSvgString } from "./export";

const snapshot: WhiteboardRenderSnapshot = {
    scene: {
        elements: [
            {
                id: "path",
                kind: "path",
                path: { nodes: [[0, 0], [1, 1]], joins: ["--"], cyclic: false },
                pen: { namedColor: "red" },
            },
            {
                id: "tap",
                kind: "dot",
                at: [2, 1],
                pen: { namedColor: "blue", lineWidth: 6, opacity: 0.4 },
            },
            { id: "label", kind: "label", at: [0, 0], text: "$A&B<$" },
            { id: "ellipse", kind: "ellipse", center: [0, 0], axisX: [2, 0], axisY: [0, 1] },
        ],
    },
    viewport: { width: 320, height: 180, scale: 40, origin: [160, 90] },
    showGrid: true,
    transparent: false,
    palette: {
        background: "#fff",
        foreground: "#111",
        inverseInk: "#191c1e",
        border: "#ddd",
        primary: "#36c",
        isDark: false,
    },
};

describe("whiteboard export", () => {
    test("emits current-viewport vector SVG with a grid and escaped labels", () => {
        const surface = {} as HTMLCanvasElement;
        registerCanvasSnapshot(surface, snapshot);
        const svg = toSvgString(surface);
        expect(svg).toContain('width="320" height="180"');
        expect(svg).toContain("<g stroke=\"#ddd\"");
        expect(svg).toContain("<path");
        expect(svg).toContain('<circle cx="240" cy="50" r="21" fill="rgb(0,0,255)" opacity="0.4"/>');
        expect(svg).toContain("A&amp;B&lt;");
        expect(svg).toContain('d="M 240,90 L');
        expect(svg).not.toContain("selection");
        expect(svg).not.toContain("<image");
    });

    test("rejects PNG export when an offscreen 2D context is unavailable", async () => {
        const surface = {} as HTMLCanvasElement;
        registerCanvasSnapshot(surface, snapshot);
        const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: { createElement: () => ({ getContext: () => null }) },
        });
        try {
            await expect(toPngBlob(surface)).rejects.toThrow("no 2d context");
        } finally {
            if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
        }
    });
});
