import { redirect } from "@sveltejs/kit";
import {
    oauthCallbackFailureURL,
    takeOAuthSignupIntent,
} from "$lib/server/oauth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies, locals: { supabase } }) => {
    const code = url.searchParams.get("code");
    if (!code) redirect(303, oauthCallbackFailureURL({ message: "Google did not return a sign-in code." }));

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) redirect(303, oauthCallbackFailureURL(error));

    const intent = takeOAuthSignupIntent(cookies);
    if (intent) {
        const { error: claimError } = await supabase.rpc("claim_profile_username", {
            p_username: intent.username,
        });
        if (claimError) {
            redirect(303, "/auth/complete-profile?error=username");
        }
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", data.user.id)
        .maybeSingle();
    if (!profile?.username) redirect(303, "/auth/complete-profile");

    redirect(303, "/");
};
