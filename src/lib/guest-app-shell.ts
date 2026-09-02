/** Cookie read by `(app)/+layout.server.ts` to gate first-time guests. */
export const GUEST_APP_SHELL_COOKIE = "pc_guest_app_shell";

type CookieReader = { get: (name: string) => string | undefined };

export function hasGuestSeenAppShell(
    cookies: CookieReader | null | undefined,
): boolean {
    return cookies?.get(GUEST_APP_SHELL_COOKIE) === "1";
}

/** Call from the welcome page (or any deliberate entry) before navigating into `(app)`. */
export function markGuestSeenAppShell(): void {
    if (typeof document === "undefined") return;
    try {
        const maxAge = 60 * 60 * 24 * 365;
        document.cookie = `${GUEST_APP_SHELL_COOKIE}=1; path=/; max-age=${maxAge}; samesite=lax`;
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
}
