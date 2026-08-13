import {
    createBrowserClient,
    createServerClient,
    isBrowser,
} from "@supabase/ssr";
import {
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY,
} from "$env/static/public";
import type { LayoutLoad } from "./$types";
import type { Database } from "$lib/types/database.types";

export const load: LayoutLoad = async ({ data, depends, fetch }) => {
    depends("supabase:auth");

    const supabase = isBrowser()
        ? createBrowserClient<Database>(
              PUBLIC_SUPABASE_URL,
              PUBLIC_SUPABASE_PUBLISHABLE_KEY,
              {
                  global: { fetch },
              },
          )
        : createServerClient<Database>(
              PUBLIC_SUPABASE_URL,
              PUBLIC_SUPABASE_PUBLISHABLE_KEY,
              {
                  global: { fetch },
                  cookies: { getAll: () => data.cookies },
              },
          );

    const { session, user, profile, aiCoachEnabled } = data;

    return { supabase, session, user, profile, aiCoachEnabled };
};
