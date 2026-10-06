import {
    parsePersistedPanelSize,
    serializePanelSize,
} from "./components/resizable-panel/resize";

export const SIDEBAR_EXPANDED_STORAGE_KEY = "layout:sidebar-expanded";
export const SIDEBAR_WIDTH_STORAGE_KEY = "layout:sidebar-width";

export const DEFAULT_SIDEBAR_WIDTH = 240;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;

type SidebarStorage = Pick<Storage, "getItem" | "setItem">;

export function loadSidebarExpanded(
    storage: Pick<SidebarStorage, "getItem"> | null | undefined,
): boolean {
    try {
        const saved = storage?.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
        return saved === "false" ? false : true;
    } catch {
        return true;
    }
}

export function saveSidebarExpanded(
    storage: Pick<SidebarStorage, "setItem"> | null | undefined,
    expanded: boolean,
): void {
    try {
        storage?.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(expanded));
        if (typeof document !== "undefined") {
            if (expanded) {
                document.documentElement.removeAttribute("data-sidebar-expanded");
            } else {
                document.documentElement.setAttribute("data-sidebar-expanded", "false");
            }
        }
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
}

export function loadSidebarWidth(
    storage: Pick<SidebarStorage, "getItem"> | null | undefined,
    fallback = DEFAULT_SIDEBAR_WIDTH,
    constraints: { minWidth?: number; maxWidth?: number } = {
        minWidth: MIN_SIDEBAR_WIDTH,
        maxWidth: MAX_SIDEBAR_WIDTH,
    },
): number {
    try {
        const saved = storage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
        if (!saved) return fallback;
        const parsed = parsePersistedPanelSize(saved, { width: fallback }, constraints);
        return parsed.width ?? fallback;
    } catch {
        return fallback;
    }
}

export function saveSidebarWidth(
    storage: Pick<SidebarStorage, "setItem"> | null | undefined,
    width: number,
): void {
    try {
        const serialized = serializePanelSize({ width });
        if (serialized) {
            storage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, serialized);
            if (typeof document !== "undefined") {
                document.documentElement.style.setProperty(
                    "--sidebar-initial-width",
                    `${width}px`,
                );
                document.documentElement.setAttribute(
                    "data-sidebar-width",
                    String(width),
                );
            }
        }
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
}
