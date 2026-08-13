import { createClient } from "@supabase/supabase-js";
import {
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY,
} from "$env/static/public";
import type { LayoutLoad } from "./$types";
import type { Database } from "$lib/types/database.types";

/**
 * An **anonymous** Supabase client for the public shell's public reads (the
 * welcome page's corpus counts). The old root layout created one client that did
 * two jobs — auth session plumbing and public queries — so the splash pages
 * inherited the app's auth data merely by existing. They no longer do: this
 * client carries no cookies and persists no session, so nothing here can read or
 * refresh a user's tokens. Anything needing the signed-in user belongs under
 * `(app)`.
 */
export const load: LayoutLoad = async ({ data, fetch }) => {
    const supabase = createClient<Database>(
        PUBLIC_SUPABASE_URL,
        PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        {
            global: { fetch },
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        },
    );

    return { supabase, signedIn: data.signedIn };
};
