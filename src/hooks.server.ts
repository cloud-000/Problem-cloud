import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { type Handle, redirect } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import {
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY,
} from "$env/static/public";
import type { Database } from "$lib/types/database.types";

const supabase: Handle = async ({ event, resolve }) => {
    event.locals.supabase = createServerClient<Database>(
        PUBLIC_SUPABASE_URL,
        PUBLIC_SUPABASE_PUBLISHABLE_KEY,
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

    // Validates the JWT locally (or via getUser as fallback) — never trust
    // getSession() alone on the server, since cookie data can be spoofed.
    event.locals.safeGetSession = async () => {
        const { data: claimsData, error } =
            await event.locals.supabase.auth.getClaims();
        if (error || !claimsData?.claims) {
            return { session: null, user: null };
        }
        const {
            data: { session },
        } = await event.locals.supabase.auth.getSession();

        const claims = claimsData.claims as any;
        const user: User = {
            id: claims.sub ?? "",
            created_at: claims.created_at || (claims.iat
                ? new Date(claims.iat * 1000).toISOString()
                : new Date().toISOString()),
            aud: claims.aud ?? "authenticated",
            role: claims.role,
            email: claims.email,
            email_confirmed_at: claims.email_verified
                ? new Date().toISOString()
                : undefined,
            phone: claims.phone,
            app_metadata: claims.app_metadata || {},
            user_metadata: claims.user_metadata || {},
            is_anonymous: claims.is_anonymous,
        };

        return { session, user };
    };

    return resolve(event, {
        filterSerializedResponseHeaders(name) {
            return (
                name === "content-range" || name === "x-supabase-api-version"
            );
        },
    });
};

const authGuard: Handle = async ({ event, resolve }) => {
    const { session, user } = await event.locals.safeGetSession();
    event.locals.session = session;
    event.locals.user = user;

    if (!event.locals.session && event.url.pathname === "/") {
        redirect(303, "/welcome");
    }

    if (!event.locals.session && event.url.pathname.startsWith("/private")) {
        redirect(303, "/auth/login");
    }

    if (event.locals.session && event.url.pathname === "/auth/login") {
        redirect(303, "/private");
    }

    // Admin-only section: gate /admin on profiles.admin_rank > 0.
    if (event.url.pathname.startsWith("/admin")) {
        if (!event.locals.user) {
            redirect(303, "/auth/login");
        }
        const { data: profile } = await event.locals.supabase
            .from("profiles")
            .select("admin_rank")
            .eq("id", event.locals.user.id)
            .single();
        if ((profile?.admin_rank ?? 0) <= 0) {
            redirect(303, "/");
        }
    }

    return resolve(event);
};

export const handle: Handle = sequence(supabase, authGuard);
