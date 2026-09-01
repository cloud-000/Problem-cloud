import type { SupabaseClient, Session, User } from "@supabase/supabase-js";
import type { Database } from "./lib/types/database.types";

declare global {
    namespace App {
        interface Locals {
            supabase: SupabaseClient<Database>;
            safeGetSession: () => Promise<{
                session: Session | null;
                user: User | null;
            }>;
            session: Session | null;
            user: User | null;
        }
        /**
         * Every field here is supplied by the `(app)` layout load and is
         * therefore **absent outside the authenticated shell** — the splash
         * group has its own anonymous client, and `/offline` has no load at
         * all (`docs/offline.md` §3). They are optional so a component reading
         * `page.data.*` has to acknowledge that rather than assume the app
         * shell is above it.
         */
        interface PageData {
            session?: Session | null;
            supabase?: SupabaseClient<Database>;
            user?: User | null;
            profile?: Database["public"]["Tables"]["profiles"]["Row"] | null;
            hostedAllowance?: import("./lib/ai/hosted-allowance").HostedAllowance | null;
        }
    }
}

export {};
