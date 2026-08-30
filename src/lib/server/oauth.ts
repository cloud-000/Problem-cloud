import { redirect, type Cookies } from "@sveltejs/kit";
import { authFailureMessage } from "$lib/auth";

export const OAUTH_PROVIDER = "google" as const;
export const OAUTH_SIGNUP_COOKIE = "pc_oauth_signup";

type OAuthSignupIntent = {
    provider: typeof OAUTH_PROVIDER;
    username: string;
};

export function setOAuthSignupIntent(cookies: Cookies, intent: OAuthSignupIntent, secure: boolean) {
    cookies.set(OAUTH_SIGNUP_COOKIE, JSON.stringify(intent), {
        path: "/auth/callback",
        httpOnly: true,
        sameSite: "lax",
        secure,
        maxAge: 10 * 60,
    });
}

export function takeOAuthSignupIntent(cookies: Cookies): OAuthSignupIntent | null {
    const value = cookies.get(OAUTH_SIGNUP_COOKIE);
    cookies.delete(OAUTH_SIGNUP_COOKIE, { path: "/auth/callback" });
    if (!value) return null;

    try {
        const parsed = JSON.parse(value) as Partial<OAuthSignupIntent>;
        if (parsed.provider === OAUTH_PROVIDER && typeof parsed.username === "string") {
            return { provider: parsed.provider, username: parsed.username };
        }
    } catch {
        // Treat a malformed or stale cookie as a normal sign-in attempt.
    }
    return null;
}

export function clearOAuthSignupIntent(cookies: Cookies) {
    cookies.delete(OAUTH_SIGNUP_COOKIE, { path: "/auth/callback" });
}

export function oauthCallbackURL(url: URL): string {
    return new URL("/auth/callback", url.origin).toString();
}

export function redirectToOAuth(data: { url: string | null }, error: { message?: string | null; code?: string | null } | null) {
    if (error || !data.url) {
        return authFailureMessage(error ?? {});
    }
    redirect(303, data.url);
}

export function oauthCallbackFailureURL(error: { message?: string | null; code?: string | null }): string {
    const url = new URL("/auth/login", "http://problemcloud.local");
    url.searchParams.set("oauth_error", authFailureMessage(error));
    return `${url.pathname}${url.search}`;
}

export function usernameClaimError(error: { message?: string | null; code?: string | null }): string {
    const message = error.message ?? "";
    if (/USERNAME_TAKEN|duplicate key/i.test(message)) return "That username was just claimed. Choose another.";
    if (/USERNAME_INVALID/i.test(message)) return "Username must be at least 3 characters.";
    if (/USERNAME_ALREADY_SET/i.test(message)) return "Your username is already set.";
    return "We couldn't save that username. Try again.";
}
