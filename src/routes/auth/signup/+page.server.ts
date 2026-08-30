import { fail, redirect } from "@sveltejs/kit";
import { authFailureMessage, validateSignupFields, validateUsername } from "$lib/auth";
import {
    OAUTH_PROVIDER,
    oauthCallbackURL,
    redirectToOAuth,
    setOAuthSignupIntent,
} from "$lib/server/oauth";
import type { Actions } from "./$types";

export const actions: Actions = {
    password: async ({ request, locals: { supabase } }) => {
        const formData = await request.formData();
        const email = String(formData.get("email") ?? "");
        const username = String(formData.get("username") ?? "");
        const password = String(formData.get("password") ?? "");
        const passwordConfirm = String(formData.get("password_confirm") ?? "");

        const invalid = validateSignupFields({
            email,
            username,
            password,
            passwordConfirm,
        });
        if (invalid) {
            return fail(400, { message: invalid, email, username });
        }

        const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
                data: {
                    username: username.trim(),
                },
            },
        });

        if (error) {
            return fail(400, {
                message: authFailureMessage(error),
                email,
                username,
            });
        }

        if (!data.session) {
            return {
                confirmationRequired: true,
                email: email.trim(),
            };
        }

        redirect(303, "/");
    },
    google: async ({ request, locals: { supabase }, cookies, url }) => {
        const formData = await request.formData();
        const username = String(formData.get("username") ?? "").trim();
        const invalid = validateUsername(username);
        if (invalid) return fail(400, { message: invalid, username });

        const { data: existing, error: lookupError } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", username)
            .maybeSingle();
        if (lookupError) {
            return fail(500, { message: "We couldn't check that username. Try again.", username });
        }
        if (existing) {
            return fail(400, { message: "That username is taken. Pick another.", username });
        }

        setOAuthSignupIntent(cookies, { provider: OAUTH_PROVIDER, username }, url.protocol === "https:");
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: OAUTH_PROVIDER,
            options: { redirectTo: oauthCallbackURL(url) },
        });
        const message = redirectToOAuth(data, error);
        return fail(400, { message, username });
    },
};
