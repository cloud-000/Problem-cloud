import { fail, redirect } from "@sveltejs/kit";
import { authFailureMessage, validateSignupFields } from "$lib/auth";
import type { Actions } from "./$types";

export const actions: Actions = {
    default: async ({ request, locals: { supabase } }) => {
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
};
