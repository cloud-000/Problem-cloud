export const SIDEBAR_EXPANDED_STORAGE_KEY = "layout:sidebar-expanded";

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
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
}
