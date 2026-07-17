import { createContext } from "svelte";

export type AppScrollViewport = {
    getElement: () => HTMLElement | null;
};

export const [getAppScrollViewport, setAppScrollViewport] =
    createContext<AppScrollViewport>();

/** The element's content offset inside the app scroll viewport. */
export function elementScrollOffset(
    element: HTMLElement,
    viewport: HTMLElement,
    edge: "top" | "bottom" = "top",
): number {
    const elementRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const edgeOffset = edge === "bottom" ? elementRect.height : 0;
    return elementRect.top - viewportRect.top + viewport.scrollTop + edgeOffset;
}

/** Keep a virtualizer aligned when responsive content above it changes size. */
export function observeScrollOffset(
    element: HTMLElement,
    viewport: HTMLElement,
    onchange: (offset: number) => void,
    edge: "top" | "bottom" = "top",
): () => void {
    let frame = 0;
    let previousOffset = Number.NaN;
    const update = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            const offset = elementScrollOffset(element, viewport, edge);
            if (Math.abs(offset - previousOffset) < 0.5) return;
            previousOffset = offset;
            onchange(offset);
        });
    };

    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(viewport);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", update);
    update();

    return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("resize", update);
    };
}
