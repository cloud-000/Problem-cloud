import type { LayoutServerLoad } from "./$types";

/**
 * The public shell needs exactly one fact about the visitor: whether to offer
 * "Dashboard" or "Log in". It deliberately does **not** inherit the app's auth
 * payload — the authenticated load moved under `(app)` so no token-bearing
 * `__data.json` is produced for a cacheable public document (`docs/offline.md`
 * §3a). A boolean is the whole contract; never widen it to the session, the
 * user, or the profile.
 */
export const load: LayoutServerLoad = async ({ locals: { safeGetSession } }) => {
    const { user } = await safeGetSession();
    return { signedIn: Boolean(user) };
};
