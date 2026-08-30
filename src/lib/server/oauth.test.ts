import { describe, expect, test } from "bun:test";
import {
    OAUTH_SIGNUP_COOKIE,
    oauthCallbackURL,
    setOAuthSignupIntent,
    takeOAuthSignupIntent,
} from "./oauth";

function cookieJar(initial?: string) {
    let value = initial;
    const writes: Array<{ value: string; options: Record<string, unknown> }> = [];
    const deletes: Array<Record<string, unknown>> = [];
    return {
        get: () => value,
        set: (_name: string, next: string, options: Record<string, unknown>) => {
            value = next;
            writes.push({ value: next, options });
        },
        delete: (_name: string, options: Record<string, unknown>) => {
            value = undefined;
            deletes.push(options);
        },
        writes,
        deletes,
    };
}

describe("OAuth signup handoff", () => {
    test("stores a short-lived, callback-only username intent", () => {
        const cookies = cookieJar();
        setOAuthSignupIntent(cookies as never, { provider: "google", username: "ada" }, true);

        expect(JSON.parse(cookies.writes[0].value)).toEqual({ provider: "google", username: "ada" });
        expect(cookies.writes[0].options).toMatchObject({
            path: "/auth/callback",
            httpOnly: true,
            sameSite: "lax",
            secure: true,
            maxAge: 600,
        });
    });

    test("consumes only a Google signup intent", () => {
        const cookies = cookieJar(JSON.stringify({ provider: "google", username: "ada" }));
        expect(takeOAuthSignupIntent(cookies as never)).toEqual({ provider: "google", username: "ada" });
        expect(cookies.deletes).toEqual([{ path: "/auth/callback" }]);

        const malformed = cookieJar(JSON.stringify({ provider: "github", username: "ada" }));
        expect(takeOAuthSignupIntent(malformed as never)).toBeNull();
        expect(OAUTH_SIGNUP_COOKIE).toBe("pc_oauth_signup");
    });

    test("uses the current app origin for the Supabase return URL", () => {
        expect(oauthCallbackURL(new URL("https://practice.example/auth/signup"))).toBe(
            "https://practice.example/auth/callback",
        );
    });
});
