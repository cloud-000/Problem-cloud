/**
 * Client-side export of a rendered whiteboard surface to a standalone SVG string
 * or a PNG Blob. The app has no server-side asy compiler, so this is how a sketch
 * becomes a shareable raster — computed theme-token colors are inlined so the
 * output renders outside the app.
 */

const COLOR_PROPS = ["stroke", "fill"] as const;
const NUMERIC_PROPS = ["stroke-width", "stroke-dasharray", "stroke-opacity", "fill-opacity", "opacity"] as const;

/** Copy resolved computed styles from the live tree onto the clone. */
function inlineComputedStyles(orig: Element, clone: Element): void {
    if (orig instanceof SVGElement) {
        const cs = getComputedStyle(orig);
        for (const prop of COLOR_PROPS) {
            const v = cs.getPropertyValue(prop);
            if (v && v !== "none") clone.setAttribute(prop, v);
        }
        for (const prop of NUMERIC_PROPS) {
            const v = cs.getPropertyValue(prop);
            if (v && v !== "" && v !== "auto") clone.setAttribute(prop, v);
        }
    }
    const oc = orig.children;
    const cc = clone.children;
    for (let i = 0; i < oc.length && i < cc.length; i++) inlineComputedStyles(oc[i], cc[i]);
}

/** Serialize the surface to a self-contained SVG string with inlined colors. */
export function toSvgString(surface: SVGSVGElement): string {
    const clone = surface.cloneNode(true) as SVGSVGElement;
    inlineComputedStyles(surface, clone);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Opaque background so the raster isn't transparent-black in image viewers.
    const bg = getComputedStyle(surface).getPropertyValue("background-color");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", String(surface.clientWidth || surface.getBoundingClientRect().width));
    rect.setAttribute("height", String(surface.clientHeight || surface.getBoundingClientRect().height));
    rect.setAttribute("fill", bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff");
    clone.insertBefore(rect, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
}

/** Render the surface to a PNG Blob at `scale`x device resolution. */
export function toPngBlob(surface: SVGSVGElement, scale = 2): Promise<Blob> {
    const svg = toSvgString(surface);
    const rect = surface.getBoundingClientRect();
    const w = surface.clientWidth || rect.width;
    const h = surface.clientHeight || rect.height;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(w * scale));
                canvas.height = Math.max(1, Math.round(h * scale));
                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("no 2d context");
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(url);
                    blob ? resolve(blob) : reject(new Error("toBlob failed"));
                }, "image/png");
            } catch (err) {
                URL.revokeObjectURL(url);
                reject(err);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("svg image load failed"));
        };
        img.src = url;
    });
}

/** Trigger a browser download of `blob` under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
