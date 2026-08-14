export type OfflinePresentationKind = "downloads" | "practice" | "library" | "unavailable";

export type OfflinePresentation = {
    path: string;
    kind: OfflinePresentationKind;
    title: string;
    retryable: boolean;
};

/** One declaration drives both the worker allowlist and the neutral shell. */
export const OFFLINE_PRESENTATIONS = [
    { path: "/offline", kind: "downloads", title: "Downloads", retryable: true },
    { path: "/practice", kind: "practice", title: "Practice", retryable: true },
    { path: "/library", kind: "library", title: "Library", retryable: true },
    { path: "/find", kind: "library", title: "Find", retryable: true },
    { path: "/", kind: "unavailable", title: "Home", retryable: true },
    { path: "/progress", kind: "unavailable", title: "Progress", retryable: true },
    { path: "/goals", kind: "unavailable", title: "Goals", retryable: true },
    { path: "/history", kind: "unavailable", title: "History", retryable: true },
    { path: "/coach", kind: "unavailable", title: "Coach", retryable: true },
    { path: "/settings", kind: "unavailable", title: "Settings", retryable: true },
] as const satisfies readonly OfflinePresentation[];

export function offlinePresentation(pathname: string): OfflinePresentation | null {
    return OFFLINE_PRESENTATIONS.find((entry) => entry.path === pathname) ?? null;
}

export function offlineNavigationAllowed(pathname: string): boolean {
    return offlinePresentation(pathname) !== null;
}
