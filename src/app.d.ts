import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "$lib/database.types.ts"; // import generated types

declare global {
    type UserData = {
        id: string;
        email: string | null;
        phone: string | null;
        user_metadata: UserMetadata | null;
        app_metadata: UserAppMetadata | null;
        role: string | null;
        expires_at: number;
    };
    namespace App {
        // interface Error {}
        interface Locals {
            supabase: SupabaseClient<Database>;
            getUser: (latestFromServer?: boolean) => Promise<{
                // session: Session | null;
                user: UserData | null;
                error: Error | null;
            }>;
            session: Session | null;
            user: User | null;
        }
        interface PageData {
            session: Session | null;
        }
        // interface PageState {}
        // interface Platform {}
    }
}

export {};
