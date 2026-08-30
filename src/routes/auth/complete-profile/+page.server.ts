import { fail, redirect } from "@sveltejs/kit";
import { validateUsername } from "$lib/auth";
import { usernameClaimError } from "$lib/server/oauth";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals: { safeGetSession }, url }) => {
    const { user } = await safeGetSession();
    if (!user) redirect(303, "/auth/login");
    return { message: url.searchParams.get("error") === "username" ? "Choose another username to finish creating your account." : null };
};

export const actions: Actions = {
    default: async ({ request, locals: { supabase, safeGetSession } }) => {
        const { user } = await safeGetSession();
        if (!user) redirect(303, "/auth/login");

        const formData = await request.formData();
        const username = String(formData.get("username") ?? "").trim();
        const invalid = validateUsername(username);
        if (invalid) return fail(400, { message: invalid, username });

        const { error } = await supabase.rpc("claim_profile_username", { p_username: username });
        if (error) return fail(400, { message: usernameClaimError(error), username });

        redirect(303, "/");
    },
};
