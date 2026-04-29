import { PUBLIC_DB_URL, PUBLIC_DB_KEY } from "$env/static/public";
import { createServerClient } from "@supabase/ssr";
import type { Handle } from "@sveltejs/kit";
import type { Database } from "$lib/database.types";

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.supabase = createServerClient<Database>(
        PUBLIC_DB_URL,
        PUBLIC_DB_KEY,
        {
            cookies: {
                getAll: () => event.cookies.getAll(),
                setAll: (cookiesToSet) => {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        event.cookies.set(name, value, {
                            ...options,
                            path: "/",
                        });
                    });
                },
            },
        },
    );
    event.locals.getUser = async (latestFromServer = false) => {
        const { data: claimsData, error: claimsError } =
            await event.locals.supabase.auth.getClaims();

        if (claimsError) {
            return {
                error: claimsError,
                user: null,
            };
        }

        if (!claimsData) {
            return {
                error: null,
                user: null,
            };
        }

        const { claims } = claimsData;
        if (latestFromServer) {
            const { data: userData, error: userError } =
                await event.locals.supabase.auth.getUser();

            if (userError) {
                return {
                    error: userError,
                    user: null,
                };
            }

            if (!userData) {
                return {
                    error: null,
                    user: null,
                };
            }

            const { user } = userData;
            return {
                error: null,
                user: {
                    id: user.id,
                    email: user.email || null,
                    phone: user.phone || null,
                    user_metadata: user.user_metadata || null,
                    app_metadata: user.app_metadata || null,
                    role: user.role || null,
                    expires_at: claims.exp,
                },
            };
        }
        return {
            error: null,
            user: {
                id: claims.sub,
                email: claims.email || null,
                phone: claims.phone || null,
                user_metadata: claims.user_metadata || null,
                app_metadata: claims.app_metadata || null,
                role: claims.role || null,
                expires_at: claims.exp,
            },
        };
    };

    return resolve(event, {
        filterSerializedResponseHeaders(name: string) {
            return (
                name === "content-range" || name === "x-supabase-api-version"
            );
        },
    });
};
