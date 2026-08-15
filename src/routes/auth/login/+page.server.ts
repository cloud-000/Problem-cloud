import { fail, redirect } from "@sveltejs/kit";
import { authFailureMessage } from "$lib/auth";
import type { Actions } from "./$types";

export const actions: Actions = {
    default: async ({ request, locals: { supabase } }) => {
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
};
