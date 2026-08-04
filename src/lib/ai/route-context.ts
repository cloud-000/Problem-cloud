/**
 * Human labels for the app-shell's route context layer.
 *
 * The layer's descriptor used to carry the raw pathname, which is fine as a
 * string in the system prompt but reads as `/library` on the quick-ask's context
 * chips. The entry table lives with the navigation tabs that declare it (see
 * `(app)/+layout.svelte`); this is only the matching.
 */

export interface RouteLabelEntry {
    readonly href: string;
    readonly label: string;
}

/**
 * The longest declared route the pathname sits under, so `/practice/abc` still
 * reads as "Practice". Falls back to the pathname itself — an unlabelled route
 * is still better context than nothing.
 */
export function routeLabel(pathname: string, entries: readonly RouteLabelEntry[]): string {
    let best: RouteLabelEntry | undefined;
    for (const entry of entries) {
        if (entry.href === "/") {
            if (pathname === "/") best = entry;
            continue;
        }
        const matches = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        if (matches && entry.href.length > (best?.href.length ?? 0)) best = entry;
    }
    return best?.label ?? pathname;
}
