import { fail, redirect } from "@sveltejs/kit";
import { authFailureMessage } from "$lib/auth";
import {
    clearOAuthSignupIntent,
    OAUTH_PROVIDER,
    oauthCallbackURL,
    redirectToOAuth,
} from "$lib/server/oauth";
import type { Actions } from "./$types";

export const load = ({ url }: { url: URL }) => ({
    oauthMessage: url.searchParams.get("oauth_error"),
});

export const actions: Actions = {
    password: async ({ request, locals: { supabase } }) => {
        const formData = await request.formData();
        const email = String(formData.get("email") ?? "");
        const password = String(formData.get("password") ?? "");

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            return fail(400, { message: authFailureMessage(error), email });
        }

        redirect(303, "/");
    },
    google: async ({ locals: { supabase }, cookies, url }) => {
        clearOAuthSignupIntent(cookies);
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: OAUTH_PROVIDER,
            options: { redirectTo: oauthCallbackURL(url) },
        });
        const message = redirectToOAuth(data, error);
        return fail(400, { message });
    },
};
